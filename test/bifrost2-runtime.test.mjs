import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  getBifrostHealth,
  getBifrostVersion,
  attachVirtualMcpToVirtualKey,
  bifrostCompatibilityMatrix,
  compatibilityValidationStatus,
  detachVirtualMcpFromVirtualKey,
  getVirtualKeyQuota,
  listVirtualMcps,
  testInference,
} from "../cli-lib.mjs";
import { houndMcpDiagnostics } from "../hound-diagnostics.mjs";

test("compatibility validation distinguishes tested, supported and newer releases", () => {
  assert.deepEqual(
    compatibilityValidationStatus("2.2.6", "2.2.4", "2.2.6"),
    { status: "tested-current", detail: "installed 2.2.6 matches the current validated release" },
  );
  assert.equal(compatibilityValidationStatus("2.2.5", "2.2.4", "2.2.6").status, "supported");
  assert.equal(compatibilityValidationStatus("2.2.7", "2.2.4", "2.2.6").status, "newer");
  assert.equal(compatibilityValidationStatus("2.2.3", "2.2.4", "2.2.6").status, "unsupported");
});

test("Bifrost 2.x control-plane probes and VK-only inference use canonical endpoints", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      virtualKey: request.headers["x-bf-vk"],
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/version") {
      response.end(JSON.stringify({ version: "2.0.0" }));
      return;
    }
    if (request.url === "/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "model" }] }));
      return;
    }
    if (request.url === "/api/governance/virtual-keys/quota") {
      response.end(JSON.stringify({ virtual_key_name: "omp", budgets: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;

  try {
    assert.equal(await getBifrostVersion(url), "2.0.0");
    await getBifrostHealth(url);
    const inference = await testInference({ url, virtualKey: "sk-bf-test" });
    assert.equal(inference.authMode, "virtual-key");
    await getVirtualKeyQuota(url, "sk-bf-test");

    const modelRequest = requests.find((entry) => entry.url === "/v1/models");
    assert.equal(modelRequest.authorization, undefined);
    assert.equal(modelRequest.virtualKey, "sk-bf-test");
    const quotaRequest = requests.find((entry) => entry.url === "/api/governance/virtual-keys/quota");
    assert.equal(quotaRequest.virtualKey, "sk-bf-test");
  } finally {
    server.close();
  }
});


test("Bifrost Virtual MCP list and VK assignment helpers use the released management endpoints", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url?.startsWith("/api/mcp/virtual-mcps?")) {
      response.end(JSON.stringify({
        virtual_mcps: [{
          id: 12,
          name: "Development Tools",
          endpoint_slug: "development-tools",
          enabled: true,
          instructions: "Use repository-safe tools.",
          instructions_mode: "replace",
          tools: [{ mcp_client_id: "railway", tool_names: ["*"] }],
          virtual_key_ids: ["vk-repo"],
        }],
        count: 1,
        total_count: 1,
        limit: 100,
        offset: 0,
      }));
      return;
    }
    if (
      (request.method === "POST" || request.method === "DELETE") &&
      request.url === "/api/mcp/virtual-mcps/12/virtual-keys/vk-repo"
    ) {
      response.end(JSON.stringify({ success: true }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;
  const auth = { mode: "basic", username: "admin", password: "secret" };
  try {
    const virtualMcps = await listVirtualMcps(url, auth);
    assert.equal(virtualMcps[0]?.name, "Development Tools");
    assert.deepEqual(virtualMcps[0]?.virtualKeyIds, ["vk-repo"]);
    assert.equal(virtualMcps[0]?.instructions, "Use repository-safe tools.");
    assert.equal(virtualMcps[0]?.instructionsMode, "replace");
    await attachVirtualMcpToVirtualKey(url, auth, 12, "vk-repo");
    await detachVirtualMcpFromVirtualKey(url, auth, 12, "vk-repo");
    assert.ok(requests.some((item) => item.method === "POST" && item.url === "/api/mcp/virtual-mcps/12/virtual-keys/vk-repo"));
    assert.ok(requests.some((item) => item.method === "DELETE" && item.url === "/api/mcp/virtual-mcps/12/virtual-keys/vk-repo"));
  } finally {
    server.close();
  }
});


test("compatibility doctor verifies Bifrost feature paths without mutating configuration", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "model" }] }));
      return;
    }
    if (request.url === "/api/governance/virtual-keys/quota") {
      response.end(JSON.stringify({
        virtual_key_name: "omp",
        budgets: [],
        rate_limit: null,
        rate_limits: [],
        provider_configs: [],
        model_configs: [],
      }));
      return;
    }
    if (request.url?.startsWith("/api/mcp/virtual-mcps?")) {
      response.end(JSON.stringify({ virtual_mcps: [], total_count: 0, limit: 1, offset: 0 }));
      return;
    }
    if (request.url?.startsWith("/api/skills?")) {
      response.end(JSON.stringify({ skills: [], total: 0, limit: 1, offset: 0 }));
      return;
    }
    if (request.url?.startsWith("/api/routing/rules?")) {
      response.end(JSON.stringify({
        rules: [{
          name: "omp-default",
          enabled: true,
          targets: [{ provider: "openai", model: "gpt-test" }],
          fallbacks: [{ provider: "deepseek", model: "deepseek-test", key_id: "key-1" }],
        }],
        total_count: 1,
        limit: 100,
        offset: 0,
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;
  const auth = { mode: "basic", username: "admin", password: "secret" };
  try {
    const matrix = await bifrostCompatibilityMatrix({
      url,
      version: "2.2.4",
      managementAuth: auth,
      virtualKey: "sk-bf-test",
    });
    assert.deepEqual(matrix.map((item) => [item.id, item.status]), [
      ["bifrost-setup-lock", "unavailable"],
      ["bifrost-virtual-mcp", "supported"],
      ["bifrost-skills", "supported"],
      ["bifrost-session-affinity", "supported"],
      ["bifrost-pinned-fallbacks", "supported"],
      ["bifrost-quota-sourceref", "supported"],
      ["bifrost-tool-search", "supported"],
      ["bifrost-between-tools-thinking", "supported"],
      ["bifrost-service-tier", "supported"],
    ]);
    assert.match(matrix.find((item) => item.id === "bifrost-pinned-fallbacks")?.detail ?? "", /object fallbacks observed=1/);
    assert.ok(requests.every((item) => item.method === "GET"));
  } finally {
    server.close();
  }
});

test("compatibility doctor distinguishes contract drift, inaccessible probes and version-gated absence", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/api/mcp/virtual-mcps?")) {
      response.end(JSON.stringify({ items: "not-an-array" }));
      return;
    }
    if (request.url?.startsWith("/api/skills?")) {
      response.end(JSON.stringify({ skills: "not-an-array" }));
      return;
    }
    if (request.url?.startsWith("/api/routing/rules?")) {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: { message: "forbidden" } }));
      return;
    }
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "model" }] }));
      return;
    }
    if (request.url === "/api/governance/virtual-keys/quota") {
      response.end(JSON.stringify({ budgets: [], rate_limits: "wrong", provider_configs: [], model_configs: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;
  const auth = { mode: "basic", username: "admin", password: "secret" };
  try {
    const matrix = await bifrostCompatibilityMatrix({
      url,
      version: "2.2.3",
      managementAuth: auth,
      virtualKey: "sk-bf-test",
    });
    assert.equal(matrix.find((item) => item.id === "bifrost-virtual-mcp")?.status, "drifted");
    assert.equal(matrix.find((item) => item.id === "bifrost-skills")?.status, "drifted");
    assert.equal(matrix.find((item) => item.id === "bifrost-pinned-fallbacks")?.status, "inaccessible");
    assert.equal(matrix.find((item) => item.id === "bifrost-quota-sourceref")?.status, "drifted");

    const old = await bifrostCompatibilityMatrix({
      url,
      version: "2.2.1",
      managementAuth: auth,
      virtualKey: "sk-bf-test",
    });
    assert.equal(old.find((item) => item.id === "bifrost-session-affinity")?.status, "unavailable");
    assert.equal(old.find((item) => item.id === "bifrost-pinned-fallbacks")?.status, "unavailable");
  } finally {
    server.close();
  }
});


test("Hound diagnostics distinguish Bifrost MCP research from OMP native web search", () => {
  const policy = {
    effective: [{
      client: "hound",
      tools: ["mcp_smart_search", "mcp_smart_fetch", "mcp_smart_crawl"],
      sources: ["virtual:Research"],
    }],
    virtualMcps: [{ name: "Research", enabled: true }],
  };
  const clients = [{
    name: "hound",
    tools: ["mcp_smart_search", "mcp_smart_fetch", "mcp_smart_crawl", "mcp_screenshot", "cache_clear", "version"],
  }];
  const virtualMcps = [{
    name: "Research",
    instructions: "Use Hound for web research.",
    instructionsMode: "append",
  }];
  const result = houndMcpDiagnostics(policy, clients, virtualMcps);
  assert.equal(result.hound.available, true);
  assert.equal(result.hound.coreReady, true);
  assert.equal(result.hound.complete, false);
  assert.deepEqual(result.hound.missing, ["mcp_screenshot", "cache_clear", "version"]);
  assert.equal(result.search.path, "MCP/Hound mcp_smart_search");
  assert.deepEqual(result.instructions, [{
    name: "Research",
    mode: "append",
    instructions: "Use Hound for web research.",
  }]);
});
