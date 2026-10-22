/**
 * Narrow, service-free recovery for an OMP tool-using turn that ends with
 * leaked internal planning instead of executing its next tool action.
 *
 * This is NOT a provider retry, a router, or a generic "incomplete task"
 * classifier. It runs only after a successful agent settlement and asks OMP
 * to continue through its own normal prompt flow, at most once per user prompt.
 */
export const STALLED_TURN_RECOVERY_MARKER = "[PIFROST_STALLED_TURN_RECOVERY_V1]";

export const STALLED_TURN_CONTINUATION = [
	STALLED_TURN_RECOVERY_MARKER,
	"Pifrost detected that the previous model response stopped in planning text instead of completing the existing user task.",
	"Continue that SAME task using OMP's normal agent and tools. First inspect the latest tool results and current workspace state to avoid repeating writes, commands, releases or other side effects.",
	"If the task is already complete, give a concise factual completion report instead. Do not invent tool results or claim work was performed unless verified.",
].join("\n");

export interface StalledTurnEnd {
	messages: readonly unknown[];
	willContinue?: boolean;
	awaitingAsyncWork?: boolean;
	/** Host observed cancellation/session rewrite/unknown tool outcome. Never auto-continue. */
	interrupted?: boolean;
	cancelled?: boolean;
	historyRewritePending?: boolean;
	hasUncertainToolOutcome?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : undefined;
}

function assistantText(message: Record<string, unknown>): string {
	const content = message.content;
	if (!Array.isArray(content)) return "";
	return content
		.map(part => {
			const item = record(part);
			return item?.type === "text" && typeof item.text === "string" ? item.text : "";
		})
		.join("\n");
}

function includesToolCall(message: Record<string, unknown>): boolean {
	return Array.isArray(message.content) && message.content.some(part => {
		const item = record(part);
		return item?.type === "toolCall" || item?.type === "tool_call" || item?.type === "function_call";
	});
}

/** A tool call whose id has not received a complete OMP toolResult may already
 * have committed externally; do not prompt another turn based on a broken log. */
export function uncertainToolOutcome(messages: readonly unknown[]): boolean {
  const pending = new Set<string>();
  for (const raw of messages) {
    const item=record(raw);
    if(!item)continue;
    if(item.role==="assistant" && Array.isArray(item.content)) {
      for(const part of item.content){
        const tool=record(part);
        if(tool && (tool.type==="toolCall"||tool.type==="tool_call"||tool.type==="function_call")){
          const id=typeof tool.id==="string" ? tool.id : typeof tool.call_id==="string" ? tool.call_id : undefined;
          if(!id) return true;
          pending.add(id);
        }
      }
    }
    if(item.role==="toolResult"||item.role==="tool_result"||item.role==="function_call_output"){
      const id=typeof item.toolCallId==="string" ? item.toolCallId :
        typeof item.tool_call_id==="string" ? item.tool_call_id :
        typeof item.call_id==="string" ? item.call_id : undefined;
      if(!id || !pending.has(id))return true;
      pending.delete(id);
      // A tool error after dispatch does not prove whether a remote mutation
      // succeeded. Scope this to uncertain transport outcomes, not ordinary
      // application errors (which may be safely diagnosed interactively).
      if(item.isError===true){
        const value=Array.isArray(item.content) ? item.content.map(v=>{
          const row=record(v);return typeof row?.text==="string" ? row.text : "";
        }).join(" ") : typeof item.content==="string" ? item.content : "";
        if(/(?:connection reset|connection closed|broken pipe|socket hang up|timeout|timed out|upstream idle|econnreset|etimedout|response lost|uncertain outcome)/iu.test(value))return true;
      }
    }
  }
  return pending.size>0;
}

/** Detect only a high-confidence failure signature, never ordinary task planning. */
export function detectStalledTurn(event: StalledTurnEnd): "leaked-planning-stop" | undefined {
	if (event.willContinue || event.awaitingAsyncWork || event.interrupted || event.cancelled ||
    event.historyRewritePending || event.hasUncertainToolOutcome || !event.messages.length ||
    uncertainToolOutcome(event.messages)) return undefined;

	const last = record(event.messages.at(-1));
	if (!last || last.role !== "assistant" || last.stopReason !== "stop" || includesToolCall(last)) {
		return undefined;
	}
	// An explicitly tool-using run is essential: don't relaunch explanatory,
	// research-only or plan-only turns just because they mention future steps.
	const recent = event.messages.slice(-24, -1);
	if (!recent.some(message => {
		const item = record(message);
		return item?.role === "toolResult" || item?.role === "tool_result";
	})) return undefined;

	const tail = assistantText(last).trim().slice(-3500);
	if (!tail || tail.includes(STALLED_TURN_RECOVERY_MARKER)) return undefined;
	const closingThinkingCount = (tail.match(/<\/thinking>/giu) ?? []).length;
	const leakedReasoning =
		closingThinkingCount >= 2 ||
		/<think>[\s\S]*<\/think>/iu.test(tail) ||
		/(?:^|\n)\s*¶think:/iu.test(tail);
	if (!leakedReasoning) return undefined;

	// Planning must occur near the END of the response (before extraneous
	// thinking-end tags), not solely inside an archived transcript or quote.
	const withoutClosers = tail.replace(/(?:\s*<\/thinking>\s*)+$/giu, "").trim();
	const ending = withoutClosers.slice(-650);
	const planning = /\b(?:let(?:'s| us)|i(?:'ll| will| should| need to)|we(?:'ll| will| should| need to)|next(?: i| we)?|now(?: i| we)?)\s+(?:start|write|patch|add|implement|run|check|fix|inspect|test|verify|update|review|build|commit|push|do|proceed|finish|measure|retest|remove|read)\b/giu;
	const matches = [...ending.matchAll(planning)];
	const lastPlan = matches.at(-1);
	if (!lastPlan || lastPlan.index === undefined) return undefined;
	const afterPlan = ending.slice(lastPlan.index + lastPlan[0].length);
	// Reject genuine final reports that merely quote earlier planning output.
	if (/(?:^|\n)\s*(?:#{1,5}\s*(?:final|summary|report|results|outcome)\b|all work is complete\b)/iu.test(afterPlan)) return undefined;
	if (afterPlan.length > 180) return undefined;
	return "leaked-planning-stop";
}

/** A stall is only an observation, never proof that another turn is safe. */
export type StalledTurnMode = "auto" | "notice" | "off";
/** Auto is the default. Invalid non-empty values fail safe to advisory mode. */
export function stalledTurnMode(value: string | undefined): StalledTurnMode {
	const configured = value?.trim().toLowerCase();
	if (!configured || ["auto", "enabled", "enable", "on", "yes", "true", "1"].includes(configured)) return "auto";
	if (["off", "disabled", "disable", "false", "no", "0"].includes(configured)) return "off";
	// Explicit notice/manual mode, or an unrecognised setting, stays advisory.
	return "notice";
}
export interface StalledTurnRecoveryContext {
	sessionId: string;
	isMain: boolean;
	hasQueuedMessages: boolean;
	hasRunningAsyncWork?: boolean;
	hasUnknownJobState?: boolean;
	isCancelled?: boolean;
	historyRewritePending?: boolean;
	hasUncertainToolOutcome?: boolean;
	isIdle?: boolean;
	sendContinuation: (message: string) => void;
	notify?: (message: string, level: "warning" | "error") => void;
}
export type StalledTurnState = "none" | "pending" | "consumed";

/**
 * Per-session, per-human-prompt observation and one-shot continuation gate.
 * Default: one automatic OMP-owned follow-up after a high-confidence stall.
 * Explicit "off" disables detection, notifications and follow-ups; "notice"
 * retains the user-confirmed interactive OMP flow.
 */
export function createStalledTurnRecoveryCoordinator(mode: StalledTurnMode = "auto") {
	const attempted = new Set<string>();
	const pending = new Set<string>();

	const available = (ctx: StalledTurnRecoveryContext): boolean =>
		ctx.isMain && Boolean(ctx.sessionId) && !ctx.hasQueuedMessages &&
		ctx.hasRunningAsyncWork !== true && ctx.hasUnknownJobState !== true &&
    ctx.isCancelled !== true && ctx.historyRewritePending !== true &&
    ctx.hasUncertainToolOutcome !== true && ctx.isIdle !== false;

	const continuePending = (ctx: StalledTurnRecoveryContext): boolean => {
		if (mode === "off" || !available(ctx) || !pending.has(ctx.sessionId) || attempted.has(ctx.sessionId)) return false;
		// Consume before queueing so a synchronous OMP event cannot duplicate it.
		attempted.add(ctx.sessionId);
		pending.delete(ctx.sessionId);
		try {
			ctx.sendContinuation(STALLED_TURN_CONTINUATION);
			ctx.notify?.(mode === "auto"
				? "Pifrost: model stopped in leaked planning; queued one OMP-managed continuation. Check workspace state before any side effects."
				: "Pifrost: one OMP-managed continuation queued after approval. Check workspace state before any side effects.", "warning");
			return true;
		} catch {
			ctx.notify?.("Pifrost: could not enqueue continuation; no automatic retry. Inspect the session before proceeding.", "error");
			return false;
		}
	};

	return {
		mode,
		onPrompt(sessionId: string, prompt: string): void {
			if (typeof prompt === "string" && !prompt.includes(STALLED_TURN_RECOVERY_MARKER)) {
				attempted.delete(sessionId);
				pending.delete(sessionId);
			}
		},
		onHistoryChanged(): void {
      // OMP may change session IDs while switching trees. All pending observations
      // belong to an old prefix, regardless of which session is now active.
      pending.clear();
    },
    onSessionInterrupt(sessionId: string): void {
      // Do not reset attempted: a cancelled turn may have committed a write.
      pending.delete(sessionId);
    },
		onSessionEnd(sessionId: string): void {
			attempted.delete(sessionId);
			pending.delete(sessionId);
		},
		status(sessionId: string): StalledTurnState {
			return pending.has(sessionId) ? "pending" : attempted.has(sessionId) ? "consumed" : "none";
		},
		continuePending,
		onAgentEnd(event: StalledTurnEnd, ctx: StalledTurnRecoveryContext): boolean {
			if (mode === "off") return false;
			if (!ctx.isMain || !ctx.sessionId || ctx.hasQueuedMessages || ctx.hasRunningAsyncWork === true ||
        ctx.hasUnknownJobState === true || ctx.isCancelled === true ||
        ctx.historyRewritePending === true || ctx.hasUncertainToolOutcome === true || !detectStalledTurn(event)) return false;
			if (attempted.has(ctx.sessionId)) {
				ctx.notify?.("Pifrost: another planning leak after one continuation. Recovery exhausted; inspect /pifrost trace or use a new session.", "error");
				return false;
			}
			if (!pending.has(ctx.sessionId)) {
				pending.add(ctx.sessionId);
				if (mode !== "auto") {
					ctx.notify?.("Pifrost: possible unfinished planning detected; no action taken. Inspect the workspace, then use /pifrost stalled continue to approve a single OMP-managed continuation.", "warning");
				}
			}
			// Automatic mode is the default but still bounded to one settled,
			// tool-using OMP main-agent turn, with no queued or async work.
			// Advisory mode requires separate explicit user confirmation.
			return mode === "auto" ? continuePending(ctx) : false;
		},
	};
}
