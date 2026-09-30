function flagString(flags, name) {
  const value = flags?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numericFlag(flags, name) {
  const raw = flagString(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`);
  return value;
}

export function routeAliasForInput(input, roles) {
  const raw = String(input ?? "").trim();
  if (!raw) return undefined;
  const selected = roles?.[raw] ?? raw;
  const primary = String(selected).split(",")[0]?.trim() ?? "";
  return primary.replace(/^bifrost\//iu, "").split(":", 1)[0].toLowerCase();
}

export function routeExplanationRequestFromFlags(flags = {}) {
  return {
    inputTokens: numericFlag(flags, "input-tokens"),
    outputTokens: numericFlag(flags, "output-tokens"),
    image: flags.image === true,
    tools: flags.tools === true || flags["tool-search"] === true || flags["between-tools"] === true,
    reasoning: flags.reasoning === true || flags["between-tools"] === true,
    toolSearch: flags["tool-search"] === true,
    betweenTools: flags["between-tools"] === true,
    toolChoice: flagString(flags, "tool-choice"),
    serviceTier: flagString(flags, "service-tier"),
  };
}

export function formatCatalogSnapshot(cache, ageMs, stale) {
  if (!Number.isFinite(ageMs)) return `Catalog snapshot: ${cache?.generatedAt ?? "unknown"}`;
  const minutes = Math.floor(ageMs / 60_000);
  return `Catalog snapshot: ${cache?.generatedAt ?? "unknown"}; age=${minutes}m${stale ? " STALE" : ""}`;
}
