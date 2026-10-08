import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { collectDoctorSnapshot } from "../doctor-probes.mjs";

test("doctor snapshot fans out read-only Bifrost probes once", async () => {
  const hits = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/api/version") return response.end(JSON.stringify({ version: "2.2.3" }));
    if (url.pathname === "/health") return response.end(JSON.stringify({ status: "ok" }));
    if (url.pathname === "/api/session/is-auth-enabled") {
      return response.end(JSON.stringify({
        is_auth_enabled: true,
        has_valid_token: false,
        auth_type: "session",
        inference_auth_enforced: true,
        setup_required: false,
        setup_token_configured: true,
      }));
    }
    if (url.pathname === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "demo" }] }));
    if (url.pathname === "/api/governance/virtual-keys/quota") {
      return response.end(JSON.stringify({ budgets: [], rate_limits: [], provider_configs: [], model_configs: [] }));
    }
    if (url.pathname === "/api/governance/virtual-keys") return response.end(JSON.stringify({ virtual_keys: [], total_count: 0 }));
    if (url.pathname === "/api/routing/rules") return response.end(JSON.stringify({ rules: [], total_count: 0 }));
    if (url.pathname === "/api/governance/routing-rules") return response.end(JSON.stringify({ rules: [], total_count: 0 }));
    if (url.pathname === "/api/config") return response.end(JSON.stringify({ client_config: {} }));
    if (url.pathname === "/api/routing/complexity-analyzer-config") {
      response.statusCode = 404;
      return response.end(JSON.stringify({ error: { message: "not enabled" } }));
    }
    if (url.pathname === "/api/mcp/clients") return response.end(JSON.stringify({ clients: [], total_count: 0 }));
    if (url.pathname === "/api/mcp/virtual-mcps") return response.end(JSON.stringify({ virtual_mcps: [], total_count: 0 }));
    if (url.pathname === "/api/skills") return response.end(JSON.stringify({ skills: [], total: 0 }));

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const snapshot = await collectDoctorSnapshot({
      runtime: { url: `${base}/v1`, virtualKey: "vk-test" },
      managementAuth: { mode: "basic", username: "admin", password: "secret" },
    });

    for (const key of ["version", "health", "setup", "inference", "quota", "management", "routing", "gateway", "complexity", "mcpClients", "virtualMcps", "skills"]) {
      assert.equal(snapshot[key].ok, true, `${key} should be successful`);
    }
    assert.equal(hits.get("/api/version"), 1);
    assert.equal(hits.get("/api/session/is-auth-enabled"), 1);
    assert.equal(hits.get("/v1/models"), 1);
    assert.equal(hits.get("/api/governance/virtual-keys/quota"), 1);
    assert.equal(hits.get("/api/mcp/virtual-mcps"), 1);
    assert.equal(hits.get("/api/skills"), 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
