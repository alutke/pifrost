import assert from "node:assert/strict";
import test from "node:test";
import {
	estimatePifrostImageTokens,
	estimatePifrostTextTokens,
	installPifrostTextTokenCounter,
	resolvePifrostImageTokenization,
} from "../omp-context-policy.ts";

function pngBase64(width: number, height: number): string {
	const bytes = Buffer.alloc(26);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
	bytes.writeUInt32BE(13, 8);
	Buffer.from("IHDR").copy(bytes, 12);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	bytes[24] = 8;
	bytes[25] = 2;
	return bytes.toString("base64");
}

test("mirrors OMP 18.8 image-tokenization families for Pifrost candidates", () => {
	assert.deepEqual(
		resolvePifrostImageTokenization({
			id: "gpt-6-astra",
			api: "openai-responses",
			identity: { class: "openai", family: "gpt", revision: "6" },
		}),
		{
			regime: "openai-patch",
			multiplier: 1.2,
			auto: "original",
			low: { maxEdge: 512 },
			high: { maxEdge: 65_535, patchBudget: 2_500 },
			original: { maxEdge: 65_535 },
		},
	);
	assert.deepEqual(
		resolvePifrostImageTokenization({
			id: "claude-opus-4.6",
			api: "openai-completions",
			identity: { class: "anthropic", family: "opus", revision: "4.6" },
		}),
		{ regime: "anthropic-patch", maxEdge: 1_568, maxTokens: 1_568 },
	);
	assert.deepEqual(
		resolvePifrostImageTokenization({
			id: "gemini-3-pro",
			identity: { class: "gemini", family: "pro", revision: "3" },
		}),
		{ regime: "fixed", tokens: 1_120 },
	);
});

test("known image dimensions replace the old fixed 1200-token prewalk reserve", () => {
	const block = { type: "image", data: pngBase64(2_000, 1_000), detail: "original" };
	const tokens = estimatePifrostImageTokens(block, {
		id: "gpt-5.6-sol",
		api: "openai-responses",
		identity: { class: "openai", family: "gpt", revision: "5.6" },
	});
	assert.equal(tokens, 2_420);
	assert.notEqual(tokens, 1_200);
});

test("unknown image dimensions use OMP's bounded OpenAI wire fallback", () => {
	const tokens = estimatePifrostImageTokens(
		{ type: "image", data: "not-an-image", detail: "original" },
		{
			id: "gpt-5.6-sol",
			api: "openai-responses",
			identity: { class: "openai", family: "gpt", revision: "5.6" },
		},
	);
	assert.equal(tokens, 12_000);
});


test("candidate tokenizer family delegates to the OMP host counter when available", () => {
	const seen: Array<{ value: string | string[]; tokenizer: string }> = [];
	installPifrostTextTokenCounter((value, tokenizer) => {
		seen.push({ value, tokenizer });
		return 37;
	});
	try {
		const text = "function_name(arg: 'value') — こんにちは世界";
		assert.equal(estimatePifrostTextTokens(text, { tokenizer: "deepseek-v3" }), 37);
		assert.deepEqual(seen, [{ value: text, tokenizer: "deepseek-v3" }]);
	} finally {
		installPifrostTextTokenCounter(undefined);
	}
});

test("text accounting remains portable when host-native tokenization is unavailable", () => {
	installPifrostTextTokenCounter(undefined);
	const text = "plain ASCII text";
	assert.equal(
		estimatePifrostTextTokens(text, { tokenizer: "deepseek-v3" }),
		Math.ceil(new TextEncoder().encode(text).byteLength / 4),
	);
});
