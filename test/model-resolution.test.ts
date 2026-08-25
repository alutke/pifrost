import assert from "node:assert/strict";
import test from "node:test";

import { buildRichRouteCatalog, type BifrostDatasheets } from "../datasheet.ts";
import {
	buildPifrostCatalog,
	toProviderModel,
	type BifrostProviderModel,
	type PifrostAliasConfig,
} from "../index.ts";
import {
	canonicalModelFamily,
	equivalentModelId,
	resolveModelReference,
} from "../model-resolution.ts";

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
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true },
	};
}

const emptySheets: BifrostDatasheets = { pricing: {}, parameters: {} };

test("resolves provider/vendor prefixes and mixed capitalization", () => {
	const models = [sparseLive("openrouter/google/gemini-3.7-flash")];
	const resolved = resolveModelReference("CommandCode GOAT/Google/GEMINI-3.7-FLASH", models);
	assert.equal(resolved.model?.id, "openrouter/google/gemini-3.7-flash");
	assert.equal(resolved.kind, "prefix-stripped");
});

test("known entitlement aliases resolve without blanket -free stripping", () => {
	assert.equal(canonicalModelFamily("opencode-go/ox-alpha-free"), "ox-alpha");
	assert.equal(canonicalModelFamily("x-preview-f-free"), "ox-alpha");
	assert.equal(resolveModelReference("opencode-go/ox-alpha-free", [sparseLive("x-preview-f-free")]).model?.id, "x-preview-f-free");
	assert.equal(equivalentModelId("vendor/new-model-free", "vendor/new-model"), false);
	assert.equal(resolveModelReference("vendor/new-model-free", [sparseLive("vendor/new-model")]).model, undefined);
});

test("vendor-qualified same-name models do not collide", () => {
	const models = [sparseLive("moonshotai/shared-preview"), sparseLive("google/shared-preview")];
	assert.equal(
		resolveModelReference("CommandCode GOAT/google/shared-preview", models).model?.id,
		"google/shared-preview",
	);
	assert.equal(
		resolveModelReference("CommandCode GOAT/deepseek/shared-preview", models).model,
		undefined,
	);
	assert.equal(equivalentModelId("google/shared-preview", "moonshotai/shared-preview"), false);
});

test("same underlying model can remain distinct through multiple route providers", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-same": [
				"CommandCode GOAT/google/gemini-3.7-flash",
				"opencode-go/google/gemini-3.7-flash",
			],
		},
	};
	const sheets: BifrostDatasheets = {
		pricing: {
			"google/gemini-3.7-flash": {
				provider: "google",
				mode: "chat",
				context_length: 1_000_000,
				max_output_tokens: 65_536,
				architecture: { input_modalities: ["text"] },
			},
		},
		parameters: {
			"google/gemini-3.7-flash": { provider: "google", supports_function_calling: true },
		},
	};
	const rich = buildRichRouteCatalog([sparseLive("google/gemini-3.7-flash")], aliases, sheets, []);
	assert.deepEqual(rich.models.map((model) => model.id), aliases.aliases["omp-same"]);
	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	assert.equal(catalog.models.length, 1);
	assert.equal(catalog.models[0]?.contextWindow, 1_000_000);
});

test("complete live Bifrost metadata outranks stale datasheet metadata", () => {
	const live = toProviderModel({
		id: "vendor/future-live-model",
		context_length: 700_000,
		max_output_tokens: 90_000,
		architecture: { input_modalities: ["text", "image"] },
		supported_parameters: ["tools", "reasoning_effort"],
		reasoning: { supported_efforts: ["low", "high"] },
	});
	assert.ok(live);
	const aliases: PifrostAliasConfig = { includePhysicalModels: false, aliases: { "omp-future": ["aggregator/vendor/future-live-model"] } };
	const rich = buildRichRouteCatalog([live], aliases, {
		pricing: {
			"vendor/future-live-model": {
				provider: "vendor",
				context_length: 256_000,
				max_output_tokens: 16_000,
				architecture: { input_modalities: ["text"] },
			},
		},
		parameters: {},
	}, []);
	assert.equal(rich.models[0]?.contextWindow, 700_000);
	assert.equal(rich.models[0]?.maxTokens, 90_000);
	assert.deepEqual(rich.models[0]?.input, ["text", "image"]);
	assert.deepEqual(rich.models[0]?.thinking?.efforts.map(String), ["low", "high"]);
	assert.equal(rich.models[0]?.capabilitySources?.contextWindow, "live");
	assert.equal(rich.models[0]?.capabilitySources?.image, "live");
});

test("new model resolves from a canonical Bifrost family row when /v1 metadata is sparse", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-future": ["CommandCode GOAT/vendor/future-family-1"] },
	};
	const rich = buildRichRouteCatalog([sparseLive("vendor/future-family-1")], aliases, {
		pricing: {
			"canonical/vendor/future-family-1": {
				provider: "canonical",
				base_model: "vendor/future-family-1",
				context_length: 524_288,
				max_output_tokens: 65_536,
				architecture: { input_modalities: ["text", "image"] },
			},
		},
		parameters: {
			"canonical/vendor/future-family-1": {
				provider: "canonical",
				base_model: "vendor/future-family-1",
				supports_function_calling: true,
			},
		},
	}, []);
	assert.equal(rich.models.length, 1);
	assert.equal(rich.models[0]?.contextWindow, 524_288);
	assert.equal(rich.models[0]?.maxTokens, 65_536);
	assert.deepEqual(rich.models[0]?.input, ["text", "image"]);
	assert.equal(rich.models[0]?.capabilitySources?.contextWindow, "canonical-family");
});

test("aggregator prefix-only changes do not require a Pifrost alias release", () => {
	const live = [sparseLive("openrouter/zai-org/GLM-5.2")];
	assert.equal(
		resolveModelReference("CommandCode GOAT/zai-org/glm-5.2", live).model?.id,
		"openrouter/zai-org/GLM-5.2",
	);
	assert.equal(
		resolveModelReference("opencode-go/zai-org/GLM-5.2", live).model?.id,
		"openrouter/zai-org/GLM-5.2",
	);
});

test("sparse live generic defaults are not treated as authoritative limits", () => {
	const aliases: PifrostAliasConfig = { includePhysicalModels: false, aliases: { "omp-unknown": ["custom/unknown-future-model"] } };
	const rich = buildRichRouteCatalog([sparseLive("unknown-future-model")], aliases, emptySheets, []);
	assert.equal(rich.models.length, 0);
	assert.equal(rich.diagnostics[0]?.status, "missing-pricing");
	assert.match(rich.diagnostics[0]?.reason ?? "", /generic \/v1 defaults are ignored/u);
});

test("capability intersections stay conservative after rich resolution", () => {
	const aliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: { "omp-mixed": ["vendor/one", "vendor/two"] },
	};
	const one = toProviderModel({
		id: "vendor/one",
		context_length: 800_000,
		max_output_tokens: 100_000,
		architecture: { input_modalities: ["text", "image"] },
		supported_parameters: ["tools", "reasoning_effort"],
		reasoning: { supported_efforts: ["low", "high", "max"] },
	});
	const two = toProviderModel({
		id: "vendor/two",
		context_length: 600_000,
		max_output_tokens: 70_000,
		architecture: { input_modalities: ["text"] },
		supported_parameters: ["tools", "reasoning_effort"],
		reasoning: { supported_efforts: ["high", "max"] },
	});
	assert.ok(one && two);
	const rich = buildRichRouteCatalog([one, two], aliases, emptySheets, []);
	const catalog = buildPifrostCatalog(rich.models, aliases, rich.diagnostics);
	const mixed = catalog.models[0];
	assert.ok(mixed);
	assert.equal(mixed.contextWindow, 600_000);
	assert.equal(mixed.maxTokens, 70_000);
	assert.deepEqual(mixed.input, ["text"]);
	assert.deepEqual(mixed.thinking?.efforts.map(String), ["high", "max"]);
	assert.equal(mixed.supportsTools, true);
});
