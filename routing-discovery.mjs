import {
  PifrostHttpError,
  bifrostManagementBase,
  managementHeaders,
  nonEmpty,
  requestJson,
} from "./cli-lib.mjs";

const ROUTE_PATHS = [
  "/api/routing/rules?limit=100&offset=0",
  "/api/governance/routing-rules?limit=100&offset=0",
];

function nestedArray(body, path) {
  let value = body;
  for (const key of path) value = value?.[key];
  return Array.isArray(value) ? value : undefined;
}

/**
 * Normalize routing-rule list response shapes seen across Bifrost releases.
 * Current Bifrost returns { rules: [...] }, while older/alternate management
 * surfaces have used routing_rules, data, items, or nested data/result objects.
 */
export function extractRoutingRules(body) {
  if (Array.isArray(body)) return body;
  const candidates = [
    ["rules"],
    ["routing_rules"],
    ["items"],
    ["data"],
    ["data", "rules"],
    ["data", "routing_rules"],
    ["data", "items"],
    ["result", "rules"],
    ["result", "routing_rules"],
    ["result", "items"],
  ];
  for (const path of candidates) {
    const found = nestedArray(body, path);
    if (found) return found;
  }
  return [];
}

function bodyShape(body) {
  if (Array.isArray(body)) return `array(${body.length})`;
  if (!body || typeof body !== "object") return typeof body;
  const keys = Object.keys(body).sort();
  const count = body.count ?? body.total_count ?? body.totalCount;
  return `object keys=[${keys.join(",")}]${count !== undefined ? ` reported-count=${count}` : ""}`;
}

function ruleIdentity(rule) {
  const id = nonEmpty(rule?.id);
  if (id) return `id:${id}`;
  return `json:${JSON.stringify(rule)}`;
}

/**
 * Query both the canonical and legacy routing endpoints.
 *
 * Some Bifrost installations return HTTP 200 with an empty collection on one
 * route while the compatibility route contains the persisted rules. Pifrost
 * must therefore not stop merely because the first endpoint returned 200.
 */
export async function discoverRoutingRules(url, auth) {
  const base = bifrostManagementBase(url);
  const headers = managementHeaders(auth);
  const diagnostics = [];
  const merged = new Map();
  let successfulEndpoint = false;
  let lastError;

  for (const path of ROUTE_PATHS) {
    const endpoint = `${base}${path}`;
    try {
      const body = await requestJson(endpoint, { headers });
      successfulEndpoint = true;
      const rules = extractRoutingRules(body);
      diagnostics.push({ path, ok: true, count: rules.length, shape: bodyShape(body) });
      for (const rule of rules) merged.set(ruleIdentity(rule), rule);
    } catch (error) {
      lastError = error;
      diagnostics.push({
        path,
        ok: false,
        status: error instanceof PifrostHttpError ? error.status : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      // Authentication errors and unexpected server failures are real errors.
      // 404/405 only mean this Bifrost version does not expose that alias path.
      if (!(error instanceof PifrostHttpError) || ![404, 405].includes(error.status)) throw error;
    }
  }

  if (!successfulEndpoint) throw lastError ?? new Error("Unable to read Bifrost routing rules");
  return { rules: [...merged.values()], diagnostics };
}

function aliasFromText(value) {
  const text = nonEmpty(value);
  if (!text) return undefined;
  const exact = text.match(/^(omp-[A-Za-z0-9._-]+)$/u);
  if (exact) return exact[1];
  return text.match(/(?:^|["'\s/:=,(])(omp-[A-Za-z0-9._-]+)(?=$|["'\s),])/u)?.[1];
}

function aliasFromStructuredQuery(value, depth = 0) {
  if (depth > 20 || value == null) return undefined;
  if (typeof value === "string") return aliasFromText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = aliasFromStructuredQuery(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    // Query-builder rules commonly store the logical model in a `value` field.
    // Prefer that before recursively examining the rest of the condition tree.
    const direct = aliasFromStructuredQuery(value.value, depth + 1);
    if (direct) return direct;
    for (const [key, item] of Object.entries(value)) {
      if (key === "value") continue;
      const found = aliasFromStructuredQuery(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function aliasIdFromRuleRobust(rule) {
  for (const candidate of [rule?.name, rule?.alias, rule?.logical_model, rule?.logicalModel]) {
    const found = aliasFromText(candidate);
    if (found) return found;
  }
  const expression = aliasFromText(rule?.cel_expression) ?? aliasFromText(rule?.celExpression);
  if (expression) return expression;
  return aliasFromStructuredQuery(rule?.query) ?? aliasFromStructuredQuery(rule?.conditions);
}

function targetReference(target) {
  const model = nonEmpty(target?.model) ?? nonEmpty(target?.model_id) ?? nonEmpty(target?.modelId);
  if (!model) return undefined;
  const provider = nonEmpty(target?.provider) ?? nonEmpty(target?.provider_name) ?? nonEmpty(target?.providerName);
  if (!provider) return model;
  if (model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return model;
  return `${provider}/${model}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/** Derive the Pifrost alias manifest while tolerating Bifrost query-builder rule shapes. */
export function deriveAliasesRobust(rules) {
  const aliases = {};
  for (const rule of rules ?? []) {
    if (rule?.enabled === false) continue;
    const id = aliasIdFromRuleRobust(rule);
    if (!id) continue;

    const rawTargets = Array.isArray(rule?.targets)
      ? rule.targets
      : Array.isArray(rule?.routing_targets)
        ? rule.routing_targets
        : [];
    const targets = [...rawTargets].sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0));
    const fallbacks = Array.isArray(rule?.fallbacks)
      ? rule.fallbacks
      : Array.isArray(rule?.fallback_models)
        ? rule.fallback_models
        : [];
    const chain = unique([...targets.map(targetReference), ...fallbacks.map(nonEmpty)]);
    if (!chain.length) continue;
    aliases[id] = { name: id, chain };
  }
  return { includePhysicalModels: false, aliases };
}
