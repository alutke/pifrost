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
    const rawRef = injected && typeof injected === "object" && !Array.isArray(injected) ? injected.web_search : undefined;
    let status = "unreported";
    let client = "";
    let tool = "";
    if (explicitlyReported && (injected === null || injected === undefined ||
        (typeof injected === "object" && !Array.isArray(injected) && rawRef === undefined))) {
      status = "not-configured";
    } else if (rawRef && typeof rawRef === "object" && !Array.isArray(rawRef)) {
      client = clean(rawRef.mcp_client_name);
      tool = clean(rawRef.tool_name);
      status = client && tool ? "configured" : "invalid-reference";
    } else if (explicitlyReported) {
      status = "unrecognised-schema";
    }
    const active = comparable(provider.provider_status) === "active";
    const concerns = [];
    if (status === "configured") {
      if (!active) concerns.push("provider not active");
      if (!clientsReadable) concerns.push("MCP client list unavailable; execution unverified");
      else {
        const found = byName.get(comparable(client));
        if (!found) concerns.push("configured MCP client not found");
        else {
          const names = Array.isArray(found.tools) ? found.tools : [];
          if (!names.some(candidate => comparable(candidate) === comparable(tool))) {
            concerns.push("tool not present in MCP client metadata");
          }
        }
      }
    } else if (status === "invalid-reference" || status === "unrecognised-schema") {
      concerns.push("provider injected-tools schema requires review");
    }
    policies.push({ provider: name, status, client, tool, active, concerns });
  }
  policies.sort((a, b) => a.provider.localeCompare(b.provider));
  return { schemaReported, clientsReadable, policies, configured: policies.filter(p => p.status === "configured").length };
}

export function formatGatewayInjectedToolDiagnostics(report) {
  const lines = ["Gateway-managed MCP tools (read-only; Bifrost owns execution):"];
  if (!report.schemaReported) {
    lines.push("  not exposed by current Bifrost management response; cannot establish whether injection is configured");
  } else if (report.configured === 0) {
    lines.push("  no provider web_search injection is reported");
  }
  for (const p of report.policies) {
    if (p.status === "not-configured" || p.status === "unreported") continue;
    const target = p.status === "configured" ? " web_search=" + p.client + "/" + p.tool : "";
    lines.push("  " + p.provider + ": " + p.status + target);
    for (const concern of p.concerns) lines.push("    WARN " + concern);
  }
  lines.push("  Metadata cannot prove per-VK permission or live execution; gateway policy and provider fallback remain authoritative.");
  return lines.join("\n");
}
