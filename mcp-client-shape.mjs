function nonEmpty(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toolDefinitionsFromClient(client, config) {
  const rawTools = Array.isArray(client?.tools)
    ? client.tools
    : Array.isArray(client?.available_tools)
      ? client.available_tools
      : Array.isArray(config?.tools)
        ? config.tools
        : [];

  return rawTools
    .map((tool) => {
      if (typeof tool === "string") {
        const name = nonEmpty(tool);
        return name ? { name } : undefined;
      }
      const name =
        nonEmpty(tool?.name) ??
        nonEmpty(tool?.function?.name) ??
        nonEmpty(tool?.tool_name) ??
        nonEmpty(tool?.function_name);
      if (!name) return undefined;
      const description = nonEmpty(tool?.description) ?? nonEmpty(tool?.function?.description);
      const inputSchema =
        tool?.inputSchema ??
        tool?.input_schema ??
        tool?.parameters ??
        tool?.function?.parameters;
      return {
        name,
        ...(description ? { description } : {}),
        ...(inputSchema && typeof inputSchema === "object" ? { inputSchema } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * Canonical normalization for MCP client rows returned by current and older
 * Bifrost management surfaces. Keep all CLI paths on this shape so Hound,
 * Code Mode, repository policy and generic MCP diagnostics cannot drift.
 */
export function normalizeMcpClientShape(client) {
  const config = client?.config && typeof client.config === "object" && !Array.isArray(client.config)
    ? client.config
    : client ?? {};

  const id =
    nonEmpty(config?.client_id) ??
    nonEmpty(client?.client_id) ??
    (client?.id === undefined || client?.id === null ? undefined : nonEmpty(String(client.id)));

  const name =
    nonEmpty(config?.name) ??
    nonEmpty(client?.name) ??
    nonEmpty(client?.client_name) ??
    id ??
    "";

  const toolDefinitions = toolDefinitionsFromClient(client, config);
  const tools = unique(toolDefinitions.map((tool) => tool.name));

  const instructionLimit = config?.max_instructions_length ?? client?.max_instructions_length;
  const numericInstructionLimit = Number(instructionLimit);

  return {
    id,
    name,
    state: client?.state ?? client?.status ?? client?.connection_state,
    disabled: Boolean(config?.disabled ?? client?.disabled),
    allowOnAllVirtualKeys: Boolean(
      config?.allow_by_default ??
      client?.allow_by_default ??
      config?.allow_on_all_virtual_keys ??
      client?.allow_on_all_virtual_keys
    ),
    endpointSlug: nonEmpty(config?.endpoint_slug) ?? nonEmpty(client?.endpoint_slug),
    connectionType: nonEmpty(config?.connection_type) ?? nonEmpty(client?.connection_type),
    authType: nonEmpty(config?.auth_type) ?? nonEmpty(client?.auth_type),
    isCodeModeClient: Boolean(config?.is_code_mode_client ?? client?.is_code_mode_client),
    toolsToExecute: Array.isArray(config?.tools_to_execute)
      ? config.tools_to_execute.map(String)
      : Array.isArray(client?.tools_to_execute)
        ? client.tools_to_execute.map(String)
        : [],
    toolsToAutoExecute: Array.isArray(config?.tools_to_auto_execute)
      ? config.tools_to_auto_execute.map(String)
      : Array.isArray(client?.tools_to_auto_execute)
        ? client.tools_to_auto_execute.map(String)
        : [],
    needsSessionStickiness:
      typeof (config?.needs_session_stickiness ?? client?.needs_session_stickiness) === "boolean"
        ? Boolean(config?.needs_session_stickiness ?? client?.needs_session_stickiness)
        : undefined,
    isPingAvailable:
      typeof (config?.is_ping_available ?? client?.is_ping_available) === "boolean"
        ? Boolean(config?.is_ping_available ?? client?.is_ping_available)
        : undefined,
    perUserHeaderKeys: Array.isArray(config?.per_user_header_keys)
      ? config.per_user_header_keys.map(String)
      : Array.isArray(client?.per_user_header_keys)
        ? client.per_user_header_keys.map(String)
        : [],
    maxInstructionsLength: Number.isFinite(numericInstructionLimit)
      ? numericInstructionLimit
      : undefined,
    serverInstructions:
      nonEmpty(client?.server_instructions) ??
      nonEmpty(config?.server_instructions),
    tools,
    toolDefinitions,
    raw: client,
  };
}


function policyAllows(tools, name) {
  const normalized = Array.isArray(tools) ? tools.map(String) : [];
  return normalized.includes("*") || normalized.includes(name);
}

/**
 * Resolve Bifrost's effective MCP execution boundary for one repository grant.
 * Bifrost 2.2.5+ treats tools_to_execute as the hard invocation allow-list and
 * tools_to_auto_execute as its approval-free subset. Repository grants can only
 * narrow that surface further; they never widen the client policy.
 */
export function mcpClientExecutionDiagnostics(client, grantedTools = ["*"]) {
  const available = Array.isArray(client?.tools) ? client.tools.map(String) : [];
  const grantAll = Array.isArray(grantedTools) && grantedTools.map(String).includes("*");
  const granted = grantAll
    ? available
    : available.filter((name) => (grantedTools ?? []).map(String).includes(name));
  const rows = granted.map((tool) => ({
    tool,
    granted: true,
    executable: policyAllows(client?.toolsToExecute, tool),
    autoExecutable:
      policyAllows(client?.toolsToExecute, tool) &&
      policyAllows(client?.toolsToAutoExecute, tool),
  }));
  const warnings = [];
  if (Array.isArray(client?.toolsToAutoExecute) && client.toolsToAutoExecute.includes("*")) {
    warnings.push("auto-execute wildcard grants every executable tool approval-free execution");
  }
  for (const name of Array.isArray(client?.toolsToAutoExecute) ? client.toolsToAutoExecute : []) {
    if (name === "*") continue;
    if (!policyAllows(client?.toolsToExecute, name)) {
      warnings.push(`auto-execute tool ${name} is not executable and will be ignored by Bifrost`);
    }
  }
  return {
    rows,
    grantedCount: rows.length,
    executableCount: rows.filter((row) => row.executable).length,
    autoExecutableCount: rows.filter((row) => row.autoExecutable).length,
    executePolicy: Array.isArray(client?.toolsToExecute) ? [...client.toolsToExecute] : [],
    autoPolicy: Array.isArray(client?.toolsToAutoExecute) ? [...client.toolsToAutoExecute] : [],
    warnings,
  };
}
