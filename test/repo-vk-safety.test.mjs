import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadState, upsertRepoVirtualKey } from "../cli-lib.mjs";

test("repo init associates but does not rotate an existing masked Virtual Key implicitly", async () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-vk-safety-"));
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;
  let rotateCalls = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys") {
      response.end(JSON.stringify({
        virtual_keys: [{ id: "vk-existing", name: "omp-demo-mcp", value: "********" }],
      }));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/governance/virtual-keys/vk-existing") {
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-existing",
          name: "omp-demo-mcp",
          value: "********",
          mcp_configs: [{ mcp_client_name: "home-assistant", tools_to_execute: ["*"] }],
        },
      }));
      return;
    }

    if (request.method === "POST" && url.pathname.endsWith("/rotate")) {
      rotateCalls += 1;
      response.end(JSON.stringify({ virtual_key: { id: "vk-existing", value: "sk-bf-rotated" } }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind an address");

  try {
    process.env.PIFROST_CONFIG_DIR = root;
    const state = loadState();
    const repo = { root, name: "demo", identity: "example/demo", id: "demo-abc" };

    await assert.rejects(
      upsertRepoVirtualKey({
        state,
        repo,
        clients: [{ name: "home-assistant", tools: ["*"] }],
        url: `http://127.0.0.1:${address.port}/v1`,
        managementKey: "management-key",
      }),
      /raw value is not available locally/u,
    );

    assert.equal(rotateCalls, 0);
    const saved = loadState();
    assert.equal(saved.config.repos[repo.id].virtualKeyId, "vk-existing");
    assert.equal(saved.secrets.repos[repo.id], undefined);
  } finally {
    server.close();
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});
