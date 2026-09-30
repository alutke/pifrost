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
  compareSemver,
  deriveAliasesFromRules,
  effectiveRepoMcpPolicy,
  diffAliases,
  loadState,
  listMcpGatewayTools,
  mcpToolSurfaceDiagnostics,
  normalizeBifrostUrl,
  normalizeMcpClient,
  normalizeVirtualMcp,
  quotaGovernanceSources,
  formatQuotaGovernanceSource,
  ompCompatibilityMatrix,
  ompWebSearchDiagnostics,
  searchBackendDiagnostics,
  webSearchConfigDiagnostics,
  parseSemver,
  versionAtLeast,
  repoMcpInstructions,
  resolveVirtualMcpNames,
  virtualMcpsForVirtualKey,
  saveState,
} from "../cli-lib.mjs";
import { parseMcpJsonRpcResponse } from "../mcp-rpc.mjs";

test("canonical CLI help exposes the full repo Skills/reset surface", () => {
  const cli = resolve(import.meta.dirname, "../cli.mjs");
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pifrost repo skills sync \[name\]/u);
  assert.match(result.stdout, /pifrost repo reset \[--delete-remote\] \[--recover-by-name\] \[--yes\]/u);
  assert.match(result.stdout, /--rotate-existing/u);
  assert.match(result.stdout, /pifrost routes diagnose/u);
  assert.match(result.stdout, /pifrost routes effective/u);
  assert.match(result.stdout, /pifrost routes explain <role\|alias>/u);
});

test("parses and compares upstream semantic versions conservatively", () => {
  assert.equal(parseSemver("OMP 18.3.2")?.version, "18.3.2");
  assert.equal(parseSemver("v2.2.3+build.7")?.version, "2.2.3");
  assert.equal(parseSemver("not-a-version"), undefined);
  assert.equal(compareSemver("18.3.2", "18.3.1"), 1);
  assert.equal(compareSemver("2.2.3", "2.2.3"), 0);
  assert.equal(versionAtLeast("2.2.2", "2.2.3"), false);
});

test("OMP compatibility matrix gates the Pifrost 18.4.5 baseline and preserves earlier feature floors", () => {
  const current = ompCompatibilityMatrix("18.4.5");
  assert.ok(current.every((item) => item.status === "supported"));
  const previous = ompCompatibilityMatrix("18.3.2");
  assert.equal(previous.find((item) => item.id === "omp-baseline")?.status, "unavailable");
  assert.equal(previous.find((item) => item.id === "omp-mcp-instructions")?.status, "supported");
  assert.equal(previous.find((item) => item.id === "omp-cfg-protocol")?.status, "supported");
  assert.equal(previous.find((item) => item.id === "omp-modern-model-metadata")?.status, "unavailable");
  const old = ompCompatibilityMatrix("18.3.0");
  assert.equal(old.find((item) => item.id === "omp-mcp-instructions")?.status, "unavailable");
  assert.equal(old.find((item) => item.id === "omp-cfg-protocol")?.status, "unavailable");
});

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

test("repo MCP instruction policy is scoped to the generated Bifrost server and survives regeneration", () => {
  const existing = {
    mcpServers: {
      other: {
        type: "http",
        url: "https://example.invalid/mcp",
        instructions: true,
        headers: { "x-other": "keep-me" },
      },
      bifrost: {
        type: "http",
        url: "http://old.invalid/mcp",
        instructions: false,
      },
    },
  };

  const preserved = buildRepoMcpConfig(existing, "http://bifrost/v1", "repo-1");
  assert.equal(preserved.mcpServers.bifrost.instructions, false);
  assert.deepEqual(preserved.mcpServers.other, existing.mcpServers.other);

  const enabled = buildRepoMcpConfig(preserved, "http://bifrost/v1", "repo-1", { instructions: true });
  assert.equal(enabled.mcpServers.bifrost.instructions, true);
  assert.deepEqual(enabled.mcpServers.other, existing.mcpServers.other);

  const inherited = buildRepoMcpConfig(enabled, "http://bifrost/v1", "repo-1", { instructions: null });
  assert.equal(Object.prototype.hasOwnProperty.call(inherited.mcpServers.bifrost, "instructions"), false);
  assert.deepEqual(inherited.mcpServers.other, existing.mcpServers.other);
});

test("repo MCP instruction status reads the effective per-server setting from .omp/mcp.json", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-mcp-instructions-"));
  try {
    assert.equal(repoMcpInstructions(root), undefined);
    mkdirSync(join(root, ".omp"), { recursive: true });
    writeFileSync(
      join(root, ".omp/mcp.json"),
      JSON.stringify({ mcpServers: { bifrost: { type: "http", url: "http://bifrost/mcp", instructions: false } } }),
    );
    assert.equal(repoMcpInstructions(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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


test("CLI route sync model preserves Bifrost 2.2.3 pinned fallback metadata", () => {
  const manifest = deriveAliasesFromRules([{
    name: "omp-default",
    enabled: true,
    targets: [{ provider: "openai", model: "gpt-large", weight: 1, key_id: "primary-key" }],
    fallbacks: [
      { provider: "deepseek", model: "deepseek-v4-pro", key_id: "fallback-key" },
      { provider: "mistral", model: "large", provider_key_name: "Mistral Primary" },
      "openai/gpt-small",
    ],
  }]);

  assert.deepEqual(manifest.aliases["omp-default"].chain, [
    "openai/gpt-large",
    "deepseek/deepseek-v4-pro",
    "mistral/large",
    "openai/gpt-small",
  ]);
  assert.deepEqual(manifest.aliases["omp-default"].routingPins, [
    { source: "target", reference: "openai/gpt-large", keyId: "primary-key" },
    { source: "fallback", reference: "deepseek/deepseek-v4-pro", keyId: "fallback-key" },
    { source: "fallback", reference: "mistral/large", providerKeyName: "Mistral Primary" },
  ]);
});

test("route diff detects pin-only changes even when the model chain is unchanged", () => {
  const local = {
    aliases: {
      "omp-default": {
        chain: ["openai/gpt", "deepseek/pro"],
        routingPins: [{ source: "fallback", reference: "deepseek/pro", keyId: "old-key" }],
      },
    },
  };
  const remote = {
    aliases: {
      "omp-default": {
        chain: ["openai/gpt", "deepseek/pro"],
        routingPins: [{ source: "fallback", reference: "deepseek/pro", keyId: "new-key" }],
      },
    },
  };
  const diff = diffAliases(local, remote);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].id, "omp-default");
  assert.equal(diff[0].localPins[0].keyId, "old-key");
  assert.equal(diff[0].remotePins[0].keyId, "new-key");
});


test("Virtual MCP normalization and name resolution are portable and case-insensitive", () => {
  const vmcps = [
    normalizeVirtualMcp({
      id: 12,
      name: "Development Tools",
      endpoint_slug: "development-tools",
      enabled: true,
      tools: [{ mcp_client_id: "railway-id", tool_names: ["list", "logs"] }],
      virtual_key_ids: ["vk-repo"],
    }),
    normalizeVirtualMcp({
      id: 13,
      name: "Infrastructure",
      endpoint_slug: "infrastructure",
      enabled: false,
      tools: [{ mcp_client_id: "home-id", tool_names: ["*"] }],
      virtual_key_ids: [],
    }),
  ];
  assert.deepEqual(resolveVirtualMcpNames(vmcps, ["development tools"]).map((item) => item.id), [12]);
  assert.deepEqual(virtualMcpsForVirtualKey(vmcps, "vk-repo").map((item) => item.name), ["Development Tools"]);
  assert.throws(() => resolveVirtualMcpNames(vmcps, ["missing"]), /Unknown Bifrost Virtual MCP/);
});

test("MCP normalization retains tool schemas for footprint diagnostics", () => {
  const client = normalizeMcpClient({
    name: "fourget",
    state: "connected",
    tools: [{
      name: "fourget_web_search",
      description: "Search the web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    }],
  });
  assert.deepEqual(client.tools, ["fourget_web_search"]);
  assert.equal(client.toolDefinitions[0].name, "fourget_web_search");
  assert.equal(client.toolDefinitions[0].description, "Search the web");
  assert.equal(client.toolDefinitions[0].inputSchema.properties.query.type, "string");
});

test("4get diagnostics distinguish configured grants from live gateway visibility", () => {
  const clients = [{
    id: "fourget-id",
    name: "fourget",
    state: "connected",
    disabled: false,
    allowOnAllVirtualKeys: false,
    tools: ["fourget_web_search", "fourget_news_search", "fourget_image_search"],
  }];
  const vk = {
    id: "vk-repo",
    mcp_configs: [{
      mcp_client_id: "fourget-id",
      mcp_client: { client_id: "fourget-id", name: "fourget" },
      tools_to_execute: ["*"],
    }],
  };
  const policy = effectiveRepoMcpPolicy(vk, [], clients);
  const omp = webSearchConfigDiagnostics(
    { web: "web/duckduckgo" },
    { web: ["web/parallel", "web/hosted"] },
  );
  const diagnostics = searchBackendDiagnostics(policy, clients, [], {
    liveTools: [
      { name: "fourget-fourget_web_search", inputSchema: { type: "object" } },
      { name: "fourget-fourget_news_search", inputSchema: { type: "object" } },
      { name: "fourget-fourget_image_search", inputSchema: { type: "object" } },
    ],
    ompSearch: omp,
  });
  assert.equal(diagnostics.preferredPath, "MCP/4get");
  assert.deepEqual(diagnostics.paths, {
    web: "MCP/4get",
    news: "MCP/4get",
    images: "MCP/4get",
  });
  assert.equal(diagnostics.fourget.complete, true);
  assert.equal(diagnostics.fourget.clients[0].name, "fourget");
  assert.equal(diagnostics.fourget.tools.fourget_web_search.configured, true);
  assert.equal(diagnostics.fourget.tools.fourget_web_search.gatewayVisible, true);
  assert.equal(diagnostics.fourget.tools.fourget_web_search.gatewayName, "fourget-fourget_web_search");
  assert.equal(diagnostics.omp.primary, "web/duckduckgo");
  assert.deepEqual(diagnostics.omp.fallbacks, ["web/parallel", "web/hosted"]);
  assert.equal(diagnostics.mcpSurface.ompDefaultLoadMode, "discoverable");
});

test("OMP web diagnostics report the built-in chain when no explicit web role exists", () => {
  const diagnostics = webSearchConfigDiagnostics({ default: "bifrost/omp-default" }, {});
  assert.equal(diagnostics.available, true);
  assert.equal(diagnostics.configured, false);
  assert.equal(diagnostics.primary, undefined);
  assert.match(diagnostics.source, /built-in default search chain/u);
});

test("OMP web diagnostics distinguish unavailable and unreadable config from an unset web role", () => {
  const unavailable = ompWebSearchDiagnostics({
    commandExists: () => false,
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.source, "OMP unavailable");

  const unreadable = ompWebSearchDiagnostics({
    commandExists: () => true,
    runCommand: () => { throw new Error("config boom"); },
  });
  assert.equal(unreadable.status, "error");
  assert.equal(unreadable.available, false);
  assert.match(unreadable.error, /config boom/u);
});

test("partial 4get installs only affect the matching search modality", () => {
  const policy = {
    effective: [{ client: "fourget", tools: ["fourget_image_search"], sources: ["direct"] }],
    virtualMcps: [],
  };
  const clients = [{
    name: "fourget",
    state: "connected",
    tools: ["fourget_image_search"],
  }];
  const diagnostics = searchBackendDiagnostics(policy, clients, [], {
    liveTools: [{ name: "fourget-fourget_image_search", inputSchema: { type: "object" } }],
    ompSearch: webSearchConfigDiagnostics({}, {}),
  });
  assert.equal(diagnostics.paths.web, "OMP native web_search");
  assert.equal(diagnostics.paths.images, "MCP/4get");
  assert.equal(diagnostics.paths.news, "OMP/native or model-selected search");
  assert.equal(diagnostics.preferredPath, "OMP native web_search");
});


test("MCP tool surface reports discoverable presentation separately from provider deferral", () => {
  const surface = mcpToolSurfaceDiagnostics([
    { name: "fourget-fourget_web_search", description: "Search", inputSchema: { type: "object" } },
    { name: "github-search", description: "Search GitHub", inputSchema: { type: "object" } },
  ]);
  assert.equal(surface.visibleTools, 2);
  assert.equal(surface.discoverableTools, 2);
  assert.equal(surface.ompDefaultLoadMode, "discoverable");
  assert.equal(surface.providerDeferral, "route-dependent");
  assert.ok(surface.estimatedSchemaTokens > 0);
});

test("live MCP tool listing ignores SSE notifications and selects the matching JSON-RPC response id", async () => {
  const calls = [];
  const tools = await listMcpGatewayTools("http://bifrost.test/v1", "vk-test", {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const body = [
        'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
        "",
        'data: {"jsonrpc":"2.0","id":99,"result":{"tools":[]}}',
        "",
        'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"fourget-fourget_web_search","description":"Search","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}}}]}}',
        "",
      ].join("\n");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal(calls[0].url, "http://bifrost.test/mcp");
  assert.equal(calls[0].init.headers["x-bf-vk"], "vk-test");
  assert.deepEqual(tools.map((tool) => tool.name), ["fourget-fourget_web_search"]);
  assert.equal(tools[0].inputSchema.properties.query.type, "string");
});

test("MCP SSE parser returns only the envelope matching the requested id", () => {
  const body = [
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
    "",
    'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
    "",
  ].join("\n");
  assert.deepEqual(parseMcpJsonRpcResponse(body, 7), {
    jsonrpc: "2.0",
    id: 7,
    result: { ok: true },
  });
  assert.equal(parseMcpJsonRpcResponse(body, 8), undefined);
});

test("effective repo MCP policy unions direct grants, Virtual MCPs and allowed-by-default clients", () => {
  const clients = [
    { id: "railway-id", name: "railway", allowOnAllVirtualKeys: false, disabled: false },
    { id: "github-id", name: "github", allowOnAllVirtualKeys: true, disabled: false },
    { id: "disabled-id", name: "disabled", allowOnAllVirtualKeys: true, disabled: true },
  ];
  const vk = {
    id: "vk-repo",
    mcp_configs: [{
      mcp_client_id: "railway-id",
      mcp_client: { client_id: "railway-id", name: "railway" },
      tools_to_execute: ["list-projects"],
    }],
  };
  const vmcps = [
    normalizeVirtualMcp({
      id: 12,
      name: "Development Tools",
      endpoint_slug: "development-tools",
      enabled: true,
      tools: [{ mcp_client_id: "railway-id", tool_names: ["get-logs"] }],
      virtual_key_ids: ["vk-repo"],
    }),
    normalizeVirtualMcp({
      id: 13,
      name: "Disabled Bundle",
      endpoint_slug: "disabled-bundle",
      enabled: false,
      tools: [{ mcp_client_id: "github-id", tool_names: ["issues"] }],
      virtual_key_ids: ["vk-repo"],
    }),
  ];
  const policy = effectiveRepoMcpPolicy(vk, vmcps, clients);
  assert.deepEqual(policy.virtualMcps.map((item) => [item.name, item.enabled]), [
    ["Development Tools", true],
    ["Disabled Bundle", false],
  ]);
  assert.deepEqual(policy.effective, [
    {
      client: "railway",
      tools: ["list-projects", "get-logs"],
      sources: ["direct", "virtual:Development Tools"],
    },
    { client: "github", tools: ["*"], sources: ["default"] },
  ]);
});


test("quota governance diagnostics distinguish direct and external SourceRef origins", () => {
  const sources = quotaGovernanceSources({
    virtual_key_name: "omp-global",
    budgets: [
      { id: "direct", max_limit: 10 },
      {
        id: "profile",
        max_limit: 20,
        source_type: "access_profile",
        source_id: "ap-eng",
        source_name: "Engineering",
      },
    ],
    rate_limits: [{
      id: "project-rate",
      source_type: "project",
      source_id: "project-ai",
      source_name: "AI Platform",
    }],
    provider_configs: [{ provider: "deepseek", budgets: [{ id: "provider" }] }],
    model_configs: [{ provider: "deepseek", model_name: "deepseek-v4-pro", rate_limit: { id: "model" } }],
  });

  assert.deepEqual(sources, [
    { kind: "virtual_key", name: "omp-global" },
    {
      kind: "external",
      sourceType: "access_profile",
      sourceId: "ap-eng",
      sourceName: "Engineering",
    },
    {
      kind: "external",
      sourceType: "project",
      sourceId: "project-ai",
      sourceName: "AI Platform",
    },
    { kind: "provider_config", provider: "deepseek" },
    { kind: "model_config", provider: "deepseek", modelId: "deepseek-v4-pro" },
  ]);
  assert.equal(formatQuotaGovernanceSource(sources[1]), 'Access Profile "Engineering" [ap-eng]');
  assert.equal(formatQuotaGovernanceSource(sources[3]), "Direct provider config: deepseek");
});
