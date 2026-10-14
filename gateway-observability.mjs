/**
 * Release D: read-only observability over Bifrost management responses.
 * Do not execute classifiers, MCP tools, inference, governance writes, or
 * request-log queries. Never print raw config, prompts, secrets or IDs.
 */
const object = x => x && typeof x === "object" && !Array.isArray(x) ? x : undefined;
const value = x => x === true ? "enabled" : x === false ? "disabled" : "not reported";
const safeName = x => typeof x === "string" && /^[a-z\d][a-z\d._/-]{0,79}$/iu.test(x) ? x : "not reported";
const boolean = x => typeof x === "boolean" ? x : undefined;

export function summarizeGatewayComplexity(config) {
  const data = object(config);
  if (!data) return { available: false, mode: "unverified", session: "unverified" };
  const classifier = data.classifier === "semantic" || data.classifier === "decision" ? data.classifier : "keywords";
  const semantic = object(data.semantic);
  const decision = object(data.decision);
  const llm = object(data.llm);
  const fallback = semantic?.fallback === "llm" || semantic?.fallback === "decision"
    ? semantic.fallback : "none";
  return {
    available: true,
    mode: classifier,
    session: object(data.session)?.enabled === true ? "enabled"
      : object(data.session)?.enabled === false ? "disabled" : "not reported",
    decision: decision ? { provider: safeName(decision.provider), model: safeName(decision.model) } : undefined,
    semantic: semantic ? { provider: safeName(semantic.provider), model: safeName(semantic.embedding_model),
      fallback } : undefined,
    llmFallback: fallback === "llm" && llm ? { provider: safeName(llm.provider), model: safeName(llm.model) } : undefined,
  };
}

export function formatGatewayComplexity(config) {
  const c = summarizeGatewayComplexity(config);
  if (!c.available) return "Bifrost classifier: not exposed/unverified (no classifier execution attempted)";
  const lines = [
    "Bifrost classifier (configuration only; no inference executed):",
    `  mode=${c.mode} session-stickiness=${c.session}`,
  ];
  if (c.mode === "decision") lines.push(`  decision provider=${c.decision?.provider ?? "not reported"} model=${c.decision?.model ?? "not reported"}`);
  if (c.mode === "semantic") lines.push(`  semantic provider=${c.semantic?.provider ?? "not reported"} embedding-model=${c.semantic?.model ?? "not reported"} fallback=${c.semantic?.fallback ?? "not reported"}`);
  if (c.llmFallback) lines.push(`  fallback-llm provider=${c.llmFallback.provider} model=${c.llmFallback.model}`);
  lines.push("  Configuration cannot prove readiness, actual classifier use, cost, or route selection; verify in Bifrost Logs/Routes.");
  return lines.join("\n");
}

export function summarizeGatewayPrivacy(gateway, virtualKey) {
  const root = object(gateway);
  const cfg = object(root?.client_config) ?? object(root?.clientConfig)
    ?? object(object(root?.data)?.client_config);
  const globalDisabled = boolean(cfg?.disable_content_logging);
  const overridesAllowed = boolean(cfg?.allow_per_request_content_storage_override);
  const retainedHidden = boolean(cfg?.retain_content_in_object_storage);
  const days = Number.isInteger(cfg?.log_retention_days) && cfg.log_retention_days >= 1 && cfg.log_retention_days < 100000
    ? cfg.log_retention_days : undefined;
  const key = object(virtualKey);
  const keyOverride = boolean(key?.disable_content_logging);
  const effectiveDisabled = key === undefined ? undefined : keyOverride ?? globalDisabled;
  return {
    global: value(globalDisabled),
    perRequestOverride: value(overridesAllowed),
    hiddenObjectStorage: value(retainedHidden),
    retentionDays: days,
    vk: key === undefined ? "not inspected" : keyOverride === undefined ? "inherit" : value(keyOverride),
    effective: effectiveDisabled === undefined ? "unverified" : effectiveDisabled ? "off" : "on",
    // Without a known VK, the global flag alone cannot determine traffic retention.
    vkInspected: key !== undefined,
  };
}

export function formatGatewayPrivacy(gateway, virtualKey) {
  const p = summarizeGatewayPrivacy(gateway, virtualKey);
  const lines = [
    "Bifrost content privacy (configuration only; read-only):",
    `  global content logging: ${p.global === "enabled" ? "disabled" : p.global === "disabled" ? "enabled" : "not reported"}`,
    `  per-request content storage override: ${p.perRequestOverride}`,
    `  hidden object-storage retention: ${p.hiddenObjectStorage}`,
    `  log retention days: ${p.retentionDays ?? "not reported"}`,
    `  Virtual Key content-logging override: ${p.vk}`,
    `  effective log content for inspected Virtual Key: ${p.effective}`,
  ];
  if (!p.vkInspected) lines.push("  To inspect a specific key without disclosing its value, supply --vk-id <management-id>.");
  lines.push("  Log metadata, hidden object copies, and other retention policies may still apply. Configuration does not prove deletion.");
  return lines.join("\n");
}

export function summarizeGatewayResearchTools(diagnostics) {
  if (!diagnostics?.schemaReported) return { known: false, rows: [] };
  const rows = [];
  const seen = new Set();
  for (const p of Array.isArray(diagnostics.policies) ? diagnostics.policies : []) {
    if (p.status !== "configured") continue;
    for (const tool of Array.isArray(p.tools) ? p.tools : []) {
      const names = [tool.name, tool.tool, tool.client].map(safeName);
      if (!names.some(s => /(?:^|[-_/.])(web|search|fetch|crawl|browse|research)(?:[-_/.]|$)/iu.test(s))) continue;
      const provider = safeName(p.provider);
      const key = [provider, ...names].join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ provider, injection: names[0], client: names[2], tool: names[1], active: p.active, warnings: p.concerns?.length ?? 0 });
    }
  }
  return { known: true, rows: rows.slice(0, 50) };
}

export function formatGatewayResearchTools(diagnostics) {
  const d = summarizeGatewayResearchTools(diagnostics);
  const lines = ["Bifrost provider-injected research (read-only; gateway-owned):"];
  if (!d.known) lines.push("  injection schema not exposed; availability unverified");
  else if (!d.rows.length) lines.push("  no research-related injected tools reported");
  for (const r of d.rows) lines.push(`  ${r.provider}: ${r.injection}=${r.client}/${r.tool} status=${r.active ? "provider-active" : "provider-unverified"}${r.warnings ? " metadata-warnings=" + r.warnings : ""}`);
  lines.push("  No tool execution, per-VK grant, successful provider call or billed invocation has been verified.");
  return lines.join("\n");
}
