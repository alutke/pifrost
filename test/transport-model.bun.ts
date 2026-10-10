import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore -- bun:test is provided by the Bun CI/runtime, not Pifrost's Node type surface.
import { test } from "bun:test";
import type { Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { resolveOpenAIRequestSetup } from "@oh-my-pi/pi-ai/providers/openai-shared";
import { getBundledModels, getBundledProviders } from "@oh-my-pi/pi-catalog";
import { physicalPolicyIdentity, physicalRequestContractKey } from "../request-compatibility.ts";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import {
	buildPifrostTransportModel,
	installPifrostModelPolicyResolver,
	resolvePifrostReasoningWithToolsPolicy,
} from "../transport-model.ts";
import { resolveRouteReasoningWithToolsPolicy } from "../datasheet.ts";
import { createPifrostMemberModelSpec } from "../multi-protocol-routing.ts";

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


test("CommandCode DeepSeek V4.1 uses the same OMP reasoning policy as its physical identity on both protocols", () => {
	const logical = {
		id: "omp-default", name: "omp-default", provider: "bifrost", api: "openai-completions",
		baseUrl: "http://bifrost/v1", reasoning: true, input: ["text"],
		cost, contextWindow: 1_000_000, maxTokens: 384_000,
	} as Model;
	const reference = "CommandCode GOAT/deepseek/deepseek-v4.1-flash";
	for (const api of ["openai-completions", "openai-responses"] as const) {
		const spec = createPifrostMemberModelSpec(logical, {
			reference, resolvedModelId: reference, contextWindow: 1_000_000, maxTokens: 384_000,
			input: ["text"], reasoning: true, supportsTools: true, protocols: [api], compat: {},
		}, api);
		const transport = buildPifrostTransportModel(spec);
		assert.equal(transport.requestModelId, reference);
		assert.equal(transport.provider, "commandcode");
		assert.equal(transport.identity.class, "deepseek");
		assert.equal(transport.reasoning, true);
		assert.deepEqual(requestProjection(transport), requestProjection(buildModel(spec)));
	}
});


test("all bundled OMP provider namespaces retain physical policy materializer equivalence on Chat and Responses", () => {
	const providers = getBundledProviders();
	let checked = 0;
	for (const provider of providers) {
		const rows = getBundledModels(provider);
		const exemplar = rows.find((row) => typeof row.id === "string" && row.id.length > 0);
		if (!exemplar) continue;
		const reference = provider + "/" + exemplar.id;
		const identity = physicalPolicyIdentity(reference);
		assert.ok(identity, reference);
		assert.equal(identity.provider, provider, reference);
		assert.equal(identity.requestModelId, reference);
		const logical = {
			id: "omp-test", provider: "bifrost", api: "openai-completions", name: "omp-test",
			baseUrl: "http://bifrost/v1", cost, contextWindow: 262_144, maxTokens: 32_768,
			compatConfig: { reasoningContentField: "do-not-inherit", supportsDeveloperRole: true },
		} as unknown as Model;
		for (const api of ["openai-completions", "openai-responses"] as const) {
			const spec = createPifrostMemberModelSpec(logical, {
				reference, resolvedModelId: reference, contextWindow: 262_144, maxTokens: 32_768,
				input: ["text"], reasoning: exemplar.reasoning ?? false, supportsTools: true,
				protocols: [api], compat: { supportsToolChoice: true },
			}, api);
			assert.equal((spec.compat as Record<string, unknown>).reasoningContentField, undefined);
			const actual = buildPifrostTransportModel(spec);
			const expected = buildModel(spec);
			assert.deepEqual(requestProjection(actual), requestProjection(expected), reference + " " + api);
			assert.equal(actual.requestModelId, reference);
			assert.ok(physicalRequestContractKey(actual).length > 50);
			checked += 1;
		}
	}
	assert.ok(checked >= 20, "expected broad coverage of pinned OMP provider catalogue");
});


// This exercises the same common request-header builder used by OMP's native
// Chat Completions and Responses transports. A model-spec assertion alone did
// not catch v0.12.3: the physical model lost headers before HTTP serialization.
test("all physical Chat and Responses requests authenticate to Bifrost with inherited VK header", () => {
	const logical = {
		id: "omp-default", name: "omp-default", provider: "bifrost", api: "openai-completions",
		baseUrl: "http://bifrost/v1", reasoning: true, input: ["text"], cost,
		contextWindow: 128_000, maxTokens: 8_192,
		headers: {
			"x-bf-vk": "vk-local-test-placeholder",
			"User-Agent": "pifrost/test OMP",
			"x-bf-eh-user-agent": "pifrost/test OMP",
		},
		compatConfig: { reasoningContentField: "logical-incompatible" },
	} as Model;
	for (const api of ["openai-completions", "openai-responses"] as const) {
		const reference = "CommandCode GOAT/deepseek/deepseek-v4.1-flash";
		const spec = createPifrostMemberModelSpec(logical, {
			reference, resolvedModelId: reference, contextWindow: 128_000, maxTokens: 8_192,
			input: ["text"], reasoning: true, supportsTools: true, protocols: [api], compat: {},
		}, api);
		const transport = buildPifrostTransportModel(spec);
		assert.equal(transport.headers?.["x-bf-vk"], "vk-local-test-placeholder", api);
		assert.equal(transport.headers?.["User-Agent"], "pifrost/test OMP", api);
		const request = resolveOpenAIRequestSetup(transport, {
			apiKey: "not-a-real-key",
			extraHeaders: { "x-bf-session-id": "test-session" },
			messages: [],
			sessionId: "test-session",
		});
		assert.equal(request.headers["x-bf-vk"], "vk-local-test-placeholder", api);
		assert.equal(request.headers["x-bf-session-id"], "test-session", api);
		assert.equal(request.headers.Authorization, "Bearer not-a-real-key", api);
		assert.equal((transport.compat as Record<string, unknown>).reasoningContentField === "logical-incompatible", false);
	}
});
