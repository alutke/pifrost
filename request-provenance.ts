import type { BifrostCostCapture } from "./bifrost-cost-bridge.ts";
import type { ReasoningHygieneCounters } from "./reasoning-stream.ts";
import { gatewayFailureAdvice, type GatewayFailureClass } from "./gateway-reliability.ts";

export interface PifrostRouteTrace {
	timestamp: number;
	sessionId: string;
	logicalModel: string;
	/** Whether the live Bifrost alias was invoked or a compatibility exception ran. */
	routeMode?: "bifrost-native" | "pifrost-compatibility" | "bifrost-direct";
	exceptionReason?: string;
	protocol: string;
	attempt: number;
	requestedPrimary: string;
	/** Same-protocol physical wire splits: crossing them is pre-output-only. */
	compatibilityBoundaryCount?: number;
	requestId?: string;
	traceId?: string;
	httpStatus?: number;
	failureClass?: GatewayFailureClass;
	retryAfterSeconds?: number;
	outputStarted?: boolean;
	cacheHit?: boolean;
	cacheHitType?: string;
	requestedModel?: string;
	requestedProvider?: string;
	provider?: string;
	resolvedModel?: string;
	originalModel?: string;
	fallbackIndex?: number;
	isFallback?: boolean;
	primaryProvider?: string;
	primaryModel?: string;
	requestType?: string;
	upstreamLatencyMs?: number;
	totalCost?: number;
	reasoningHygiene?: ReasoningHygieneCounters;
	outcome: "done" | "error" | "thrown";
}

const MAX_TRACES_PER_SESSION = 20;
const traces = new Map<string, PifrostRouteTrace[]>();

export function recordPifrostRouteTrace(
	sessionId: string,
	input: Omit<PifrostRouteTrace, "timestamp" | "sessionId">,
): PifrostRouteTrace {
	const trace: PifrostRouteTrace = {
		timestamp: Date.now(),
		sessionId,
		...input,
	};
	const current = traces.get(sessionId) ?? [];
	current.push(trace);
	if (current.length > MAX_TRACES_PER_SESSION) current.splice(0, current.length - MAX_TRACES_PER_SESSION);
	traces.set(sessionId, current);
	return trace;
}

export function recordBifrostCaptureTrace(
	sessionId: string,
	base: {
		logicalModel: string;
		routeMode?: PifrostRouteTrace["routeMode"];
		exceptionReason?: string;
		protocol: string;
		attempt: number;
		requestedPrimary: string;
		/** Same-protocol physical wire splits: crossing them is pre-output-only. */
		compatibilityBoundaryCount?: number;
		outcome: PifrostRouteTrace["outcome"];
	},
	capture: BifrostCostCapture,
	reasoningHygiene?: ReasoningHygieneCounters,
): PifrostRouteTrace {
	return recordPifrostRouteTrace(sessionId, {
		...base,
		...(capture.requestId ? { requestId: capture.requestId } : {}),
		...(capture.traceId ? { traceId: capture.traceId } : {}),
		...(capture.httpStatus !== undefined ? { httpStatus: capture.httpStatus } : {}),
		...(capture.failureClass ? { failureClass: capture.failureClass } : {}),
		...(capture.retryAfterSeconds !== undefined ? { retryAfterSeconds: capture.retryAfterSeconds } : {}),
		...(capture.outputStarted !== undefined ? { outputStarted: capture.outputStarted } : {}),
		...(capture.cacheHit !== undefined ? { cacheHit: capture.cacheHit } : {}),
		...(capture.cacheHitType ? { cacheHitType: capture.cacheHitType } : {}),
		...(capture.requestedModel ? { requestedModel: capture.requestedModel } : {}),
		...(capture.requestedProvider ? { requestedProvider: capture.requestedProvider } : {}),
		...(capture.provider ? { provider: capture.provider } : {}),
		...(capture.resolvedModel ? { resolvedModel: capture.resolvedModel } : {}),
		...(capture.originalModel ? { originalModel: capture.originalModel } : {}),
		...(capture.fallbackIndex !== undefined ? { fallbackIndex: capture.fallbackIndex } : {}),
		...(capture.isFallback !== undefined ? { isFallback: capture.isFallback } : {}),
		...(capture.primaryProvider ? { primaryProvider: capture.primaryProvider } : {}),
		...(capture.primaryModel ? { primaryModel: capture.primaryModel } : {}),
		...(capture.requestType ? { requestType: capture.requestType } : {}),
		...(capture.upstreamLatencyMs !== undefined ? { upstreamLatencyMs: capture.upstreamLatencyMs } : {}),
		...(capture.total !== undefined ? { totalCost: capture.total } : {}),
		...(reasoningHygiene ? { reasoningHygiene: { ...reasoningHygiene } } : {}),
	});
}

export function releasePifrostRouteTraces(sessionId: string): void {
	traces.delete(sessionId);
}

function money(value: number | undefined): string | undefined {
	return value === undefined ? undefined : `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

/** Gateway headers prove a request alias, NOT a matched routing rule.
 * Bifrost Routes counters remain the rule-match source of truth. */
export function gatewayRouteEvidence(trace: Pick<PifrostRouteTrace, "routeMode" | "logicalModel" | "requestedModel">): string | undefined {
  if (trace.routeMode === "pifrost-compatibility") return "physical-request (route counters not expected)";
  if (trace.routeMode !== "bifrost-native") return undefined;
  if (!trace.requestedModel) return "unverified (gateway alias header absent)";
  const requested = trace.requestedModel.toLowerCase().replace(/^bifrost\//u, "");
  return requested === trace.logicalModel.toLowerCase()
    ? "alias-requested (rule match unverified)"
    : "alias-mismatch (check routing configuration)";
}

/** Only gateway-reported monetary totals count. No Pifrost price estimates.
 * This is an in-memory, bounded OMP session view, not a Bifrost invoice.
 * Missing gateway usage remains unknown, never silently counted as $0. */
export function formatPifrostSessionCosts(sessionId: string): string {
  const current = traces.get(sessionId) ?? [];
  if (!current.length) return "Pifrost session costs: no requests recorded for this session.";
  const byRole = new Map<string, { attempts: number; reported: number; total: number; fallbacks: number; cacheHits: number }>();
  let reported = 0;
  let total = 0;
  let cacheKnown = 0;
  for (const entry of current) {
    const item = byRole.get(entry.logicalModel) ?? { attempts: 0, reported: 0, total: 0, fallbacks: 0, cacheHits: 0 };
    item.attempts++;
    if (entry.isFallback || (entry.fallbackIndex ?? 0) > 0) item.fallbacks++;
    if (entry.cacheHit !== undefined) cacheKnown++;
    if (entry.cacheHit === true) item.cacheHits++;
    const amount = entry.totalCost;
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      item.total += amount;
      item.reported++;
      total += amount;
      reported++;
    }
    byRole.set(entry.logicalModel, item);
  }
  const lines = [
    `Pifrost session gateway costs (last ${current.length} attempts; memory-only):`,
    `  reported=${reported}/${current.length} reported-subtotal=${reported ? money(total) : "unknown"} (USD; missing costs excluded, not zero)`,
  ];
  for (const [alias, v] of [...byRole].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${alias}: reported=${v.reported}/${v.attempts} ${v.reported ? "reported-subtotal=" + money(v.total) : "cost=unknown"} fallbacks=${v.fallbacks} cache-hits=${v.cacheHits}`);
  }
  lines.push(`  cache-metadata=${cacheKnown}/${current.length}; unreported means unknown`);
  lines.push("  Gateway reporting only; not provider invoices or rule counters. Retry/failover attempts may each incur charges.");
  return lines.join("\n");
}

export function formatPifrostRouteTraces(sessionId: string): string {
	const current = traces.get(sessionId) ?? [];
	if (!current.length) return "Pifrost routing trace: no requests recorded for this session.";
	const lines = ["Pifrost request trace (newest first; up to 10 requests)", "Gateway request details do not establish that a Bifrost routing rule matched.", ""];
	for (const trace of [...current].reverse().slice(0, 10)) {
		const served = trace.resolvedModel
			? `${trace.provider ? `${trace.provider}/` : ""}${trace.resolvedModel}`
			: trace.outcome === "done" ? trace.requestedPrimary + " (not gateway-confirmed)" : "unverified";
		const details = [
			`attempt=${trace.attempt}`,
			trace.routeMode ? `route-mode=${trace.routeMode}` : undefined,
			trace.exceptionReason ? `exception=${trace.exceptionReason}` : undefined,
			`protocol=${trace.protocol}`,
			`requested=${trace.requestedPrimary}`,
			trace.requestedModel ? `gateway-request=${trace.requestedProvider ? `${trace.requestedProvider}/` : ""}${trace.requestedModel}` : undefined,
			gatewayRouteEvidence(trace) ? `route-evidence=${gatewayRouteEvidence(trace)}` : undefined,
			trace.compatibilityBoundaryCount
				? `wire-boundaries=${trace.compatibilityBoundaryCount} boundary-retry=pre-output-only`
				: undefined,
			`served=${served}`,
			trace.fallbackIndex !== undefined
				? `fallback=${trace.fallbackIndex}`
				: trace.isFallback
					? "fallback=yes"
					: "fallback=no",
			trace.requestId ? `request-id=${trace.requestId}` : undefined,
			trace.traceId ? `trace-id=${trace.traceId}` : undefined,
			trace.httpStatus !== undefined ? `http=${trace.httpStatus}` : undefined,
			trace.failureClass ? `failure=${trace.failureClass}` : undefined,
			trace.retryAfterSeconds !== undefined ? `retry-after=${trace.retryAfterSeconds}s (gateway advisory only)` : undefined,
			trace.outputStarted !== undefined ? `output-started=${trace.outputStarted ? "yes" : "no"}` : undefined,
			trace.cacheHit !== undefined ? `cache-hit=${trace.cacheHit ? "yes" : "no"}` : undefined,
			trace.cacheHitType ? `cache-type=${trace.cacheHitType}` : undefined,
			trace.upstreamLatencyMs !== undefined ? `upstream=${trace.upstreamLatencyMs.toFixed(1)}ms` : undefined,
			money(trace.totalCost) ? `cost=${money(trace.totalCost)}` : undefined,
			trace.reasoningHygiene ? [
				`history-removed=${trace.reasoningHygiene.replayRemoved}`,
				`history-mixed=${trace.reasoningHygiene.replayMixedRewritten}`,
				`history-nested=${trace.reasoningHygiene.replayNestedRewritten}`,
				`history-prose=${trace.reasoningHygiene.replayProseRewritten}`,
				`history-ambiguous=${trace.reasoningHygiene.replayAmbiguousRetained}`,
				`sse-reasoning=${trace.reasoningHygiene.rawReasoningSseFrames}`,
				`sse-markers=${trace.reasoningHygiene.rawReasoningMarkerFrames}`,
				`stream-prefixes=${trace.reasoningHygiene.outputPrefixesRemoved}`,
				`stream-marker-only=${trace.reasoningHygiene.outputMarkerOnlyCleared}`,
				`stream-signed-retained=${trace.reasoningHygiene.outputMarkerOnlyRetainedSigned}`,
				`stream-no-continuation=${trace.reasoningHygiene.outputMarkerOnlyRetainedNoContinuation}`,
			].join(" ") : undefined,
			`outcome=${trace.outcome}`,
		].filter((value): value is string => typeof value === "string" && value.length > 0);
		const route = details.filter(item => /^(?:attempt=|route-mode=|exception=|protocol=|requested=|gateway-request=|route-evidence=|wire-boundaries=|fallback=)/u.test(item));
		const gateway = details.filter(item => /^(?:request-id=|trace-id=|http=|failure=|retry-after=|output-started=|cache-hit=|cache-type=)/u.test(item));
		const usage = details.filter(item => /^(?:upstream=|cost=)/u.test(item));
		const reasoning = details.filter(item => item.startsWith("history-"));
		lines.push(`  ${trace.logicalModel} - ${trace.outcome === "done" ? "completed" : "failed"}`);
		lines.push(`    Model: served=${served}`);
		lines.push(`    Routing: ${route.join(" ")}`);
		if (gateway.length) lines.push(`    Gateway: ${gateway.join(" ")}`);
		if (usage.length) lines.push(`    Usage: ${usage.join(" ")}`);
		if (reasoning.length) lines.push(`    Reasoning cleanup: ${reasoning.join(" ")}`);
		if (trace.failureClass) lines.push(`    Next: ${gatewayFailureAdvice(trace.failureClass)}`);
		lines.push("");
	}
	return lines.join("\n");
}
