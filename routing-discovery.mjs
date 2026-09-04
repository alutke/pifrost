import {
  PifrostHttpError,
  bifrostManagementBase,
  managementHeaders,
  nonEmpty,
  requestJson,
} from "./cli-lib.mjs";

const ROUTE_PATHS = [
  "/api/routing/rules",
  "/api/governance/routing-rules",
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

function totalCount(body) {
  const raw = body?.total_count ?? body?.totalCount;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function fetchRoutingPages(base, path, headers) {
  const limit = 100;
  const rules = [];
  const shapes = [];
  let offset = 0;

  while (true) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const body = await requestJson(`${base}${path}?${query}`, { headers });
    const page = extractRoutingRules(body);
    rules.push(...page);
    shapes.push(bodyShape(body));

    const total = totalCount(body);
    if (total !== undefined && rules.length >= total) break;
    if (page.length === 0 || page.length < limit) break;

    offset += page.length;
    if (offset > 100_000) throw new Error(`Refusing excessive routing pagination from ${path}`);
  }

  return {
    rules,
    pages: shapes.length,
    shape: shapes.length === 1 ? shapes[0] : `${shapes[0]} pages=${shapes.length}`,
  };
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
  let lastError;

  for (let index = 0; index < ROUTE_PATHS.length; index += 1) {
    const path = ROUTE_PATHS[index];
    try {
      const pageResult = await fetchRoutingPages(base, path, headers);
      const rules = pageResult.rules;
      diagnostics.push({
        path,
        ok: true,
        count: rules.length,
        pages: pageResult.pages,
        shape: pageResult.shape,
      });

      // Bifrost 2.x owns routing under /api/routing. Its governance alias is
      // deprecated, so a non-empty canonical response is authoritative. Probe
      // the legacy path only for older installations or the historic empty-200
      // compatibility case Pifrost already supports.
      if (index === 0 && rules.length > 0) return { rules, diagnostics };
      if (index === ROUTE_PATHS.length - 1) return { rules, diagnostics };
    } catch (error) {
      lastError = error;
      diagnostics.push({
        path,
        ok: false,
        status: error instanceof PifrostHttpError ? error.status : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!(error instanceof PifrostHttpError) || ![404, 405].includes(error.status)) throw error;
    }
  }

  throw lastError ?? new Error("Unable to read Bifrost routing rules");
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

function ruleMembers(rule) {
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
  return unique([...targets.map(targetReference), ...fallbacks.map(nonEmpty)]);
}

/**
 * Derive a conservative OMP alias envelope from Bifrost routing rules.
 *
 * Bifrost 2.x permits multiple rules for the same logical model across global,
 * customer/team/VK/user scopes, weighted targets, complexity predicates and
 * chain_rule re-entry. Pifrost cannot know which request scope will be active
 * when OMP selects an alias, so it unions every possible member for that alias
 * instead of letting the last rule overwrite earlier scopes.
 *
 * If an alias rule is chained, any enabled downstream routing rule may become
 * reachable after the first rewrite. Include those members as a conservative
 * closure; capability synthesis will then take the safe minimum/intersection.
 */
export function deriveAliasesRobust(rules) {
  const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
  const aliases = {};
  const aliasRules = new Map();

  for (const rule of enabled) {
    const id = aliasIdFromRuleRobust(rule);
    if (!id) continue;
    const members = ruleMembers(rule);
    if (!members.length) continue;
    const bucket = aliasRules.get(id) ?? [];
    bucket.push(rule);
    aliasRules.set(id, bucket);
    const existing = aliases[id]?.chain ?? [];
    aliases[id] = { name: id, chain: unique([...existing, ...members]) };
  }

  const allReachableMembers = unique(enabled.flatMap(ruleMembers));
  for (const [id, related] of aliasRules) {
    if (related.some((rule) => rule?.chain_rule === true || rule?.chainRule === true)) {
      aliases[id] = {
        name: id,
        chain: unique([...(aliases[id]?.chain ?? []), ...allReachableMembers]),
      };
    }
  }

  return { includePhysicalModels: false, aliases };
}

export function routingFeatureSummary(rules) {
  const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
  const scopes = unique(enabled.map((rule) => nonEmpty(rule?.scope) ?? "global")).sort();
  const aliasCounts = new Map();
  for (const rule of enabled) {
    const id = aliasIdFromRuleRobust(rule);
    if (id) aliasCounts.set(id, (aliasCounts.get(id) ?? 0) + 1);
  }
  return {
    enabledRules: enabled.length,
    scopes,
    chainRules: enabled.filter((rule) => rule?.chain_rule === true || rule?.chainRule === true).length,
    weightedRules: enabled.filter((rule) => {
      const targets = Array.isArray(rule?.targets) ? rule.targets : [];
      return targets.length > 1 || targets.some((target) => Number(target?.weight ?? 1) !== 1);
    }).length,
    complexityRules: enabled.filter((rule) =>
      /complexity_tier/iu.test(String(rule?.cel_expression ?? rule?.celExpression ?? JSON.stringify(rule?.query ?? ""))),
    ).length,
    multiScopeAliases: [...aliasCounts.values()].filter((count) => count > 1).length,
  };
}
