import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@oh-my-pi/pi-ai";

import type { DynamicRoutePlan } from "../dynamic-routing.ts";
import {
	bifrostAttemptExtraBody,
	createPifrostAttemptModelSpec,
	runPifrostProtocolPlan,
	type PifrostAttemptStream,
	type PifrostProtocolOutput,
} from "../multi-protocol-routing.ts";

function logicalModel(): Model {
	return {
		id: "omp-default",
		name: "omp-default",
		provider: "bifrost",
		api: "openai-completions",
		baseUrl: "http://bifrost/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		compatConfig: {
			supportsReasoningEffort: true,
			supportsToolChoice: true,
			supportsUsageInStreaming: true,
		},
		compat: {
			supportsDeveloperRole: true,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
			disableReasoningOnToolChoice: false,
		},
		identity: {
			provider: "bifrost",
			model: "omp-default",
		},
	} as unknown as Model;
}

function member(reference: string, protocol: "openai-completions" | "openai-responses") {
	return {
		reference,
		resolvedModelId: reference,
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		input: ["text"] as ("text" | "image")[],
		reasoning: true,
		supportsTools: true,
		protocols: [protocol],
		compat: {
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
		},
	};
}

function plan(): DynamicRoutePlan {
	const muse = member("opencode-go/muse-spark-1.3-contributor", "openai-responses");
	const command = member("CommandCode GOAT/deepseek/deepseek-v4.1-flash", "openai-completions");
	const deepseek = member("deepseek/deepseek-flash", "openai-completions");
	return {
		logicalModel: "omp-default",
		estimatedInputTokens: 10_000,
		outputReserveTokens: 64_000,
		outputReserveExplicit: false,
		requiredContextTokens: 74_000,
		attempts: [
			{ protocol: "openai-responses", primary: muse.reference, fallbacks: [], members: [muse] },
			{
				protocol: "openai-completions",
				primary: command.reference,
				fallbacks: [deepseek.reference],
				members: [command, deepseek],
			},
		],
		excluded: [],
	};
}

function assistant(model: string, api: "openai-completions" | "openai-responses", stopReason: "stop" | "error"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api,
		provider: "bifrost",
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function eventStream(events: readonly AssistantMessageEvent[]): PifrostAttemptStream {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
	};
}

function failedAttempt(model: string, api: "openai-completions" | "openai-responses"): PifrostAttemptStream {
	const partial = assistant(model, api, "stop");
	const error = assistant(model, api, "error");
	error.errorMessage = "synthetic pre-output failure";
	return eventStream([
		{ type: "start", partial },
		{ type: "error", reason: "error", error },
	]);
}

function successfulAttempt(model: string, api: "openai-completions" | "openai-responses"): PifrostAttemptStream {
	const partial = assistant(model, api, "stop");
	return eventStream([
		{ type: "start", partial },
		{ type: "done", reason: "stop", message: partial },
	]);
}

function outputCollector() {
	const events: AssistantMessageEvent[] = [];
	let failure: unknown;
	const output: PifrostProtocolOutput = {
		push(event) {
			events.push(event);
		},
		fail(error) {
			failure = error;
		},
		forwardLocalWorkFrom() {},
	};
	return {
		events,
		output,
		failure: () => failure,
	};
}

test("attempt specs use native protocol endpoints and preserve same-protocol Bifrost fallbacks", () => {
	const logical = logicalModel();
	const route = plan();
	const responses = createPifrostAttemptModelSpec(logical, route.attempts[0]!);
	const chat = createPifrostAttemptModelSpec(logical, route.attempts[1]!);

	assert.equal(responses.api, "openai-responses");
	assert.equal(responses.id, "opencode-go/muse-spark-1.3-contributor");
	assert.equal(chat.api, "openai-completions");
	assert.equal(chat.id, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	assert.deepEqual(
		((chat.compat as Record<string, unknown> | undefined)?.extraBody as Record<string, unknown> | undefined)?.fallbacks,
		["deepseek/deepseek-flash"],
	);
	assert.equal(bifrostAttemptExtraBody(route.attempts[0]!), undefined);
});

test("pre-output Responses failure falls through to the Chat protocol group", async () => {
	const logical = logicalModel();
	const route = plan();
	const dispatched: Array<{ protocol: string; model: string }> = [];
	const collected = outputCollector();

	await runPifrostProtocolPlan(logical, route, collected.output, (attempt) => {
		dispatched.push({ protocol: attempt.protocol, model: attempt.primary });
		return attempt.protocol === "openai-responses"
			? failedAttempt(attempt.primary, "openai-responses")
			: successfulAttempt(attempt.primary, "openai-completions");
	});

	assert.equal(collected.failure(), undefined);
	assert.deepEqual(dispatched, [
		{ protocol: "openai-responses", model: "opencode-go/muse-spark-1.3-contributor" },
		{ protocol: "openai-completions", model: "CommandCode GOAT/deepseek/deepseek-v4.1-flash" },
	]);
	assert.deepEqual(collected.events.map((event) => event.type), ["start", "done"]);
	const done = collected.events.at(-1);
	assert.equal(done?.type, "done");
	if (done?.type === "done") {
		assert.equal(done.message.model, "omp-default");
		assert.equal(done.message.api, "openai-completions");
		assert.equal(done.message.upstreamModel, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	}
});

test("once a Responses attempt emits model output Pifrost never replays on Chat", async () => {
	const logical = logicalModel();
	const route = plan();
	const dispatched: string[] = [];
	const collected = outputCollector();

	await runPifrostProtocolPlan(logical, route, collected.output, (attempt) => {
		dispatched.push(attempt.protocol);
		if (attempt.protocol === "openai-completions") {
			return successfulAttempt(attempt.primary, "openai-completions");
		}
		const partial = assistant(attempt.primary, "openai-responses", "stop");
		partial.content = [{ type: "thinking", thinking: "" }];
		const error = assistant(attempt.primary, "openai-responses", "error");
		error.errorMessage = "failed after output began";
		return eventStream([
			{ type: "start", partial },
			{ type: "thinking_start", contentIndex: 0, partial },
			{ type: "error", reason: "error", error },
		]);
	});

	assert.equal(collected.failure(), undefined);
	assert.deepEqual(dispatched, ["openai-responses"]);
	assert.deepEqual(collected.events.map((event) => event.type), ["start", "thinking_start", "error"]);
	const error = collected.events.at(-1);
	assert.equal(error?.type, "error");
	if (error?.type === "error") {
		assert.equal(error.error.model, "omp-default");
		assert.equal(error.error.upstreamModel, "opencode-go/muse-spark-1.3-contributor");
	}
});
