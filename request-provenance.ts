import type { BifrostCostCapture } from "./bifrost-cost-bridge.ts";
import type { ReasoningHygieneCounters } from "./reasoning-stream.ts";
import { gatewayFailureAdvice, type GatewayFailureClass } from "./gateway-reliability.ts";
import { inferenceFailureAdvice, type InferenceFailureCode } from "./inference-failure.ts";
import type { InferenceRequestDiagnostics } from "./request-diagnostics.ts";
import type { OutputBudgetDecision } from "./output-budget.ts";
import { gatewaySelectionRelativeToPrimary, type RouteContractEvidence } from "./route-compatibility.ts";
import type { ReasoningReplayAudit } from "./reasoning-integrity.ts";

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
	failureCode?: InferenceFailureCode;
	requestDiagnostics?: InferenceRequestDiagnostics;
	outputBudget?: OutputBudgetDecision;
	routeContract?: RouteContractEvidence;
	replayAudit?: ReasoningReplayAudit;
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
		...(capture.failureCode ? { failureCode: capture.failureCode } : {}),
		...(capture.requestDiagnostics ? { requestDiagnostics: { ...capture.requestDiagnostics } } : {}),
		...(capture.outputBudget ? { outputBudget: { ...capture.outputBudget, constraints: [...capture.outputBudget.constraints] } } : {}),
		...(capture.routeContract ? { routeContract: { ...capture.routeContract } } : {}),
		...(capture.replayAudit ? { replayAudit: { ...capture.replayAudit } } : {}),
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

/** Terminal recovery examines only the most recent gateway attempt.
 * Earlier failed fallbacks are not grounds to fork after a later success. */
export function latestPifrostRouteTrace(sessionId: string): Readonly<PifrostRouteTrace> | undefined {
	return traces.get(sessionId)?.at(-1);
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

export interface PifrostTraceDisplayOptions {
  last?: number;
  errorsOnly?: boolean;
  role?: string;
  compact?: boolean;
}
export function parsePifrostTraceOptions(args: string): PifrostTraceDisplayOptions {
  const tokens = args.trim() ? args.trim().split(/\s+/u) : [];
  const result: PifrostTraceDisplayOptions = {compact:true};
  for(let i=0;i<tokens.length;i++){
    const value=tokens[i].toLowerCase();
    if(value==="verbose")result.compact=false;
    else if(value==="errors")result.errorsOnly=true;
    else if(value==="last"){
      const n=Number(tokens[++i]);
      if(!Number.isInteger(n)||n<1||n>20)throw new Error("Trace last must be between 1 and 20");
      result.last=n;
    }else if(value==="role"){
      const name=tokens[++i];
      if(!name||!/^[a-z0-9_.-]{1,64}$/iu.test(name))throw new Error("Trace role requires an OMP role or alias");
      result.role=name;
    }else throw new Error("Usage: /pifrost trace [last N] [errors] [role alias] [verbose]");
  }
  return result;
}

export function formatPifrostRouteTraces(sessionId: string, options: PifrostTraceDisplayOptions = {}): string {
	const current = (traces.get(sessionId) ?? []).filter(item =>
    (!options.errorsOnly || item.outcome !== "done") &&
    (!options.role || item.logicalModel === options.role || item.logicalModel === "omp-"+options.role));
	if (!current.length) return "Pifrost routing trace: no requests recorded for this session.";
	const shown=Math.min(options.last??10,20);
	const lines = ["Pifrost request trace (newest first; up to "+shown+" requests)", "Gateway request details do not establish that a Bifrost routing rule matched.", ""];
	for (const trace of [...current].reverse().slice(0, shown)) {
    const selection = gatewaySelectionRelativeToPrimary(trace.routeContract, trace.provider, trace.resolvedModel);
    if(options.compact){
      const served=trace.resolvedModel
        ? (trace.provider?trace.provider+"/":"")+trace.resolvedModel
        : "not gateway-confirmed";
      lines.push("  "+trace.logicalModel+" - "+(trace.outcome==="done"?"Completed":"Failed"));
      lines.push("    Model: "+served);
      lines.push("    Route: "+(trace.routeMode??"unverified")+
        (trace.isFallback||((trace.fallbackIndex??0)>0)?" (fallback attempted)":""));
      if(selection==="differs-from-cached-primary") lines.push("    Selection: differs from cached primary; gateway reason unknown (affinity/fallback not inferred)");
      if(trace.routeContract?.mode==="pifrost-compatibility" && trace.routeContract.verification!=="verified-local-snapshot") lines.push("    Contract: local policy verification required");
      if(trace.replayAudit?.reason==="incompatible-history") lines.push("    Reasoning: invalid replay history; no upstream request sent");
      if(trace.outputBudget?.reduced) lines.push("    Output: capped to "+trace.outputBudget.effectiveTokens+" tokens"+
        (trace.outputBudget.requestedTokens ? " (requested "+trace.outputBudget.requestedTokens+")" : "")+
        "; limiting="+trace.outputBudget.limitingSource);
      lines.push("    Cost: "+(money(trace.totalCost)??"unknown")+
        (trace.upstreamLatencyMs===undefined?"":"; upstream "+Math.round(trace.upstreamLatencyMs)+" ms"));
      if(trace.failureCode && trace.failureCode!=="UNKNOWN")lines.push("    Issue: "+trace.failureCode+" - "+inferenceFailureAdvice(trace.failureCode));
      else if(trace.failureClass)lines.push("    Issue: "+trace.failureClass+
        (gatewayFailureAdvice(trace.failureClass)?" - "+gatewayFailureAdvice(trace.failureClass):""));
      else if(trace.outcome!=="done")lines.push("    Issue: no gateway failure classification available");
      lines.push("    More detail: /pifrost trace verbose");
      lines.push("");
      continue;
    }
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
			trace.routeContract ? `contract=${trace.routeContract.mode} policy=${trace.routeContract.verification} members=${trace.routeContract.possibleMembers} unknown-members=${trace.routeContract.unknownMembers} encoders=${trace.routeContract.encodersComplete ? "complete" : "incomplete"} mixed-protocols=${trace.routeContract.mixedProtocols ? "yes" : "no"} affinity-scope=all-known-members` : undefined,
			trace.routeContract?.policyFingerprintPrefix ? `policy-fingerprint=${trace.routeContract.policyFingerprintPrefix}` : undefined,
			selection!=="unverified" ? `selection=${selection} selection-cause=unverified` : undefined,
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
			trace.failureCode ? `failure-code=${trace.failureCode}` : undefined,
			trace.requestDiagnostics ? `history-items=${trace.requestDiagnostics.historyItems} assistant-items=${trace.requestDiagnostics.assistantMessages} reasoning-items=${trace.requestDiagnostics.nativeReasoningItems} chat-reasoning=${trace.requestDiagnostics.chatReasoningMessages} tool-calls=${trace.requestDiagnostics.toolCalls} tool-results=${trace.requestDiagnostics.toolResults} orphan-results=${trace.requestDiagnostics.orphanToolResults} tool-definitions=${trace.requestDiagnostics.toolDefinitions}` : undefined,
			trace.requestDiagnostics?.requestedOutputTokens !== undefined ? `output-requested=${trace.requestDiagnostics.requestedOutputTokens}` : undefined,
			trace.requestDiagnostics?.reasoningEffort ? `reasoning-effort=${trace.requestDiagnostics.reasoningEffort}` : undefined,
			trace.replayAudit ? `replay=${trace.replayAudit.reason} replay-contract=${trace.replayAudit.requirement} assistant-runs=${trace.replayAudit.assistantRuns} replay-required=${trace.replayAudit.runsRequiringReasoning} replay-missing=${trace.replayAudit.missingRequiredRuns} native-reasoning-items=${trace.replayAudit.nativeReasoningItems}` : undefined,
			trace.outputBudget ? `output-effective=${trace.outputBudget.effectiveTokens} output-reduced=${trace.outputBudget.reduced ? "yes" : "no"} output-explicit=${trace.outputBudget.explicit ? "yes" : "no"} output-source=${trace.outputBudget.limitingSource} budget-members=${trace.outputBudget.memberCount} verified-members=${trace.outputBudget.verifiedMemberCount} unknown-members=${trace.outputBudget.unknownMemberCount}` : undefined,
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
		const route = details.filter(item => /^(?:attempt=|route-mode=|exception=|protocol=|requested=|gateway-request=|route-evidence=|wire-boundaries=|fallback=|contract=|policy-fingerprint=|selection=)/u.test(item));
		const gateway = details.filter(item => /^(?:request-id=|trace-id=|http=|failure=|failure-code=|retry-after=|output-started=|cache-hit=|cache-type=)/u.test(item));
		const usage = details.filter(item => /^(?:upstream=|cost=)/u.test(item));
		const reasoning = details.filter(item => /^(?:history-removed=|history-mixed=|history-nested=|history-prose=|history-ambiguous=)/u.test(item));
		const requestShape = details.filter(item => /^(?:history-items=|output-requested=|reasoning-effort=|output-effective=|replay=)/u.test(item));
		lines.push(`  ${trace.logicalModel} - ${trace.outcome === "done" ? "completed" : "failed"}`);
		lines.push(`    Model: served=${served}`);
		lines.push(`    Routing: ${route.join(" ")}`);
		if (gateway.length) lines.push(`    Gateway: ${gateway.join(" ")}`);
		if (usage.length) lines.push(`    Usage: ${usage.join(" ")}`);
		if (reasoning.length) lines.push(`    Reasoning cleanup: ${reasoning.join(" ")}`);
		if (requestShape.length) lines.push(`    Request structure: ${requestShape.join(" ")}`);
		if (trace.failureCode && trace.failureCode !== "UNKNOWN") lines.push(`    Next: ${inferenceFailureAdvice(trace.failureCode)}`);
		else if (trace.failureClass) lines.push(`    Next: ${gatewayFailureAdvice(trace.failureClass)}`);
		lines.push("");
	}
	return lines.join("\n");
}
