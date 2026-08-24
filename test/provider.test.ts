import assert from "node:assert/strict";
import test from "node:test";
import {
	bifrostHeaders,
	buildPifrostCatalog,
	formatDoctorReport,
	normalizeBifrostUrl,
	resolveAliasReference,
	synthesizeAlias,
	toProviderModel,
	type BifrostProviderModel,
} from "../index.ts";

function model(
	id: string,
	overrides: Partial<BifrostProviderModel> = {},
): BifrostProviderModel {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsTools: true,
		compat: {
			supportsDeveloperRole: true,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: true,
			maxTokensField: "max_completion_tokens",
		},
		...overrides,
	};
}

test("normalizes Bifrost URLs", () => {
	assert.equal(normalizeBifrostUrl("http://localhost:8180"), "http://localhost:8180/openai/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/v1"), "http://localhost:8180/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/openai/v1/models"), "http://localhost:8180/openai/v1");
});

test("keeps API auth and virtual-key governance independent", () => {
	assert.deepEqual(
		bifrostHeaders({ url: "http://bifrost/openai/v1", apiKey: "api", virtualKey: "sk-bf-vk" }),
		{
			Accept: "application/json",
			Authorization: "Bearer api",
			"x-bf-vk": "sk-bf-vk",
		},
	);
	assert.equal(bifrostHeaders({ url: "http://bifrost/openai/v1" }).Authorization, null);
});

test("maps rich Bifrost model metadata", () => {
	const mapped = toProviderModel({
		id: "openai/gpt-test",
		context_length: 1_000_000,
		max_output_tokens: 128_000,
		architecture: { input_modalities: ["text", "image"] },
		supported_parameters: ["tools", "reasoning_effort"],
		reasoning: { supported_efforts: ["low", "high", "max"] },
	});
	assert.ok(mapped);
	assert.equal(mapped.contextWindow, 1_000_000);
	assert.equal(mapped.maxTokens, 128_000);
	assert.deepEqual(mapped.input, ["text", "image"]);
	assert.equal(mapped.supportsTools, true);
	assert.equal(mapped.reasoning, true);
	assert.equal(mapped.thinkingLevelMap?.high, "high");
	assert.equal(mapped.thinkingLevelMap?.medium, null);
});

test("resolves provider-prefixed Bifrost fallback references by physical model id", () => {
	const physical = [model("deepseek/deepseek-v4-pro"), model("mimo-v2.5")];
	assert.equal(
		resolveAliasReference("CommandCode GOAT/deepseek/deepseek-v4-pro", physical)?.id,
		"deepseek/deepseek-v4-pro",
	);
	assert.equal(resolveAliasReference("Xiaomi MIMO/mimo-v2.5", physical)?.id, "mimo-v2.5");
});

test("alias envelope uses the weakest context and output limits", () => {
	const physical = [
		model("kimi-k2.7-code", { contextWindow: 256_000, maxTokens: 32_000 }),
		model("deepseek/deepseek-v4-flash", { contextWindow: 1_000_000, maxTokens: 128_000 }),
	];
	const result = synthesizeAlias(
		"omp-default",
		{ chain: ["opencode-go/kimi-k2.7-code", "deepseek/deepseek-v4-flash"] },
		physical,
	);
	assert.ok(result.model);
	assert.equal(result.model.contextWindow, 256_000);
	assert.equal(result.model.maxTokens, 32_000);
});

test("alias image, tools and reasoning are conservative intersections", () => {
	const richThinking = {
		off: "off",
		minimal: null,
		low: "low",
		medium: null,
		high: "high",
		xhigh: null,
		max: "max",
	} as const;
	const physical = [
		model("one", {
			reasoning: true,
			thinkingLevelMap: richThinking,
			input: ["text", "image"],
			supportsTools: true,
			compat: {
				supportsDeveloperRole: true,
				supportsReasoningEffort: true,
				supportsUsageInStreaming: true,
				supportsStrictMode: true,
				maxTokensField: "max_completion_tokens",
			},
		}),
		model("two", {
			reasoning: false,
			input: ["text"],
			supportsTools: false,
		}),
	];
	const result = synthesizeAlias("mixed", ["one", "two"], physical);
	assert.ok(result.model);
	assert.equal(result.model.reasoning, false);
	assert.deepEqual(result.model.input, ["text"]);
	assert.equal(result.model.supportsTools, false);
	assert.deepEqual(result.diagnostic.reasoningEfforts, []);
});

test("alias is withheld when any configured fallback cannot be resolved", () => {
	const result = synthesizeAlias("broken", ["known", "missing"], [model("known")]);
	assert.equal(result.model, undefined);
	assert.deepEqual(result.diagnostic.unresolved, ["missing"]);
});

test("alias-only mode hides physical models from Pi while retaining them for derivation", () => {
	const catalog = buildPifrostCatalog([model("one", { contextWindow: 512_000 })], {
		includePhysicalModels: false,
		aliases: { "omp-test": ["one"] },
	});
	assert.deepEqual(catalog.models.map((item) => item.id), ["omp-test"]);
	assert.equal(catalog.models[0]?.contextWindow, 512_000);
});

test("doctor report highlights unresolved chain members", () => {
	const result = synthesizeAlias("omp-test", ["one", "missing"], [model("one")]);
	const report = formatDoctorReport([result.diagnostic], "/tmp/pifrost.aliases.json");
	assert.match(report, /WARN omp-test/);
	assert.match(report, /missing/);
});
