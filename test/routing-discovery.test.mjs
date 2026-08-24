import assert from "node:assert/strict";
import test from "node:test";

import {
  aliasIdFromRuleRobust,
  deriveAliasesRobust,
  discoverRoutingRules,
  extractRoutingRules,
} from "../routing-discovery.mjs";

test("extractRoutingRules accepts current and compatibility response shapes", () => {
  const rule = { id: "1", name: "omp-default" };
  assert.deepEqual(extractRoutingRules({ rules: [rule] }), [rule]);
  assert.deepEqual(extractRoutingRules({ routing_rules: [rule] }), [rule]);
  assert.deepEqual(extractRoutingRules({ data: [rule] }), [rule]);
  assert.deepEqual(extractRoutingRules({ data: { rules: [rule] } }), [rule]);
  assert.deepEqual(extractRoutingRules({ result: { routing_rules: [rule] } }), [rule]);
  assert.deepEqual(extractRoutingRules([rule]), [rule]);
});

test("discoverRoutingRules does not stop on an empty canonical 200 response", async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  const rule = {
    id: "route-1",
    name: "omp-default",
    enabled: true,
    targets: [{ provider: "openai", model: "gpt-test", weight: 1 }],
  };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("/api/routing/rules")) {
      return new Response(JSON.stringify({ rules: [], count: 0, total_count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/api/governance/routing-rules")) {
      return new Response(JSON.stringify({ rules: [rule], count: 1, total_count: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  try {
    const result = await discoverRoutingRules("http://bifrost:8180/v1", {
      mode: "basic",
      username: "admin",
      password: "password",
    });
    assert.equal(requested.length, 2);
    assert.deepEqual(result.rules, [rule]);
    assert.deepEqual(result.diagnostics.map((item) => item.count), [0, 1]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("discoverRoutingRules merges and deduplicates rules returned by both paths", async () => {
  const previousFetch = globalThis.fetch;
  const shared = { id: "shared", name: "omp-default", enabled: true, targets: [] };
  const legacyOnly = { id: "legacy", name: "omp-task", enabled: true, targets: [] };
  globalThis.fetch = async (url) => {
    const body = String(url).includes("/api/governance/routing-rules")
      ? { routing_rules: [shared, legacyOnly] }
      : { rules: [shared] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await discoverRoutingRules("http://bifrost:8180/v1", "legacy-enterprise-key");
    assert.deepEqual(result.rules.map((rule) => rule.id).sort(), ["legacy", "shared"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("alias discovery accepts names, CEL expressions and query-builder conditions", () => {
  assert.equal(aliasIdFromRuleRobust({ name: "omp-default" }), "omp-default");
  assert.equal(
    aliasIdFromRuleRobust({ name: "Default route", cel_expression: "request.model == 'omp-task'" }),
    "omp-task",
  );
  assert.equal(
    aliasIdFromRuleRobust({
      name: "Plan route",
      query: {
        combinator: "and",
        rules: [{ field: "model", operator: "=", value: "omp-plan" }],
      },
    }),
    "omp-plan",
  );
});

test("deriveAliasesRobust builds ordered chains from compatibility field names", () => {
  const result = deriveAliasesRobust([
    {
      name: "Human readable",
      enabled: true,
      query: { rules: [{ field: "model", value: "omp-default" }] },
      routing_targets: [
        { provider_name: "slow", model_id: "model-b", weight: 0.25 },
        { provider_name: "fast", model_id: "model-a", weight: 0.75 },
      ],
      fallback_models: ["direct/model-c", "fast/model-a"],
    },
  ]);
  assert.deepEqual(result, {
    includePhysicalModels: false,
    aliases: {
      "omp-default": {
        name: "omp-default",
        chain: ["fast/model-a", "slow/model-b", "direct/model-c"],
      },
    },
  });
});
