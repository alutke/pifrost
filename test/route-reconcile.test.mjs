import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOnDemandRouteCheck, reconcileRouteSnapshot, attestCompatibilityRoute, compatibilityMemberDigest, withReconcileLock,
  RouteReconcileError,
} from "../route-reconcile.mjs";
import { routePolicyFingerprint } from "../route-policy-fingerprint.mjs";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "pifrost-on-demand-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, PIFROST_CONFIG_DIR: dir,
    PIFROST_ALIASES: join(dir, "aliases.json") };
  const rule = { id: "a", name: "omp-advisor", enabled: true,
    cel_expression: "request.model == 'omp-advisor'",
    targets: [{ provider: "opencode-go", model: "muse-spark-1.3-contributor", weight: 1 }] };
  const manifest = { includePhysicalModels: false,
    aliases: { "omp-advisor": { name: "omp-advisor", chain: ["opencode-go/muse-spark-1.3-contributor"] } } };
  const snapshot = (rules = [rule]) => ({
    rules, manifest, policyFingerprint: routePolicyFingerprint(rules),
  });
  return { dir, env, rule, manifest, snapshot };
}

test("unchanged policy is read once and never rewrites manifest or models", async t => {
  const f = setup(t), same = f.snapshot();
  const original = { ...f.manifest, policyFingerprint: same.policyFingerprint };
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify(original));
  let reads = 0, writes = 0;
  const result = await reconcileRouteSnapshot({ env: f.env,
    capture: async () => { reads++; return same; },
    write: () => { writes++; } });
  assert.equal(result.status, "unchanged");
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.env.PIFROST_ALIASES, "utf8")), original);
});

test("CEL-only policy change triggers a double-confirmed alias refresh", async t => {
  const f = setup(t), first = f.snapshot();
  const updated = f.snapshot([{ ...f.rule, cel_expression: "request.model == 'omp-advisor' && request.type == 'chat'" }]);
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify({ ...f.manifest, policyFingerprint: first.policyFingerprint }));
  let reads = 0;
  const result = await reconcileRouteSnapshot({ env: f.env,
    capture: async () => { reads++; return updated; } });
  assert.equal(result.status, "updated");
  assert.equal(result.routes, 1);
  assert.equal(reads, 2);
  const written = JSON.parse(readFileSync(f.env.PIFROST_ALIASES, "utf8"));
  assert.equal(written.policyFingerprint, updated.policyFingerprint);
  assert.match(written.synchronizedAt, /^\d{4}-/u);
});

test("policy changing during confirmation never writes configuration", async t => {
  const f = setup(t), first = f.snapshot();
  const second = f.snapshot([{ ...f.rule, targets: [{ provider: "other", model: "new", weight: 1 }] }]);
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify({ ...f.manifest, policyFingerprint: "a".repeat(64) }));
  const existing = readFileSync(f.env.PIFROST_ALIASES, "utf8");
  let reads = 0;
  await assert.rejects(reconcileRouteSnapshot({ env: f.env,
    capture: async () => ++reads === 1 ? first : second,
  }), /gateway-policy-changing/u);
  assert.equal(readFileSync(f.env.PIFROST_ALIASES, "utf8"), existing);
});

test("invalid or empty gateway routing never destroys valid aliases", async t => {
  const f = setup(t), first = f.snapshot();
  writeFileSync(f.env.PIFROST_ALIASES, JSON.stringify({ ...f.manifest, policyFingerprint: first.policyFingerprint }));
  const old = readFileSync(f.env.PIFROST_ALIASES, "utf8");
  for (const snapshot of [{ rules: [], manifest: { aliases: {} }, policyFingerprint: "a".repeat(64) },
    { ...first, rules: [null] }, { ...first, policyFingerprint: "not-a-sha" }]) {
    await assert.rejects(reconcileRouteSnapshot({ env: f.env, capture: async () => snapshot }), /invalid-rule-inventory/u);
    assert.equal(readFileSync(f.env.PIFROST_ALIASES, "utf8"), old);
  }
});

test("concurrent checks serialize through a short-lived process lock; no service remains", async t => {
  const f = setup(t);
  let release;
  const first = withReconcileLock(() => new Promise(resolve => { release = resolve; }), f.env);
  await assert.rejects(withReconcileLock(async () => null, f.env), /check-already-in-progress/u);
  release("ok");
  assert.equal(await first, "ok");
  assert.equal(await withReconcileLock(async () => "ready", f.env), "ready");
});

test("prompt-driven check is throttled, single-flight and refreshes only on change", async () => {
  let now = 0, calls = 0, refreshes = 0;
  const messages = [];
  let unblock;
  const check = createOnDemandRouteCheck({
    now: () => now, minIntervalMs: 60_000,
    run: async () => { calls++; if (calls === 1) {
      await new Promise(resolve => { unblock = resolve; });
      return { status: "updated", schemaVersion: 1 };
    } return { status: "unchanged", schemaVersion: 1 }; },
    refresh: async () => { refreshes++; },
    notify: (message, level) => messages.push([message,level]),
  });
  const first = check({}), simultaneous = check({});
  unblock();
  assert.equal((await first).modelsRefreshed, true);
  assert.equal((await simultaneous).modelsRefreshed, true);
  assert.equal((await check({})).status, "throttled");
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
  assert.equal(messages.length, 1);
  now = 60_001;
  assert.equal((await check({})).status, "unchanged");
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test("management/check failures fail open and do not refresh providers", async () => {
  let notices = 0, refreshes = 0;
  const check = createOnDemandRouteCheck({
    run: async () => { throw new RouteReconcileError("gateway-check-failed"); },
    refresh: async () => { refreshes++; },
    notify: (_message, level) => { assert.equal(level, "warning"); notices++; },
  });
  assert.equal((await check({})).status, "unavailable");
  assert.equal(refreshes, 0);
  assert.equal(notices, 1);
});

test("failed OMP registry refresh is retried on next prompt even before throttle expiry", async () => {
  let timestamp = 0, checks = 0, refreshes = 0;
  const notices = [];
  const runCheck = createOnDemandRouteCheck({
    now: () => timestamp,
    run: async () => { checks++; return { status: "updated" }; },
    refresh: async () => { refreshes++; if (refreshes === 1) throw new Error("model registry offline"); },
    notify: (message, level) => notices.push({ message, level }),
  });
  assert.equal((await runCheck({})).status, "unavailable");
  assert.equal(checks, 1);
  assert.equal(refreshes, 1);
  assert.match(notices[0].message, /will retry/u);
  timestamp = 1;
  assert.equal((await runCheck({})).status, "refreshed");
  assert.equal(checks, 1, "must not requery management API for a model-registry-only retry");
  assert.equal(refreshes, 2);
  assert.equal((await runCheck({})).status, "throttled");
});

test("R1-04 read-only physical-route attestation requires two consistent live gateway reads", async () => {
  const rules = [{id:"rule",name:"omp-default",enabled:true,
    cel_expression:"request.model == 'omp-default'",
    targets:[{provider:"provider",model:"a",weight:1}]}];
  const manifest = {aliases:{"omp-default":{name:"omp-default",chain:["provider/a"],
    dynamicRouting:{mode:"context-aware",source:"bifrost-simple-rule"}}}};
  const snapshot = { rules, manifest, policyFingerprint:routePolicyFingerprint(rules) };
  let reads = 0;
  const result = await attestCompatibilityRoute({alias:"omp-default",
    capture:async()=>{reads++;return snapshot;},now:()=>Date.parse("2026-10-21T12:00:00Z")});
  assert.equal(reads,2);
  assert.equal(result.status,"verified");
  assert.equal(result.policyFingerprint,snapshot.policyFingerprint);
  assert.equal(result.memberDigest,compatibilityMemberDigest(["provider/a"]));
  assert.equal(result.verifiedAt,"2026-10-21T12:00:00.000Z");
  await assert.rejects(attestCompatibilityRoute({alias:"omp-default",
    capture:async()=>({...snapshot,manifest:{aliases:{"omp-default":{...manifest.aliases["omp-default"],dynamicRouting:undefined}}}})}),
    /gateway-route-not-compatible/u);
});
test("R1-05 live policy changing between attestation reads fails without any writes", async () => {
  const f=setup({after(callback){callback();}});
  const first=f.snapshot(), second=f.snapshot([{...f.rule,enabled:false}]);
  let reads=0;
  await assert.rejects(attestCompatibilityRoute({alias:"omp-advisor",
    capture:async()=>++reads===1?first:second}),/gateway-policy-changing/u);
  assert.equal(reads,2);
});
