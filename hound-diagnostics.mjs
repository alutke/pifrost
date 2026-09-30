const HOUND_TOOL_SPECS = Object.freeze([
  { name: "mcp_smart_search", capability: "search", core: true },
  { name: "mcp_smart_fetch", capability: "fetch", core: true },
  { name: "mcp_smart_crawl", capability: "crawl", core: true },
  { name: "mcp_screenshot", capability: "screenshot", core: false },
  { name: "cache_clear", capability: "cache", core: false },
  { name: "version", capability: "version", core: false },
]);

export const HOUND_TOOLS = Object.freeze(HOUND_TOOL_SPECS.map((item) => item.name));
export const HOUND_CORE_TOOLS = Object.freeze(HOUND_TOOL_SPECS.filter((item) => item.core).map((item) => item.name));

function nonEmpty(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function canonicalHoundToolName(name) {
  const value = nonEmpty(String(name ?? ""))?.toLowerCase();
  if (!value) return undefined;
  return HOUND_TOOLS.find((canonical) =>
    value === canonical ||
    value.endsWith(`-${canonical}`) ||
    value.endsWith(`_${canonical}`) ||
    value.endsWith(`__${canonical}`) ||
    value.endsWith(`.${canonical}`) ||
    value.endsWith(`/${canonical}`) ||
    value.endsWith(`:${canonical}`)
  );
}

function houndClient(client) {
  if (!client) return false;
  const tools = new Set((client.tools ?? []).map(canonicalHoundToolName).filter(Boolean));
  return HOUND_CORE_TOOLS.some((name) => tools.has(name));
}

function toolStatusMap(policy, clients, liveTools) {
  const granted = new Map();
  const clientRows = [];

  for (const grant of policy?.effective ?? []) {
    const client = (clients ?? []).find(
      (item) => item?.name?.toLowerCase() === String(grant.client ?? "").toLowerCase(),
    );
    if (!houndClient(client)) continue;

    const canonicalAvailable = new Map();
    for (const tool of client?.tools ?? []) {
      const canonical = canonicalHoundToolName(tool);
      if (canonical) canonicalAvailable.set(canonical, tool);
    }

    const canonicalGranted = new Set();
    if (grant.tools?.includes("*")) {
      for (const canonical of canonicalAvailable.keys()) canonicalGranted.add(canonical);
    } else {
      for (const tool of grant.tools ?? []) {
        const canonical = canonicalHoundToolName(tool);
        if (canonical && canonicalAvailable.has(canonical)) canonicalGranted.add(canonical);
      }
    }

    if (!canonicalGranted.size) continue;

    clientRows.push({
      name: grant.client,
      state: client?.state,
      sources: grant.sources ?? [],
      granted: [...canonicalGranted],
      serverInstructions: Boolean(client?.serverInstructions),
      maxInstructionsLength: client?.maxInstructionsLength,
    });

    for (const canonical of canonicalGranted) {
      const rows = granted.get(canonical) ?? [];
      rows.push({ client: grant.client, sources: grant.sources ?? [] });
      granted.set(canonical, rows);
    }
  }

  const liveKnown = liveTools !== undefined;
  const liveCanonical = new Map();
  for (const tool of Array.isArray(liveTools) ? liveTools : []) {
    const name = typeof tool === "string" ? tool : tool?.name;
    const canonical = canonicalHoundToolName(name);
    if (canonical) liveCanonical.set(canonical, name);
  }

  const tools = Object.fromEntries(HOUND_TOOLS.map((name) => [name, {
    configured: granted.has(name),
    gatewayVisible: liveKnown ? liveCanonical.has(name) : undefined,
    gatewayName: liveCanonical.get(name),
    grants: granted.get(name) ?? [],
  }]));

  return { tools, clientRows, liveKnown };
}

function capabilityStatus(tools, liveKnown, name) {
  const row = tools[name];
  const available = liveKnown ? row?.gatewayVisible === true : row?.configured === true;
  return {
    tool: name,
    available,
    configured: row?.configured === true,
    gatewayVisible: row?.gatewayVisible,
    gatewayName: row?.gatewayName,
  };
}

/**
 * Hound is always consumed through Bifrost MCP. Pifrost never starts Hound,
 * reaches its HTTP endpoint directly, or creates a synthetic model/route.
 */
export function houndMcpDiagnostics(policy, clients = [], virtualMcps = [], options = {}) {
  const { tools, clientRows, liveKnown } = toolStatusMap(policy, clients, options.liveTools);
  const configuredCount = HOUND_TOOLS.filter((name) => tools[name].configured).length;
  const visibleCount = HOUND_TOOLS.filter((name) => tools[name].gatewayVisible === true).length;

  const capabilities = Object.fromEntries(
    HOUND_TOOL_SPECS.map((spec) => [spec.capability, capabilityStatus(tools, liveKnown, spec.name)]),
  );

  const attachedNames = new Set((policy?.virtualMcps ?? []).map((item) => item.name));
  const instructions = (virtualMcps ?? [])
    .filter((item) => attachedNames.has(item.name))
    .map((item) => ({
      name: item.name,
      mode: item.instructionsMode ?? "append",
      instructions: item.instructions,
    }));

  const omp = options.ompSearch ?? {
    status: "unavailable",
    available: false,
    configured: false,
    primary: undefined,
    fallbacks: [],
    source: "OMP search configuration not inspected",
  };

  const searchPath = capabilities.search.available
    ? "MCP/Hound mcp_smart_search"
    : omp.available
      ? "OMP native web_search"
      : "unavailable";

  return {
    hound: {
      available: Object.values(capabilities).some((item) => item.available),
      configured: configuredCount > 0,
      complete: liveKnown ? visibleCount === HOUND_TOOLS.length : configuredCount === HOUND_TOOLS.length,
      coreReady: HOUND_CORE_TOOLS.every((name) =>
        liveKnown ? tools[name].gatewayVisible === true : tools[name].configured === true,
      ),
      configuredCount,
      visibleCount: liveKnown ? visibleCount : undefined,
      liveVerified: liveKnown,
      clients: clientRows,
      tools,
      capabilities,
      missing: HOUND_TOOLS.filter((name) =>
        liveKnown ? tools[name].gatewayVisible !== true : !tools[name].configured,
      ),
    },
    search: {
      path: searchPath,
      hound: capabilities.search,
      omp,
    },
    instructions,
  };
}
