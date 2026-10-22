/**
 * Read-only Bifrost provider-injected MCP configuration diagnostics.
 * Injection and execution remain exclusively gateway-owned.
 *
 * GET /api/providers is a redacted management API. Never print returned
 * provider configuration, credentials, keys, network settings or full objects.
 * Runtime execution requires further gateway-side checks; MCP registration
 * alone is not an execution guarantee.
 */
const clean = value => typeof value === "string" ? value.trim() : "";
const comparable = value => clean(value).toLowerCase();

export function gatewayInjectedToolDiagnostics(payload, clients) {
  if (!payload || !Array.isArray(payload.providers)) {
    throw new Error("Bifrost providers response has no providers array; injected-tool policy unverified");
  }
  const clientsReadable = Array.isArray(clients);
  const byName = new Map();
  if (clientsReadable) {
    for (const item of clients) {
      const name = comparable(item?.name);
      if (name) byName.set(name, item);
    }
  }
  const policies = [];
  let schemaReported = false;
  for (const provider of payload.providers) {
    if (!provider || typeof provider !== "object") continue;
    const name = clean(provider.name);
    if (!name) continue;
    const explicitlyReported = Object.hasOwn(provider, "injected_tools");
    if (explicitlyReported) schemaReported = true;
    const injected = provider.injected_tools;
    // Bifrost 2.3+ accepts a list of {name,mcp_client_name,tool_name}.
    // Retain the pre-2.3 {web_search:{...}} form for older gateways.
    const isNewSchema = Array.isArray(injected);
    const rawRef = injected && typeof injected === "object" && !isNewSchema ? injected.web_search : undefined;
    const rawTools = isNewSchema ? injected : rawRef ? [{ name: "web_search", ...rawRef }] : [];
    let status = "unreported";
    const tools = [];
    if (explicitlyReported && (injected == null || (isNewSchema && injected.length === 0) ||
        (!isNewSchema && typeof injected === "object" && rawRef === undefined))) {
      status = "not-configured";
    } else if (!isNewSchema && rawRef !== undefined && (typeof rawRef !== "object" || Array.isArray(rawRef))) {
      status = "unrecognised-schema";
    } else if (isNewSchema || rawRef !== undefined) {
      status = "configured";
      for (const entry of rawTools) {
        const item = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
        const client = clean(item.mcp_client_name);
        const tool = clean(item.tool_name);
        const injectionName = clean(item.name);
        if (!client || !tool || !injectionName) status = "invalid-reference";
        tools.push({ name: injectionName, client, tool });
      }
      if (!tools.length) status = "not-configured";
    } else if (explicitlyReported) {
      status = "unrecognised-schema";
    }
    const active = comparable(provider.provider_status) === "active";
    const concerns = [];
    const injectedNames = new Set();
    for (const entry of tools) {
      const name = comparable(entry.name);
      if (injectedNames.has(name)) concerns.push("duplicate provider-injected tool name; execution mapping ambiguous");
      injectedNames.add(name);
    }
    if (status === "configured") {
      if (!active) concerns.push("provider not active");
      if (!clientsReadable) concerns.push("MCP client list unavailable; execution unverified");
      else for (const entry of tools) {
        const found = byName.get(comparable(entry.client));
        if (!found) concerns.push("configured MCP client not found");
        else {
          const names = Array.isArray(found.tools) ? found.tools : [];
          if (!names.some(candidate => comparable(candidate) === comparable(entry.tool))) {
            concerns.push("tool not present in MCP client metadata");
          }
        }
      }
    } else if (status === "invalid-reference" || status === "unrecognised-schema") {
      concerns.push("provider injected-tools schema requires review");
    }
    // Preserve old report fields for legacy single-tool integrations.
    policies.push({ provider: name, status, client: tools[0]?.client ?? "", tool: tools[0]?.tool ?? "", tools, active,
      executionOwner: "bifrost", approvalOwner: "gateway-policy", concerns: [...new Set(concerns)] });
  }
  policies.sort((a, b) => a.provider.localeCompare(b.provider));
  return { schemaReported, clientsReadable, policies, configured: policies.filter(p => p.status === "configured").reduce((sum, p) => sum + p.tools.length, 0) };
}

export function formatGatewayInjectedToolDiagnostics(report) {
  const lines = ["Gateway-managed MCP tools (read-only; Bifrost owns execution):"];
  if (!report.schemaReported) {
    lines.push("  not exposed by current Bifrost management response; cannot establish whether injection is configured");
  } else if (report.configured === 0) {
    lines.push("  no provider-injected MCP tools are reported");
  }
  for (const p of report.policies) {
    if (p.status === "not-configured" || p.status === "unreported") continue;
    const target = p.status === "configured"
      ? " " + p.tools.map(item => item.name + "=" + item.client + "/" + item.tool).join(", ")
      : "";
    lines.push("  " + p.provider + ": " + p.status + target);
    for (const concern of p.concerns) lines.push("    WARN " + concern);
  }
  if (report.configured > 0) {
    lines.push("  WARN Provider-injected tools execute inside Bifrost; OMP's visible MCP tool list and approvals are not a complete gateway authorization boundary.");
    lines.push("  Do not add duplicate OMP tool definitions for the same provider-injected tools; inspect gateway grants and approval-free policy.");
  }
  lines.push("  Metadata cannot prove per-VK permission or live execution; gateway policy and provider fallback remain authoritative.");
  return lines.join("\n");
}
