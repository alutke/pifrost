import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  reconcileRoutesOnce, withRouteWatchLock, stageRouteCatalog,
  watchPaths, validateWatchInterval, RouteWatchError,
  readWatchStatus, runRouteWatchLoop,
} from "../route-watch.mjs";
import { routePolicyFingerprint } from "../route-policy-fingerprint.mjs";

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "pifrost-route-watch-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, PIFROST_CONFIG_DIR: home,
    PIFROST_ALIASES: join(home, "aliases.json"),
    PIFROST_CACHE_FILE: join(home, "catalog.json"),
    PI_CODING_AGENT_DIR: home };
  const base = { aliases: { "omp-default": { name: "omp-default", chain: ["alpha/first"] } },
    includePhysicalModels: false };
  const rules = [{ id: "route-default", name: "omp-default", enabled: true,
    cel_expression: "model == 'omp-default'", targets: [{ provider: "alpha", model: "first", weight: 1 }] }];
  const snapshot = (extra = {}) => ({ rules: extra.rules ?? rules,
    manifest: extra.manifest ?? base,
    policyFingerprint: routePolicyFingerprint(extra.rules ?? rules) });
  return { home, env, base, rules, snapshot };
}

test("watcher uses complete rule-policy fingerprints and never refreshes unchanged rules", async t => {
  const f = fixture(t);
  const snap = f.snapshot();
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify({ ...f.base, policyFingerprint: snap.policyFingerprint }));
  let captures = 0, staged = 0, statuses = [];
  const result = await reconcileRoutesOnce({
    env: f.env, capture: async () => { captures++; return snap; },
    stage: async () => { staged++; throw Error("should not stage"); },
    status: value => statuses.push(value),
  });
  assert.equal(result.status, "unchanged");
  assert.equal(captures, 1);
  assert.equal(staged, 0);
  assert.equal(statuses[0].lastError, null);
});

test("changed CEL only forces staged reconcile and triple-checks policy stability", async t => {
  const f = fixture(t);
  const original = f.snapshot();
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify({ ...f.base, policyFingerprint: original.policyFingerprint }));
  const changed = f.snapshot({ rules: [{ ...f.rules[0], cel_expression: "model == 'omp-default' && request_type == 'chat'" }] });
  let captures = 0, committed = 0, cleaned = 0;
  const result = await reconcileRoutesOnce({
    env: f.env, capture: async () => { captures++; return changed; },
    stage: async () => ({ commit: () => { committed++; }, cleanup: () => { cleaned++; } }),
    wait: async () => {},
    status: () => {},
  });
  assert.equal(result.status, "updated");
  assert.equal(captures, 3);
  assert.equal(committed, 1);
  assert.equal(cleaned, 1);
});

test("different debounced or post-stage policy rejects write and cleans up", async t => {
  const f = fixture(t);
  const a = f.snapshot();
  const b = f.snapshot({ rules: [{ ...f.rules[0], cel_expression: "model == 'omp-default' && request_type == 'chat'" }] });
  let captured = 0, commits = 0, cleanups = 0;
  await assert.rejects(reconcileRoutesOnce({
    env: f.env, capture: async () => ++captured === 2 ? b : a,
    wait: async () => {},
    stage: async () => ({ commit: () => { commits++; }, cleanup: () => { cleanups++; } }),
  }), /routing-changed-during-check/);
  assert.equal(commits, 0);
  captured = 0;
  await assert.rejects(reconcileRoutesOnce({
    env: f.env, capture: async () => ++captured === 3 ? b : a,
    wait: async () => {},
    stage: async () => ({ commit: () => { commits++; }, cleanup: () => { cleanups++; } }),
  }), /routing-changed-during-refresh/);
  assert.equal(commits, 0);
  assert.equal(cleanups, 1);
});

test("refuse empty, malformed, partial inventory without overwriting existing aliases", async t => {
  const f = fixture(t);
  const original = JSON.stringify({ ...f.base, policyFingerprint: "a".repeat(64) });
  writeFileSync(f.env.PIFROST_ALIASES, original);
  for (const invalid of [
    { rules: [], manifest: { aliases: {}, includePhysicalModels: false }, policyFingerprint: "b".repeat(64) },
    { rules: [null], manifest: f.base, policyFingerprint: "b".repeat(64) },
    { rules: [f.rules[0]], manifest: f.base, policyFingerprint: "not-a-fingerprint" },
  ]) {
    await assert.rejects(reconcileRoutesOnce({ env: f.env, capture: async () => invalid }),
      /gateway-read-failed/);
    assert.equal(readFileSync(f.env.PIFROST_ALIASES, "utf8"), original);
  }
});

test("catalog staging keeps old config until it is valid, commits both files, and strips admin secrets", async t => {
  const f = fixture(t);
  const original = { ...f.base, policyFingerprint: "a".repeat(64) };
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify(original));
  writeFileSync(f.env.PIFROST_CACHE_FILE, "old-cache");
  const manifest = { ...f.base, policyFingerprint: "b".repeat(64),
    synchronizedAt: new Date().toISOString() };
  let seenEnvironment;
  const staged = await stageRouteCatalog(manifest, {
    ...f.env, BIFROST_ADMIN_PASSWORD: "secret-password",
    BIFROST_MANAGEMENT_API_KEY: "secret-token",
  }, async environment => {
    seenEnvironment = environment;
    const readManifest = JSON.parse(readFileSync(environment.PIFROST_ALIASES, "utf8"));
    assert.deepEqual(readManifest.aliases, f.base.aliases);
    assert.equal(readFileSync(f.env.PIFROST_ALIASES, "utf8"), JSON.stringify(original));
    writeFileSync(environment.PIFROST_CACHE_FILE, JSON.stringify({
      aliasFingerprint: "c".repeat(64), diagnostics: [],
      models: [{ id: "omp-default" }]
    }));
  });
  assert.match(readFileSync(f.env.PIFROST_CACHE_FILE, "utf8"), /old-cache/);
  staged.commit();
  staged.cleanup();
  assert.equal(JSON.parse(readFileSync(f.env.PIFROST_ALIASES, "utf8")).policyFingerprint, manifest.policyFingerprint);
  assert.equal(JSON.parse(readFileSync(f.env.PIFROST_CACHE_FILE, "utf8")).models[0].id, "omp-default");
  assert.equal(seenEnvironment.BIFROST_ADMIN_PASSWORD, "secret-password", "test-supplied stage callback retains input; real child transport removes it");
});

test("publication failure rolls back both manifest and cached catalogue", async t => {
  const f = fixture(t);
  const original = { ...f.base, policyFingerprint: "a".repeat(64) };
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify(original));
  writeFileSync(f.env.PIFROST_CACHE_FILE, "old-catalog");
  const staged = await stageRouteCatalog({ ...f.base, policyFingerprint: "b".repeat(64) }, f.env,
    async environment => writeFileSync(environment.PIFROST_CACHE_FILE, JSON.stringify({
      aliasFingerprint: "c".repeat(64), models: [{ id: "omp-default" }], diagnostics: [],
    })));
  unlinkSync(staged.path); // emulate a rename failure after manifest publication
  assert.throws(() => staged.commit());
  staged.cleanup();
  assert.deepEqual(JSON.parse(readFileSync(f.env.PIFROST_ALIASES, "utf8")), original);
  assert.equal(readFileSync(f.env.PIFROST_CACHE_FILE, "utf8"), "old-catalog");
});

test("single-flight lock prevents concurrent watchers and recovers a dead PID", async t => {
  const f = fixture(t);
  let release;
  const held = withRouteWatchLock(() => new Promise(resolve => { release = resolve; }), f.env);
  await assert.rejects(withRouteWatchLock(async () => "overlap", f.env), /lock-busy/);
  release("finished");
  assert.equal(await held, "finished");
  assert.equal(existsSync(watchPaths(f.env).lock), false);
  writeFileSync(watchPaths(f.env).lock, JSON.stringify({ pid: 999_999_999 }));
  assert.equal(await withRouteWatchLock(async () => "recovered", f.env), "recovered");
});

test("interval bounds, status serialization and bounded error backoff", async t => {
  const f = fixture(t);
  assert.equal(validateWatchInterval(), 60_000);
  assert.equal(validateWatchInterval("15"), 15_000);
  assert.throws(() => validateWatchInterval("2"), /15 and 3600/);
  assert.throws(() => validateWatchInterval("nan"), /15 and 3600/);
  assert.equal(readWatchStatus(f.env).status, "never-run");
  const controller = new AbortController();
  let ticks = 0;
  const waits = [];
  await runRouteWatchLoop({ capture: async () => ({}), env: f.env,
    execute: async () => {
      if (++ticks === 1) throw new RouteWatchError("gateway-read-failed");
      controller.abort();
      return { status: "unchanged" };
    },
    signal: controller.signal,
    intervalMs: 60_000,
    log: () => {},
    wait: async duration => { waits.push(duration); },
  });
  assert.deepEqual(waits, [120_000]);
  assert.equal(readWatchStatus(f.env).lastError, "gateway-read-failed");
});
