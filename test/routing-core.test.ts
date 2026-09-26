import assert from "node:assert/strict";
import test from "node:test";

import {
  aliasIdFromRule,
  deriveAliasesFromRules,
  routingFeatureSummary,
  routingRulePins,
  targetReference,
} from "../routing-core.ts";

test("routing core owns target, pin, alias and feature semantics in one module", () => {
  const rule = {
    id: "route-1",
    name: "omp-default",
    enabled: true,
    targets: [{ provider: "openai", model: "gpt-test", weight: 2, provider_key_name: "primary" }],
    fallbacks: [{ provider: "deepseek", model: "deepseek-test", key_id: "key-2" }],
  };

  assert.equal(aliasIdFromRule(rule), "omp-default");
  assert.equal(targetReference(rule.targets[0]), "openai/gpt-test");
  assert.deepEqual(routingRulePins(rule).map((pin) => pin.source), ["target", "fallback"]);

  const manifest = deriveAliasesFromRules([rule]);
  assert.deepEqual(manifest.aliases["omp-default"]?.chain, ["openai/gpt-test", "deepseek/deepseek-test"]);

  const summary = routingFeatureSummary([rule]);
  assert.equal(summary.enabledRules, 1);
  assert.equal(summary.pinnedRules, 1);
  assert.equal(summary.weightedRules, 1);
});
