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
        virtual_keys: [{ id: "vk-existing", name: "omp-demo-abc-mcp", value: "********" }],
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys/vk-existing") {
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-existing",
          name: "omp-demo-abc-mcp",
          value: "********",
          mcp_configs: [{
            id: 11,
            mcp_client_id: "client-ha",
            mcp_client_name: "home-assistant",
            tools_to_execute: ["*"],
          }],
        },
      }));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/governance/virtual-keys/vk-existing") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      assert.equal(Object.prototype.hasOwnProperty.call(parsed, "name"), false);
      assert.deepEqual(parsed.mcp_configs, [{
        id: 11,
        mcp_client_name: "home-assistant",
        tools_to_execute: ["*"],
      }]);
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-existing",
          name: "omp-demo-abc-mcp",
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


test("repo-scoped Virtual Key names distinguish repositories with the same basename", async () => {
  const { repoVirtualKeyName } = await import("../cli-lib.mjs");
  assert.equal(repoVirtualKeyName({ name: "homelab", id: "homelab-aaaaaaaaaa" }), "omp-homelab-aaaaaaaaaa-mcp");
  assert.equal(repoVirtualKeyName({ name: "homelab", id: "homelab-bbbbbbbbbb" }), "omp-homelab-bbbbbbbbbb-mcp");
});


test("repo init recovers from a create-name race by re-reading the exact canonical key", async () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-vk-race-"));
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;
  let listCalls = 0;
  let createCalls = 0;
  let rotateCalls = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys") {
      listCalls += 1;
      // Correctness must not depend on Bifrost's optional search filter.
      assert.equal(url.searchParams.has("search"), false);
      response.end(JSON.stringify({
        virtual_keys: listCalls === 1
          ? []
          : [{ id: "vk-raced", name: "omp-demo-race-mcp", value: "********" }],
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/governance/virtual-keys") {
      createCalls += 1;
      response.statusCode = 409;
      response.end(JSON.stringify({ error: { message: "A virtual key with this name already exists" } }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys/vk-raced") {
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-raced",
          name: "omp-demo-race-mcp",
          value: "********",
          mcp_configs: [],
        },
      }));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/governance/virtual-keys/vk-raced") {
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-raced",
          name: "omp-demo-race-mcp",
          value: "********",
          mcp_configs: [{ mcp_client_name: "railway", tools_to_execute: ["*"] }],
        },
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/governance/virtual-keys/vk-raced/rotate") {
      rotateCalls += 1;
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-raced",
          name: "omp-demo-race-mcp",
          value: "sk-bf-raced",
        },
      }));
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
    const repo = { root, name: "demo", identity: "example/demo", id: "demo-race" };

    const vk = await upsertRepoVirtualKey({
      state,
      repo,
      clients: [{ name: "railway", tools: ["*"] }],
      url: `http://127.0.0.1:${address.port}/v1`,
      managementKey: "management-key",
      rotateExisting: true,
    });

    assert.equal(vk.id, "vk-raced");
    assert.equal(createCalls, 1);
    assert.equal(listCalls, 2);
    assert.equal(rotateCalls, 1);
    const saved = loadState();
    assert.equal(saved.config.repos[repo.id].virtualKeyName, "omp-demo-race-mcp");
    assert.equal(saved.secrets.repos[repo.id].mcpVirtualKey, "sk-bf-raced");
  } finally {
    server.close();
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});


test("repo init migrates a stored legacy key to the repo-scoped canonical name", async () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-vk-legacy-update-"));
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;
  let putCalls = 0;
  let listCalls = 0;
  let detailCalls = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys") {
      listCalls += 1;
      // No other key owns the repo-scoped canonical name.
      response.end(JSON.stringify({ virtual_keys: [] }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys/vk-legacy") {
      detailCalls += 1;
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-legacy",
          name: "omp-homelab-mcp",
          value: "********",
          mcp_configs: [{
            id: 71,
            mcp_client_id: "client-n8n",
            mcp_client_name: "n8n",
            tools_to_execute: ["*"],
          }],
        },
      }));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/governance/virtual-keys/vk-legacy") {
      putCalls += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      // Reproduce the Bifrost 2.2.3 legacy-name failure: a policy-only update
      // cannot disambiguate an old duplicate basename-only name.
      if (parsed.name !== "omp-homelab-59894f4310-mcp") {
        response.statusCode = 409;
        response.end(JSON.stringify({ error: { message: "A virtual key with this name already exists" } }));
        return;
      }
      assert.equal(parsed.is_active, true);
      // Bifrost 2.2.3 requires the row id for existing MCP grants. Without
      // id:71, it treats n8n as a new row and returns ErrAlreadyExists, which
      // its handler misleadingly reports as a Virtual Key name conflict.
      assert.deepEqual(parsed.mcp_configs, [
        { id: 71, mcp_client_name: "n8n", tools_to_execute: ["*"] },
        { mcp_client_name: "railway", tools_to_execute: ["*"] },
      ]);
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-legacy",
          name: parsed.name,
          value: "********",
          mcp_configs: parsed.mcp_configs,
        },
      }));
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
    const repo = { root, name: "homelab", identity: "example/homelab", id: "homelab-59894f4310" };
    state.config.repos[repo.id] = {
      name: repo.name,
      identity: repo.identity,
      virtualKeyId: "vk-legacy",
      virtualKeyName: "omp-homelab-mcp",
      mcpClients: [{ name: "n8n", tools: ["*"] }],
    };
    state.secrets.repos[repo.id] = { mcpVirtualKey: "sk-bf-existing" };

    const vk = await upsertRepoVirtualKey({
      state,
      repo,
      clients: [
        { name: "n8n", tools: ["*"] },
        { name: "railway", tools: ["*"] },
      ],
      url: `http://127.0.0.1:${address.port}/v1`,
      managementKey: "management-key",
    });

    assert.equal(vk.id, "vk-legacy");
    assert.equal(vk.name, "omp-homelab-59894f4310-mcp");
    assert.equal(putCalls, 1);
    assert.equal(listCalls, 1);
    assert.equal(detailCalls, 1);
    const saved = loadState();
    assert.equal(saved.config.repos[repo.id].virtualKeyName, "omp-homelab-59894f4310-mcp");
    assert.deepEqual(saved.config.repos[repo.id].mcpClients, [
      { name: "n8n", tools: ["*"] },
      { name: "railway", tools: ["*"] },
    ]);
    assert.equal(saved.secrets.repos[repo.id].mcpVirtualKey, "sk-bf-existing");
  } finally {
    server.close();
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});


test("repo init refuses legacy-key migration when the canonical name belongs to another key", async () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-vk-legacy-conflict-"));
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;
  let putCalls = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys/vk-legacy") {
      response.end(JSON.stringify({
        virtual_key: {
          id: "vk-legacy",
          name: "omp-homelab-mcp",
          value: "********",
          mcp_configs: [{
            id: 71,
            mcp_client_id: "client-n8n",
            mcp_client_name: "n8n",
            tools_to_execute: ["*"],
          }],
        },
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/governance/virtual-keys") {
      response.end(JSON.stringify({
        virtual_keys: [{
          id: "vk-other",
          name: "omp-homelab-59894f4310-mcp",
          value: "********",
        }],
      }));
      return;
    }

    if (request.method === "PUT") putCalls += 1;
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind an address");

  try {
    process.env.PIFROST_CONFIG_DIR = root;
    const state = loadState();
    const repo = { root, name: "homelab", identity: "example/homelab", id: "homelab-59894f4310" };
    state.config.repos[repo.id] = {
      name: repo.name,
      identity: repo.identity,
      virtualKeyId: "vk-legacy",
      virtualKeyName: "omp-homelab-mcp",
      mcpClients: [{ name: "n8n", tools: ["*"] }],
    };
    state.secrets.repos[repo.id] = { mcpVirtualKey: "sk-bf-existing" };

    await assert.rejects(
      upsertRepoVirtualKey({
        state,
        repo,
        clients: [{ name: "n8n", tools: ["*"] }],
        url: `http://127.0.0.1:${address.port}/v1`,
        managementKey: "management-key",
      }),
      /canonical name .* already belongs to vk-other/u,
    );
    assert.equal(putCalls, 0);
  } finally {
    server.close();
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});
