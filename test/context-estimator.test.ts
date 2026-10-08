import assert from "node:assert/strict";
import test from "node:test";

import type { Context } from "@oh-my-pi/pi-ai";

import {
	createApproximateContextTokenizer,
	estimateOmpContextInputTokens,
} from "../context-estimator.ts";

test("semantic context estimate ignores large tool-result details that are not prompt content", () => {
	const context = {
		systemPrompt: ["system"],
		messages: [
			{
				role: "user",
				content: "inspect the failure",
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "small visible result" }],
				details: { raw: "x".repeat(4_000_000) },
				isError: false,
				timestamp: 2,
			},
		],
		tools: [{
			name: "read",
			description: "Read a file",
			parameters: { type: "object", properties: { path: { type: "string" } } },
		}],
	} as unknown as Context;

	const estimate = estimateOmpContextInputTokens(context, createApproximateContextTokenizer());
	assert.ok(estimate > 0);
	assert.ok(estimate < 1_000, `unexpected semantic estimate: ${estimate}`);

	const rawObjectBytes = new TextEncoder().encode(JSON.stringify(context)).byteLength;
	assert.ok(rawObjectBytes > 3_900_000);
});

test("provider usage anchor owns the established prefix and only the tail is locally estimated", () => {
	const context = {
		systemPrompt: ["this prefix is already represented by provider usage"],
		messages: [
			{
				role: "user",
				content: "first turn",
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "answer" }],
				api: "openai-completions",
				provider: "test",
				model: "test",
				usage: {
					input: 10_000,
					output: 2_000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 12_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
			{
				role: "user",
				content: "tail ".repeat(80),
				timestamp: 3,
			},
		],
		tools: [{
			name: "large-tool",
			description: "z".repeat(20_000),
			parameters: { type: "object", properties: {} },
		}],
	} as unknown as Context;

	const estimate = estimateOmpContextInputTokens(context, createApproximateContextTokenizer());
	assert.ok(estimate >= 12_000);
	assert.ok(estimate < 12_500, `anchor should prevent recounting established framing: ${estimate}`);
});

test("history rewrite marker rejects a predated retained-tail usage anchor", () => {
	const context = {
		messages: [
			{
				role: "user",
				content: "compacted replacement",
				historyRewriteAt: 2,
				timestamp: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "retained tail answer" }],
				api: "openai-completions",
				provider: "test",
				model: "test",
				usage: {
					input: 900_000,
					output: 10_000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 910_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				// OMP can retain a tail whose timestamp predates the rewrite commit.
				timestamp: 1,
			},
		],
	} as unknown as Context;

	const estimate = estimateOmpContextInputTokens(context, createApproximateContextTokenizer());
	assert.ok(estimate < 100, `predated retained-tail anchor survived rewrite: ${estimate}`);
});


test("pure-output usage is not trusted as a provider prompt anchor", () => {
	const context = {
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "locally counted answer" }],
				api: "openai-completions",
				provider: "test",
				model: "test",
				usage: {
					input: 0,
					output: 900_000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 900_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 1,
			},
			{
				role: "user",
				content: "small tail",
				timestamp: 2,
			},
		],
	} as unknown as Context;

	const estimate = estimateOmpContextInputTokens(context, createApproximateContextTokenizer());
	assert.ok(estimate < 100, `pure-output usage was incorrectly trusted as context: ${estimate}`);
});


test("physical-model anchor filter does not reuse usage from a different fallback member", () => {
	const context = {
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "prior physical response" }],
				api: "openai-completions",
				provider: "bifrost",
				model: "omp-default",
				upstreamModel: "provider/model-a",
				usage: {
					input: 900_000,
					output: 10_000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 910_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 1,
			},
			{ role: "user", content: "small tail", timestamp: 2 },
		],
	} as unknown as Context;

	const tokenizer = createApproximateContextTokenizer();
	const sameModel = estimateOmpContextInputTokens(context, tokenizer, {
		anchorModelIds: ["provider/model-a"],
	});
	const differentModel = estimateOmpContextInputTokens(context, tokenizer, {
		anchorModelIds: ["provider/model-b"],
	});
	assert.ok(sameModel >= 910_000);
	assert.ok(differentModel < 100, `different physical member reused stale usage: ${differentModel}`);
});


test("full local recount includes opaque reasoning and server-tool replay payloads", () => {
	const signature = "s".repeat(20_000);
	const redacted = "r".repeat(12_000);
	const serverPayload = { type: "web_search_result", opaque: "o".repeat(8_000) };
	const context = {
		messages: [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "brief thought", thinkingSignature: signature },
					{ type: "redactedThinking", data: redacted },
					{ type: "anthropicServerTool", block: serverPayload },
				],
				api: "openai-completions",
				provider: "bifrost",
				model: "omp-default",
				upstreamModel: "provider/model-a",
				usage: {
					input: 50_000,
					output: 1_000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 51_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 1,
			},
			{ role: "user", content: "next turn", timestamp: 2 },
		],
	} as unknown as Context;

	const estimate = estimateOmpContextInputTokens(context, createApproximateContextTokenizer(), {
		// Force a full local recount: model-a usage cannot anchor model-b.
		anchorModelIds: ["provider/model-b"],
	});
	assert.ok(estimate > 10_000, `opaque replay payloads were undercounted: ${estimate}`);
});
