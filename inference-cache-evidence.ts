/**
 * Release 5F: request/response-only cache evidence. A declared TTL is intent,
 * not proof of physical provider acceptance or reuse. No field is injected.
 */
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export interface ResponsesCacheIntent {
  status: "unavailable" | "default" | "requested" | "invalid";
  requestedTtl?: "30m" | "12h";
  breakpoints: number;
  explicitTtlOverrides: number;
  legacyRetention: boolean;
  cacheKeyPresent: boolean;
  /** True only if the caller explicitly asked for 12h; not proof of upstream egress. */
  twelveHourRequested: boolean;
  providerAccepted: "unverified";
}

export function inspectResponsesCacheRequest(payload: unknown, protocol: string): ResponsesCacheIntent {
  const body = object(payload);
  if (protocol !== "openai-responses" || !body) return {
    status: "unavailable", breakpoints: 0, explicitTtlOverrides: 0,
    legacyRetention: false, cacheKeyPresent: false, twelveHourRequested: false,
    providerAccepted: "unverified",
  };
  const requestOptions = object(body.prompt_cache_options);
  const ttl = requestOptions?.ttl;
  const points: RecordValue[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || points.length > 80) return;
    if (Array.isArray(node)) for (const child of node.slice(0, 80)) visit(child, depth + 1);
    else {
      const record = object(node);
      if (!record) return;
      const point = object(record.prompt_cache_breakpoint);
      if (point) points.push(point);
      for (const [key, child] of Object.entries(record)) {
        if (key !== "prompt_cache_breakpoint" && key !== "prompt_cache_key" &&
            key !== "prompt_cache_options" && key !== "prompt_cache_retention") visit(child, depth + 1);
      }
    }
  };
  // Only user-provided request input and instructions are eligible.
  visit(body.input, 0);
  visit(body.instructions, 0);
  const overrides = points.filter(p => p.ttl !== undefined);
  const valid = (v: unknown) => v === undefined || v === "30m" || v === "12h";
  const invalid = !valid(ttl) || points.some(p => !valid(p.ttl)) ||
    (requestOptions?.mode !== undefined && requestOptions.mode !== "implicit" && requestOptions.mode !== "explicit") ||
    points.length > 4;
  const requested = requestOptions !== undefined || points.length > 0 || body.prompt_cache_retention !== undefined;
  return {
    status: invalid ? "invalid" : requested ? "requested" : "default",
    ...(valid(ttl) && ttl !== undefined ? { requestedTtl: ttl as "30m" | "12h" } : {}),
    breakpoints: points.length,
    explicitTtlOverrides: overrides.length,
    legacyRetention: body.prompt_cache_retention !== undefined,
    cacheKeyPresent: typeof body.prompt_cache_key === "string" && body.prompt_cache_key.length > 0,
    twelveHourRequested: ttl === "12h" || points.some(p => p.ttl === "12h"),
    providerAccepted: "unverified",
  };
}

export interface GatewayCacheCounters {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWrite30mTokens?: number;
  cacheWrite12hTokens?: number;
  /** Counter origin is an upstream payload, not an independent invoice. */
  source: "bifrost-response-usage";
}

export function inspectGatewayUsageCounters(usage: unknown): GatewayCacheCounters | undefined {
  const root = object(usage);
  if (!root) return undefined;
  const input = count(root.input_tokens) ?? count(root.prompt_tokens);
  const output = count(root.output_tokens) ?? count(root.completion_tokens);
  const detail = object(root.input_tokens_details) ?? object(root.prompt_tokens_details);
  const writeDetail = object(detail?.cache_write_tokens_details);
  const read = count(detail?.cached_tokens) ?? count(root.cache_read_input_tokens);
  const write = count(detail?.cache_write_tokens) ?? count(root.cache_creation_input_tokens);
  const write30 = count(writeDetail?.ttl_30m_tokens);
  const write12 = count(writeDetail?.ttl_12h_tokens);
  if ([input, output, read, write, write30, write12].every(v => v === undefined)) return undefined;
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(write === undefined ? {} : { cacheWriteTokens: write }),
    ...(write30 === undefined ? {} : { cacheWrite30mTokens: write30 }),
    ...(write12 === undefined ? {} : { cacheWrite12hTokens: write12 }),
    source: "bifrost-response-usage",
  };
}

export function gatewayCostEvidence(capture: {
  total?: number; provider?: string; resolvedModel?: string; usageCounters?: GatewayCacheCounters;
}): {
  attribution: "gateway-physical-model" | "model-only" | "unverified";
  amount: "gateway-reported" | "unknown";
  accounting: "reported-tokens" | "unknown";
} {
  const validCost = typeof capture.total === "number" && Number.isFinite(capture.total) && capture.total >= 0;
  return {
    attribution: capture.provider && capture.resolvedModel ? "gateway-physical-model" :
      capture.resolvedModel ? "model-only" : "unverified",
    amount: validCost ? "gateway-reported" : "unknown",
    accounting: capture.usageCounters ? "reported-tokens" : "unknown",
  };
}
