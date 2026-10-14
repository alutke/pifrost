import assert from "node:assert/strict";
import test from "node:test";
import { routePolicyFingerprint, routePolicyDrift } from "../route-policy-fingerprint.mjs";
import { deriveAliasesFromRules, isContextDynamicRuleSafe } from "../routing-core.ts";

const simple = (cel_expression: string) => ({
  name:"omp-default", scope:"global", enabled:true, cel_expression,
  targets:[{provider:"alpha",model:"first",weight:1}], fallbacks:["beta/second"],
});

test("only exact alias conditions may become locally compiled physical routes", () => {
  assert.equal(isContextDynamicRuleSafe(simple("model == 'omp-default'"),"omp-default"),true);
  assert.equal(isContextDynamicRuleSafe(simple("request.model == 'omp-default'"),"omp-default"),true);
  assert.equal(isContextDynamicRuleSafe(simple("('omp-default' == model)"),"omp-default"),true);
  for(const condition of [
    "model == 'omp-default' && request_type == 'chat'",
    "model == 'omp-default' || request_type == 'responses'",
    "model == 'omp-default' && headers['x-tier'] == 'premium'",
    "model == 'omp-default' && virtual_key_id == 'key-1'",
    "request_type == 'chat'",
    "model == 'omp-default-evil'",
  ]) {
    const rule=simple(condition);
    assert.equal(isContextDynamicRuleSafe(rule,"omp-default"),false,condition);
    assert.equal(deriveAliasesFromRules([rule]).aliases["omp-default"]?.dynamicRouting,undefined,condition);
  }
  assert.equal(isContextDynamicRuleSafe({...simple("model == 'omp-default'"),query:{field:"model",value:"omp-default"}},"omp-default"),false);
});

test("full policy fingerprint detects conditional/pin-only drift even if physical chain unchanged", () => {
  const base=simple("model == 'omp-default'");
  const first=routePolicyFingerprint([base, simple("model == 'omp-task'")]);
  const reversed=routePolicyFingerprint([simple("model == 'omp-task'"),base]);
  assert.equal(first,reversed);
  assert.equal(routePolicyDrift(first,reversed),"verified-match");
  assert.equal(routePolicyDrift(first,routePolicyFingerprint([{...base,cel_expression:"model == 'omp-default' && request_type == 'chat'"},simple("model == 'omp-task'")])),"drifted");
  assert.equal(routePolicyDrift(first,routePolicyFingerprint([{...base,targets:[{...base.targets[0],key_id:"rotated"}]},simple("model == 'omp-task'")])),"drifted");
  assert.equal(routePolicyDrift(undefined,first),"unverified");
  assert.match(first,/^[a-f0-9]{64}$/u);
});
