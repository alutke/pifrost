import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadState, upsertRepoVirtualKey } from "../cli-lib.mjs";

test("new repo MCP Virtual Keys are explicitly inference-denied on Bifrost 2.x", async () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-vk-create-"));
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;
  let createdBody;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys") {
      response.end(JSON.stringify({ virtual_keys: [] }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/governance/virtual-keys") {
      let body = "";
      for await (const chunk of request) body += chunk;
      createdBody = JSON.parse(body);
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-new",
          name: "omp-demo-mcp",
          value: "sk-bf-new",
          ...createdBody,
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");

  try {
    process.env.PIFROST_CONFIG_DIR = root;
    const state = loadState();
    const repo = { root, name: "demo", identity: "example/demo", id: "demo-secure" };
    await upsertRepoVirtualKey({
      state,
      repo,
      clients: [{ name: "railway", tools: ["*"] }],
      url: `http://127.0.0.1:${address.port}/v1`,
      managementKey: "management-key",
    });

    assert.equal(createdBody.allow_all_providers, false);
    assert.deepEqual(createdBody.provider_configs, []);
    assert.deepEqual(createdBody.mcp_configs, [{
      mcp_client_name: "railway",
      tools_to_execute: ["*"],
    }]);
  } finally {
    server.close();
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});
