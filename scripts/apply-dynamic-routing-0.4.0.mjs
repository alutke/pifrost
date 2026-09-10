import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

const dynamicRouting = `import type { BifrostProviderModel, PifrostAliasConfig, PifrostCatalog } from "./index.ts";

export const DYNAMIC_ROUTE_MODE = "context-aware" as const;
export const DEFAULT_CONTEXT_BYTES_PER_TOKEN = 2.5;
export const DEFAULT_CONTEXT_SAFETY_MARGIN = 0.1;
export const DEFAULT_CONTEXT_FIXED_HEADROOM = 2_048;
export const DEFAULT_IMAGE_TOKEN_RESERVE = 4_096;

export interface DynamicRouteMemberProfile {
\treference: string;
\tresolvedModelId: string;
\tcontextWindow: number;
\tmaxTokens: number;
\tinput: ("text" | "image")[];
\treasoning: boolean;
\tsupportsTools: boolean;
\tcompat: {
\t\tsupportsToolChoice?: boolean;
\t\tsupportsForcedToolChoice?: boolean;
\t\tsupportsNamedToolChoice?: boolean;
\t\tdisableReasoningOnToolChoice?: boolean;
\t};
}

export interface DynamicRouteBand {
\tmaxRequiredTokens: number;
\tmembers: string[];
}

export interface DynamicRouteProfile {
\tid: string;
\tmode: typeof DYNAMIC_ROUTE_MODE;
\tsource: "bifrost-simple-rule";
\tstaticContextWindow: number;
\tadvertisedContextWindow: number;
\tmaxTokens: number;
\tmembers: DynamicRouteMemberProfile[];
\tbands: DynamicRouteBand[];
}

export interface DynamicRouteDecision {
\tlogicalModel: string;
\testimatedInputTokens: number;
\toutputReserveTokens: number;
\trequiredContextTokens: number;
\tprimary: string;
\tfallbacks: string[];
\texcluded: Array<{ reference: string; reasons: string[] }>;
}

export interface DynamicRouteEstimateOptions {
\tbytesPerToken?: number;
\tsafetyMargin?: number;
\tfixedHeadroom?: number;
\timageTokenReserve?: number;
}

type DynamicAliasDefinition = {
\tname?: string;
\tchain: string[];
\tdynamicRouting?: {
\t\tmode?: string;
\t\tsource?: string;
\t};
};

type DynamicModelCarrier = BifrostProviderModel & {
\tpifrostDynamicRoute?: DynamicRouteProfile;
};

type DynamicDiagnosticCarrier = PifrostCatalog["diagnostics"][number] & {
\tdynamicRouting?: boolean;
\tstaticContextWindow?: number;
\tcontextBands?: DynamicRouteBand[];
};

function dynamicDefinition(value: PifrostAliasConfig["aliases"][string] | undefined): DynamicAliasDefinition | undefined {
\tif (!value || Array.isArray(value)) return undefined;
\treturn value as DynamicAliasDefinition;
}

function finitePositive(value: unknown): number | undefined {
\treturn typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function profileIsValid(value: unknown): value is DynamicRouteProfile {
\tif (!value || typeof value !== "object") return false;
\tconst profile = value as Partial<DynamicRouteProfile>;
\treturn (
\t\ttypeof profile.id === "string" &&
\t\tprofile.mode === DYNAMIC_ROUTE_MODE &&
\t\tprofile.source === "bifrost-simple-rule" &&
\t\tfinitePositive(profile.advertisedContextWindow) !== undefined &&
\t\tfinitePositive(profile.staticContextWindow) !== undefined &&
\t\tfinitePositive(profile.maxTokens) !== undefined &&
\t\tArray.isArray(profile.members) &&
\t\tprofile.members.length > 0
\t);
}

function routeBands(members: readonly DynamicRouteMemberProfile[]): DynamicRouteBand[] {
\tconst thresholds = [...new Set(members.map((member) => member.contextWindow))].sort((a, b) => a - b);
\treturn thresholds.map((maxRequiredTokens) => ({
\t\tmaxRequiredTokens,
\t\tmembers: members.filter((member) => member.contextWindow >= maxRequiredTokens).map((member) => member.reference),
\t}));
}

/**
 * Upgrade only aliases explicitly marked safe by routes-sync. The normal alias
 * synthesis remains conservative; this post-process raises the OMP context
 * envelope only when Pifrost can enforce member eligibility on every request.
 */
export function applyDynamicRouteProfiles(
\tcatalog: PifrostCatalog,
\tphysicalModels: readonly BifrostProviderModel[],
\taliasConfig: PifrostAliasConfig | undefined,
\tresolveReference: (reference: string, models: readonly BifrostProviderModel[]) => BifrostProviderModel | undefined,
): PifrostCatalog {
\tif (!aliasConfig) return catalog;
\tconst diagnosticCopies = catalog.diagnostics.map((item) => ({ ...item })) as DynamicDiagnosticCarrier[];
\tconst diagnosticsById = new Map(diagnosticCopies.map((item) => [item.id.toLowerCase(), item]));

\tconst models = catalog.models.map((model): BifrostProviderModel => {
\t\tconst definition = dynamicDefinition(aliasConfig.aliases[model.id]);
\t\tif (definition?.dynamicRouting?.mode !== DYNAMIC_ROUTE_MODE || definition.dynamicRouting.source !== "bifrost-simple-rule") {
\t\t\treturn model;
\t\t}
\t\tconst resolved = definition.chain.map((reference) => ({
\t\t\treference,
\t\t\tmodel: resolveReference(reference, physicalModels),
\t\t}));
\t\tif (resolved.length === 0 || resolved.some((entry) => !entry.model)) return model;

\t\tconst members: DynamicRouteMemberProfile[] = resolved.map((entry) => {
\t\t\tconst member = entry.model!;
\t\t\treturn {
\t\t\t\treference: entry.reference,
\t\t\t\tresolvedModelId: member.id,
\t\t\t\tcontextWindow: member.contextWindow,
\t\t\t\tmaxTokens: member.maxTokens,
\t\t\t\tinput: [...member.input],
\t\t\t\treasoning: member.reasoning,
\t\t\t\tsupportsTools: member.supportsTools,
\t\t\t\tcompat: {
\t\t\t\t\tsupportsToolChoice: member.compat.supportsToolChoice,
\t\t\t\t\tsupportsForcedToolChoice: member.compat.supportsForcedToolChoice,
\t\t\t\t\tsupportsNamedToolChoice: member.compat.supportsNamedToolChoice,
\t\t\t\t\tdisableReasoningOnToolChoice: member.compat.disableReasoningOnToolChoice,
\t\t\t\t},
\t\t\t};
\t\t});
\t\tconst staticContextWindow = Math.min(...members.map((member) => member.contextWindow));
\t\tconst advertisedContextWindow = Math.max(...members.map((member) => member.contextWindow));
\t\tif (advertisedContextWindow <= staticContextWindow) return model;

\t\tconst profile: DynamicRouteProfile = {
\t\t\tid: model.id,
\t\t\tmode: DYNAMIC_ROUTE_MODE,
\t\t\tsource: "bifrost-simple-rule",
\t\t\tstaticContextWindow,
\t\t\tadvertisedContextWindow,
\t\t\t// Output remains the route-wide safe minimum. Dynamic routing solves
\t\t\t// context-window down-ranking without silently increasing output ceilings.
\t\t\tmaxTokens: model.maxTokens,
\t\t\tmembers,
\t\t\tbands: routeBands(members),
\t\t};
\t\tconst diagnostic = diagnosticsById.get(model.id.toLowerCase());
\t\tif (diagnostic) {
\t\t\tdiagnostic.staticContextWindow = staticContextWindow;
\t\t\tdiagnostic.contextWindow = advertisedContextWindow;
\t\t\tdiagnostic.dynamicRouting = true;
\t\t\tdiagnostic.contextBands = profile.bands;
\t\t}
\t\treturn {
\t\t\t...model,
\t\t\tcontextWindow: advertisedContextWindow,
\t\t\tpifrostDynamicRoute: profile,
\t\t} as DynamicModelCarrier;
\t});

\treturn { ...catalog, models, diagnostics: diagnosticCopies };
}

export function extractDynamicRouteProfiles(models: readonly BifrostProviderModel[]): Map<string, DynamicRouteProfile> {
\tconst result = new Map<string, DynamicRouteProfile>();
\tfor (const model of models) {
\t\tconst profile = (model as DynamicModelCarrier).pifrostDynamicRoute;
\t\tif (profileIsValid(profile)) result.set(profile.id.toLowerCase(), profile);
\t}
\treturn result;
}

function imagePartCount(value: unknown, depth = 0): number {
\tif (depth > 40 || value == null) return 0;
\tif (Array.isArray(value)) return value.reduce((sum, item) => sum + imagePartCount(item, depth + 1), 0);
\tif (typeof value !== "object") return 0;
\tconst record = value as Record<string, unknown>;
\tconst type = typeof record.type === "string" ? record.type.toLowerCase() : "";
\tif (type.includes("image")) return 1;
\treturn Object.values(record).reduce((sum, item) => sum + imagePartCount(item, depth + 1), 0);
}

function estimatePayload(value: Record<string, unknown>): { json: string; images: number } {
\tconst promptPayload = { ...value };
\tfor (const key of ["model", "fallbacks", "stream", "stream_options", "max_tokens", "max_completion_tokens"]) {
\t\tdelete promptPayload[key];
\t}
\tconst images = imagePartCount(promptPayload);
\tconst json = JSON.stringify(promptPayload, (key, item) => {
\t\tif (typeof item !== "string") return item;
\t\tif (/^data:image\//iu.test(item)) return "[image-data]";
\t\tif (/image/iu.test(key) && item.length > 512) return "[image-data]";
\t\treturn item;
\t});
\treturn { json, images };
}

export function estimateOpenAIRequestInputTokens(
\tbody: Record<string, unknown>,
\toptions: DynamicRouteEstimateOptions = {},
): number {
\tconst bytesPerToken = finitePositive(options.bytesPerToken) ?? DEFAULT_CONTEXT_BYTES_PER_TOKEN;
\tconst safetyMargin = typeof options.safetyMargin === "number" && Number.isFinite(options.safetyMargin)
\t\t? Math.max(0, options.safetyMargin)
\t\t: DEFAULT_CONTEXT_SAFETY_MARGIN;
\tconst fixedHeadroom = typeof options.fixedHeadroom === "number" && Number.isFinite(options.fixedHeadroom)
\t\t? Math.max(0, Math.floor(options.fixedHeadroom))
\t\t: DEFAULT_CONTEXT_FIXED_HEADROOM;
\tconst imageTokenReserve = typeof options.imageTokenReserve === "number" && Number.isFinite(options.imageTokenReserve)
\t\t? Math.max(0, Math.floor(options.imageTokenReserve))
\t\t: DEFAULT_IMAGE_TOKEN_RESERVE;
\tconst { json, images } = estimatePayload(body);
\tconst bytes = new TextEncoder().encode(json).byteLength;
\treturn Math.max(1, Math.ceil((bytes / bytesPerToken) * (1 + safetyMargin)) + fixedHeadroom + images * imageTokenReserve);
}

function requestedOutputTokens(body: Record<string, unknown>, profile: DynamicRouteProfile): number {
\tfor (const key of ["max_completion_tokens", "max_tokens"]) {
\t\tconst value = body[key];
\t\tif (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.ceil(value);
\t}
\treturn profile.maxTokens;
}

function requestHasImages(body: Record<string, unknown>): boolean {
\treturn imagePartCount(body.messages ?? body.input) > 0;
}

function requestUsesTools(body: Record<string, unknown>): boolean {
\treturn Array.isArray(body.tools) && body.tools.length > 0;
}

function requestUsesReasoning(body: Record<string, unknown>): boolean {
\treturn body.reasoning !== undefined || body.reasoning_effort !== undefined;
}

function memberExclusionReasons(
\tmember: DynamicRouteMemberProfile,
\tbody: Record<string, unknown>,
\trequiredContextTokens: number,
\toutputReserveTokens: number,
): string[] {
\tconst reasons: string[] = [];
\tif (member.contextWindow < requiredContextTokens) reasons.push(`context ${member.contextWindow} < required ${requiredContextTokens}`);
\tif (member.maxTokens < outputReserveTokens) reasons.push(`max-output ${member.maxTokens} < requested ${outputReserveTokens}`);
\tif (requestHasImages(body) && !member.input.includes("image")) reasons.push("no image input");
\tconst usesTools = requestUsesTools(body);
\tif (usesTools && !member.supportsTools) reasons.push("no tool support");
\tconst toolChoice = body.tool_choice;
\tif (toolChoice !== undefined && member.compat.supportsToolChoice === false) reasons.push("no tool_choice support");
\tif ((toolChoice === "required" || toolChoice === "any") && member.compat.supportsForcedToolChoice === false) {
\t\treasons.push("no forced tool_choice support");
\t}
\tif (toolChoice && typeof toolChoice === "object" && member.compat.supportsNamedToolChoice === false) {
\t\treasons.push("no named tool_choice support");
\t}
\tif (requestUsesReasoning(body) && !member.reasoning) reasons.push("no reasoning support");
\tif (requestUsesReasoning(body) && usesTools && member.compat.disableReasoningOnToolChoice === true) {
\t\treasons.push("cannot combine reasoning with tools");
\t}
\treturn reasons;
}

export class DynamicRouteCapacityError extends Error {
\tconstructor(message: string) {
\t\tsuper(message);
\t\tthis.name = "DynamicRouteCapacityError";
\t}
}

export function rewriteDynamicOpenAIRequest(
\tprofile: DynamicRouteProfile,
\tbody: Record<string, unknown>,
\toptions: DynamicRouteEstimateOptions = {},
): { body: Record<string, unknown>; decision: DynamicRouteDecision } {
\tconst estimatedInputTokens = estimateOpenAIRequestInputTokens(body, options);
\tconst outputReserveTokens = requestedOutputTokens(body, profile);
\tconst requiredContextTokens = estimatedInputTokens + outputReserveTokens;
\tconst excluded: DynamicRouteDecision["excluded"] = [];
\tconst eligible: DynamicRouteMemberProfile[] = [];
\tfor (const member of profile.members) {
\t\tconst reasons = memberExclusionReasons(member, body, requiredContextTokens, outputReserveTokens);
\t\tif (reasons.length) excluded.push({ reference: member.reference, reasons });
\t\telse eligible.push(member);
\t}
\tif (!eligible.length) {
\t\tthrow new DynamicRouteCapacityError(
\t\t\t`Pifrost dynamic route ${profile.id} has no eligible member for estimated input ${estimatedInputTokens} + output reserve ${outputReserveTokens} = ${requiredContextTokens} tokens; compact the session or lower the requested output ceiling`,
\t\t);
\t}
\tconst primary = eligible[0]!.reference;
\tconst fallbacks = eligible.slice(1).map((member) => member.reference);
\treturn {
\t\tbody: {
\t\t\t...body,
\t\t\tmodel: primary,
\t\t\t...(fallbacks.length ? { fallbacks } : { fallbacks: [] }),
\t\t},
\t\tdecision: {
\t\t\tlogicalModel: profile.id,
\t\t\testimatedInputTokens,
\t\t\toutputReserveTokens,
\t\t\trequiredContextTokens,
\t\t\tprimary,
\t\t\tfallbacks,
\t\t\texcluded,
\t\t},
\t};
}

async function requestBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
\tconst body = init?.body;
\tif (typeof body === "string") return body;
\tif (body instanceof URLSearchParams) return body.toString();
\tif (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
\tif (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
\tif (typeof Request !== "undefined" && input instanceof Request) {
\t\ttry {
\t\t\treturn await input.clone().text();
\t\t} catch {
\t\t\treturn undefined;
\t\t}
\t}
\treturn undefined;
}

function mergedHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
\tconst headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
\tif (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
\treturn headers;
}

/**
 * Intercept the final OpenAI-compatible JSON payload after OMP has serialized
 * messages/tools. For a context-aware alias, replace the logical model with the
 * first capability-safe physical route member and supply the remaining eligible
 * members through Bifrost's documented top-level fallback list.
 */
export function createDynamicRoutingFetch(
\tbaseFetch: typeof globalThis.fetch,
\tprofiles: ReadonlyMap<string, DynamicRouteProfile>,
\testimateOptions: DynamicRouteEstimateOptions = {},
): typeof globalThis.fetch {
\treturn (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
\t\tconst text = await requestBodyText(input, init);
\t\tif (!text) return baseFetch(input, init);
\t\tlet body: Record<string, unknown>;
\t\ttry {
\t\t\tconst parsed: unknown = JSON.parse(text);
\t\t\tif (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return baseFetch(input, init);
\t\t\tbody = parsed as Record<string, unknown>;
\t\t} catch {
\t\t\treturn baseFetch(input, init);
\t\t}
\t\tconst logicalModel = typeof body.model === "string" ? body.model.toLowerCase() : "";
\t\tconst profile = profiles.get(logicalModel);
\t\tif (!profile) return baseFetch(input, init);

\t\tconst rewritten = rewriteDynamicOpenAIRequest(profile, body, estimateOptions);
\t\tconst headers = mergedHeaders(input, init);
\t\theaders.delete("content-length");
\t\theaders.set("x-pifrost-logical-model", profile.id);
\t\theaders.set("x-pifrost-estimated-input-tokens", String(rewritten.decision.estimatedInputTokens));
\t\theaders.set("x-pifrost-required-context-tokens", String(rewritten.decision.requiredContextTokens));
\t\theaders.set("x-pifrost-eligible-members", String(1 + rewritten.decision.fallbacks.length));
\t\tconst nextBody = JSON.stringify(rewritten.body);

\t\tif (typeof Request !== "undefined" && input instanceof Request) {
\t\t\tconst request = new Request(input, { ...init, method: init?.method ?? input.method, headers, body: nextBody });
\t\t\treturn baseFetch(request);
\t\t}
\t\treturn baseFetch(input, { ...init, headers, body: nextBody });
\t}) as typeof globalThis.fetch;
}
`;
write("dynamic-routing.ts", dynamicRouting);

let routing = read("routing-discovery.mjs");
routing = replaceOnce(
  routing,
  `function ruleMembers(rule) {\n  const rawTargets = Array.isArray(rule?.targets)\n    ? rule.targets\n    : Array.isArray(rule?.routing_targets)\n      ? rule.routing_targets\n      : [];`,
  `function rawRuleTargets(rule) {\n  return Array.isArray(rule?.targets)\n    ? rule.targets\n    : Array.isArray(rule?.routing_targets)\n      ? rule.routing_targets\n      : [];\n}\n\nfunction ruleMembers(rule) {\n  const rawTargets = rawRuleTargets(rule);`,
  "routing raw-target helper",
);
routing = replaceOnce(
  routing,
  `  return unique([...targets.map(targetReference), ...fallbacks.map(nonEmpty)]);\n}\n\n/**\n * Derive a conservative OMP alias envelope from Bifrost routing rules.`,
  `  return unique([...targets.map(targetReference), ...fallbacks.map(nonEmpty)]);\n}\n\nconst DYNAMIC_ROUTING_FORBIDDEN_IDENTIFIERS = Object.freeze([\n  "headers",\n  "params",\n  "budget_used",\n  "tokens_used",\n  "complexity_tier",\n  "virtual_key_id",\n  "virtual_key_name",\n  "user_id",\n  "team_id",\n  "team_name",\n  "customer_id",\n  "customer_name",\n  "provider",\n]);\n\nfunction structuredQueryFields(value, result = new Set(), depth = 0) {\n  if (depth > 20 || value == null) return result;\n  if (Array.isArray(value)) {\n    for (const item of value) structuredQueryFields(item, result, depth + 1);\n    return result;\n  }\n  if (typeof value !== "object") return result;\n  if (typeof value.field === "string") result.add(value.field.toLowerCase());\n  for (const item of Object.values(value)) structuredQueryFields(item, result, depth + 1);\n  return result;\n}\n\n/**\n * Dynamic request-time compilation is safe only when bypassing the logical\n * Bifrost rule cannot change its semantics: one global terminal rule, one\n * primary target, static fallbacks, and no request/scope/budget/complexity\n * predicate other than model/request_type selection. More complex aliases keep\n * the existing static weakest-member envelope and stay fully Bifrost-routed.\n */\nexport function isContextDynamicRuleSafe(rule, aliasId) {\n  if (!rule || rule.enabled === false || aliasIdFromRuleRobust(rule) !== aliasId) return false;\n  const scope = (nonEmpty(rule?.scope) ?? "global").toLowerCase();\n  const scopeId = nonEmpty(rule?.scope_id) ?? nonEmpty(rule?.scopeId);\n  if (scope !== "global" || scopeId) return false;\n  if (rule?.chain_rule === true || rule?.chainRule === true) return false;\n  if (rawRuleTargets(rule).length !== 1 || !targetReference(rawRuleTargets(rule)[0])) return false;\n\n  const fields = new Set([\n    ...structuredQueryFields(rule?.query),\n    ...structuredQueryFields(rule?.conditions),\n  ]);\n  if ([...fields].some((field) => !["model", "request_type"].includes(field))) return false;\n\n  const conditionText = [\n    rule?.cel_expression,\n    rule?.celExpression,\n    JSON.stringify(rule?.query ?? ""),\n    JSON.stringify(rule?.conditions ?? ""),\n  ].filter(Boolean).join(" ").toLowerCase();\n  for (const identifier of DYNAMIC_ROUTING_FORBIDDEN_IDENTIFIERS) {\n    const pattern = new RegExp(\`\\\\b\${identifier}\\\\b\`, "u");\n    if (pattern.test(conditionText)) return false;\n  }\n  return true;\n}\n\n/**\n * Derive a conservative OMP alias envelope from Bifrost routing rules.`,
  "dynamic routing safety helper",
);
routing = replaceOnce(
  routing,
  `  for (const [id, related] of aliasRules) {\n    if (related.some((rule) => rule?.chain_rule === true || rule?.chainRule === true)) {\n      aliases[id] = {\n        name: id,\n        chain: unique([...(aliases[id]?.chain ?? []), ...allReachableMembers]),\n      };\n    }\n  }\n\n  return { includePhysicalModels: false, aliases };`,
  `  for (const [id, related] of aliasRules) {\n    if (related.some((rule) => rule?.chain_rule === true || rule?.chainRule === true)) {\n      aliases[id] = {\n        name: id,\n        chain: unique([...(aliases[id]?.chain ?? []), ...allReachableMembers]),\n      };\n      continue;\n    }\n    if (related.length === 1 && isContextDynamicRuleSafe(related[0], id)) {\n      aliases[id] = {\n        ...aliases[id],\n        dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },\n      };\n    }\n  }\n\n  return { includePhysicalModels: false, aliases };`,
  "routing dynamic marker",
);
write("routing-discovery.mjs", routing);

let native = read("native.ts");
native = replaceOnce(
  native,
  `import { createBifrostUsageProvider } from "./bifrost-usage.ts";`,
  `import { createBifrostUsageProvider } from "./bifrost-usage.ts";\nimport {\n\tapplyDynamicRouteProfiles,\n\tcreateDynamicRoutingFetch,\n\textractDynamicRouteProfiles,\n\ttype DynamicRouteProfile,\n} from "./dynamic-routing.ts";`,
  "native dynamic import",
);
native = replaceOnce(
  native,
  `function nonEmpty(value: string | undefined): string | undefined {\n\tconst trimmed = value?.trim();\n\treturn trimmed ? trimmed : undefined;\n}\n`,
  `let runtimeDynamicRoutes = new Map<string, DynamicRouteProfile>();\n\nfunction installDynamicRouteProfiles(models: readonly import("./index.ts").BifrostProviderModel[]): void {\n\truntimeDynamicRoutes = extractDynamicRouteProfiles(models);\n}\n\nfunction nonEmpty(value: string | undefined): string | undefined {\n\tconst trimmed = value?.trim();\n\treturn trimmed ? trimmed : undefined;\n}\n`,
  "native runtime map",
);
native = replaceOnce(
  native,
  `\tconst streamOptions: OpenAICompletionsOptions = {\n\t\t...options,`,
  `\tconst baseFetch = options?.fetch ?? globalThis.fetch;\n\tconst streamOptions: OpenAICompletionsOptions = {\n\t\t...options,`,
  "native base fetch",
);
native = replaceOnce(
  native,
  `\t\tpromptCache: options?.promptCache,\n\t};`,
  `\t\tpromptCache: options?.promptCache,\n\t\t// The fetch wrapper sees OMP's final serialized OpenAI payload. It can\n\t\t// therefore enforce the exact member envelope before Bifrost executes the\n\t\t// caller-supplied physical fallback chain. Non-dynamic aliases are untouched.\n\t\tfetch: createDynamicRoutingFetch(baseFetch, runtimeDynamicRoutes),\n\t};`,
  "native routing fetch",
);
native = replaceOnce(
  native,
  `\t\tcatalog = buildPifrostCatalog(richRoutes.models, aliasSource.config, richRoutes.diagnostics);\n\t}\n\n\twriteCatalogCache(catalog, { config: liveConfig, aliasConfig: aliasSource.config });`,
  `\t\tcatalog = buildPifrostCatalog(richRoutes.models, aliasSource.config, richRoutes.diagnostics);\n\t\tcatalog = applyDynamicRouteProfiles(catalog, richRoutes.models, aliasSource.config, (reference, models) =>\n\t\t\tmodels.find((candidate) => candidate.id.toLowerCase() === reference.toLowerCase()) ??\n\t\t\tundefined,\n\t\t);\n\t}\n\n\t// The no-datasheet path is uncommon for configured aliases, but keep it\n\t// capability-safe and dynamic when all route members exist in /v1/models.\n\tif ((!hasAliases || !datasheets) && aliasSource.config) {\n\t\tcatalog = applyDynamicRouteProfiles(catalog, liveModels, aliasSource.config, (reference, models) =>\n\t\t\tmodels.find((candidate) => candidate.id.toLowerCase() === reference.toLowerCase()) ?? undefined,\n\t\t);\n\t}\n\tinstallDynamicRouteProfiles(catalog.models);\n\twriteCatalogCache(catalog, { config: liveConfig, aliasConfig: aliasSource.config });`,
  "native apply profiles",
);
native = replaceOnce(
  native,
  `\t\tconst startupCache = loadCatalogCache({ config, aliasConfig: aliasSource.config });\n\t\tif (startupCache) diagnostics = startupCache.diagnostics;`,
  `\t\tconst startupCache = loadCatalogCache({ config, aliasConfig: aliasSource.config });\n\t\tif (startupCache) {\n\t\t\tdiagnostics = startupCache.diagnostics;\n\t\t\tinstallDynamicRouteProfiles(startupCache.models);\n\t\t}`,
  "native startup profiles",
);
native = replaceOnce(
  native,
  `\t\t\t\tif (cached && !forceRefreshRequested()) {\n\t\t\t\t\tdiagnostics = cached.diagnostics;`,
  `\t\t\t\tif (cached && !forceRefreshRequested()) {\n\t\t\t\t\tdiagnostics = cached.diagnostics;\n\t\t\t\t\tinstallDynamicRouteProfiles(cached.models);`,
  "native cached profiles",
);
write("native.ts", native);

let cache = read("cache.ts");
cache = replaceOnce(cache, "export const CATALOG_CACHE_SCHEMA_VERSION = 3;", "export const CATALOG_CACHE_SCHEMA_VERSION = 4;", "cache schema");
write("cache.ts", cache);

let diagnostics = read("model-diagnostics.mjs");
diagnostics = replaceOnce(diagnostics, "export const EXPECTED_CACHE_SCHEMA_VERSION = 3;", "export const EXPECTED_CACHE_SCHEMA_VERSION = 4;", "doctor schema");
diagnostics = replaceOnce(
  diagnostics,
  `  const source = thinking.source === "none" ? "" : \` source=\${thinking.source}\`;\n  return \`\${String(model?.id ?? "").padEnd(16)} context=\${String(model?.contextWindow ?? "-").padEnd(8)} max=\${String(model?.maxTokens ?? "-").padEnd(8)} thinking=\${effortText.padEnd(24)} images=\${images}\${source}\`;`,
  `  const source = thinking.source === "none" ? "" : \` source=\${thinking.source}\`;\n  const route = model?.pifrostDynamicRoute;\n  const dynamic = route?.mode === "context-aware"\n    ? \` dynamic-context=\${route.staticContextWindow}->\${route.advertisedContextWindow}\`\n    : "";\n  return \`\${String(model?.id ?? "").padEnd(16)} context=\${String(model?.contextWindow ?? "-").padEnd(8)} max=\${String(model?.maxTokens ?? "-").padEnd(8)} thinking=\${effortText.padEnd(24)} images=\${images}\${source}\${dynamic}\`;`,
  "doctor dynamic marker",
);
diagnostics = replaceOnce(
  diagnostics,
  `  const diagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];\n  const withMembers = diagnostics.filter((item) => Array.isArray(item?.members) && item.members.length);`,
  `  const diagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];\n  const dynamic = models.filter((model) => model?.pifrostDynamicRoute?.mode === "context-aware");\n  if (dynamic.length) {\n    out.log("\\nDynamic context routing:");\n    for (const model of dynamic) {\n      const route = model.pifrostDynamicRoute;\n      out.log(\`  \${model.id}: static=\${route.staticContextWindow} advertised=\${route.advertisedContextWindow}\`);\n      for (const band of route.bands ?? []) {\n        out.log(\`    <=\${band.maxRequiredTokens}: \${(band.members ?? []).join(" -> ")}\`);\n      }\n    }\n  }\n\n  const withMembers = diagnostics.filter((item) => Array.isArray(item?.members) && item.members.length);`,
  "doctor bands",
);
write("model-diagnostics.mjs", diagnostics);

let index = read("index.ts");
index = replaceOnce(index, 'export const PIFROST_VERSION = "0.3.4";', 'export const PIFROST_VERSION = "0.4.0";', "runtime version");
write("index.ts", index);

let pkg = JSON.parse(read("package.json"));
pkg.version = "0.4.0";
const routeIndex = pkg.files.indexOf("route-inventory.ts");
if (routeIndex < 0) throw new Error("package files route-inventory anchor missing");
if (!pkg.files.includes("dynamic-routing.ts")) pkg.files.splice(routeIndex + 1, 0, "dynamic-routing.ts");
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

let providerTest = read("test/provider.test.ts").replaceAll("pifrost/0.3.4 OMP", "pifrost/0.4.0 OMP");
write("test/provider.test.ts", providerTest);

let routingTest = read("test/routing-discovery.test.mjs");
routingTest = replaceOnce(
  routingTest,
  `  deriveAliasesRobust,\n  discoverRoutingRules,`,
  `  deriveAliasesRobust,\n  discoverRoutingRules,\n  isContextDynamicRuleSafe,`,
  "routing test import",
);
routingTest += `\n\ntest("simple global terminal aliases opt into context-aware routing", () => {\n  const rule = {\n    id: "dynamic",\n    name: "omp-default",\n    scope: "global",\n    enabled: true,\n    cel_expression: "model == 'omp-default'",\n    targets: [{ provider: "openai", model: "gpt-large", weight: 1 }],\n    fallbacks: ["deepseek/small"],\n  };\n  assert.equal(isContextDynamicRuleSafe(rule, "omp-default"), true);\n  const result = deriveAliasesRobust([rule]);\n  assert.deepEqual(result.aliases["omp-default"], {\n    name: "omp-default",\n    chain: ["openai/gpt-large", "deepseek/small"],\n    dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },\n  });\n});\n\ntest("scope, weighted, chained and request-dependent aliases stay static", () => {\n  const base = {\n    id: "unsafe",\n    name: "omp-default",\n    scope: "global",\n    enabled: true,\n    cel_expression: "model == 'omp-default'",\n    targets: [{ provider: "openai", model: "gpt-large", weight: 1 }],\n  };\n  assert.equal(isContextDynamicRuleSafe({ ...base, scope: "virtual_key", scope_id: "vk" }, "omp-default"), false);\n  assert.equal(isContextDynamicRuleSafe({ ...base, chain_rule: true }, "omp-default"), false);\n  assert.equal(isContextDynamicRuleSafe({ ...base, targets: [...base.targets, { provider: "deepseek", model: "small", weight: 1 }] }, "omp-default"), false);\n  assert.equal(isContextDynamicRuleSafe({ ...base, cel_expression: "model == 'omp-default' && budget_used < 80" }, "omp-default"), false);\n  assert.equal(isContextDynamicRuleSafe({ ...base, cel_expression: "model == 'omp-default' && headers['x-tier'] == 'large'" }, "omp-default"), false);\n});\n`;
write("test/routing-discovery.test.mjs", routingTest);

const dynamicTest = `import assert from "node:assert/strict";\nimport test from "node:test";\n\nimport type { BifrostProviderModel, PifrostAliasConfig, PifrostCatalog } from "../index.ts";\nimport {\n\tapplyDynamicRouteProfiles,\n\tcreateDynamicRoutingFetch,\n\textractDynamicRouteProfiles,\n\trewriteDynamicOpenAIRequest,\n\ttype DynamicRouteProfile,\n} from "../dynamic-routing.ts";\n\nfunction member(id: string, contextWindow: number, overrides: Partial<BifrostProviderModel> = {}): BifrostProviderModel {\n\treturn {\n\t\tid,\n\t\tname: id,\n\t\treasoning: true,\n\t\tinput: ["text"],\n\t\tcost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },\n\t\tcontextWindow,\n\t\tmaxTokens: 32_000,\n\t\tsupportsTools: true,\n\t\tcompat: {\n\t\t\tsupportsDeveloperRole: false,\n\t\t\tsupportsReasoningEffort: true,\n\t\t\tsupportsUsageInStreaming: true,\n\t\t\tsupportsToolChoice: true,\n\t\t\tsupportsForcedToolChoice: true,\n\t\t\tsupportsNamedToolChoice: true,\n\t\t\tdisableReasoningOnToolChoice: false,\n\t\t},\n\t\t...overrides,\n\t};\n}\n\nconst aliases: PifrostAliasConfig = {\n\tincludePhysicalModels: false,\n\taliases: {\n\t\t"omp-default": {\n\t\t\tname: "omp-default",\n\t\t\tchain: ["provider/large", "provider/small", "provider/large-two"],\n\t\t\tdynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },\n\t\t} as never,\n\t},\n};\n\nconst physical = [\n\tmember("provider/large", 1_000_000),\n\tmember("provider/small", 256_000),\n\tmember("provider/large-two", 1_000_000),\n];\n\nfunction baseCatalog(): PifrostCatalog {\n\treturn {\n\t\tmodels: [{ ...member("omp-default", 256_000), maxTokens: 32_000 }],\n\t\tdiagnostics: [{\n\t\t\tid: "omp-default", name: "omp-default", chain: aliases.aliases["omp-default"] && !Array.isArray(aliases.aliases["omp-default"]) ? aliases.aliases["omp-default"].chain : [],\n\t\t\tresolved: [], unresolved: [], contextWindow: 256_000, maxTokens: 32_000, image: false, reasoning: true, reasoningEfforts: ["high"], tools: true,\n\t\t}],\n\t};\n}\n\nfunction profile(): DynamicRouteProfile {\n\tconst catalog = applyDynamicRouteProfiles(baseCatalog(), physical, aliases, (reference, models) =>\n\t\tmodels.find((model) => model.id === reference),\n\t);\n\tconst profiles = extractDynamicRouteProfiles(catalog.models);\n\tconst value = profiles.get("omp-default");\n\tassert.ok(value);\n\treturn value;\n}\n\ntest("dynamic alias advertises the largest context while retaining safe output ceiling", () => {\n\tconst catalog = applyDynamicRouteProfiles(baseCatalog(), physical, aliases, (reference, models) =>\n\t\tmodels.find((model) => model.id === reference),\n\t);\n\tassert.equal(catalog.models[0]?.contextWindow, 1_000_000);\n\tassert.equal(catalog.models[0]?.maxTokens, 32_000);\n\tconst route = profile();\n\tassert.equal(route.staticContextWindow, 256_000);\n\tassert.equal(route.advertisedContextWindow, 1_000_000);\n\tassert.deepEqual(route.bands.map((band) => [band.maxRequiredTokens, band.members]), [\n\t\t[256_000, ["provider/large", "provider/small", "provider/large-two"]],\n\t\t[1_000_000, ["provider/large", "provider/large-two"]],\n\t]);\n});\n\ntest("large requests remove small-context members but preserve route order", () => {\n\tconst route = profile();\n\tconst body = { model: "omp-default", messages: [{ role: "user", content: "x".repeat(300_000) }], max_tokens: 32_000 };\n\tconst result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 1, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });\n\tassert.equal(result.body.model, "provider/large");\n\tassert.deepEqual(result.body.fallbacks, ["provider/large-two"]);\n\tassert.equal(result.decision.excluded[0]?.reference, "provider/small");\n});\n\ntest("small requests retain every route member", () => {\n\tconst route = profile();\n\tconst body = { model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 };\n\tconst result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });\n\tassert.equal(result.body.model, "provider/large");\n\tassert.deepEqual(result.body.fallbacks, ["provider/small", "provider/large-two"]);\n});\n\ntest("final-wire fetch rewrites logical aliases and adds routing diagnostics headers", async () => {\n\tconst route = profile();\n\tlet capturedBody: Record<string, unknown> | undefined;\n\tlet capturedHeaders: Headers | undefined;\n\tconst fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {\n\t\tcapturedBody = JSON.parse(String(init?.body));\n\t\tcapturedHeaders = new Headers(init?.headers);\n\t\treturn new Response("ok", { status: 200 });\n\t}) as typeof fetch;\n\tconst wrapped = createDynamicRoutingFetch(fakeFetch, new Map([["omp-default", route]]), {\n\t\tbytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0,\n\t});\n\tawait wrapped("http://bifrost/v1/chat/completions", {\n\t\tmethod: "POST",\n\t\theaders: { "content-type": "application/json", "x-bf-eh-user-agent": "pifrost/test" },\n\t\tbody: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 }),\n\t});\n\tassert.equal(capturedBody?.model, "provider/large");\n\tassert.deepEqual(capturedBody?.fallbacks, ["provider/small", "provider/large-two"]);\n\tassert.equal(capturedHeaders?.get("x-pifrost-logical-model"), "omp-default");\n\tassert.equal(capturedHeaders?.get("x-bf-eh-user-agent"), "pifrost/test");\n});\n\ntest("capability guard excludes non-tool members when the actual wire request uses tools", () => {\n\tconst route = profile();\n\troute.members[0] = { ...route.members[0]!, supportsTools: false };\n\tconst body = {\n\t\tmodel: "omp-default",\n\t\tmessages: [{ role: "user", content: "hello" }],\n\t\ttools: [{ type: "function", function: { name: "x", parameters: { type: "object" } } }],\n\t\tmax_tokens: 32_000,\n\t};\n\tconst result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });\n\tassert.equal(result.body.model, "provider/small");\n});\n`;
write("test/dynamic-routing.test.ts", dynamicTest);

let readme = read("README.md");
readme = readme.replaceAll("Pifrost 0.3.4", "Pifrost 0.4.0").replace(/\n0\.3\.4\n/g, "\n0.4.0\n");
const dynamicSection = `\n## Dynamic context-aware Bifrost routes\n\nPifrost 0.4.0 removes the weakest-context-member ceiling for simple Bifrost logical routes. After \`pifrost routes sync\`, aliases backed by one global, terminal, unweighted routing rule are marked \`context-aware\`. Pifrost advertises the largest context window available anywhere in that route while keeping the route-wide safe minimum output ceiling.\n\nAt request time Pifrost intercepts OMP's final OpenAI-compatible payload, estimates serialized prompt demand with a conservative safety allowance, reserves the requested output budget, and filters the synced route chain. Members that cannot accommodate the request context are excluded. The first eligible member becomes the physical Bifrost request model and the remaining eligible members are supplied through Bifrost's native top-level \`fallbacks\` array, so Bifrost still executes provider credentials, retries, governance and failover. The original logical role is retained in \`x-pifrost-logical-model\` for observability.\n\nFor example, a route \`1M -> 256K -> 1M\` is advertised to OMP as 1M. Small requests retain all three members; once the calculated input-plus-output requirement exceeds 256K, the middle member is removed for that request only. Pifrost fails closed if no member can satisfy the calculated requirement.\n\nDynamic compilation is deliberately disabled for scope-specific, weighted, chained, complexity, budget, quota, header or parameter-dependent rules because bypassing those logical rules could change Bifrost semantics. Those aliases continue to use the static weakest-member envelope. The feature therefore improves simple fallback routes automatically without weakening complex-route correctness.\n\nRun \`pifrost doctor\` after syncing to see \`dynamic-context=<static>-><advertised>\` and the derived context bands.\n`;
const troubleshooting = "\n## Troubleshooting\n";
if (!readme.includes(troubleshooting)) throw new Error("README troubleshooting anchor missing");
readme = readme.replace(troubleshooting, dynamicSection + troubleshooting);
write("README.md", readme);

let changelog = read("CHANGELOG.md");
changelog = replaceOnce(changelog, "# Changelog\n\n## 0.3.4", `# Changelog\n\n## 0.4.0\n\n- Added request-time context-aware route compilation for simple Bifrost logical aliases. A 1M -> 256K -> 1M route can now advertise 1M to OMP while automatically excluding the 256K member only when the actual request no longer fits.\n- Added a conservative final-wire request estimator with output-token reserve, fixed headroom, image allowance and capability guards. No eligible member means fail-closed rather than an unsafe oversized request.\n- Dynamic requests preserve route order and delegate the eligible chain to Bifrost via its native top-level \`fallbacks\` request field. Provider credentials, retries, governance and failover remain Bifrost-owned.\n- \`pifrost routes sync\` opts in only single global terminal unweighted rules without scope/budget/quota/complexity/header/parameter-dependent semantics. Complex routes retain the previous weakest-member static envelope.\n- Dynamic profile metadata is persisted in the model cache and exposed by \`pifrost doctor\` as the original static context, advertised context and request bands.\n- Cache schema bumped to v4.\n\n## 0.3.4`, "changelog");
write("CHANGELOG.md", changelog);

// Remove the one-shot bootstrap files from the resulting implementation commit.
for (const path of ["scripts/apply-dynamic-routing-0.4.0.mjs", ".github/workflows/dynamic-routing-upgrade.yml"]) {
  if (existsSync(path)) unlinkSync(path);
}

console.log("Pifrost 0.4.0 dynamic routing patch applied");
