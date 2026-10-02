import assert from "node:assert/strict";
import test from "node:test";

import {
	canonicalModelFamily,
	findCatalogCapabilityFallback,
	modelIdentityCandidates,
	type CatalogModelLike,
} from "../catalog-fallback.ts";
import {
	buildRichRouteCatalog,
	findDatasheetEntry,
	modelReferenceCandidates,
	type BifrostDatasheets,
} from "../datasheet.ts";
import { buildPifrostCatalog, type BifrostProviderModel, type PifrostAliasConfig } from "../index.ts";

import { installPifrostModelPolicyResolver } from "../transport-model.ts";

installPifrostModelPolicyResolver((spec) => {
	if (spec.provider === "openai" && spec.id === "gpt-6.1-sol") {
		return {
			thinking: undefined,
			identity: { class: "openai", family: "gpt", revision: "6.1" } as never,
			compat: { disableReasoningWithTools: false } as never,
			catalog: {},
		};
	}
	if ((spec.provider === "azure" || spec.provider === "azure-openai") && spec.id === "gpt-6-astra") {
		return {
			thinking: undefined,
			identity: { class: "openai", family: "gpt", revision: "6" } as never,
			compat: { disableReasoningWithTools: true } as never,
			catalog: {},
		};
	}
	throw new Error("No synthetic host policy for this test route");
});

function liveModel(id: string): BifrostProviderModel {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsTools: false,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
		},
	};
}

const aliases: PifrostAliasConfig = {
	includePhysicalModels: false,
	aliases: {
		"omp-test": {
			chain: [
				"opencode-go/kimi-k2.7-code",
				"CommandCode GOAT/deepseek/deepseek-v4-pro",
			],
		},
	},
};

test("builds progressively stripped model-reference candidates", () => {
	assert.deepEqual(modelReferenceCandidates("CommandCode GOAT/deepseek/deepseek-v4-pro"), [
		"commandcode goat/deepseek/deepseek-v4-pro",
		"deepseek-v4-pro",
		"deepseek/deepseek-v4-pro",
	]);
});

test("normalizes known Ox Alpha provider aliases without blanket free-model stripping", () => {
	assert.equal(canonicalModelFamily("stealth/ox-alpha"), "ox-alpha");
	assert.equal(canonicalModelFamily("opencode-go/ox-alpha-free"), "ox-alpha");
	assert.equal(canonicalModelFamily("x-preview-f-free"), "ox-alpha");
	assert.equal(canonicalModelFamily("deepseek-v4-flash-free"), "deepseek-v4-flash-free");
	assert.ok(modelIdentityCandidates("CommandCode GOAT/stealth/ox-alpha").includes("ox-alpha"));
});

test("datasheet lookup resolves custom-provider route references against underlying model keys", () => {
	const match = findDatasheetEntry(
		{
			"openrouter/moonshotai/kimi-k2.7-code": {
				provider: "openrouter",
				mode: "chat",
				base_model: "kimi-k2.7-code",
			},
		},
		"CommandCode GOAT/moonshotai/Kimi-K2.7-Code",
		"moonshotai/Kimi-K2.7-Code",
	);
	assert.equal(match?.key, "openrouter/moonshotai/kimi-k2.7-code");
});

test("rich route catalog replaces sparse /v1 model defaults with Bifrost datasheet limits", () => {
	const datasheets: BifrostDatasheets = {
		pricing: {
			"openrouter/kimi-k2.7-code": {
				provider: "openrouter",
				mode: "chat",
				base_model: "kimi-k2.7-code",
				context_length: 256_000,
				max_output_tokens: 32_000,
				architecture: { input_modalities: ["text"] },
			},
			"deepseek/deepseek-v4-pro": {
				provider: "deepseek",
				mode: "chat",
				base_model: "deepseek-v4-pro",
				context_length: 1_000_000,
				max_output_tokens: 384_000,
				architecture: { input_modalities: ["text"] },
			},
		},
		parameters: {
			"openrouter/kimi-k2.7-code": {
				provider: "openrouter",
				supports_function_calling: true,
				supports_reasoning: true,
			},
			"deepseek/deepseek-v4-pro": {
				provider: "deepseek",
				supports_function_calling: true,
				supports_reasoning: true,
				supports_reasoning_effort: true,
				reasoning_effort_levels: ["high", "max"],
			},
		},
	};
	const rich = buildRichRouteCatalog(
		[liveModel("kimi-k2.7-code"), liveModel("deepseek/deepseek-v4-pro")],
		aliases,
		datasheets,
		[],
	);
	assert.equal(rich.models.length, 2);
	assert.equal(rich.models[0]?.contextWindow, 256_000);
	assert.equal(rich.models[0]?.maxTokens, 32_000);
	assert.equal(rich.models[1]?.contextWindow, 1_000_000);
	assert.deepEqual(rich.models[1]?.thinking?.efforts.map(String), ["high", "max"]);

	const catalog = buildPifrostCatalog(rich.models, aliases);
	assert.equal(catalog.models.length, 1);
	assert.equal(catalog.models[0]?.id, "omp-test");
	assert.equal(catalog.models[0]?.contextWindow, 256_000);
	assert.equal(catalog.models[0]?.maxTokens, 32_000);
});

test("OMP catalog fallback supplies safe metadata when Bifrost datasheet lags", () => {
	const fixture: CatalogModelLike[] = [{
		id: "future-model",
		provider: "opencode-go",
		contextWindow: 524_288,
		maxTokens: 65_536,
		input: ["text", "image"],
		reasoning: true,
		supportsTools: true,
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
	}];
	const fallback = findCatalogCapabilityFallback("opencode-go/future-model", undefined, fixture);
	assert.equal(fallback?.source, "omp-catalog-provider");
	assert.equal(fallback?.contextWindow, 524_288);
	assert.equal(fallback?.maxTokens, 65_536);
	assert.deepEqual(fallback?.input, ["text", "image"]);
	assert.equal(fallback?.supportsTools, true);
});

test("current Ox Alpha route resolves provider alias drift and retains high/max reasoning", () => {
	const taskAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-task": [
				"CommandCode GOAT/stealth/ox-alpha",
				"opencode-go/ox-alpha-free",
				"deepseek/deepseek-v4-flash",
			],
		},
	};
	const rich = buildRichRouteCatalog(
		[liveModel("stealth/ox-alpha"), liveModel("x-preview-f-free"), liveModel("deepseek-v4-flash")],
		taskAliases,
		{
			pricing: {
				"deepseek/deepseek-v4-flash": {
					provider: "deepseek",
					mode: "chat",
					context_length: 1_000_000,
					max_output_tokens: 384_000,
					architecture: { input_modalities: ["text"] },
				},
			},
			parameters: {
				"deepseek/deepseek-v4-flash": {
					provider: "deepseek",
					supports_function_calling: true,
					supports_reasoning: true,
					reasoning_effort_levels: ["high", "max"],
				},
			},
		},
		[],
	);
	assert.equal(rich.models.length, 3);
	assert.ok(rich.diagnostics.every((diagnostic) => diagnostic.status !== "not-live" && diagnostic.status !== "missing-pricing"));
	const catalog = buildPifrostCatalog(rich.models, taskAliases);
	const task = catalog.models[0];
	assert.ok(task);
	assert.equal(task.contextWindow, 1_000_000);
	assert.equal(task.maxTokens, 131_072);
	assert.equal(task.reasoning, true);
	assert.deepEqual(task.thinking?.efforts.map(String), ["high", "max"]);
	assert.equal(task.supportsTools, true);
});

test("DeepSeek V4 Flash Vision Exp keeps omp-vision image capability", () => {
	const visionAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-vision": [
				"Xiaomi MIMO/mimo-v2.5",
				"deepseek/deepseek-v4-flash-vision-exp",
			],
		},
	};
	const rich = buildRichRouteCatalog(
		[liveModel("mimo-v2.5"), liveModel("deepseek-v4-flash-vision-exp")],
		visionAliases,
		{
			pricing: {
				"xiaomi/mimo-v2.5": {
					provider: "xiaomi",
					mode: "chat",
					context_length: 1_048_576,
					max_output_tokens: 131_072,
					architecture: { input_modalities: ["text", "image"] },
				},
			},
			parameters: {
				"xiaomi/mimo-v2.5": { provider: "xiaomi", supports_function_calling: true, supports_reasoning: true },
			},
		},
		[],
	);
	assert.equal(rich.models.length, 2);
	const catalog = buildPifrostCatalog(rich.models, visionAliases);
	assert.deepEqual(catalog.models[0]?.input, ["text", "image"]);
	assert.equal(catalog.models[0]?.contextWindow, 1_048_576);
	assert.equal(catalog.models[0]?.maxTokens, 131_072);
});

test("vision comes from Bifrost datasheet architecture rather than sparse /v1 defaults", () => {
	const visionAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-vision": ["Xiaomi MIMO/mimo-v2.5"] },
	};
	const rich = buildRichRouteCatalog([liveModel("mimo-v2.5")], visionAliases, {
		pricing: {
			"xiaomi/mimo-v2.5": {
				provider: "xiaomi",
				mode: "chat",
				context_length: 1_000_000,
				max_output_tokens: 128_000,
				architecture: { input_modalities: ["text", "image", "video", "audio"] },
			},
		},
		parameters: {
			"xiaomi/mimo-v2.5": { provider: "xiaomi", supports_function_calling: true },
		},
	}, []);
	assert.deepEqual(rich.models[0]?.input, ["text", "image"]);
	const catalog = buildPifrostCatalog(rich.models, visionAliases);
	assert.deepEqual(catalog.models[0]?.input, ["text", "image"]);
});

test("truly unknown route member is withheld when neither source has safe limits", () => {
	const rich = buildRichRouteCatalog([liveModel("totally-unknown-model-xyz")], {
		includePhysicalModels: false,
		aliases: { "omp-test": ["custom/totally-unknown-model-xyz"] },
	}, {
		pricing: {},
		parameters: {},
	}, []);
	assert.equal(rich.models.length, 0);
	assert.equal(rich.diagnostics[0]?.status, "missing-pricing");
});


test("OpenRouter catalog fallback prefers the OpenRouter provider row", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-or": ["openrouter/google/gemini-3.7-flash"] },
	};
	const liveModel: BifrostProviderModel = {
		id: "openrouter/google/gemini-3.7-flash",
		name: "openrouter/google/gemini-3.7-flash",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsTools: false,
		capabilitySources: {
			contextWindow: "fallback",
			maxTokens: "fallback",
			image: "fallback",
			reasoning: "fallback",
			reasoningEfforts: "fallback",
			tools: "fallback",
		},
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true },
	};
	const catalogOverride = [
		{
			id: "google/gemini-3.7-flash",
			provider: "openrouter",
			contextWindow: 900_000,
			maxTokens: 60_000,
			reasoning: true,
			input: ["text", "image"],
			supportsTools: true,
			cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
			compat: { supportsReasoningEffort: true, supportsToolChoice: true, supportsUsageInStreaming: true },
		},
		{
			id: "gemini-3.7-flash",
			provider: "google",
			contextWindow: 1_000_000,
			maxTokens: 65_536,
			reasoning: true,
			input: ["text", "image"],
			supportsTools: true,
			cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
			compat: { supportsReasoningEffort: true, supportsToolChoice: true, supportsUsageInStreaming: true },
		},
	];
	const rich = buildRichRouteCatalog([liveModel], aliases, { pricing: {}, parameters: {} }, catalogOverride);
	assert.equal(rich.models[0]?.contextWindow, 900_000);
	assert.deepEqual(rich.diagnostics[0]?.fallbackMatches, ["openrouter/google/gemini-3.7-flash"]);
});


test("CommandCode GOAT LongCat 2.0 free gets an exact safe vendor-backed envelope", () => {
	const advisorAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-advisor": ["CommandCode GOAT/meituan/LongCat-2.0:free"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("CommandCode GOAT/meituan/LongCat-2.0:free")],
		advisorAliases,
		{ pricing: {}, parameters: {} },
		[],
	);
	assert.equal(rich.models.length, 1);
	assert.equal(rich.models[0]?.contextWindow, 1_000_000);
	assert.equal(rich.models[0]?.maxTokens, 131_072);
	assert.deepEqual(rich.models[0]?.input, ["text"]);
	assert.equal(rich.models[0]?.reasoning, true);
	assert.equal(rich.models[0]?.thinking, undefined);
	assert.equal(rich.models[0]?.supportsTools, true);
	assert.equal(rich.models[0]?.compat.supportsReasoningEffort, false);
	assert.equal(rich.models[0]?.compat.supportsToolChoice, true);
	assert.equal(rich.models[0]?.compat.supportsForcedToolChoice, false);
	assert.equal(rich.models[0]?.capabilitySources?.contextWindow, "vendor-override");
	assert.equal(rich.models[0]?.capabilitySources?.maxTokens, "vendor-override");
	assert.notEqual(rich.diagnostics[0]?.status, "missing-pricing");
});

test("LongCat free override does not leak to OpenRouter or arbitrary free variants", () => {
	const openRouterAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-or": ["openrouter/meituan/longcat-2.0:free"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("openrouter/meituan/longcat-2.0:free")],
		openRouterAliases,
		{ pricing: {}, parameters: {} },
		[],
	);
	assert.equal(rich.models.length, 0);
	assert.equal(rich.diagnostics[0]?.status, "missing-pricing");
});


test("rich route diagnostics retain Bifrost time-of-day pricing without changing OMP peak rates", () => {
	const pricingAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-price": ["deepseek/deepseek-v4-flash"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("deepseek/deepseek-v4-flash")],
		pricingAliases,
		{
			pricing: {
				"deepseek/deepseek-v4-flash": {
					provider: "deepseek",
					mode: "chat",
					context_length: 1_000_000,
					max_output_tokens: 128_000,
					input_cost_per_token: 0.00000044,
					output_cost_per_token: 0.00000132,
					cache_read_input_token_cost: 0.000000014,
					off_peak_cost_multiplier: 0.5,
					peak_hours: {
						timezone: "UTC",
						windows: [{ days: [1, 2, 3, 4, 5], start: "01:00", end: "04:00" }],
					},
				},
			},
			parameters: {},
		},
		[],
	);
	assert.equal(rich.models[0]?.cost.input, 0.44);
	assert.equal(rich.models[0]?.cost.output, 1.32);
	assert.equal(rich.diagnostics[0]?.pricing?.offPeakCostMultiplier, 0.5);
	assert.equal(rich.diagnostics[0]?.pricing?.peakHours?.timezone, "UTC");
	assert.equal(rich.diagnostics[0]?.pricing?.peakCost.input, 0.44);

	const catalog = buildPifrostCatalog(rich.models, pricingAliases, rich.diagnostics);
	assert.equal(catalog.models[0]?.cost.input, 0.44);
	assert.equal(catalog.diagnostics[0]?.members?.[0]?.pricing?.pricingKey, "deepseek/deepseek-v4-flash");
});


test("OMP provider policy overrides stale Bifrost reasoning-with-tools negative for GPT-6.1 Sol", () => {
	const planAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-plan": ["openai/gpt-6.1-sol"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("openai/gpt-6.1-sol")],
		planAliases,
		{
			pricing: {},
			parameters: {
				"openai/gpt-6.1-sol": {
					provider: "openai",
					supports_function_calling: true,
					supports_reasoning: true,
					supports_reasoning_with_tool_calls: false,
				},
			},
		},
		[{
			id: "gpt-6.1-sol",
			provider: "openai-codex",
			api: "openai-responses",
			contextWindow: 1_050_000,
			maxTokens: 128_000,
			input: ["text"],
			reasoning: true,
			supportsTools: true,
			compat: {
				disableReasoningWithTools: false,
				supportsUsageInStreaming: true,
				supportsToolChoice: true,
			},
		}],
	);
	const model = rich.models[0];
	assert.ok(model);
	assert.equal(model.compat.supportsReasoningWithTools, true);
	assert.equal(model.capabilitySources?.reasoningWithTools, "omp-provider-policy");
	assert.equal(rich.diagnostics[0]?.sources?.reasoningWithTools, "omp-provider-policy");
});

test("OMP provider policy preserves an explicit reasoning-with-tools restriction", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-azure": ["azure/gpt-6-astra"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("azure/gpt-6-astra")],
		aliases,
		{
			pricing: {},
			parameters: {
				"azure/gpt-6-astra": {
					provider: "azure",
					supports_function_calling: true,
					supports_reasoning: true,
					supports_reasoning_with_tool_calls: true,
				},
			},
		},
		[{
			id: "gpt-6-astra",
			provider: "azure",
			api: "openai-responses",
			contextWindow: 1_050_000,
			maxTokens: 128_000,
			input: ["text"],
			reasoning: true,
			supportsTools: true,
			compat: {
				disableReasoningWithTools: true,
				supportsUsageInStreaming: true,
				supportsToolChoice: true,
			},
		}],
	);
	assert.equal(rich.models[0]?.compat.supportsReasoningWithTools, false);
	assert.equal(rich.models[0]?.capabilitySources?.reasoningWithTools, "omp-provider-policy");
});

test("Bifrost reasoning-with-tools metadata still governs when no exact OMP provider policy matches", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-custom": ["custom/gpt-6.1-sol"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("custom/gpt-6.1-sol")],
		aliases,
		{
			pricing: {},
			parameters: {
				"custom/gpt-6.1-sol": {
					provider: "custom",
					supports_function_calling: true,
					supports_reasoning: true,
					supports_reasoning_with_tool_calls: false,
				},
			},
		},
		[{
			id: "gpt-6.1-sol",
			provider: "openai-codex",
			api: "openai-responses",
			contextWindow: 1_050_000,
			maxTokens: 128_000,
			input: ["text"],
			reasoning: true,
			supportsTools: true,
			compat: {
				disableReasoningWithTools: false,
				supportsUsageInStreaming: true,
				supportsToolChoice: true,
			},
		}],
	);
	assert.equal(rich.models[0]?.compat.supportsReasoningWithTools, false);
	assert.equal(rich.models[0]?.capabilitySources?.reasoningWithTools, "bifrost-datasheet");
});

test("Bifrost 2.2.4 datasheet metadata enriches Tool Search, between-tools thinking and service tiers", () => {
	const modernAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-modern": ["provider/modern"] },
	};
	const rich = buildRichRouteCatalog(
		[liveModel("provider/modern")],
		modernAliases,
		{
			pricing: {
				"provider/modern": {
					provider: "provider",
					mode: "chat",
					context_length: 256_000,
					max_output_tokens: 32_000,
					input_cost_per_token: 0.000001,
					output_cost_per_token: 0.000002,
					architecture: { input_modalities: ["text"] },
				},
			},
			parameters: {
				"provider/modern": {
					provider: "provider",
					supports_function_calling: true,
					supports_reasoning: true,
					supports_tool_search: true,
					supports_between_tools_thinking: true,
					supports_service_tier: true,
					service_tiers: ["priority", "ultrafast"],
				},
			},
		},
		[],
	);
	assert.equal(rich.models[0]?.supportsToolSearch, true);
	assert.equal(rich.models[0]?.compat.supportsBetweenToolsThinking, true);
	assert.equal(rich.models[0]?.supportsServiceTier, true);
	assert.deepEqual(rich.models[0]?.serviceTiers, ["priority", "ultrafast"]);
	assert.equal(rich.models[0]?.capabilitySources?.toolSearch, "bifrost-datasheet");
	assert.equal(rich.models[0]?.capabilitySources?.betweenToolsThinking, "bifrost-datasheet");
});
