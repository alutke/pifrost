import assert from "node:assert/strict";
import test from "node:test";
import {
	createStalledTurnRecoveryCoordinator,
	detectStalledTurn,
	stalledTurnMode,
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

test("default auto mode permits only one OMP follow-up per human prompt", () => {
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
	const recovery = createStalledTurnRecoveryCoordinator("auto");
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

test("R2-01 explicit notice mode never queues without manual approval", () => {
	assert.equal(stalledTurnMode(undefined), "auto");
	assert.equal(stalledTurnMode(""), "auto");
	assert.equal(stalledTurnMode("AUTO"), "auto");
	assert.equal(stalledTurnMode("notice"), "notice");
	for (const setting of ["1", "yes", "true", "on", "enabled", "enable"]) {
		assert.equal(stalledTurnMode(setting), "auto", setting);
	}
	assert.equal(stalledTurnMode("manual"), "notice");
	assert.equal(stalledTurnMode("invalid-value"), "notice");
	for (const setting of ["off", "OFF", "disable", "disabled", "false", "no", "0"]) {
		assert.equal(stalledTurnMode(setting), "off", setting);
	}
	const recovery = createStalledTurnRecoveryCoordinator("notice");
	let sends=0;
	const notices: string[]=[];
	const ctx={ sessionId:"manual-1",isMain:true,hasQueuedMessages:false,
		sendContinuation:()=>{sends++;},notify:(message:string)=>notices.push(message) };
	assert.equal(recovery.onAgentEnd(observed,ctx),false);
	assert.equal(recovery.status(ctx.sessionId),"pending");
	assert.equal(sends,0);
	assert.equal(notices.length,1);
	assert.match(notices[0]!, /no action taken/i);
	assert.equal(recovery.onAgentEnd(observed,ctx),false);
	assert.equal(notices.length,1,"duplicate terminal events must not spam notices");
	assert.equal(recovery.continuePending({...ctx,isIdle:false}),false);
	assert.equal(recovery.continuePending({...ctx,hasRunningAsyncWork:true}),false);
	assert.equal(sends,0);
	assert.equal(recovery.continuePending({...ctx,isIdle:true}),true);
	assert.equal(sends,1);
	assert.equal(recovery.status(ctx.sessionId),"consumed");
	assert.equal(recovery.continuePending(ctx),false);
	assert.equal(sends,1);
});
test("R2-02 user cancellation leaves pending observation, human prompt and shutdown clear it", () => {
	const recovery=createStalledTurnRecoveryCoordinator("notice");
	const ctx={sessionId:"manual-2",isMain:true,hasQueuedMessages:false,sendContinuation:()=>{}};
	recovery.onAgentEnd(observed,ctx);
	assert.equal(recovery.status(ctx.sessionId),"pending");
	recovery.onPrompt(ctx.sessionId,STALLED_TURN_CONTINUATION);
	assert.equal(recovery.status(ctx.sessionId),"pending");
	recovery.onPrompt(ctx.sessionId,"New user task");
	assert.equal(recovery.status(ctx.sessionId),"none");
	recovery.onAgentEnd(observed,ctx);
	recovery.onSessionEnd(ctx.sessionId);
	assert.equal(recovery.status(ctx.sessionId),"none");
});
test("R2-03 auto mode refuses queued messages, live async work or non-idle OMP", () => {
	const recovery=createStalledTurnRecoveryCoordinator("auto");
	let sent=0;
	const ctx={sessionId:"auto-safety",isMain:true,hasQueuedMessages:false,isIdle:false,
		sendContinuation:()=>{sent++;}};
	assert.equal(recovery.onAgentEnd(observed,ctx),false);
	assert.equal(recovery.status(ctx.sessionId),"pending");
	assert.equal(recovery.onAgentEnd(observed,{...ctx,isIdle:true,hasRunningAsyncWork:true}),false);
	assert.equal(recovery.onAgentEnd(observed,{...ctx,isIdle:true,hasQueuedMessages:true}),false);
	assert.equal(sent,0);
	assert.equal(recovery.continuePending({...ctx,isIdle:true}),true);
	assert.equal(sent,1);
});

test("R3-01 off mode suppresses detection, UI notices and OMP follow-ups", () => {
	const recovery = createStalledTurnRecoveryCoordinator("off");
	const notices: string[] = [], sent: string[] = [];
	const ctx = {
		sessionId: "disabled-session", isMain: true,
		hasQueuedMessages: false, isIdle: true,
		sendContinuation: (message: string) => { sent.push(message); },
		notify: (message: string) => { notices.push(message); },
	};
	assert.equal(recovery.mode, "off");
	assert.equal(recovery.onAgentEnd(observed, ctx), false);
	assert.equal(recovery.status(ctx.sessionId), "none");
	assert.equal(recovery.continuePending(ctx), false);
	recovery.onPrompt(ctx.sessionId, "another prompt");
	assert.equal(recovery.onAgentEnd(observed, ctx), false);
	assert.deepEqual(sent, []);
	assert.deepEqual(notices, []);
});
test("R3-02 default auto never starts while queue or async work is active and does not duplicate a follow-up", () => {
	const recovery = createStalledTurnRecoveryCoordinator();
	const messages: string[] = [];
	const ctx = {
		sessionId: "default-auto-guards", isMain: true,
		hasQueuedMessages: false, hasRunningAsyncWork: false,
		sendContinuation: (message: string) => messages.push(message),
	};
	assert.equal(recovery.mode, "auto");
	assert.equal(recovery.onAgentEnd(observed, {...ctx,hasQueuedMessages:true}), false);
	assert.equal(recovery.onAgentEnd(observed, {...ctx,hasRunningAsyncWork:true}), false);
	assert.equal(recovery.onAgentEnd({...observed,willContinue:true}, ctx), false);
	assert.equal(recovery.onAgentEnd({...observed,awaitingAsyncWork:true}, ctx), false);
	assert.equal(recovery.onAgentEnd(observed, ctx), true);
	assert.equal(recovery.onAgentEnd(observed, ctx), false);
	assert.deepEqual(messages, [STALLED_TURN_CONTINUATION]);
});
