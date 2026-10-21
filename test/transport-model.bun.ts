import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore -- bun:test is provided by the Bun CI/runtime, not Pifrost's Node type surface.
import { test } from "bun:test";
import type { Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { resolveOpenAIRequestSetup } from "@oh-my-pi/pi-ai/providers/openai-shared";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import { auditReasoningReplay, strictReplayCompatOverrides } from "../reasoning-integrity.ts";
import { getBundledModels, getBundledProviders } from "@oh-my-pi/pi-catalog";
import { physicalPolicyIdentity, physicalRequestContractKey } from "../request-compatibility.ts";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import { resolveModelTokenizer } from "@oh-my-pi/pi-catalog/model-tokenizer";
import {
	buildPifrostTransportModel,
	installPifrostModelPolicyResolver,
	installPifrostModelTokenizerResolver,
	resolvePifrostReasoningWithToolsPolicy,
	resolvePifrostReasoningReplayRequirement,
} from "../transport-model.ts";
import { resolveRouteReasoningWithToolsPolicy } from "../datasheet.ts";
import { createPifrostMemberModelSpec } from "../multi-protocol-routing.ts";
import pifrostProvider from "../native.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

installPifrostModelPolicyResolver((spec) => resolveModelPolicy(spec));
installPifrostModelTokenizerResolver((modelId, provider) => resolveModelTokenizer(modelId, provider));

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
	} as unknown as Model;
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
		assert.equal((transport.compat as unknown as Record<string, unknown>).reasoningContentField === "logical-incompatible", false);
	}
});


test("Release C opt-in registers an OMP-native TypeSafe judge, without rewriting role or executing any judgment", async () => {
	const names = ["BIFROST_URL", "BIFROST_API_KEY", "BIFROST_VIRTUAL_KEY", "PIFROST_NATIVE_JUDGE_MODEL", "PIFROST_CONFIG_DIR"] as const;
	const saved = Object.fromEntries(names.map(name => [name, process.env[name]])) as Record<string, string | undefined>;
	const providers = new Map<string, Record<string, unknown>>();
	let commandCount = 0;
	let eventCount = 0;
	try {
		process.env.BIFROST_URL = "http://127.0.0.1:8180/v1";
		delete process.env.BIFROST_API_KEY;
		process.env.BIFROST_VIRTUAL_KEY = "sk-bf-unit-test";
		process.env.PIFROST_NATIVE_JUDGE_MODEL = "jev-latest";
		process.env.PIFROST_CONFIG_DIR = "/tmp/pifrost-judge-bun-fixture-should-not-write";
		const pi = {
			registerFlag: () => {},
			getFlag: () => undefined,
			registerProvider: (name: string, config: Record<string, unknown>) => { providers.set(name, config); },
			on: () => { eventCount++; },
			registerCommand: () => { commandCount++; },
		} as unknown as ExtensionAPI;
		await pifrostProvider(pi);
		assert.ok(providers.has("bifrost"), "normal chat provider is still registered");
		const judge = providers.get("bifrost-judge");
		assert.ok(judge, "native judge is registered separately");
		assert.equal(judge.api, "typesafe");
		assert.equal(judge.baseUrl, "http://127.0.0.1:8180/typesafe");
		assert.equal(judge.apiKey, "sk-bf-unit-test");
		const models = judge.models as Array<Record<string, unknown>>;
		assert.equal(models.length, 1);
		assert.equal(models[0]?.id, "jev-latest");
		assert.equal(models[0]?.api, "typesafe");
		assert.equal(models[0]?.kind, "judge");
		assert.equal(models[0]?.reasoning, false);
		assert.equal(commandCount, 1, "Pifrost retains its existing slash-command handler");
		assert.ok(eventCount > 0);
		assert.equal("modelRoles" in judge, false, "judge role stays with OMP's model-role configuration");
	} finally {
		for (const name of names) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
	}
});

test("Release D: OMP natively serializes missing DeepSeek Responses replay when strict physical policy is resolved", async()=>{
  const reference="CommandCode GOAT/deepseek/deepseek-v4.1-flash";
  assert.equal(resolvePifrostReasoningReplayRequirement("commandcode","deepseek/deepseek-v4.1-flash","openai-responses"),
    "all-assistant-runs");
  const spec={
    id:"deepseek/deepseek-v4.1-flash",requestModelId:reference,
    name:"DeepSeek Flash",provider:"commandcode",api:"openai-responses",
    baseUrl:"http://127.0.0.1:8180/v1",reasoning:true,
    input:["text"],supportsTools:true,cost,contextWindow:1_000_000,maxTokens:131072,
    compat: strictReplayCompatOverrides("all-assistant-runs"),
  } as ModelSpec<"openai-responses">;
  const model=buildPifrostTransportModel(spec);
  assert.equal(model.compat.requiresReasoningContentForAllAssistantTurns,true);
  let captured:Record<string,any>|undefined;
  const fakeFetch: typeof fetch=async(_url,_init)=>new Response(
    JSON.stringify({error:{type:"invalid_request_error",message:"synthetic test end"}}),
    {status:400,headers:{"content-type":"application/json"}},
  );
  const previous={
    role:"assistant",api:"openai-responses",provider:"other-provider",model:"other-model",
    content:[{type:"text",text:"Previous assistant response"}],
    stopReason:"stop",timestamp:Date.now(),
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
  };
  const user={role:"user",content:[{type:"text",text:"continue"}],timestamp:Date.now()};
  const stream=streamOpenAIResponses(model,{
    systemPrompt:["synthetic test"],messages:[previous,user] as any,tools:[],
  },{
    apiKey:"sk-not-a-real-key",sessionId:"release-d-omp-native-serializer",maxTokens:4096,
    reasoning:"high",statefulResponses:false,fetch:fakeFetch,
    onPayload:(body:unknown)=>{captured=body as Record<string,any>;return body;},
  });
  try { for await(const _event of stream) { /* synthetic upstream error */ } }
  catch { /* only the outgoing serialized body is under test */ }
  assert.ok(captured,"OMP must have produced a final Responses payload");
  const audit=auditReasoningReplay(captured,{
    protocol:"openai-responses",requirement:"all-assistant-runs",source:"physical-omp-policy",
  },true);
  assert.equal(audit.reason,"verified");
  assert.ok(audit.nativeReasoningItems>0,"native OMP serializer provides required reasoning item");
  assert.equal(audit.missingRequiredRuns,0);
});
