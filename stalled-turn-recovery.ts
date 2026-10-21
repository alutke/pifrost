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

/** Detect only a high-confidence failure signature, never ordinary task planning. */
export function detectStalledTurn(event: StalledTurnEnd): "leaked-planning-stop" | undefined {
	if (event.willContinue || event.awaitingAsyncWork || !event.messages.length) return undefined;

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
export type StalledTurnMode = "notice" | "auto";
export function stalledTurnMode(value: string | undefined): StalledTurnMode {
	return value?.trim().toLowerCase() === "auto" ? "auto" : "notice";
}
export interface StalledTurnRecoveryContext {
	sessionId: string;
	isMain: boolean;
	hasQueuedMessages: boolean;
	hasRunningAsyncWork?: boolean;
	isIdle?: boolean;
	sendContinuation: (message: string) => void;
	notify?: (message: string, level: "warning" | "error") => void;
}
export type StalledTurnState = "none" | "pending" | "consumed";

/**
 * Per-session, per-human-prompt observation and one-shot continuation gate.
 * Default: notice only. A manual continuation requires explicit approval from
 * the interactive OMP command, checked again after the approval dialog.
 */
export function createStalledTurnRecoveryCoordinator(mode: StalledTurnMode = "notice") {
	const attempted = new Set<string>();
	const pending = new Set<string>();

	const available = (ctx: StalledTurnRecoveryContext): boolean =>
		ctx.isMain && Boolean(ctx.sessionId) && !ctx.hasQueuedMessages &&
		ctx.hasRunningAsyncWork !== true && ctx.isIdle !== false;

	const continuePending = (ctx: StalledTurnRecoveryContext): boolean => {
		if (!available(ctx) || !pending.has(ctx.sessionId) || attempted.has(ctx.sessionId)) return false;
		// Consume before queueing so a synchronous OMP event cannot duplicate it.
		attempted.add(ctx.sessionId);
		pending.delete(ctx.sessionId);
		try {
			ctx.sendContinuation(STALLED_TURN_CONTINUATION);
			ctx.notify?.("Pifrost: one OMP-managed continuation queued after approval. Check workspace state before any side effects.", "warning");
			return true;
		} catch {
			ctx.notify?.("Pifrost: could not enqueue continuation; no automatic retry. Inspect the session before proceeding.", "error");
			return false;
		}
	};

	return {
		onPrompt(sessionId: string, prompt: string): void {
			if (typeof prompt === "string" && !prompt.includes(STALLED_TURN_RECOVERY_MARKER)) {
				attempted.delete(sessionId);
				pending.delete(sessionId);
			}
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
			if (!available(ctx) || !detectStalledTurn(event)) return false;
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
			// Explicit opt-in auto mode retains the former bounded behaviour,
			// but only when OMP has no pending work and is idle. Notice-only is
			// intentionally the default for non-idempotent tool workflows.
			return mode === "auto" ? continuePending(ctx) : false;
		},
	};
}
