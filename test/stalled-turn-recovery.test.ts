import assert from "node:assert/strict";
import test from "node:test";
import {
	createStalledTurnRecoveryCoordinator,
	detectStalledTurn,
	STALLED_TURN_CONTINUATION,
	STALLED_TURN_RECOVERY_MARKER,
	type StalledTurnEnd,
} from "../stalled-turn-recovery.ts";

const toolResult = { role: "toolResult", toolCallId: "call-123", toolName: "bash", content: [{ type: "text", text: "ok" }] };
const user = { role: "user", content: [{ type: "text", text: "Implement the changes" }] };

function ending(text: string, stopReason = "stop"): StalledTurnEnd {
	return {
		messages: [
			user,
			{ role: "assistant", content: [{ type: "toolCall", id: "call-123", name: "bash", arguments: {} }] },
			toolResult,
			{ role: "assistant", stopReason, content: [{ type: "text", text }] },
		],
	};
}

const observed = ending("Need to finish the change. Let's patch the static imports and run tests. </thinking>\n</thinking>");

test("recognizes the CommandCode/DeepSeek planning leak after tool execution", () => {
	assert.equal(detectStalledTurn(observed), "leaked-planning-stop");
	assert.equal(detectStalledTurn(ending("¶think: The test passed.\nNow I need to implement the remaining fixtures.")), "leaked-planning-stop");
	assert.equal(detectStalledTurn(ending("<think> unfinished </think> We should test the implementation.")), "leaked-planning-stop");
});

test("does not restart successful answers, ordinary plans, or quoted transcript snippets", () => {
	assert.equal(detectStalledTurn(ending("All 50 tests passed. Release complete.")), undefined);
	assert.equal(detectStalledTurn(ending("Next we should test the renderer.")), undefined);
	assert.equal(detectStalledTurn(ending("¶think: Let's run tests.\n\n## Final report\nAll work is complete.")), undefined);
	assert.equal(detectStalledTurn(ending("Example text: <thinking>I'll implement this</thinking>. That is a model bug.")), undefined);
});

test("requires a prior tool result and a clean terminal assistant stop", () => {
	const noTool = ending("Let's patch that. </thinking></thinking>");
	assert.equal(detectStalledTurn({ messages: [noTool.messages[0]!, noTool.messages[3]!] }), undefined);
	assert.equal(detectStalledTurn(ending("Let's patch that. </thinking></thinking>", "error")), undefined);
	assert.equal(detectStalledTurn(ending("Let's patch that. </thinking></thinking>", "length")), undefined);
	assert.equal(detectStalledTurn({ ...observed, willContinue: true }), undefined);
	assert.equal(detectStalledTurn({ ...observed, awaitingAsyncWork: true }), undefined);
	assert.equal(detectStalledTurn({ ...observed, messages: [] }), undefined);
	assert.equal(detectStalledTurn({ ...observed, messages: [...observed.messages.slice(0, -1), toolResult] }), undefined);
});

test("does not retransmit completed tool calls or consume messages with tool calls", () => {
	const messages = observed.messages.slice(0, -1);
	assert.equal(detectStalledTurn({
		messages: [...messages, {
			role: "assistant", stopReason: "stop", content: [
				{ type: "text", text: "Let's run the tests. </thinking></thinking>" },
				{ type: "toolCall", id: "next", name: "bash", arguments: {} },
			],
		}],
	}), undefined);
});

test("only one OMP-managed follow-up per human prompt, with clear exhaustion", () => {
	const recovery = createStalledTurnRecoveryCoordinator();
	const sent: string[] = [];
	const warnings: string[] = [];
	const context = {
		sessionId: "real-session-1",
		isMain: true,
		hasQueuedMessages: false,
		sendContinuation: (message: string) => { sent.push(message); },
		notify: (message: string) => { warnings.push(message); },
	};
	assert.equal(recovery.onAgentEnd(observed, context), true);
	assert.deepEqual(sent, [STALLED_TURN_CONTINUATION]);
	assert.match(sent[0]!, /inspect the latest tool results and current workspace state/i);
	assert.match(sent[0]!, /avoid repeating writes, commands, releases/i);
	assert.equal(recovery.onAgentEnd(observed, context), false);
	assert.equal(sent.length, 1);
	assert.match(warnings.at(-1)!, /exhausted/);

	// The extension-generated prompt must NOT reset the latch.
	recovery.onPrompt(context.sessionId, STALLED_TURN_CONTINUATION);
	assert.equal(recovery.onAgentEnd(observed, context), false);
	assert.equal(sent.length, 1);

	recovery.onPrompt(context.sessionId, "Implement a new feature");
	assert.equal(recovery.onAgentEnd(observed, context), true);
	assert.equal(sent.length, 2);
	recovery.onSessionEnd(context.sessionId);
	assert.equal(recovery.onAgentEnd(observed, context), true);
	assert.equal(sent.length, 3);
});

test("queued user actions, background continuation, and subagents always win", () => {
	const recovery = createStalledTurnRecoveryCoordinator();
	let count = 0;
	const base = {
		sessionId: "session-2", isMain: true, hasQueuedMessages: false,
		sendContinuation: () => { count++; },
	};
	assert.equal(recovery.onAgentEnd(observed, { ...base, isMain: false }), false);
	assert.equal(recovery.onAgentEnd(observed, { ...base, hasQueuedMessages: true }), false);
	assert.equal(recovery.onAgentEnd({ ...observed, willContinue: true }, base), false);
	assert.equal(recovery.onAgentEnd({ ...observed, awaitingAsyncWork: true }, base), false);
	assert.equal(count, 0);
});

test("a failed enqueue is bounded, without attempting tool replay", () => {
	const recovery = createStalledTurnRecoveryCoordinator();
	let tries = 0;
	const notifications: string[] = [];
	const ctx = {
		sessionId: "failed-session",
		isMain: true,
		hasQueuedMessages: false,
		sendContinuation: () => { tries++; throw Error("session closing"); },
		notify: (message: string) => { notifications.push(message); },
	};
	assert.equal(recovery.onAgentEnd(observed, ctx), false);
	assert.equal(recovery.onAgentEnd(observed, ctx), false);
	assert.equal(tries, 1);
	assert.match(notifications.join(" "), /could not enqueue/);
});

test("recovery marker cannot be mistaken for another stalled assistant response", () => {
	assert.equal(detectStalledTurn(ending(
		STALLED_TURN_RECOVERY_MARKER + "\nLet's run more tests. </thinking></thinking>"
	)), undefined);
});
