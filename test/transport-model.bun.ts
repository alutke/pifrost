import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore -- bun:test is provided by the Bun CI/runtime, not Pifrost's Node type surface.
import { test } from "bun:test";
import type { Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import {
	buildPifrostTransportModel,
	installPifrostModelPolicyResolver,
	resolvePifrostReasoningWithToolsPolicy,
} from "../transport-model.ts";
import { resolveRouteReasoningWithToolsPolicy } from "../datasheet.ts";

installPifrostModelPolicyResolver((spec) => resolveModelPolicy(spec));

function requestProjection(model: Model) {
	return {
		id: model.id,
		name: model.name,
		api: model.api,
		provider: model.provider,
		requestModelId: model.requestModelId,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		identity: model.identity,
		requiresGlyphTokenization: model.requiresGlyphTokenization,
		tokenizer: model.tokenizer,
		thinking: model.thinking,
		compat: model.compat,
		compatConfig: model.compatConfig,
		supportsComputerUse: model.supportsComputerUse,
		supportsComputerUseConfig: model.supportsComputerUseConfig,
		requiresCursorToolSchemaProjection: model.requiresCursorToolSchemaProjection,
		requiresToolResultImageHoisting: model.requiresToolResultImageHoisting,
		supportsAssistantPrefill: model.supportsAssistantPrefill,
		omitMaxOutputTokens: model.omitMaxOutputTokens,
		contextWindow: model.contextWindow,
		contextWindowAuthoritative: model.contextWindowAuthoritative,
		maxTokens: model.maxTokens,
		input: model.input,
	};
}

const cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 };

test("transport materializer matches OMP buildModel request policy for OpenAI Responses", () => {
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

	assert.deepEqual(
		requestProjection(buildPifrostTransportModel(spec)),
		requestProjection(buildModel(spec)),
	);
});

test("transport materializer matches OMP buildModel request policy for OpenAI-compatible chat", () => {
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

	assert.deepEqual(
		requestProjection(buildPifrostTransportModel(spec)),
		requestProjection(buildModel(spec)),
	);
});

test("runtime policy resolver keeps OpenAI GPT-6.1 Sol eligible for reasoning plus tools", () => {
	assert.equal(
		resolvePifrostReasoningWithToolsPolicy("openai", "gpt-6.1-sol", "openai-completions"),
		true,
	);
	assert.equal(
		resolvePifrostReasoningWithToolsPolicy("openai", "gpt-6.1-sol", "openai-responses"),
		true,
	);
	assert.equal(
		resolveRouteReasoningWithToolsPolicy(
			"openai/gpt-6.1-sol",
			"openai/gpt-6.1-sol",
			["openai-responses", "openai-completions"],
		),
		true,
	);
});

test("runtime policy resolver preserves Azure GPT-6 Astra protocol-specific reasoning-with-tools policy", () => {
	assert.equal(
		resolvePifrostReasoningWithToolsPolicy("azure", "gpt-6-astra", "openai-completions"),
		false,
	);
	assert.equal(
		resolvePifrostReasoningWithToolsPolicy("azure", "gpt-6-astra", "openai-responses"),
		true,
	);
	assert.equal(
		resolveRouteReasoningWithToolsPolicy(
			"azure/gpt-6-astra",
			"azure/gpt-6-astra",
			["openai-responses", "openai-completions"],
		),
		false,
	);
});

test("runtime host imports stay at the extension entry boundary", () => {
	const native = readFileSync(new URL("../native.ts", import.meta.url), "utf8");
	const materializer = readFileSync(new URL("../transport-model.ts", import.meta.url), "utf8");
	const fallback = readFileSync(new URL("../catalog-fallback.ts", import.meta.url), "utf8");

	assert.doesNotMatch(native, /@oh-my-pi\/pi-catalog\/build/u);
	assert.match(native, /from\s+["']@oh-my-pi\/pi-catalog["']/u);
	assert.match(native, /@oh-my-pi\/pi-catalog\/compat\/resolve/u);
	assert.match(native, /@oh-my-pi\/pi-catalog\/compat\/behavior/u);
	assert.doesNotMatch(materializer, /from\s+["']@oh-my-pi\/pi-catalog(?:\/|["'])/u);
	assert.doesNotMatch(fallback, /from\s+["']@oh-my-pi\/pi-catalog(?:\/|["'])/u);
});
