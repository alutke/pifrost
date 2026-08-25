import assert from "node:assert/strict";
import test from "node:test";

import { buildRichRouteCatalog, type BifrostDatasheets } from "../datasheet.ts";
import { buildPifrostCatalog, type BifrostProviderModel, type PifrostAliasConfig } from "../index.ts";
import { augmentLiveInventoryForRoutes } from "../route-inventory.ts";

function sparseLive(id: string): BifrostProviderModel {
	return {
		id,
		name: id,
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
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
		},
	};
}

test("configured route members absent from /v1/models receive metadata-only identities", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-task": ["CommandCode GOAT/stealth/ox-alpha", "opencode-go/ox-alpha-free"] },
	};
	const augmented = augmentLiveInventoryForRoutes([], aliases);
	assert.deepEqual(augmented.map((model) => model.id), aliases.aliases["omp-task"]);
	assert.ok(augmented.every((model) => model.capabilitySources?.contextWindow === "fallback"));
	assert.ok(augmented.every((model) => model.capabilitySources?.maxTokens === "fallback"));
});

test("ambiguous live identities are not replaced by route placeholders", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-test": ["shared-preview"] },
	};
	const live = [sparseLive("google/shared-preview"), sparseLive("moonshotai/shared-preview")];
	const augmented = augmentLiveInventoryForRoutes(live, aliases);
	assert.equal(augmented.length, 2);
	assert.equal(augmented.some((model) => model.id === "shared-preview"), false);
});

test("Ox Alpha routes resolve from verified capability data when aggregator inventory lags", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-task": [
				"CommandCode GOAT/stealth/ox-alpha",
				"opencode-go/ox-alpha-free",
				"deepseek/deepseek-v4-flash",
			],
		},
	};
	const sheets: BifrostDatasheets = {
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
				supports_reasoning: true,
				supports_reasoning_effort: true,
				reasoning_effort_levels: ["high", "max"],
				supports_function_calling: true,
			},
		},
	};
	const live = [sparseLive("deepseek/deepseek-v4-flash")];
	const augmented = augmentLiveInventoryForRoutes(live, aliases);
	const rich = buildRichRouteCatalog(augmented, aliases, sheets, []);
	assert.equal(rich.models.length, 3);
	assert.ok(rich.diagnostics.every((item) => item.status !== "not-live" && item.status !== "missing-pricing"));
	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	const task = catalog.models[0];
	assert.ok(task);
	assert.equal(task.contextWindow, 1_000_000);
	assert.equal(task.maxTokens, 131_072);
	assert.equal(task.reasoning, true);
	assert.deepEqual(task.thinking?.efforts.map(String), ["high", "max"]);
	assert.equal(task.input.includes("image"), false);
});

test("DeepSeek Vision Exp preserves image intersection when absent from /v1/models", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-vision": [
				"Xiaomi MIMO/mimo-v2.5",
				"deepseek/deepseek-v4-flash-vision-exp",
			],
		},
	};
	const sheets: BifrostDatasheets = {
		pricing: {
			"xiaomi/mimo-v2.5": {
				provider: "xiaomi",
				mode: "chat",
				context_length: 1_000_000,
				max_output_tokens: 131_072,
				architecture: { input_modalities: ["text", "image"] },
			},
		},
		parameters: {
			"xiaomi/mimo-v2.5": {
				provider: "xiaomi",
				supports_reasoning: true,
				supports_function_calling: true,
			},
		},
	};
	const live = [sparseLive("mimo-v2.5")];
	const augmented = augmentLiveInventoryForRoutes(live, aliases);
	const rich = buildRichRouteCatalog(augmented, aliases, sheets, []);
	assert.equal(rich.models.length, 2);
	const visionMember = rich.models.find((model) => model.id === "deepseek/deepseek-v4-flash-vision-exp");
	assert.ok(visionMember?.input.includes("image"));
	assert.equal(visionMember?.capabilitySources?.image, "vendor-override");
	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	assert.equal(catalog.models.length, 1);
	assert.ok(catalog.models[0]?.input.includes("image"));
	assert.equal(catalog.models[0]?.contextWindow, 1_000_000);
	assert.equal(catalog.models[0]?.maxTokens, 131_072);
});
