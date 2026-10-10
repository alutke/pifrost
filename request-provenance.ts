import type { BifrostCostCapture } from "./bifrost-cost-bridge.ts";
import type { ReasoningHygieneCounters } from "./reasoning-stream.ts";

export interface PifrostRouteTrace {
	timestamp: number;
	sessionId: string;
	logicalModel: string;
	protocol: string;
	attempt: number;
	requestedPrimary: string;
	requestId?: string;
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
		protocol: string;
		attempt: number;
		requestedPrimary: string;
		outcome: PifrostRouteTrace["outcome"];
	},
	capture: BifrostCostCapture,
	reasoningHygiene?: ReasoningHygieneCounters,
): PifrostRouteTrace {
	return recordPifrostRouteTrace(sessionId, {
		...base,
		...(capture.requestId ? { requestId: capture.requestId } : {}),
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

export function formatPifrostRouteTraces(sessionId: string): string {
	const current = traces.get(sessionId) ?? [];
	if (!current.length) return "Pifrost routing trace: no requests recorded for this session.";
	const lines = ["Pifrost routing trace (latest first):"];
	for (const trace of [...current].reverse().slice(0, 10)) {
		const served = trace.resolvedModel
			? `${trace.provider ? `${trace.provider}/` : ""}${trace.resolvedModel}`
			: trace.requestedPrimary;
		const details = [
			`attempt=${trace.attempt}`,
			`protocol=${trace.protocol}`,
			`requested=${trace.requestedPrimary}`,
			`served=${served}`,
			trace.fallbackIndex !== undefined
				? `fallback=${trace.fallbackIndex}`
				: trace.isFallback
					? "fallback=yes"
					: "fallback=no",
			trace.requestId ? `request-id=${trace.requestId}` : undefined,
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
			].join(" ") : undefined,
			`outcome=${trace.outcome}`,
		].filter(Boolean);
		lines.push(`  ${trace.logicalModel}: ${details.join(" ")}`);
	}
	return lines.join("\n");
}
