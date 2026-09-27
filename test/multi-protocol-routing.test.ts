import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, ModelSpec } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

import type { DynamicRoutePlan } from "../dynamic-routing.ts";
import {
	bifrostAttemptExtraBody,
	buildPifrostAttemptModel,
	streamPifrostProtocolPlan,
} from "../multi-protocol-routing.ts";

function logicalModel() {
	return buildModel({
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
		compat: {
			supportsReasoningEffort: true,
			supportsToolChoice: true,
			supportsUsageInStreaming: true,
		},
	} as ModelSpec<"openai-completions">);
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

function failedAttempt(model: string, api: "openai-completions" | "openai-responses"): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const partial = assistant(model, api, "stop");
	stream.push({ type: "start", partial });
	const error = assistant(model, api, "error");
	error.errorMessage = "synthetic pre-output failure";
	stream.push({ type: "error", reason: "error", error });
	return stream;
}

function successfulAttempt(model: string, api: "openai-completions" | "openai-responses"): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const partial = assistant(model, api, "stop");
	stream.push({ type: "start", partial });
	stream.push({ type: "done", reason: "stop", message: partial });
	return stream;
}

test("attempt models use native protocol endpoints and preserve same-protocol Bifrost fallbacks", () => {
	const logical = logicalModel();
	const route = plan();
	const responses = buildPifrostAttemptModel(logical, route.attempts[0]!);
	const chat = buildPifrostAttemptModel(logical, route.attempts[1]!);

	assert.equal(responses.api, "openai-responses");
	assert.equal(responses.id, "opencode-go/muse-spark-1.3-contributor");
	assert.equal(chat.api, "openai-completions");
	assert.equal(chat.id, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	const chatCompat = (chat as import("@oh-my-pi/pi-ai").Model<"openai-completions">).compat;
	assert.deepEqual((chatCompat.extraBody as Record<string, unknown> | undefined)?.fallbacks, ["deepseek/deepseek-flash"]);
	assert.equal(bifrostAttemptExtraBody(route.attempts[0]!), undefined);
});

test("pre-output Responses failure falls through to the Chat protocol group", async () => {
	const logical = logicalModel();
	const route = plan();
	const dispatched: Array<{ protocol: string; model: string }> = [];
	const stream = streamPifrostProtocolPlan(logical, route, (attempt, transportModel) => {
		dispatched.push({ protocol: attempt.protocol, model: transportModel.id });
		return attempt.protocol === "openai-responses"
			? failedAttempt(transportModel.id, "openai-responses")
			: successfulAttempt(transportModel.id, "openai-completions");
	});

	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);

	assert.deepEqual(dispatched, [
		{ protocol: "openai-responses", model: "opencode-go/muse-spark-1.3-contributor" },
		{ protocol: "openai-completions", model: "CommandCode GOAT/deepseek/deepseek-v4.1-flash" },
	]);
	assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
	const done = events.at(-1);
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
	const stream = streamPifrostProtocolPlan(logical, route, (attempt, transportModel) => {
		dispatched.push(attempt.protocol);
		if (attempt.protocol === "openai-completions") {
			return successfulAttempt(transportModel.id, "openai-completions");
		}
		const inner = new AssistantMessageEventStream();
		const partial = assistant(transportModel.id, "openai-responses", "stop");
		partial.content = [{ type: "thinking", thinking: "" }];
		inner.push({ type: "start", partial });
		inner.push({ type: "thinking_start", contentIndex: 0, partial });
		const error = assistant(transportModel.id, "openai-responses", "error");
		error.errorMessage = "failed after output began";
		inner.push({ type: "error", reason: "error", error });
		return inner;
	});

	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);

	assert.deepEqual(dispatched, ["openai-responses"]);
	assert.deepEqual(events.map((event) => event.type), ["start", "thinking_start", "error"]);
	const error = events.at(-1);
	assert.equal(error?.type, "error");
	if (error?.type === "error") {
		assert.equal(error.error.model, "omp-default");
		assert.equal(error.error.upstreamModel, "opencode-go/muse-spark-1.3-contributor");
	}
});
