import { classifyGatewayHttpStatus, parseGatewayRetryAfter, safeGatewayHeaderToken, type GatewayFailureClass } from "./gateway-reliability.ts";
import { classifyInferenceFailure, type InferenceFailureCode } from "./inference-failure.ts";
import type { InferenceRequestDiagnostics } from "./request-diagnostics.ts";
import type { OutputBudgetDecision } from "./output-budget.ts";
import type { RouteContractEvidence } from "./route-compatibility.ts";
import type { ReasoningReplayAudit } from "./reasoning-integrity.ts";

function finiteNonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface BifrostCostCapture {
	total?: number;
	breakdown?: Record<string, unknown>;
	requestId?: string;
	traceId?: string;
	/** Gateway error-only classification; no raw error body or tokens are retained. */
	httpStatus?: number;
	/** Captured from actual model stream deltas; not a retry instruction. */
	outputStarted?: boolean;
	failureClass?: GatewayFailureClass;
	/** Diagnostic-only code; never a retry policy. */
	failureCode?: InferenceFailureCode;
	/** Wire structure only: no prompts, reasoning or tool arguments. */
	requestDiagnostics?: InferenceRequestDiagnostics;
	/** Provenance-only cap decision made before HTTP dispatch; no prompts/keys. */
	outputBudget?: OutputBudgetDecision;
	/** Cached route-contract metadata, never used to select Bifrost providers. */
	routeContract?: RouteContractEvidence;
	/** Counts only; excludes prompt, reasoning contents and provider signatures. */
	replayAudit?: ReasoningReplayAudit;
	retryAfterSeconds?: number;
	cacheHit?: boolean;
	cacheHitType?: string;
	/** Original logical route as observed by Bifrost 2.3+, not client metadata. */
	requestedModel?: string;
	requestedProvider?: string;
	provider?: string;
	originalModel?: string;
	resolvedModel?: string;
	fallbackIndex?: number;
	isFallback?: boolean;
	primaryProvider?: string;
	primaryModel?: string;
	requestType?: string;
	upstreamLatencyMs?: number;
	/** True only when Bifrost explicitly reports dropping a max_* token field. */
	droppedOutputLimit?: boolean;
	/** Diagnostic-only gateway conversion, never used to select another route. */
	convertedRequestType?: string;
}

function recordDroppedParams(capture: BifrostCostCapture, value: unknown): void {
  const params = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string" && value.length <= 8192 ? value.split(",") : [];
  if (params.some(param => /(?:^|\\.)max_(?:output_|completion_)?tokens$/iu.test(param.trim()))) {
    capture.droppedOutputLimit = true;
  }
}
function recordBodyExtraFields(value: unknown, capture?: BifrostCostCapture): void {
  if (!capture || !value || typeof value !== "object" || Array.isArray(value)) return;
  const body = value as Record<string, unknown>;
  const extra = body.extra_fields;
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return;
  const fields = extra as Record<string, unknown>;
  const route = fields.routing_info && typeof fields.routing_info === "object" && !Array.isArray(fields.routing_info)
    ? fields.routing_info as Record<string, unknown> : undefined;
  const string = (v: unknown): string | undefined =>
    typeof v === "string" ? safeGatewayHeaderToken(v, 128) : undefined;
  // In streaming, final extra_fields may be more current than early headers
  // written before Bifrost completed a fallback. Only gateway-owned fields.
  capture.requestedModel = string(route?.requested_model) ?? capture.requestedModel;
  capture.requestedProvider = string(route?.requested_provider) ?? capture.requestedProvider;
  capture.provider = string(route?.provider) ?? string(fields.provider) ?? capture.provider;
  capture.resolvedModel = string(route?.model) ?? string(fields.resolved_model_used) ?? capture.resolvedModel;
  capture.originalModel = string(fields.original_model_requested) ?? capture.originalModel;
  capture.primaryProvider = string(route?.primary_provider) ?? capture.primaryProvider;
  capture.primaryModel = string(route?.primary_model) ?? capture.primaryModel;
  capture.requestType = string(fields.request_type) ?? capture.requestType;
  capture.convertedRequestType = string(fields.converted_request_type) ?? capture.convertedRequestType;
  if (route?.is_fallback === true) capture.isFallback = true;
  recordDroppedParams(capture, fields.dropped_compat_plugin_params);
}

function bridgeUsageObject(
	value: Record<string, unknown>,
	capture?: BifrostCostCapture,
): Record<string, unknown> {
	const cost = value.cost;
	if (!cost || typeof cost !== "object" || Array.isArray(cost)) return value;
	const total = finiteNonNegative((cost as Record<string, unknown>).total_cost);
	if (total === undefined) return value;
	if (capture) {
		capture.total = total;
		capture.breakdown = { ...(cost as Record<string, unknown>) };
	}
	return {
		...value,
		cost: total,
		pifrost_bifrost_cost: cost,
	};
}

function bridgeNode(value: unknown, capture?: BifrostCostCapture, depth = 0): unknown {
	if (depth > 48 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((item) => {
			const bridged = bridgeNode(item, capture, depth + 1);
			if (bridged !== item) changed = true;
			return bridged;
		});
		return changed ? next : value;
	}

	const record = value as Record<string, unknown>;
	let changed = false;
	let next: Record<string, unknown> | undefined;
	for (const [key, child] of Object.entries(record)) {
		let bridged = child;
		if (key === "usage" && child && typeof child === "object" && !Array.isArray(child)) {
			const usage = bridgeUsageObject(child as Record<string, unknown>, capture);
			bridged = bridgeNode(usage, capture, depth + 1);
		} else {
			bridged = bridgeNode(child, capture, depth + 1);
		}
		if (bridged !== child) {
			next ??= { ...record };
			next[key] = bridged;
			changed = true;
		}
	}
	return changed ? next! : value;
}

/**
 * Bifrost 2.2.x can expose an authoritative nested usage.cost object. OMP's
 * OpenAI-compatible accounting consumes a scalar provider-reported cost, so
 * translate only that wire shape and retain the original breakdown alongside
 * it for diagnostics. Payloads without a nested Bifrost total are untouched.
 */
export function bridgeBifrostUsageCostPayload(
	value: unknown,
	capture?: BifrostCostCapture,
): unknown {
	recordBodyExtraFields(value, capture);
	return bridgeNode(value, capture);
}

function bridgeSseLine(line: string, capture?: BifrostCostCapture): string {
	const newline = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
	const body = newline ? line.slice(0, -newline.length) : line;
	const match = body.match(/^(\s*data:\s?)(.*)$/u);
	if (!match) return line;
	const [, prefix, raw] = match;
	if (!raw || raw === "[DONE]") return line;
	try {
		const parsed = JSON.parse(raw);
		const bridged = bridgeBifrostUsageCostPayload(parsed, capture);
		return `${prefix}${JSON.stringify(bridged)}${newline}`;
	} catch {
		return line;
	}
}

function bridgeEventStream(
	body: ReadableStream<Uint8Array>,
	capture?: BifrostCostCapture,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			while (true) {
				const newline = pending.indexOf("\n");
				if (newline >= 0) {
					const line = pending.slice(0, newline + 1);
					pending = pending.slice(newline + 1);
					controller.enqueue(encoder.encode(bridgeSseLine(line, capture)));
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					pending += decoder.decode();
					if (pending) controller.enqueue(encoder.encode(bridgeSseLine(pending, capture)));
					controller.close();
					return;
				}
				pending += decoder.decode(value, { stream: true });
			}
		},
		async cancel(reason) {
			await reader.cancel(reason);
		},
	});
}

function nonEmptyHeader(headers: Headers, name: string): string | undefined {
	const value = headers.get(name)?.trim();
	return value || undefined;
}

function captureBifrostHeaders(headers: Headers, capture?: BifrostCostCapture, status?: number): void {
	if (!capture) return;
	capture.requestId = safeGatewayHeaderToken(headers.get("x-bifrost-request-id")) ?? capture.requestId;
	capture.convertedRequestType = safeGatewayHeaderToken(headers.get("x-bifrost-converted-request-type")) ?? capture.convertedRequestType;
	recordDroppedParams(capture, headers.get("x-bifrost-dropped-compat-params"));
	const traceId = safeGatewayHeaderToken(headers.get("x-bifrost-trace-id"));
	if (traceId) capture.traceId = traceId;
	const classified = status === undefined ? undefined : classifyGatewayHttpStatus(status);
	if (classified && status !== undefined) {
		capture.httpStatus = status;
		capture.failureClass = classified;
		const retryAfter = parseGatewayRetryAfter(headers.get("retry-after"));
		if (retryAfter !== undefined) capture.retryAfterSeconds = retryAfter;
	}
	const cacheHit = headers.get("x-bifrost-cache-hit");
	if (cacheHit === "true" || cacheHit === "false") capture.cacheHit = cacheHit === "true";
	const cacheHitType = safeGatewayHeaderToken(headers.get("x-bifrost-cache-hit-type"), 64);
	if (cacheHitType) capture.cacheHitType = cacheHitType;
	capture.requestedModel = nonEmptyHeader(headers, "x-bifrost-routing-info-requested-model") ?? capture.requestedModel;
	capture.requestedProvider = nonEmptyHeader(headers, "x-bifrost-routing-info-requested-provider") ?? capture.requestedProvider;
	capture.provider =
		nonEmptyHeader(headers, "x-bifrost-routing-info-provider") ??
		nonEmptyHeader(headers, "x-bifrost-provider") ??
		capture.provider;
	capture.originalModel =
		nonEmptyHeader(headers, "x-bifrost-original-model") ??
		capture.originalModel;
	capture.resolvedModel =
		nonEmptyHeader(headers, "x-bifrost-routing-info-model") ??
		nonEmptyHeader(headers, "x-bifrost-resolved-model") ??
		capture.resolvedModel;
	capture.primaryProvider =
		nonEmptyHeader(headers, "x-bifrost-routing-info-primary-provider") ??
		capture.primaryProvider;
	capture.primaryModel =
		nonEmptyHeader(headers, "x-bifrost-routing-info-primary-model") ??
		capture.primaryModel;
	capture.requestType =
		nonEmptyHeader(headers, "x-bifrost-request-type") ??
		capture.requestType;
	const fallbackIndex = Number(nonEmptyHeader(headers, "x-bifrost-fallback-index"));
	if (Number.isInteger(fallbackIndex) && fallbackIndex > 0) capture.fallbackIndex = fallbackIndex;
	if (nonEmptyHeader(headers, "x-bifrost-routing-info-is-fallback") === "true") capture.isFallback = true;
	else if (capture.fallbackIndex !== undefined) capture.isFallback = true;
	const latency = Number(nonEmptyHeader(headers, "x-bifrost-upstream-latency-ms"));
	if (Number.isFinite(latency) && latency >= 0) capture.upstreamLatencyMs = latency;
}

function bridgedHeaders(headers: Headers): Headers {
	const result = new Headers(headers);
	result.delete("content-length");
	return result;
}

export async function bridgeBifrostUsageCostResponse(
	response: Response,
	capture?: BifrostCostCapture,
): Promise<Response> {
	captureBifrostHeaders(response.headers, capture, response.status);
	if (!response.body) return response;
	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

	if (contentType.includes("text/event-stream")) {
		return new Response(bridgeEventStream(response.body, capture), {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	}

	if (!contentType.includes("application/json")) return response;
	const text = await response.text();
	try {
		const parsed = JSON.parse(text);
		if (capture && response.status >= 400) capture.failureCode = classifyInferenceFailure(response.status, parsed).code;
		const bridged = bridgeBifrostUsageCostPayload(parsed, capture);
		return new Response(JSON.stringify(bridged), {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	} catch {
		return new Response(text, {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	}
}

export function createBifrostCostBridgeFetch(
	baseFetch: typeof globalThis.fetch,
	capture?: BifrostCostCapture,
): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
		bridgeBifrostUsageCostResponse(await baseFetch(input, init), capture)) as typeof globalThis.fetch;
}

export interface PifrostMessageWithUpstreamModel {
	upstreamModel?: string;
	upstreamProvider?: string;
}

/**
 * Before processing a native logical rule, discard the physical identity
 * inferred by OMP's locally selected serialization model. Only Bifrost's
 * confirmed resolved-model headers may add real upstream provenance later.
 */
export function clearUnverifiedNativeOrigin<T extends PifrostMessageWithUpstreamModel & { model: string }>(
	message: T,
	logicalAlias: string,
): T {
	return { ...message, model: logicalAlias, upstreamModel: undefined, upstreamProvider: undefined };
}

/**
 * Keep the logical OMP model stable while recording what Bifrost actually
 * served. Never infer a provider from the configured primary: Bifrost may
 * independently select a fallback for the same wire request.
 *
 * When a serving model is confirmed but the provider is not, discard any
 * unverified upstreamProvider even if the model ID is unchanged: the same
 * model can be served from different hosts. Never fabricate cross-host
 * reasoning provenance. This never modifies the original OMP session message.
 */
export function applyBifrostResolvedModel<T extends PifrostMessageWithUpstreamModel>(
	message: T,
	capture: BifrostCostCapture,
): T {
	const resolvedModel = capture.resolvedModel?.trim();
	if (!resolvedModel) return message;
	const provider = capture.provider?.trim();
	if (message.upstreamModel === resolvedModel &&
		(provider ? message.upstreamProvider === provider : message.upstreamProvider === undefined)) return message;
	const next: PifrostMessageWithUpstreamModel = { ...message, upstreamModel: resolvedModel };
	if (provider) next.upstreamProvider = provider;
	else delete next.upstreamProvider;
	return next as T;
}

export interface PifrostUsageWithCost {
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

/**
 * Apply Bifrost's authoritative total to an OMP-shaped usage cost after wire
 * parsing. Kept dependency-free so this compatibility module remains safe in
 * clean GitHub plugin installs and Node-based unit tests.
 */
export function applyBifrostAuthoritativeCost<T extends PifrostUsageWithCost>(
	usage: T,
	capture: BifrostCostCapture,
): T {
	const total = capture.total;
	if (total === undefined || !Number.isFinite(total) || total < 0) return usage;
	const estimated = usage.cost.total;
	const nextCost = { ...usage.cost };
	if (Number.isFinite(estimated) && estimated > 0) {
		const scale = total / estimated;
		nextCost.input *= scale;
		nextCost.output *= scale;
		nextCost.cacheRead *= scale;
		nextCost.cacheWrite *= scale;
	} else {
		nextCost.input = total;
		nextCost.output = 0;
		nextCost.cacheRead = 0;
		nextCost.cacheWrite = 0;
	}
	nextCost.total = total;
	return { ...usage, cost: nextCost };
}
