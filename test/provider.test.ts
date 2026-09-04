import assert from "node:assert/strict";
import test from "node:test";
import {
	bifrostHeaders,
	buildPifrostCatalog,
	createNativeProviderConfig,
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
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
		},
		...overrides,
	};
}

function effortThinking(...efforts: string[]): NonNullable<BifrostProviderModel["thinking"]> {
	return {
		mode: "effort",
		efforts: efforts as unknown as NonNullable<BifrostProviderModel["thinking"]>["efforts"],
	};
}

test("normalizes Bifrost URLs to the native /v1 mount", () => {
	assert.equal(normalizeBifrostUrl("http://localhost:8180"), "http://localhost:8180/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/v1"), "http://localhost:8180/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/openai/v1/models"), "http://localhost:8180/openai/v1");
});

test("keeps API auth and virtual-key governance independent", () => {
	assert.deepEqual(
		bifrostHeaders({ url: "http://bifrost/v1", apiKey: "api", virtualKey: "sk-bf-vk" }),
		{
			Accept: "application/json",
			Authorization: "Bearer api",
			"x-bf-vk": "sk-bf-vk",
		},
	);
	assert.equal(bifrostHeaders({ url: "http://bifrost/v1" }).Authorization, null);
});

test("maps rich Bifrost model metadata to canonical OMP thinking metadata", () => {
	const mapped = toProviderModel({
		id: "openai/gpt-test",
		context_length: 1_000_000,
		max_output_tokens: 128_000,
		architecture: { input_modalities: ["text", "image"] },
		supported_parameters: ["tools", "reasoning_effort"],
		reasoning: { supported_efforts: ["low", "high", "max"], default_effort: "high" },
	});
	assert.ok(mapped);
	assert.equal(mapped.contextWindow, 1_000_000);
	assert.equal(mapped.maxTokens, 128_000);
	assert.deepEqual(mapped.input, ["text", "image"]);
	assert.equal(mapped.supportsTools, true);
	assert.equal(mapped.reasoning, true);
	assert.equal(mapped.thinking?.mode, "effort");
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["low", "high", "max"]);
	assert.equal(String(mapped.thinking?.defaultLevel), "high");
});

test("maps Bifrost 2.x reasoning effort none onto OMP minimal wire semantics", () => {
	const mapped = toProviderModel({
		id: "provider/reasoning-off",
		context_length: 128_000,
		max_output_tokens: 16_000,
		supported_parameters: ["reasoning_effort"],
		reasoning: { supported_efforts: ["none", "low", "high"], default_effort: "none" },
	});
	assert.ok(mapped);
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["minimal", "low", "high"]);
	assert.equal(mapped.thinking?.effortMap?.minimal, "none");
	assert.equal(String(mapped.thinking?.defaultLevel), "minimal");
});

test("does not conflate distinct none and minimal wire efforts", () => {
	const mapped = toProviderModel({
		id: "provider/both",
		context_length: 128_000,
		max_output_tokens: 16_000,
		reasoning: { supported_efforts: ["none", "minimal", "low"] },
	});
	assert.ok(mapped);
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["minimal", "low"]);
	assert.equal(mapped.thinking?.effortMap?.minimal, "minimal");
});

test("native provider accepts Bifrost 2.x Virtual-Key-only inference auth", async () => {
	const provider = createNativeProviderConfig({
		config: { url: "http://bifrost/v1", virtualKey: "sk-bf-vk-only" },
		aliasConfig: { includePhysicalModels: false, aliases: {} },
		fetch: async (_input, init) => {
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("authorization"), null);
			assert.equal(headers.get("x-bf-vk"), "sk-bf-vk-only");
			return new Response(JSON.stringify({
				data: [{ id: "model", context_length: 128_000, max_output_tokens: 8192 }],
			}), { status: 200, headers: { "content-type": "application/json" } });
		},
	});
	assert.equal(provider.apiKey, "sk-bf-vk-only");
	assert.equal(provider.authHeader, true);
	const models = await provider.fetchDynamicModels("sk-bf-vk-only");
	assert.equal(models[0]?.id, "model");
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
	const physical = [
		model("one", {
			reasoning: true,
			thinking: effortThinking("low", "high", "max"),
			input: ["text", "image"],
			supportsTools: true,
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort: true,
				supportsUsageInStreaming: true,
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

test("alias reasoning effort is the intersection of every fallback", () => {
	const physical = [
		model("one", {
			reasoning: true,
			thinking: effortThinking("low", "high", "max"),
			compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, supportsUsageInStreaming: true },
		}),
		model("two", {
			reasoning: true,
			thinking: effortThinking("high", "max"),
			compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, supportsUsageInStreaming: true },
		}),
	];
	const result = synthesizeAlias("reasoning", ["one", "two"], physical);
	assert.ok(result.model);
	assert.deepEqual(result.model.thinking?.efforts.map(String), ["high", "max"]);
	assert.deepEqual(result.diagnostic.reasoningEfforts, ["high", "max"]);
});

test("alias is withheld when any configured fallback cannot be resolved", () => {
	const result = synthesizeAlias("broken", ["known", "missing"], [model("known")]);
	assert.equal(result.model, undefined);
	assert.deepEqual(result.diagnostic.unresolved, ["missing"]);
});

test("alias-only mode hides physical models from OMP while retaining them for derivation", () => {
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

test("native OMP provider uses Chat Completions and separate x-bf-vk governance", async () => {
	let capturedHeaders: Headers | undefined;
	const fakeFetch: typeof fetch = async (_input, init) => {
		capturedHeaders = new Headers(init?.headers);
		return new Response(
			JSON.stringify({
				data: [
					{
						id: "deepseek/deepseek-v4-flash",
						context_length: 1_000_000,
						max_output_tokens: 128_000,
						supported_parameters: ["tools", "reasoning_effort"],
						reasoning: { supported_efforts: ["high", "max"] },
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	};

	const provider = createNativeProviderConfig({
		config: { url: "http://bifrost/v1", apiKey: "api", virtualKey: "vk" },
		aliasConfig: { includePhysicalModels: false, aliases: { "omp-task": ["deepseek/deepseek-v4-flash"] } },
		fetch: fakeFetch,
	});

	assert.equal(provider.api, "openai-completions");
	assert.equal(provider.authHeader, true);
	assert.deepEqual(provider.headers, { "x-bf-vk": "vk" });
	const models = await provider.fetchDynamicModels("resolved-api");
	assert.deepEqual(models.map((entry) => entry.id), ["omp-task"]);
	assert.equal(capturedHeaders?.get("authorization"), "Bearer resolved-api");
	assert.equal(capturedHeaders?.get("x-bf-vk"), "vk");
});
