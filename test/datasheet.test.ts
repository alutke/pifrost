import assert from "node:assert/strict";
import test from "node:test";

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
		"deepseek/deepseek-v4-pro",
		"deepseek-v4-pro",
	]);
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
	});
	assert.deepEqual(rich.models[0]?.input, ["text", "image"]);
	const catalog = buildPifrostCatalog(rich.models, visionAliases);
	assert.deepEqual(catalog.models[0]?.input, ["text", "image"]);
});

test("route member is withheld when Bifrost datasheet cannot provide safe context/output limits", () => {
	const rich = buildRichRouteCatalog([liveModel("kimi-k2.7-code")], {
		includePhysicalModels: false,
		aliases: { "omp-test": ["opencode-go/kimi-k2.7-code"] },
	}, {
		pricing: {},
		parameters: {},
	});
	assert.equal(rich.models.length, 0);
	assert.equal(rich.diagnostics[0]?.status, "missing-pricing");
});
