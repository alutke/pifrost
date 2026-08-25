import {
  bifrostManagementBase,
  managementHeaders,
  nonEmpty,
  requestJson,
} from "./cli-lib.mjs";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function arrayFromResponse(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.clients)) return body.data.clients;
  return [];
}

/**
 * Normalize MCP clients returned by current and older Bifrost releases.
 *
 * Current Bifrost returns:
 *   { config: { client_id, name, disabled, allow_on_all_virtual_keys, ... },
 *     tools: [...], state, vk_configs }
 *
 * Older/alternate surfaces may expose those identity/config fields flat.
 */
export function normalizeMcpClient(client) {
  const config = client?.config && typeof client.config === "object" && !Array.isArray(client.config)
    ? client.config
    : {};

  const id =
    nonEmpty(config?.client_id) ??
    nonEmpty(client?.client_id) ??
    nonEmpty(client?.id) ??
    undefined;

  const name =
    nonEmpty(config?.name) ??
    nonEmpty(client?.name) ??
    nonEmpty(client?.client_name) ??
    id ??
    "";

  const rawTools = Array.isArray(client?.tools)
    ? client.tools
    : Array.isArray(client?.available_tools)
      ? client.available_tools
      : Array.isArray(config?.tools)
        ? config.tools
        : [];

  const tools = unique(
    rawTools.map((tool) =>
      typeof tool === "string"
        ? nonEmpty(tool)
        : nonEmpty(tool?.name) ??
          nonEmpty(tool?.function?.name) ??
          nonEmpty(tool?.tool_name) ??
          nonEmpty(tool?.function_name),
    ),
  );

  return {
    id,
    name,
    state: client?.state ?? client?.status ?? client?.connection_state,
    disabled: Boolean(config?.disabled ?? client?.disabled),
    allowOnAllVirtualKeys: Boolean(
      config?.allow_on_all_virtual_keys ?? client?.allow_on_all_virtual_keys,
    ),
    tools,
    raw: client,
  };
}

export async function listMcpClients(url, managementAuth) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/mcp/clients?limit=100&offset=0`, {
    headers: managementHeaders(managementAuth),
  });
  const clients = arrayFromResponse(body, ["clients", "mcp_clients", "items"])
    .map(normalizeMcpClient)
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
