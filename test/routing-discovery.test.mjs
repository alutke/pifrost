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

test("discoverRoutingRules treats non-empty Bifrost 2.x canonical routing as authoritative", async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  const canonical = { id: "canonical", name: "omp-default", enabled: true, targets: [] };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("/api/governance/routing-rules")) {
      throw new Error("deprecated routing alias should not be probed after a non-empty canonical response");
    }
    return new Response(JSON.stringify({ rules: [canonical] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await discoverRoutingRules("http://bifrost:8180/v1", "legacy-enterprise-key");
    assert.deepEqual(result.rules, [canonical]);
    assert.equal(requested.length, 1);
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


test("Bifrost 2.x scoped rules for one alias are unioned conservatively", () => {
  const result = deriveAliasesRobust([
    {
      id: "global",
      name: "omp-default",
      scope: "global",
      priority: 10,
      enabled: true,
      targets: [{ provider: "deepseek", model: "flash", weight: 1 }],
    },
    {
      id: "vk",
      name: "omp-default",
      scope: "virtual_key",
      scope_id: "vk-1",
      priority: 1,
      enabled: true,
      targets: [{ provider: "openai", model: "gpt", weight: 1 }],
      fallbacks: ["deepseek/pro"],
    },
  ]);
  assert.deepEqual(result.aliases["omp-default"].chain, [
    "deepseek/flash",
    "openai/gpt",
    "deepseek/pro",
  ]);
});

test("chain_rule aliases include a conservative downstream routing closure", () => {
  const result = deriveAliasesRobust([
    {
      id: "alias",
      name: "omp-plan",
      enabled: true,
      chain_rule: true,
      targets: [{ provider: "router", model: "stage-one", weight: 1 }],
    },
    {
      id: "downstream",
      name: "provider rewrite",
      enabled: true,
      cel_expression: "request.provider == 'router'",
      targets: [{ provider: "deepseek", model: "pro", weight: 1 }],
      fallbacks: ["openai/gpt"],
    },
  ]);
  assert.deepEqual(result.aliases["omp-plan"].chain, [
    "router/stage-one",
    "deepseek/pro",
    "openai/gpt",
  ]);
});


test("discoverRoutingRules paginates beyond 100 canonical Bifrost 2.x rules", async () => {
  const previousFetch = globalThis.fetch;
  const all = Array.from({ length: 150 }, (_, index) => ({
    id: `route-${index}`,
    name: index === 149 ? "omp-last" : `rule-${index}`,
    enabled: true,
    targets: [{ provider: "provider", model: `model-${index}`, weight: 1 }],
  }));
  const offsets = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/api/governance/routing-rules")) {
      throw new Error("legacy endpoint must not be needed for populated canonical routing");
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    offsets.push(offset);
    const page = all.slice(offset, offset + limit);
    return new Response(JSON.stringify({
      rules: page,
      count: page.length,
      total_count: all.length,
      limit,
      offset,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await discoverRoutingRules("http://bifrost:8180/v1", {
      mode: "basic",
      username: "admin",
      password: "secret",
    });
    assert.equal(result.rules.length, 150);
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(result.diagnostics[0]?.pages, 2);
    assert.equal(result.diagnostics[0]?.count, 150);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
