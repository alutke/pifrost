const HOUND_TOOL_SPECS = Object.freeze([
  { name: "mcp_smart_search", capability: "search", research: true },
  { name: "mcp_smart_fetch", capability: "fetch", research: true },
  { name: "mcp_smart_crawl", capability: "crawl", research: true },
  { name: "mcp_screenshot", capability: "screenshot", research: false },
  { name: "cache_clear", capability: "cache", research: false },
  { name: "version", capability: "version", research: false },
]);

export const HOUND_TOOLS = Object.freeze(HOUND_TOOL_SPECS.map((item) => item.name));
export const HOUND_RESEARCH_TOOLS = Object.freeze(
  HOUND_TOOL_SPECS.filter((item) => item.research).map((item) => item.name),
);

const HOUND_IDENTITY_TOOLS = Object.freeze([
  "mcp_smart_search",
  "mcp_smart_fetch",
  "mcp_smart_crawl",
  "mcp_screenshot",
]);

export const BIFROST_CODE_MODE_TOOLS = Object.freeze([
  "listToolFiles",
  "readToolFile",
  "getToolDocs",
  "executeToolCode",
]);

const BIFROST_IMAGE_TRANSPORT_WARNING =
  "Bifrost currently flattens MCP ImageContent to text. Pifrost restores validated markers only for directly exposed Hound screenshot tools; Code Mode screenshot output remains conditional because executeToolCode does not preserve trustworthy nested-tool provenance.";

export const PIFROST_RICH_CONTENT_RECOVERY = true;

function nonEmpty(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeIdentity(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function prefixedToolMatches(value, clientName, canonical) {
  const raw = nonEmpty(String(clientName ?? ""))?.toLowerCase();
  if (!raw) return false;
  const variants = new Set([
    raw,
    raw.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
    raw.replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, ""),
  ].filter(Boolean));
  for (const prefix of variants) {
    for (const separator of ["-", "_", "__", ".", "/", ":"]) {
      if (value === `${prefix}${separator}${canonical}`) return true;
    }
  }
  return false;
}

function suffixToolMatch(value, canonical) {
  if (value === canonical) return true;
  return ["-", "_", "__", ".", "/", ":"].some((separator) =>
    value.endsWith(`${separator}${canonical}`)
  );
}

export function canonicalHoundToolName(name, clientNames = []) {
  const value = nonEmpty(String(name ?? ""))?.toLowerCase();
  if (!value) return undefined;

  for (const canonical of HOUND_TOOLS) {
    if (value === canonical) return canonical;
    if (HOUND_IDENTITY_TOOLS.includes(canonical) && suffixToolMatch(value, canonical)) {
      return canonical;
    }
    if (clientNames.some((clientName) => prefixedToolMatches(value, clientName, canonical))) {
      return canonical;
    }
  }
  return undefined;
}

export function canonicalCodeModeToolName(name) {
  const value = nonEmpty(String(name ?? ""));
  if (!value) return undefined;
  const lower = value.toLowerCase();
  return BIFROST_CODE_MODE_TOOLS.find((canonical) => {
    const target = canonical.toLowerCase();
    return lower === target || suffixToolMatch(lower, target);
  });
}

function houndClient(client) {
  if (!client) return false;
  const tools = new Set(
    (client.tools ?? []).map((name) => canonicalHoundToolName(name, [client.name])).filter(Boolean),
  );
  return HOUND_IDENTITY_TOOLS.some((name) => tools.has(name));
}

function matchingPolicyClient(grant, clients) {
  return (clients ?? []).find(
    (item) => item?.name?.toLowerCase() === String(grant.client ?? "").toLowerCase(),
  );
}

export function houndCodeModeClientNames(policy, clients = []) {
  const names = [];
  for (const grant of policy?.effective ?? []) {
    const client = matchingPolicyClient(grant, clients);
    if (!client?.isCodeModeClient || !houndClient(client)) continue;
    if (!names.some((name) => name.toLowerCase() === client.name.toLowerCase())) {
      names.push(client.name);
    }
  }
  return names;
}

function toolStatusMap(policy, clients, liveTools, codeModeProbe) {
  const granted = new Map();
  const clientRows = [];

  for (const grant of policy?.effective ?? []) {
    const client = matchingPolicyClient(grant, clients);
    if (!houndClient(client)) continue;

    const canonicalAvailable = new Map();
    for (const tool of client?.tools ?? []) {
      const canonical = canonicalHoundToolName(tool, [client?.name]);
      if (canonical) canonicalAvailable.set(canonical, tool);
    }

    const canonicalGranted = new Set();
    if (grant.tools?.includes("*")) {
      for (const canonical of canonicalAvailable.keys()) canonicalGranted.add(canonical);
    } else {
      for (const tool of grant.tools ?? []) {
        const canonical = canonicalHoundToolName(tool, [client?.name]);
        if (canonical && canonicalAvailable.has(canonical)) canonicalGranted.add(canonical);
      }
    }

    if (!canonicalGranted.size) continue;

    const canonicalExecutable = new Set(
      (grant.executionPolicyKnown ? grant.executableTools ?? [] : [...canonicalGranted])
        .map((tool) => canonicalHoundToolName(tool, [client?.name]))
        .filter(Boolean),
    );
    const canonicalAutoExecutable = new Set(
      (grant.autoExecutionPolicyKnown ? grant.autoExecutableTools ?? [] : [])
        .map((tool) => canonicalHoundToolName(tool, [client?.name]))
        .filter(Boolean),
    );

    clientRows.push({
      name: grant.client,
      state: client?.state,
      sources: grant.sources ?? [],
      granted: [...canonicalGranted],
      executable: [...canonicalExecutable],
      autoExecutable: [...canonicalAutoExecutable],
      executionPolicyKnown: grant.executionPolicyKnown === true,
      autoExecutionPolicyKnown: grant.autoExecutionPolicyKnown === true,
      isCodeModeClient: client?.isCodeModeClient === true,
      serverInstructions: Boolean(client?.serverInstructions),
      maxInstructionsLength: client?.maxInstructionsLength,
    });

    for (const canonical of canonicalGranted) {
      const rows = granted.get(canonical) ?? [];
      rows.push({
        client: grant.client,
        sources: grant.sources ?? [],
        isCodeModeClient: client?.isCodeModeClient === true,
        executionPolicyKnown: grant.executionPolicyKnown === true,
        autoExecutionPolicyKnown: grant.autoExecutionPolicyKnown === true,
        executable: grant.executionPolicyKnown === true ? canonicalExecutable.has(canonical) : undefined,
        autoExecutable: grant.autoExecutionPolicyKnown === true ? canonicalAutoExecutable.has(canonical) : undefined,
      });
      granted.set(canonical, rows);
    }
  }

  const rawLiveTools = Array.isArray(liveTools) ? liveTools : [];
  const liveKnown = liveTools !== undefined;
  const houndClientNames = clientRows.map((item) => item.name);
  const liveCanonical = new Map();
  const codeModeMeta = new Map();

  for (const tool of rawLiveTools) {
    const name = typeof tool === "string" ? tool : tool?.name;
    const canonical = canonicalHoundToolName(name);
    if (canonical && HOUND_IDENTITY_TOOLS.includes(canonical)) {
      liveCanonical.set(canonical, name);
    }
    const codeModeCanonical = canonicalCodeModeToolName(name);
    if (codeModeCanonical) codeModeMeta.set(codeModeCanonical, name);
  }

  const houndIdentityKnown = houndClientNames.length > 0 ||
    HOUND_IDENTITY_TOOLS.some((name) => liveCanonical.has(name));
  if (houndIdentityKnown) {
    for (const tool of rawLiveTools) {
      const name = typeof tool === "string" ? tool : tool?.name;
      const canonical = canonicalHoundToolName(name, houndClientNames);
      if (canonical) liveCanonical.set(canonical, name);
    }
  }

  const codeModeClients = clientRows.filter((item) => item.isCodeModeClient);
  const codeModeConfigured = codeModeClients.length > 0;
  const codeModeProbeKnown = codeModeProbe !== undefined;
  const codeModeTools = new Set(codeModeProbe?.ok ? codeModeProbe.tools ?? [] : []);

  const tools = Object.fromEntries(HOUND_TOOLS.map((name) => {
    const grantRows = granted.get(name) ?? [];
    const executionPolicyKnown = grantRows.some((row) => row.executionPolicyKnown === true);
    const executable = executionPolicyKnown
      ? grantRows.some((row) => row.executable === true)
      : undefined;
    const autoExecutionPolicyKnown = grantRows.some((row) => row.autoExecutionPolicyKnown === true);
    const autoExecutable = autoExecutionPolicyKnown
      ? grantRows.some((row) => row.autoExecutable === true)
      : undefined;
    const executionAllowed = executable !== false;
    const classicVisible = liveCanonical.has(name) && executionAllowed;
    const codeModeVisible = codeModeProbe?.ok === true && codeModeTools.has(name) && granted.has(name) && executionAllowed;
    let gatewayVisible;
    let gatewayName = liveCanonical.get(name);

    if (liveKnown) {
      if (classicVisible || codeModeVisible) {
        gatewayVisible = true;
        if (!gatewayName && codeModeVisible) {
          gatewayName = `Code Mode:${codeModeProbe.fileName ?? codeModeProbe.serverName ?? "hound"}`;
        }
      } else if (codeModeConfigured && !codeModeProbeKnown) {
        gatewayVisible = undefined;
      } else {
        gatewayVisible = false;
      }
    }

    return [name, {
      configured: granted.has(name),
      executable,
      autoExecutable,
      executionPolicyKnown,
      autoExecutionPolicyKnown,
      gatewayVisible,
      gatewayName,
      grants: grantRows,
    }];
  }));

  return {
    tools,
    clientRows,
    liveKnown,
    codeMode: {
      configured: codeModeConfigured,
      clients: codeModeClients.map((item) => item.name),
      metaTools: Object.fromEntries(BIFROST_CODE_MODE_TOOLS.map((name) => [name, {
        gatewayVisible: liveKnown ? codeModeMeta.has(name) : undefined,
        gatewayName: codeModeMeta.get(name),
      }])),
      gatewayMetaComplete: liveKnown
        ? BIFROST_CODE_MODE_TOOLS.every((name) => codeModeMeta.has(name))
        : undefined,
      probe: codeModeProbe,
    },
  };
}

function capabilityStatus(tools, liveKnown, name) {
  const row = tools[name];
  const executionAllowed = row?.executable !== false;
  const available = (liveKnown
    ? row?.gatewayVisible === true
    : row?.configured === true) && executionAllowed;
  return {
    tool: name,
    available,
    configured: row?.configured === true,
    executable: row?.executable,
    autoExecutable: row?.autoExecutable,
    executionPolicyKnown: row?.executionPolicyKnown === true,
    autoExecutionPolicyKnown: row?.autoExecutionPolicyKnown === true,
    gatewayVisible: row?.gatewayVisible,
    gatewayName: row?.gatewayName,
  };
}

function mcpToolResultText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.text === "string") return result.text;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .map((block) => typeof block === "string" ? block : block?.type === "text" ? block.text : undefined)
    .filter((value) => typeof value === "string")
    .join("\n");
}

function parseCodeModeFileTree(text) {
  const files = [];
  const stack = [];
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^ */u)?.[0].length ?? 0;
    const level = Math.floor(indent / 2);
    const token = line.trim();
    if (token.endsWith("/")) {
      stack[level] = token.slice(0, -1);
      stack.length = level + 1;
      continue;
    }
    if (!token.endsWith(".pyi")) continue;
    const parts = [...stack.slice(0, level), token].filter(Boolean);
    const path = parts.join("/");
    if (path.startsWith("servers/")) files.push(path);
  }
  return [...new Set(files)];
}

function fileServerName(path) {
  const parts = String(path ?? "").split("/");
  if (parts[0] !== "servers" || parts.length < 2) return undefined;
  return parts.length === 2
    ? parts[1].replace(/\.pyi$/u, "")
    : parts[1];
}

function houndToolsInText(text) {
  const signatures = new Set();
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u);
    if (match?.[1]) signatures.add(match[1]);
  }
  return HOUND_TOOLS.filter((name) => signatures.has(name));
}

function houndToolsInToolLevelFiles(files, serverName) {
  const prefix = `servers/${serverName}/`;
  return HOUND_TOOLS.filter((name) =>
    files.some((file) => file === `${prefix}${name}.pyi`)
  );
}

/**
 * Non-destructively verify a Hound binding hidden behind Bifrost Code Mode.
 * This performs only listToolFiles/readToolFile calls; it never invokes Hound
 * search/fetch/crawl/browser tools or reaches the public Internet itself.
 */
export async function probeHoundCodeMode(callTool, clientNames = [], options = {}) {
  if (typeof callTool !== "function") throw new Error("Code Mode probe requires a tool caller");

  const listResult = await callTool("listToolFiles", {});
  const listText = mcpToolResultText(listResult);
  const files = parseCodeModeFileTree(listText);
  if (!files.length) {
    return { ok: false, error: "Bifrost Code Mode returned no virtual tool files", files: [] };
  }

  const wanted = new Set(clientNames.map(normalizeIdentity).filter(Boolean));
  const serverNames = [...new Set(files.map(fileServerName).filter(Boolean))];
  const orderedServers = [
    ...serverNames.filter((name) => wanted.has(normalizeIdentity(name))),
    ...serverNames.filter((name) => !wanted.has(normalizeIdentity(name))),
  ];

  const maxServers = Math.max(1, Number(options.maxServers ?? 20));
  for (const serverName of orderedServers.slice(0, maxServers)) {
    const serverFile = `servers/${serverName}.pyi`;
    const expectedServer = wanted.has(normalizeIdentity(serverName));
    if (files.includes(serverFile)) {
      const readResult = await callTool("readToolFile", { fileName: serverFile });
      const tools = houndToolsInText(mcpToolResultText(readResult));
      if (
        HOUND_IDENTITY_TOOLS.some((name) => tools.includes(name)) ||
        (expectedServer && tools.length > 0)
      ) {
        return {
          ok: true,
          bindingLevel: "server",
          serverName,
          fileName: serverFile,
          tools,
          files,
        };
      }
      continue;
    }

    const candidateTools = houndToolsInToolLevelFiles(files, serverName);
    if (!candidateTools.length) continue;
    if (
      !expectedServer &&
      !HOUND_IDENTITY_TOOLS.some((name) => candidateTools.includes(name))
    ) continue;

    const confirmTool =
      candidateTools.find((name) => HOUND_IDENTITY_TOOLS.includes(name)) ??
      candidateTools[0];
    const confirmFile = `servers/${serverName}/${confirmTool}.pyi`;
    const readResult = await callTool("readToolFile", { fileName: confirmFile });
    const confirmed = houndToolsInText(mcpToolResultText(readResult));
    if (!confirmed.includes(confirmTool)) continue;

    return {
      ok: true,
      bindingLevel: "tool",
      serverName,
      fileName: confirmFile,
      tools: candidateTools,
      files,
    };
  }

  return {
    ok: false,
    error: "No Hound tool signature was found in the repository-scoped Bifrost Code Mode virtual files",
    files,
  };
}

/**
 * Hound is always consumed through Bifrost MCP. Pifrost never starts Hound,
 * reaches its HTTP endpoint directly, or creates a synthetic model/route.
 */
export function houndMcpDiagnostics(policy, clients = [], virtualMcps = [], options = {}) {
  const { tools, clientRows, liveKnown, codeMode } = toolStatusMap(
    policy,
    clients,
    options.liveTools,
    options.codeModeProbe,
  );

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

  const codeModeRows = clientRows.filter((item) => item.isCodeModeClient);
  const classicRows = clientRows.filter((item) => !item.isCodeModeClient);
  const mode = codeModeRows.length && classicRows.length
    ? "mixed"
    : codeModeRows.length
      ? "code"
      : "classic";

  const searchReady = capabilities.search.available;
  const webResearchReady = capabilities.search.available && capabilities.fetch.available;
  const deepResearchReady = webResearchReady && capabilities.crawl.available;
  const screenshotCallable = capabilities.screenshot.available;
  const imageContentPreserved = options.imageContentPreserved === true;
  const pifrostImageRecovery = options.pifrostImageRecovery !== false;
  const screenshotGatewayName = String(capabilities.screenshot.gatewayName ?? "");
  const screenshotViaCodeMode = screenshotGatewayName.startsWith("Code Mode:");
  const classicRecoveryReady = pifrostImageRecovery && !screenshotViaCodeMode && mode !== "code";
  const visualWebRecoverable = screenshotCallable && (imageContentPreserved || classicRecoveryReady);
  const visualWebConditional = screenshotCallable && !imageContentPreserved && pifrostImageRecovery && screenshotViaCodeMode;
  const visualWebReady = visualWebRecoverable;
  const visualWebStatus = imageContentPreserved
    ? "native"
    : visualWebRecoverable
      ? "recovered"
      : visualWebConditional
        ? "conditional-code-mode"
        : "unavailable";
  const administrativeComplete = capabilities.cache.available && capabilities.version.available;
  const contractComplete = HOUND_TOOLS.every((name) =>
    liveKnown ? tools[name].gatewayVisible === true : tools[name].configured === true
  );

  const transportWarnings = [];
  if (screenshotCallable && !imageContentPreserved) {
    transportWarnings.push(BIFROST_IMAGE_TRANSPORT_WARNING);
  }

  const classicLive = HOUND_IDENTITY_TOOLS.some((name) => {
    const gatewayName = tools[name].gatewayName;
    return gatewayName && !String(gatewayName).startsWith("Code Mode:");
  });
  const codeModeLiveVerified = codeMode.configured
    ? codeMode.gatewayMetaComplete === true && codeMode.probe?.ok === true
    : false;
  const liveVerified = liveKnown && (classicLive || codeModeLiveVerified);

  const searchPath = capabilities.search.available
    ? mode === "code" || String(capabilities.search.gatewayName ?? "").startsWith("Code Mode:")
      ? "MCP/Hound mcp_smart_search (Bifrost Code Mode)"
      : "MCP/Hound mcp_smart_search"
    : omp.available
      ? "OMP native web_search"
      : "unavailable";

  return {
    hound: {
      available: Object.values(capabilities).some((item) => item.available),
      configured: configuredCount > 0,
      complete: contractComplete,
      contractComplete,
      researchComplete: deepResearchReady,
      administrativeComplete,
      coreReady: deepResearchReady,
      searchReady,
      webResearchReady,
      deepResearchReady,
      screenshotCallable,
      visualWebReady,
      visualWebRecoverable,
      visualWebConditional,
      visualWebStatus,
      imageContentPreserved,
      pifrostImageRecovery,
      configuredCount,
      visibleCount: liveKnown ? visibleCount : undefined,
      liveVerified,
      mode,
      clients: clientRows,
      tools,
      capabilities,
      missing: HOUND_TOOLS.filter((name) =>
        liveKnown ? tools[name].gatewayVisible !== true : !tools[name].configured
      ),
      missingResearch: HOUND_RESEARCH_TOOLS.filter((name) =>
        liveKnown ? tools[name].gatewayVisible !== true : !tools[name].configured
      ),
      codeMode,
      transportWarnings,
    },
    search: {
      path: searchPath,
      hound: capabilities.search,
      omp,
    },
    instructions,
  };
}
