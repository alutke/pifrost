import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CATALOG_CACHE_SCHEMA_VERSION } from "../cache.ts";
import {
  EXPECTED_CACHE_SCHEMA_VERSION,
  explainRouteRequest,
  formatEffectiveRouteReport,
  formatRouteExplanation,
  readCatalog,
  printModelDoctor,
} from "../model-diagnostics.mjs";

test("terminal model diagnostics use the cache.ts schema constant", () => {
  assert.equal(EXPECTED_CACHE_SCHEMA_VERSION, CATALOG_CACHE_SCHEMA_VERSION);
  assert.equal(CATALOG_CACHE_SCHEMA_VERSION, 18);
});

test("schema-v18 catalog is accepted and emits the shared diagnostic result", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-model-diagnostic-schema-"));
  const agent = join(root, "agent");
  mkdirSync(agent, { recursive: true });
  const path = join(agent, "pifrost.catalog.json");
  writeFileSync(path, JSON.stringify({
    schemaVersion: CATALOG_CACHE_SCHEMA_VERSION,
    generatedAt: "2026-09-26T00:00:00.000Z",
    models: [{
      id: "omp-default",
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      input: ["text"],
    }],
    diagnostics: [],
  }));

  const env = { ...process.env, PI_CODING_AGENT_DIR: agent };
  try {
    assert.equal(readCatalog(env).cache?.schemaVersion, CATALOG_CACHE_SCHEMA_VERSION);
    const lines = [];
    const result = printModelDoctor(env, { log: (value) => lines.push(String(value)) });
    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 1);
    assert.deepEqual(
      {
        id: result.checks[0].id,
        status: result.checks[0].status,
        modelCount: result.checks[0].data.modelCount,
      },
      { id: "model-catalog", status: "ok", modelCount: 1 },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("effective route report maps OMP roles through Pifrost aliases to physical members", () => {
  const diagnostics = [{
    id: "omp-default",
    members: [{
      reference: "openai/gpt-test",
      resolvedModelId: "openai/gpt-test",
      status: "resolved",
      protocols: ["openai-responses"],
      capabilities: {
        contextWindow: 1000000,
        maxTokens: 128000,
        image: true,
        reasoning: true,
        tools: true,
        toolSearch: true,
        betweenToolsThinking: true,
        serviceTier: true,
        serviceTiers: ["priority"],
      },
    }],
  }];
  const report = formatEffectiveRouteReport(
    { default: "bifrost/omp-default", web: "web/duckduckgo" },
    diagnostics,
  );
  assert.match(report, /default: bifrost\/omp-default -> omp-default/u);
  assert.match(report, /openai\/gpt-test/u);
  assert.match(report, /toolSearch=yes/u);
  assert.match(report, /web: web\/duckduckgo \(not Pifrost-managed\)/u);
});

test("request explanation identifies member-specific capability exclusions", () => {
  const diagnostic = {
    id: "omp-plan",
    maxTokens: 128000,
    members: [
      {
        reference: "openai/strong",
        resolvedModelId: "openai/strong",
        status: "resolved",
        protocols: ["openai-responses"],
        capabilities: {
          contextWindow: 1000000,
          maxTokens: 128000,
          image: true,
          reasoning: true,
          tools: true,
          toolSearch: true,
          reasoningWithTools: true,
          betweenToolsThinking: true,
          serviceTier: true,
          serviceTiers: ["priority", "ultrafast"],
        },
      },
      {
        reference: "deepseek/fallback",
        resolvedModelId: "deepseek/fallback",
        status: "resolved",
        protocols: ["openai-completions"],
        capabilities: {
          contextWindow: 128000,
          maxTokens: 32000,
          image: false,
          reasoning: true,
          tools: true,
          toolSearch: false,
          reasoningWithTools: true,
          betweenToolsThinking: false,
          serviceTier: false,
        },
      },
    ],
  };
  const result = explainRouteRequest(diagnostic, {
    inputTokens: 120000,
    outputTokens: 16000,
    image: true,
    tools: true,
    reasoning: true,
    toolSearch: true,
    betweenTools: true,
    serviceTier: "ultrafast",
  });
  assert.equal(result.members[0].eligible, true);
  assert.equal(result.members[1].eligible, false);
  assert.ok(result.members[1].reasons.some((reason) => /context 128000 < required 136000/u.test(reason)));
  assert.ok(result.members[1].reasons.includes("no image input"));
  assert.ok(result.members[1].reasons.includes("no tool-search/deferred-tool support"));
  assert.ok(result.members[1].reasons.includes("tool search requires Responses transport"));
  assert.ok(!result.members[1].reasons.includes("no between-tools thinking support"));
  assert.ok(result.members[1].notices.some((notice) => /downgraded or omitted by Bifrost/u.test(notice)));
  assert.ok(result.members[1].reasons.includes("no service-tier support"));
  assert.match(formatRouteExplanation(result), /\[EXCLUDED\] deepseek\/fallback/u);
});


test("catalog diagnostics expose snapshot freshness separately from schema validity", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-model-diagnostic-freshness-"));
  const agent = join(root, "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "pifrost.catalog.json"), JSON.stringify({
    schemaVersion: CATALOG_CACHE_SCHEMA_VERSION,
    generatedAt: "2026-09-30T00:00:00.000Z",
    models: [{ id: "omp-default", contextWindow: 128000, maxTokens: 8192, reasoning: false, input: ["text"] }],
    diagnostics: [],
  }));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agent };
  try {
    const fresh = readCatalog(env, Date.parse("2026-09-30T01:00:00.000Z"));
    assert.equal(fresh.stale, false);
    assert.equal(fresh.ageMs, 60 * 60_000);
    const stale = readCatalog(env, Date.parse("2026-09-30T07:00:00.000Z"));
    assert.equal(stale.stale, true);
    assert.equal(stale.ageMs, 7 * 60 * 60_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
