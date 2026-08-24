import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";

import {
  bifrostManagementBase,
  buildRepoMcpConfig,
  deriveAliasesFromRules,
  diffAliases,
  loadState,
  normalizeBifrostUrl,
  saveState,
} from "../cli-lib.mjs";

test("normalizes inference and management Bifrost URLs", () => {
  assert.equal(normalizeBifrostUrl("http://192.168.1.221:8180"), "http://192.168.1.221:8180/v1");
  assert.equal(normalizeBifrostUrl("http://192.168.1.221:8180/v1/models"), "http://192.168.1.221:8180/v1");
  assert.equal(bifrostManagementBase("http://192.168.1.221:8180/v1"), "http://192.168.1.221:8180");
});

test("derives omp aliases from routing-rule names, weighted targets and fallbacks", () => {
  const manifest = deriveAliasesFromRules([
    {
      name: "omp-default",
      enabled: true,
      targets: [
        { provider: "slow", model: "model-b", weight: 1 },
        { provider: "fast", model: "model-a", weight: 10 },
      ],
      fallbacks: ["direct/model-c", "fast/model-a"],
    },
    {
      name: "human readable rule",
      enabled: true,
      cel_expression: 'request.model == "omp-plan"',
      targets: [{ provider: "openai", model: "gpt-test", weight: 1 }],
      fallbacks: [],
    },
    {
      name: "omp-disabled",
      enabled: false,
      targets: [{ provider: "x", model: "y", weight: 1 }],
    },
  ]);

  assert.deepEqual(manifest, {
    includePhysicalModels: false,
    aliases: {
      "omp-default": {
        name: "omp-default",
        chain: ["fast/model-a", "slow/model-b", "direct/model-c"],
      },
      "omp-plan": {
        name: "omp-plan",
        chain: ["openai/gpt-test"],
      },
    },
  });
});

test("route diff reports only changed and missing aliases", () => {
  const local = {
    aliases: {
      "omp-default": { chain: ["a", "b"] },
      "omp-old": { chain: ["x"] },
    },
  };
  const remote = {
    aliases: {
      "omp-default": { chain: ["a", "c"] },
      "omp-new": { chain: ["z"] },
    },
  };
  assert.deepEqual(diffAliases(local, remote), [
    { id: "omp-default", local: ["a", "b"], remote: ["a", "c"] },
    { id: "omp-new", local: undefined, remote: ["z"] },
    { id: "omp-old", local: ["x"], remote: undefined },
  ]);
});

test("repo MCP config contains command indirection and never embeds the VK", () => {
  const config = buildRepoMcpConfig(
    { mcpServers: { other: { type: "http", url: "https://example.invalid/mcp" } } },
    "http://192.168.1.221:8180/v1",
    "homelab-deadbeef00",
  );
  assert.equal(config.mcpServers.other.url, "https://example.invalid/mcp");
  assert.deepEqual(config.mcpServers.bifrost, {
    type: "http",
    url: "http://192.168.1.221:8180/mcp",
    timeout: 120000,
    headers: {
      "x-bf-vk": "!pifrost secret repo-mcp --id homelab-deadbeef00",
    },
  });
  assert.equal(JSON.stringify(config).includes("sk-bf-"), false);
});

test("state store persists secrets as mode 0600", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-cli-test-"));
  try {
    const env = { ...process.env, PIFROST_CONFIG_DIR: root };
    const state = loadState(env);
    state.config.bifrost.url = "http://bifrost/v1";
    state.secrets.inferenceApiKey = "secret-api";
    state.secrets.inferenceVirtualKey = "secret-vk";
    saveState(state.config, state.secrets, env);
    assert.equal(statSync(join(root, "secrets.json")).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(join(root, "config.json"), "utf8")).bifrost.url, "http://bifrost/v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret subcommand prints only the requested repo VK", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-secret-test-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "secrets.json"),
      JSON.stringify({ schemaVersion: 1, repos: { "repo-123": { mcpVirtualKey: "sk-bf-repo-secret" } } }),
      { mode: 0o600 },
    );
    writeFileSync(join(root, "config.json"), JSON.stringify({ schemaVersion: 1, bifrost: {}, repos: {} }), {
      mode: 0o600,
    });
    chmodSync(join(root, "secrets.json"), 0o600);
    const cli = resolve("cli.mjs");
    const result = spawnSync(process.execPath, [cli, "secret", "repo-mcp", "--id", "repo-123"], {
      env: { ...process.env, PIFROST_CONFIG_DIR: root },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "sk-bf-repo-secret");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
