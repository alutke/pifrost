import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ModelSpec } from "@oh-my-pi/pi-ai";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import { buildPifrostTransportModel } from "../transport-model.ts";

const cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 };

test("transport materializer uses OMP policy resolution for OpenAI Responses", () => {
	const spec = {
		id: "gpt-5.4",
		name: "OpenAI: GPT 5.4 (latest)",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text", "image"],
		supportsTools: true,
		cost,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
	} satisfies ModelSpec<"openai-responses">;

	const policy = resolveModelPolicy(spec);
	const model = buildPifrostTransportModel(spec);

	assert.deepEqual(model.identity, policy.identity);
	assert.deepEqual(model.compat, policy.compat);
	assert.deepEqual(model.thinking, policy.thinking);
	assert.equal(model.compatConfig, undefined);
	assert.equal(model.name, "GPT 5.4");
	assert.equal(model.reasoning, spec.reasoning || policy.thinking !== undefined);
	assert.equal(model.supportsComputerUse, true);

	if (typeof policy.catalog.omitMaxOutputTokens === "boolean") {
		assert.equal(model.omitMaxOutputTokens, policy.catalog.omitMaxOutputTokens);
	}
});

test("transport materializer preserves request policy and tokenizer for OpenAI-compatible chat", () => {
	const spec = {
		id: "deepseek-chat",
		name: "DeepSeek Chat",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com/v1",
		reasoning: true,
		input: ["text"],
		supportsTools: true,
		cost,
		contextWindow: 128_000,
		maxTokens: 8_192,
	} satisfies ModelSpec<"openai-completions">;

	const policy = resolveModelPolicy(spec);
	const model = buildPifrostTransportModel(spec);

	assert.deepEqual(model.identity, policy.identity);
	assert.deepEqual(model.compat, policy.compat);
	assert.deepEqual(model.thinking, policy.thinking);
	assert.equal(model.tokenizer, "deepseek-v3");
	assert.equal(model.supportsComputerUse, false);
});

test("runtime extension avoids compiled-OMP-broken catalog root subpaths", () => {
	const native = readFileSync(new URL("../native.ts", import.meta.url), "utf8");
	const materializer = readFileSync(new URL("../transport-model.ts", import.meta.url), "utf8");

	assert.doesNotMatch(native, /@oh-my-pi\/pi-catalog\/build/u);
	assert.doesNotMatch(materializer, /@oh-my-pi\/pi-catalog\/build/u);
	assert.doesNotMatch(materializer, /from\s+["']@oh-my-pi\/pi-catalog["']/u);
	assert.match(materializer, /@oh-my-pi\/pi-catalog\/compat\/resolve/u);
});
