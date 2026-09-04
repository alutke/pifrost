import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  getRoutingRules,
  listMcpClients,
  listVirtualKeys,
} from "../cli-lib.mjs";

test("Bifrost 2.x management collections are read across every page", async () => {
  const rules = Array.from({ length: 150 }, (_, index) => ({
    id: `rule-${index}`,
    name: index === 149 ? "omp-page-2" : `rule-${index}`,
    enabled: true,
    targets: [],
  }));
  const clients = Array.from({ length: 125 }, (_, index) => ({
    config: { client_id: `client-${index}`, name: `client-${index}` },
    tools: [],
    state: "connected",
  }));
  const keys = Array.from({ length: 101 }, (_, index) => ({
    id: `vk-${index}`,
    name: `key-${index}`,
  }));

  const calls = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    calls.push(`${url.pathname}:${offset}`);
    response.setHeader("content-type", "application/json");

    const page = (items, key) => {
      const values = items.slice(offset, offset + limit);
      response.end(JSON.stringify({
        [key]: values,
        count: values.length,
        total_count: items.length,
        limit,
        offset,
      }));
    };

    if (url.pathname === "/api/routing/rules") return page(rules, "rules");
    if (url.pathname === "/api/mcp/clients") return page(clients, "clients");
    if (url.pathname === "/api/governance/virtual-keys") return page(keys, "virtual_keys");

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const base = `http://127.0.0.1:${address.port}/v1`;
  const auth = { mode: "basic", username: "admin", password: "secret" };

  try {
    const foundRules = await getRoutingRules(base, auth);
    const foundClients = await listMcpClients(base, auth);
    const foundKeys = await listVirtualKeys(base, auth);

    assert.equal(foundRules.length, 150);
    assert.equal(foundRules.at(-1)?.name, "omp-page-2");
    assert.equal(foundClients.length, 125);
    assert.equal(foundClients.at(-1)?.name, "client-124");
    assert.equal(foundKeys.length, 101);
    assert.equal(foundKeys.at(-1)?.name, "key-100");

    assert.ok(calls.includes("/api/routing/rules:100"));
    assert.ok(calls.includes("/api/mcp/clients:100"));
    assert.ok(calls.includes("/api/governance/virtual-keys:100"));
    assert.ok(!calls.some((call) => call.startsWith("/api/governance/routing-rules:")));
  } finally {
    server.close();
  }
});
