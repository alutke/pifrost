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
