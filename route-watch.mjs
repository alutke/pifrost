/**
 * Native Bifrost route watcher.
 * Runs only in the standalone Pifrost control plane, never in the OMP provider.
 * Management credentials are not made available to inference discovery.
 */
import { spawn } from "node:child_process";
import {
  closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  aliasManifestPath, loadAliasManifest, ompAgentDir, pifrostConfigDir,
  writeAliasManifest, diffAliases,
} from "./cli-lib.mjs";
import { routePolicyDrift } from "./route-policy-fingerprint.mjs";

export const DEFAULT_WATCH_INTERVAL_MS = 60_000;
export const MIN_WATCH_INTERVAL_MS = 15_000;
export const MAX_WATCH_INTERVAL_MS = 3_600_000;
export const WATCH_MAX_BACKOFF_MS = 15 * 60_000;

export function watchPaths(env = process.env) {
  const root = pifrostConfigDir(env);
  return {
    lock: join(root, "route-watch.lock"),
    status: join(root, "route-watch-status.json"),
    manifest: aliasManifestPath(env),
    catalog: env.PIFROST_CACHE_FILE?.trim() || join(ompAgentDir(env), "pifrost.catalog.json"),
  };
}

export function validateWatchInterval(raw) {
  const seconds = raw === undefined ? DEFAULT_WATCH_INTERVAL_MS / 1000 : Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds * 1000 < MIN_WATCH_INTERVAL_MS ||
      seconds * 1000 > MAX_WATCH_INTERVAL_MS) {
    throw new Error("Watcher interval must be an integer between 15 and 3600 seconds.");
  }
  return seconds * 1000;
}

function writeJsonAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), "." + basename(path) + "." + randomUUID() + ".tmp");
  try {
    writeFileSync(temp, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function readWatchStatus(env = process.env) {
  const path = watchPaths(env).status;
  if (!existsSync(path)) return { status: "never-run" };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || value.schemaVersion !== 1) throw new Error("schema");
    return value;
  } catch {
    return { status: "unreadable-status" };
  }
}

export function writeWatchStatus(patch, env = process.env) {
  const previous = readWatchStatus(env);
  const next = {
    ...previous,
    ...patch,
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
  };
  writeJsonAtomic(watchPaths(env).status, next);
  return next;
}

export class RouteWatchError extends Error {
  constructor(code) { super(code); this.code = code; this.name = "RouteWatchError"; }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

/** Interprocess exclusive lock. Never steal an active PID's lock. */
export async function withRouteWatchLock(operation, env = process.env) {
  const { lock } = watchPaths(env);
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  let fd;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fd = openSync(lock, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch {}
      if (!owner || processAlive(owner.pid)) throw new RouteWatchError("lock-busy");
      // Remove only if the lock file did not change during stale-owner detection.
      const before = statSync(lock);
      const after = statSync(lock);
      if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) throw new RouteWatchError("lock-busy");
      unlinkSync(lock);
    }
  }
  if (fd === undefined) throw new RouteWatchError("lock-busy");
  writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n");
  try {
    return await operation();
  } finally {
    closeSync(fd);
    try {
      const owner = JSON.parse(readFileSync(lock, "utf8"));
      if (owner.pid === process.pid) unlinkSync(lock);
    } catch {}
  }
}

function validateSnapshot(snapshot) {
  const count = snapshot?.manifest?.aliases && Object.keys(snapshot.manifest.aliases).length;
  if (!Array.isArray(snapshot?.rules) || !count ||
      !/^[a-f0-9]{64}$/u.test(snapshot.policyFingerprint ?? "")) {
    throw new RouteWatchError("invalid-routing-snapshot");
  }
  // Never publish partial or malformed rule lists.
  if (snapshot.rules.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule))) {
    throw new RouteWatchError("invalid-routing-snapshot");
  }
  return count;
}

async function runOmpRefresh(env, timeoutMs = 90_000) {
  // Never expose management credentials to the inference extension.
  const childEnv = { ...env, PIFROST_FORCE_REFRESH: "1" };
  for (const key of [
    "BIFROST_MANAGEMENT_API_KEY", "BIFROST_ADMIN_USERNAME",
    "BIFROST_ADMIN_PASSWORD", "BIFROST_SETUP_TOKEN", "BIFROST_MANAGEMENT_AUTH_MODE",
  ]) delete childEnv[key];
  await new Promise((ok, reject) => {
    const child = spawn("omp", ["models", "refresh"], {
      env: childEnv, stdio: ["ignore", "ignore", "ignore"], shell: false,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new RouteWatchError("catalog-staging-failed"));
      else ok();
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("timeout")); }, timeoutMs);
    child.once("error", finish);
    child.once("exit", (code, signal) => finish(code === 0 && !signal ? undefined : new Error("exit")));
  });
}

export async function stageRouteCatalog(manifest, env = process.env, refresh = runOmpRefresh) {
  const paths = watchPaths(env);
  mkdirSync(dirname(paths.manifest), { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(dirname(paths.manifest), ".pifrost-stage-"));
  const stagedManifest = join(temp, "aliases.json");
  const stagedCache = join(temp, "catalog.json");
  try {
    writeFileSync(stagedManifest, JSON.stringify(manifest), { mode: 0o600 });
    await refresh({
      ...env,
      PIFROST_ALIASES: stagedManifest,
      PIFROST_CACHE_FILE: stagedCache,
    });
    if (!existsSync(stagedCache)) throw new RouteWatchError("catalog-staging-failed");
    const catalog = JSON.parse(readFileSync(stagedCache, "utf8"));
    const ids = new Set((catalog.models ?? []).map(model => model?.id?.toLowerCase()));
    if (!Array.isArray(catalog.models) || catalog.models.length === 0 ||
        !Array.isArray(catalog.diagnostics) ||
        !Object.keys(manifest.aliases).every(id => ids.has(id.toLowerCase())) ||
        !/^[a-f0-9]{64}$/u.test(catalog.aliasFingerprint ?? "")) {
      throw new RouteWatchError("catalog-staging-invalid");
    }
    return {
      path: stagedCache,
      commit() {
        mkdirSync(dirname(paths.catalog), { recursive: true, mode: 0o700 });
        const backup = join(temp, "old-catalog.json");
        const hadCatalog = existsSync(paths.catalog);
        if (hadCatalog) copyFileSync(paths.catalog, backup);
        let manifestWritten = false;
        try {
          writeAliasManifest(manifest, env);
          manifestWritten = true;
          // Both files use safe atomic replacement; cache fingerprint fails
          // closed if a reader runs between their individual renames.
          renameSync(stagedCache, paths.catalog);
        } catch (error) {
          if (manifestWritten) throw error;
          throw error;
        }
        return { backup, hadCatalog };
      },
      cleanup() { rmSync(temp, { recursive: true, force: true }); },
    };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * One poll is single-flight by interprocess lock. A second matching snapshot
 * acts as short debounce. A final snapshot after stage blocks time-of-check /
 * time-of-use drift, so a transient/half-edited Bifrost rule is never applied.
 */
export async function reconcileRoutesOnce({ capture, stage = stageRouteCatalog,
  read = loadAliasManifest, lock = withRouteWatchLock, debounceMs = 1_500,
  wait = sleep, env = process.env, status = writeWatchStatus } = {}) {
  if (typeof capture !== "function") throw new Error("route watcher requires a management-plane capture function");
  return lock(async () => {
    const local = read(watchPaths(env).manifest);
    let first;
    try { first = await capture(); validateSnapshot(first); }
    catch { throw new RouteWatchError("gateway-read-failed"); }
    const changed = routePolicyDrift(local.policyFingerprint, first.policyFingerprint) !== "verified-match"
      || diffAliases(local, first.manifest).length > 0;
    if (!changed) {
      const result = { status: "unchanged", fingerprint: first.policyFingerprint.slice(0, 12),
        lastCheckedAt: new Date().toISOString() };
      status(result, env);
      return result;
    }
    await wait(debounceMs);
    let second;
    try { second = await capture(); validateSnapshot(second); }
    catch { throw new RouteWatchError("gateway-read-failed"); }
    if (first.policyFingerprint !== second.policyFingerprint ||
        diffAliases(first.manifest, second.manifest).length > 0) {
      throw new RouteWatchError("routing-changed-during-check");
    }
    const next = { ...second.manifest, synchronizedAt: new Date().toISOString(),
      policyFingerprint: second.policyFingerprint };
    let staged;
    try { staged = await stage(next, env); }
    catch (error) {
      throw error instanceof RouteWatchError ? error : new RouteWatchError("catalog-staging-failed");
    }
    try {
      const confirmed = await capture();
      validateSnapshot(confirmed);
      if (confirmed.policyFingerprint !== second.policyFingerprint ||
          diffAliases(confirmed.manifest, second.manifest).length) {
        throw new RouteWatchError("routing-changed-during-refresh");
      }
      // If another manual sync won between capture and commit, lock access
      // prevents merging incompatible local state.
      const result = staged.commit();
      const reply = { status: "updated", fingerprint: second.policyFingerprint.slice(0, 12),
        routes: Object.keys(next.aliases).length, lastCheckedAt: new Date().toISOString(),
        lastChangedAt: new Date().toISOString(), restartRequired: true };
      status(reply, env);
      return reply;
    } catch (error) {
      throw error instanceof RouteWatchError ? error : new RouteWatchError("catalog-commit-failed");
    } finally {
      staged.cleanup();
    }
  }, env);
}

export async function runRouteWatchLoop({ capture, intervalMs = DEFAULT_WATCH_INTERVAL_MS,
  signal, execute = reconcileRoutesOnce, status = writeWatchStatus, env = process.env,
  log = console.log, wait = sleep } = {}) {
  let failures = 0;
  while (!signal?.aborted) {
    try {
      const result = await execute({ capture, env, status });
      failures = 0;
      if (result.status === "updated") log("Pifrost routes updated; restart running OMP sessions to load new routing metadata.");
    } catch (error) {
      const code = error instanceof RouteWatchError ? error.code : "watcher-error";
      failures++;
      try { status({ status: "degraded", lastError: code, failures,
        lastCheckedAt: new Date().toISOString() }, env); } catch {}
      log("Pifrost route watch: " + code + " (existing configuration retained).");
    }
    if (signal?.aborted) break;
    const interval = failures ? Math.min(intervalMs * 2 ** Math.min(failures, 8), WATCH_MAX_BACKOFF_MS) : intervalMs;
    try { await wait(interval, undefined, { signal }); } catch { break; }
  }
}
