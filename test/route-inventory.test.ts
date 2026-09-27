import assert from "node:assert/strict";
import test from "node:test";

import { buildRichRouteCatalog, type BifrostDatasheets } from "../datasheet.ts";
import { buildPifrostCatalog, type BifrostProviderModel, type PifrostAliasConfig } from "../index.ts";
import { augmentLiveInventoryForRoutes } from "../route-inventory.ts";
import { findCatalogProtocolCapability } from "../catalog-fallback.ts";
import { applyDynamicRouteProfiles, extractDynamicRouteProfiles, planDynamicRouteAttempts } from "../dynamic-routing.ts";

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
			protocol: "fallback",
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


test("Pixel Canary metadata keeps the current advisor route synthesizable", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-advisor": [
				"CommandCode GOAT/stealth/pixel-canary",
				"openrouter/thinkingmachines/inkling:free",
				"Xiaomi MIMO/mimo-v2.6-flash",
			],
		},
	};
	const augmented = augmentLiveInventoryForRoutes([], aliases);
	const catalogOverride = [{
		id: "thinkingmachines/inkling:free",
		provider: "openrouter",
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		reasoning: true,
		thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high" },
		input: ["text"],
		supportsTools: true,
		compat: {
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			disableReasoningOnToolChoice: false,
		},
	}];
	const rich = buildRichRouteCatalog(augmented, aliases, { pricing: {}, parameters: {} }, catalogOverride);
	assert.equal(rich.models.length, 3);
	assert.equal(rich.diagnostics.some((item) => item.status === "missing-pricing"), false);
	const pixel = rich.models.find((model) => model.id === "CommandCode GOAT/stealth/pixel-canary");
	assert.equal(pixel?.contextWindow, 262_144);
	assert.equal(pixel?.maxTokens, 131_072);
	assert.ok(pixel?.input.includes("image"));

	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	assert.equal(catalog.models.length, 1);
	assert.equal(catalog.models[0]?.id, "omp-advisor");
	assert.equal(catalog.models[0]?.contextWindow, 262_144);
	assert.equal(catalog.diagnostics[0]?.unresolved.length, 0);
});

test("MiMo V2.6 provider variants preserve vision capability without live metadata", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-vision": [
				"opencode-go/mimo-v2.6-flash",
				"CommandCode GOAT/xiaomi/mimo-v2.6-flash",
				"Xiaomi MIMO/mimo-v2.6-flash",
			],
		},
	};
	const augmented = augmentLiveInventoryForRoutes([], aliases);
	const rich = buildRichRouteCatalog(augmented, aliases, { pricing: {}, parameters: {} }, []);
	assert.equal(rich.models.length, 3);
	assert.ok(rich.models.every((model) => model.input.includes("image")));
	assert.ok(rich.models.every((model) => model.capabilitySources?.image === "vendor-override"));
	assert.ok(rich.models.every((model) => model.contextWindow === 1_048_576));
	assert.ok(rich.models.every((model) => model.maxTokens === 131_072));

	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	assert.equal(catalog.models.length, 1);
	assert.equal(catalog.models[0]?.id, "omp-vision");
	assert.deepEqual(catalog.models[0]?.input, ["text", "image"]);
	assert.equal(catalog.diagnostics[0]?.image, true);
	assert.equal(catalog.diagnostics[0]?.unresolved.length, 0);
});


test("current omp-default keeps Muse primary via Responses then falls back to the Chat group", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-default": {
				name: "omp-default",
				chain: [
					"opencode-go/muse-spark-1.3-contributor",
					"CommandCode GOAT/deepseek/deepseek-v4.1-flash",
					"deepseek/deepseek-flash",
				],
				dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },
			},
		},
	};
	assert.deepEqual(findCatalogProtocolCapability("opencode-go/muse-spark-1.3-contributor"), ["openai-responses"]);
	assert.deepEqual(findCatalogProtocolCapability("CommandCode GOAT/deepseek/deepseek-v4.1-flash"), ["openai-completions"]);
	const augmented = augmentLiveInventoryForRoutes([], aliases);
	const catalogOverride = [
		{
			id: "muse-spark-1.3-contributor",
			provider: "opencode-go",
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			reasoning: true,
			input: ["text", "image"],
			supportsTools: true,
			compat: { supportsReasoningEffort: true, supportsUsageInStreaming: true, supportsToolChoice: true },
		},
		{
			id: "deepseek/deepseek-v4.1-flash",
			provider: "commandcode",
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			reasoning: true,
			input: ["text", "image"],
			supportsTools: true,
			compat: {
				supportsReasoningEffort: true,
				supportsUsageInStreaming: true,
				supportsToolChoice: true,
				supportsReasoningWithTools: true,
				disableReasoningOnToolChoice: true,
			},
		},
		{
			id: "deepseek-flash",
			provider: "deepseek",
			contextWindow: 1_048_576,
			maxTokens: 131_072,
			reasoning: true,
			input: ["text"],
			supportsTools: true,
			compat: {
				supportsReasoningEffort: true,
				supportsUsageInStreaming: true,
				supportsToolChoice: true,
				supportsReasoningWithTools: true,
				disableReasoningOnToolChoice: true,
			},
		},
	];
	const rich = buildRichRouteCatalog(augmented, aliases, { pricing: {}, parameters: {} }, catalogOverride);
	const muse = rich.models.find((model) => model.id === "opencode-go/muse-spark-1.3-contributor");
	const commandCode = rich.models.find((model) => model.id === "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	assert.deepEqual(muse?.protocols, ["openai-responses"]);
	assert.deepEqual(commandCode?.protocols, ["openai-completions"]);
	assert.equal(muse?.capabilitySources?.protocol, "canonical-family");
	assert.equal(commandCode?.capabilitySources?.protocol, "canonical-family");

	let catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	const byId = new Map(rich.models.map((model) => [model.id.toLowerCase(), model]));
	catalog = applyDynamicRouteProfiles(catalog, rich.models, aliases, (reference) => byId.get(reference.toLowerCase()));
	const route = extractDynamicRouteProfiles(catalog.models).get("omp-default");
	assert.ok(route);
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "examine previous railway errors" }],
			tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
			reasoning_effort: "high",
			max_completion_tokens: 131_072,
		},
		{
			bytesPerToken: 100,
			safetyMargin: 0,
			fixedHeadroom: 0,
			imageTokenReserve: 0,
			outputCapExplicit: false,
		},
	);
	assert.equal(plan.outputReserveExplicit, false);
	assert.deepEqual(plan.excluded, []);
	assert.deepEqual(plan.attempts.map((attempt) => ({
		protocol: attempt.protocol,
		primary: attempt.primary,
		fallbacks: attempt.fallbacks,
	})), [
		{
			protocol: "openai-responses",
			primary: "opencode-go/muse-spark-1.3-contributor",
			fallbacks: [],
		},
		{
			protocol: "openai-completions",
			primary: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
			fallbacks: ["deepseek/deepseek-flash"],
		},
	]);
});

test("provider-specific OMP protocol policy outranks cross-provider family datasheet endpoints", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-default": {
				name: "omp-default",
				chain: [
					"opencode-go/muse-spark-1.3-contributor",
					"CommandCode GOAT/deepseek/deepseek-v4.1-flash",
				],
				dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },
			},
		},
	};
	const augmented = augmentLiveInventoryForRoutes([], aliases);
	const catalogOverride = [
		{
			id: "muse-spark-1.3-contributor",
			provider: "opencode-go",
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			reasoning: true,
			input: ["text", "image"],
			supportsTools: true,
			compat: { supportsReasoningEffort: true, supportsUsageInStreaming: true, supportsToolChoice: true },
		},
		{
			id: "deepseek/deepseek-v4.1-flash",
			provider: "commandcode",
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			reasoning: true,
			input: ["text"],
			supportsTools: true,
			compat: { supportsReasoningEffort: true, supportsUsageInStreaming: true, supportsToolChoice: true },
		},
	];
	const datasheets: BifrostDatasheets = {
		pricing: {},
		parameters: {
			"openrouter/meta/muse-spark-1.3-contributor": {
				provider: "openrouter",
				mode: "chat",
				base_model: "muse-spark-1.3-contributor",
				supported_endpoints: ["/v1/chat/completions"],
			},
		},
	};
	const rich = buildRichRouteCatalog(augmented, aliases, datasheets, catalogOverride);
	const muse = rich.models.find((model) => model.id === "opencode-go/muse-spark-1.3-contributor");
	assert.deepEqual(muse?.protocols, ["openai-responses"]);
	assert.equal(muse?.capabilitySources?.protocol, "canonical-family");

	let catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	const byId = new Map(rich.models.map((model) => [model.id.toLowerCase(), model]));
	catalog = applyDynamicRouteProfiles(catalog, rich.models, aliases, (reference) => byId.get(reference.toLowerCase()));
	const route = extractDynamicRouteProfiles(catalog.models).get("omp-default");
	assert.ok(route);
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "test" }],
			max_completion_tokens: 32_000,
		},
		{ bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 },
	);
	assert.equal(plan.attempts[0]?.protocol, "openai-responses");
	assert.equal(plan.attempts[0]?.primary, "opencode-go/muse-spark-1.3-contributor");
	assert.equal(plan.attempts[1]?.protocol, "openai-completions");
	assert.equal(plan.attempts[1]?.primary, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
});

