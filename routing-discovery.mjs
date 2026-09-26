import {
  PifrostHttpError,
  bifrostManagementBase,
  managementHeaders,
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
  const seenPages = new Set();
  let offset = 0;

  while (true) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const body = await requestJson(`${base}${path}?${query}`, { headers });
    const page = extractRoutingRules(body);
    const signature = JSON.stringify(page.map((rule) => rule?.id ?? rule?.name ?? rule));
    if (seenPages.has(signature)) break;
    seenPages.add(signature);
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

export {
  aliasIdFromRule as aliasIdFromRuleRobust,
  deriveAliasesFromRules as deriveAliasesRobust,
  isContextDynamicRuleSafe,
  routingFeatureSummary,
} from "./routing-core.ts";
