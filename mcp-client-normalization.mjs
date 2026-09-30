import {
  bifrostManagementBase,
  managementHeaders,
  nonEmpty,
  requestJson,
} from "./cli-lib.mjs";
import { normalizeMcpClientShape } from "./mcp-client-shape.mjs";

function arrayFromResponse(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.clients)) return body.data.clients;
  return [];
}

export function normalizeMcpClient(client) {
  return normalizeMcpClientShape(client);
}

export async function listMcpClients(url, managementAuth) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/mcp/clients?limit=100&offset=0`, {
    headers: managementHeaders(managementAuth),
  });
  const clients = arrayFromResponse(body, ["clients", "mcp_clients", "items"])
    .map(normalizeMcpClientShape)
    .filter((client) => client.name);
  return clients;
}

export function mcpAssignment(client, tools = ["*"]) {
  const name = nonEmpty(client?.name);
  if (!name) throw new Error("Cannot create MCP assignment for a client without a name");
  const normalizedTools = Array.isArray(tools) && tools.length ? tools : ["*"];
  return {
    mcp_client_name: name,
    tools_to_execute: normalizedTools,
  };
}
