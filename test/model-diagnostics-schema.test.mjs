import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CATALOG_CACHE_SCHEMA_VERSION } from "../cache.ts";
import {
  EXPECTED_CACHE_SCHEMA_VERSION,
  readCatalog,
  printModelDoctor,
} from "../model-diagnostics.mjs";

test("terminal model diagnostics use the cache.ts schema constant", () => {
  assert.equal(EXPECTED_CACHE_SCHEMA_VERSION, CATALOG_CACHE_SCHEMA_VERSION);
  assert.equal(CATALOG_CACHE_SCHEMA_VERSION, 6);
});

test("schema-v6 catalog is accepted and emits the shared diagnostic result", () => {
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
