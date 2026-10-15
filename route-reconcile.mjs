/**
 * Event-driven (not a service) Bifrost route reconciliation.
 * Called from the interactive OMP extension immediately before user work.
 * The CLI child owns management authentication; no secrets reach the OMP
 * provider or model registry. No timers, cron jobs or background workers.
 */
import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  aliasManifestPath, diffAliases, loadAliasManifest, loadState,
  managementAuthFromState, pifrostConfigDir, runtimeConfigFromState,
  writeAliasManifest,
} from "./cli-lib.mjs";
import { discoverRoutingRules, deriveAliasesRobust } from "./routing-discovery.mjs";
import { routePolicyDrift, routePolicyFingerprint } from "./route-policy-fingerprint.mjs";

export class RouteReconcileError extends Error {
  constructor(code) { super(code); this.name = "RouteReconcileError"; this.code = code; }
}

export function validateRemoteSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.rules) || snapshot.rules.length === 0 ||
      snapshot.rules.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule)) ||
      !snapshot?.manifest || !snapshot.manifest.aliases ||
      Object.keys(snapshot.manifest.aliases).length === 0 ||
      !/^[a-f0-9]{64}$/u.test(snapshot.policyFingerprint ?? "")) {
    throw new RouteReconcileError("invalid-rule-inventory");
  }
  return snapshot;
}

export async function captureRouteSnapshot(env = process.env) {
  const state = loadState(env);
  const config = runtimeConfigFromState(state, env);
  const auth = managementAuthFromState(state, env);
  if (!config.url || !auth) throw new RouteReconcileError("management-credentials-unavailable");
  // On-demand checks must not stall the next user prompt indefinitely.
  // Each management request has a three-second bound; older manual commands
  // retain their standard timeout.
  const discovered = await discoverRoutingRules(config.url, auth, { timeoutMs: 3000 });
  return validateRemoteSnapshot({
    rules: discovered.rules,
    manifest: deriveAliasesRobust(discovered.rules),
    policyFingerprint: routePolicyFingerprint(discovered.rules),
  });
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

/** A short-lived lock, only while a user-triggered check is running.
 * No persistent process or sleeping loop is ever created.
 */
export async function withReconcileLock(action, env = process.env) {
  const path = join(pifrostConfigDir(env), "route-reconcile.lock");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fd = openSync(path, "wx", 0o600); break; }
      catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let owner;
        try { owner = JSON.parse(readFileSync(path, "utf8")); } catch {}
        // If an owner is live or an unknown lock exists, skip this check.
        if (!owner || alive(owner.pid)) throw new RouteReconcileError("check-already-in-progress");
        // A known dead process's lock may be cleaned up. Never steal a
        // lock if its recorded owner changed before deletion.
        let again;
        try { again = JSON.parse(readFileSync(path, "utf8")); } catch {}
        if (!again || again.pid !== owner.pid || again.nonce !== owner.nonce) {
          throw new RouteReconcileError("check-already-in-progress");
        }
        unlinkSync(path);
      }
    }
    if (fd === undefined) throw new RouteReconcileError("check-already-in-progress");
    const token = { pid: process.pid, nonce: String(process.hrtime.bigint()) };
    writeFileSync(fd, JSON.stringify(token));
    try { return await action(); }
    finally {
      try {
        const current = JSON.parse(readFileSync(path, "utf8"));
        if (current.pid === token.pid && current.nonce === token.nonce) unlinkSync(path);
      } catch {}
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** No refresh here. OMP refreshes only its own Bifrost provider in-session
 * after this succeeds. Standalone users can still use routes sync.
 */
export async function reconcileRouteSnapshot({
  env = process.env, capture = () => captureRouteSnapshot(env),
  read = () => loadAliasManifest(aliasManifestPath(env)),
  write = manifest => writeAliasManifest(manifest, env),
  lock = action => withReconcileLock(action, env),
} = {}) {
  return lock(async () => {
    const local = read();
    let first;
    try { first = validateRemoteSnapshot(await capture()); }
    catch (error) {
      if (error instanceof RouteReconcileError) throw error;
      throw new RouteReconcileError("gateway-check-failed");
    }
    const drift = routePolicyDrift(local.policyFingerprint, first.policyFingerprint);
    if (drift === "verified-match" && diffAliases(local, first.manifest).length === 0) {
      return { status: "unchanged", fingerprint: first.policyFingerprint.slice(0, 12) };
    }
    // A second, independent check rejects routes being edited mid-request.
    let second;
    try { second = validateRemoteSnapshot(await capture()); }
    catch { throw new RouteReconcileError("gateway-confirmation-failed"); }
    if (first.policyFingerprint !== second.policyFingerprint ||
        diffAliases(first.manifest, second.manifest).length !== 0) {
      throw new RouteReconcileError("gateway-policy-changing");
    }
    try {
      write({
        ...second.manifest,
        synchronizedAt: new Date().toISOString(),
        policyFingerprint: second.policyFingerprint,
      });
    } catch {
      throw new RouteReconcileError("manifest-write-failed");
    }
    return { status: "updated", fingerprint: second.policyFingerprint.slice(0, 12),
      routes: Object.keys(second.manifest.aliases).length };
  });
}

/**
 * Re-entrant OMP lifecycle hooks are normal. Throttle wall-clock checks and
 * serialize them; refresh ONLY the Bifrost provider when the CLI reports a
 * real change. No timer, service or background process is retained.
 */
export function createOnDemandRouteCheck({
  now = () => Date.now(),
  minIntervalMs = 60_000,
  run, refresh, notify = () => {},
} = {}) {
  if (typeof run !== "function" || typeof refresh !== "function") throw new Error("Missing route-check dependencies");
  let checkedAt = -Infinity;
  let pending;
  let needsRegistryRefresh = false;
  return async function check(context) {
    if (pending) return pending;
    const current = now();
    if (!needsRegistryRefresh && current - checkedAt < minIntervalMs) return { status: "throttled" };
    checkedAt = current;
    pending = (async () => {
      try {
        // If the previous prompt successfully saved new aliases but model
        // registration failed, retry just OMP's Bifrost registry on the next
        // user prompt. Otherwise unchanged gateway policy would mask the
        // incomplete in-session refresh indefinitely.
        if (needsRegistryRefresh) {
          await refresh(context);
          needsRegistryRefresh = false;
          notify("Pifrost: Bifrost model registration recovered.", "info", context);
          return { status: "refreshed", modelsRefreshed: true };
        }
        const result = await run();
        if (result?.status === "unavailable") throw new Error("gateway check unavailable");
        if (result?.status !== "updated") return result;
        needsRegistryRefresh = true;
        await refresh(context);
        needsRegistryRefresh = false;
        notify("Pifrost: Bifrost routes changed; refreshed OMP models for future selections.", "info", context);
        return { ...result, modelsRefreshed: true };
      } catch {
        notify(needsRegistryRefresh
          ? "Pifrost: routes saved but OMP model refresh failed; will retry at your next prompt."
          : "Pifrost: route check unavailable; keeping the existing OMP models. Run pifrost routes sync if needed.",
          "warning", context);
        return { status: "unavailable" };
      }
    })();
    try { return await pending; }
    finally { pending = undefined; }
  };
}
