import assert from "node:assert/strict";
import test from "node:test";

import {
  listMcpClients,
  mcpAssignment,
  normalizeMcpClient,
} from "../mcp-client-normalization.mjs";

test("normalizes current Bifrost nested MCP client response", () => {
  const raw = {
    config: {
      client_id: "9c2d0d39-railway",
      name: "railway",
      connection_type: "http",
      endpoint_slug: "railway",
      auth_type: "per_user_oauth",
      is_code_mode_client: true,
      tools_to_execute: ["*"],
      tools_to_auto_execute: ["get-logs"],
      needs_session_stickiness: false,
      is_ping_available: true,
      disabled: false,
      allow_on_all_virtual_keys: false,
    },
    tools: [
      { function: { name: "create-deployment" } },
      { name: "get-logs" },
      { tool_name: "list-projects" },
    ],
    state: "connected",
    vk_configs: [],
  };

  const client = normalizeMcpClient(raw);
  assert.equal(client.id, "9c2d0d39-railway");
  assert.equal(client.name, "railway");
  assert.equal(client.state, "connected");
  assert.equal(client.disabled, false);
  assert.equal(client.allowOnAllVirtualKeys, false);
  assert.equal(client.endpointSlug, "railway");
  assert.equal(client.connectionType, "http");
  assert.equal(client.authType, "per_user_oauth");
  assert.equal(client.isCodeModeClient, true);
  assert.deepEqual(client.toolsToExecute, ["*"]);
  assert.deepEqual(client.toolsToAutoExecute, ["get-logs"]);
  assert.equal(client.needsSessionStickiness, false);
  assert.equal(client.isPingAvailable, true);
  assert.deepEqual(client.tools, ["create-deployment", "get-logs", "list-projects"]);
});

test("normalizes nested n8n client and preserves display name for VK assignment", () => {
  const client = normalizeMcpClient({
    config: {
      client_id: "mcp-n8n-123",
      name: "n8n",
      allow_on_all_virtual_keys: false,
    },
    tools: ["create_workflow", "execute_workflow"],
    state: "connected",
  });

  assert.equal(client.name, "n8n");
  assert.deepEqual(mcpAssignment(client, ["*"]), {
    mcp_client_name: "n8n",
    tools_to_execute: ["*"],
  });
});

test("retains compatibility with flat MCP client response shapes", () => {
  const client = normalizeMcpClient({
    client_id: "legacy-id",
    name: "legacy-client",
    disabled: true,
    allow_on_all_virtual_keys: true,
    available_tools: [{ function: { name: "legacy-tool" } }],
    connection_state: "healthy",
  });

  assert.equal(client.id, "legacy-id");
  assert.equal(client.name, "legacy-client");
  assert.equal(client.disabled, true);
  assert.equal(client.allowOnAllVirtualKeys, true);
  assert.equal(client.state, "healthy");
  assert.deepEqual(client.tools, ["legacy-tool"]);
});

test("rejects assignment when an MCP client has no usable identity", () => {
  assert.throws(
    () => mcpAssignment(normalizeMcpClient({ tools: [] }), ["*"]),
    /without a name/,
  );
});

test("listMcpClients reads nested clients from the Bifrost management response", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    clients: [
      {
        config: { client_id: "railway-id", name: "railway" },
        tools: [{ function: { name: "get-logs" } }],
        state: "connected",
      },
      {
        config: { client_id: "n8n-id", name: "n8n" },
        tools: [{ function: { name: "create_workflow" } }],
        state: "connected",
      },
    ],
    count: 2,
    total_count: 2,
    limit: 100,
    offset: 0,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const clients = await listMcpClients("http://bifrost:8180/v1", {
      mode: "basic",
      username: "admin",
      password: "secret",
    });
    assert.deepEqual(clients.map((client) => client.name), ["railway", "n8n"]);
    assert.deepEqual(clients.map((client) => client.id), ["railway-id", "n8n-id"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
