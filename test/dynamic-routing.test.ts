import assert from "node:assert/strict";
import test from "node:test";

import type { BifrostProviderModel, PifrostAliasConfig, PifrostCatalog } from "../index.ts";
import {
	applyDynamicRouteProfiles,
	createDynamicRoutingFetch,
	extractDynamicRouteProfiles,
	planDynamicRouteAttempts,
	rewriteDynamicOpenAIRequest,
	type DynamicRouteProfile,
} from "../dynamic-routing.ts";

function member(id: string, contextWindow: number, overrides: Partial<BifrostProviderModel> = {}): BifrostProviderModel {
	return {
		id,
		name: id,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 32_000,
		supportsTools: true,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
			disableReasoningOnToolChoice: false,
		},
		...overrides,
	};
}

const aliases: PifrostAliasConfig = {
	includePhysicalModels: false,
	aliases: {
		"omp-default": {
			name: "omp-default",
			chain: ["provider/large", "provider/small", "provider/large-two"],
			dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },
		} as never,
	},
};

const physical = [
	member("provider/large", 1_000_000),
	member("provider/small", 256_000),
	member("provider/large-two", 1_000_000),
];

function baseCatalog(): PifrostCatalog {
	return {
		models: [{ ...member("omp-default", 256_000), maxTokens: 32_000 }],
		diagnostics: [{
			id: "omp-default", name: "omp-default", chain: aliases.aliases["omp-default"] && !Array.isArray(aliases.aliases["omp-default"]) ? aliases.aliases["omp-default"].chain : [],
			resolved: [], unresolved: [], contextWindow: 256_000, maxTokens: 32_000, image: false, reasoning: true, reasoningEfforts: ["high"], tools: true,
		}],
	};
}

function profile(): DynamicRouteProfile {
	const catalog = applyDynamicRouteProfiles(baseCatalog(), physical, aliases, (reference, models) =>
		models.find((model) => model.id === reference),
	);
	const profiles = extractDynamicRouteProfiles(catalog.models);
	const value = profiles.get("omp-default");
	assert.ok(value);
	return value;
}

test("dynamic alias advertises the largest context while retaining safe output ceiling", () => {
	const catalog = applyDynamicRouteProfiles(baseCatalog(), physical, aliases, (reference, models) =>
		models.find((model) => model.id === reference),
	);
	assert.equal(catalog.models[0]?.contextWindow, 1_000_000);
	assert.equal(catalog.models[0]?.maxTokens, 32_000);
	const route = profile();
	assert.equal(route.staticContextWindow, 256_000);
	assert.equal(route.advertisedContextWindow, 1_000_000);
	assert.deepEqual(route.bands.map((band) => [band.maxRequiredTokens, band.members]), [
		[256_000, ["provider/large", "provider/small", "provider/large-two"]],
		[1_000_000, ["provider/large", "provider/large-two"]],
	]);
});

test("large requests remove small-context members but preserve route order", () => {
	const route = profile();
	const body = { model: "omp-default", messages: [{ role: "user", content: "x".repeat(300_000) }], max_tokens: 32_000 };
	const result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 1, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });
	assert.equal(result.body.model, "provider/large");
	assert.deepEqual(result.body.fallbacks, ["provider/large-two"]);
	assert.equal(result.decision.excluded[0]?.reference, "provider/small");
});

test("small requests retain every route member", () => {
	const route = profile();
	const body = { model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 };
	const result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });
	assert.equal(result.body.model, "provider/large");
	assert.deepEqual(result.body.fallbacks, ["provider/small", "provider/large-two"]);
});


test("native semantic estimate outranks an inflated serialized-body estimate", () => {
	const route = profile();
	const body = {
		model: "omp-default",
		messages: [{
			role: "toolResult",
			content: [{ type: "text", text: "small visible result" }],
			details: { raw: "x".repeat(4_000_000) },
		}],
		max_tokens: 32_000,
	};
	const plan = planDynamicRouteAttempts(route, body, {
		estimatedInputTokens: 12_000,
		outputCapExplicit: false,
	});
	assert.equal(plan.estimatedInputTokens, 12_000);
	assert.equal(plan.requiredContextTokens, 44_000);
	assert.deepEqual(plan.excluded, []);
	assert.equal(plan.attempts[0]?.primary, "provider/large");
});

test("protocol prewalk removes responses-only members from Pifrost chat requests", () => {
	const route = profile();
	route.members[0] = { ...route.members[0]!, protocols: ["openai-responses"] };
	route.members[1] = { ...route.members[1]!, protocols: ["openai-completions"] };
	route.members[2] = { ...route.members[2]!, protocols: ["openai-completions"] };
	const body = { model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 };
	const result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });
	assert.equal(result.body.model, "provider/small");
	assert.deepEqual(result.body.fallbacks, ["provider/large-two"]);
	assert.deepEqual(result.decision.excluded[0], {
		reference: "provider/large",
		reasons: ["protocol openai-responses incompatible with openai-completions"],
	});
});

test("multi-protocol planner preserves Muse-first route order and groups Chat fallbacks", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		reference: "opencode-go/muse-spark-1.3-contributor",
		resolvedModelId: "opencode-go/muse-spark-1.3-contributor",
		protocols: ["openai-responses"],
	};
	route.members[1] = {
		...route.members[1]!,
		reference: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
		resolvedModelId: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
		protocols: ["openai-completions"],
	};
	route.members[2] = {
		...route.members[2]!,
		reference: "deepseek/deepseek-flash",
		resolvedModelId: "deepseek/deepseek-flash",
		protocols: ["openai-completions"],
	};
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "hello" }],
			tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
			reasoning_effort: "high",
			max_completion_tokens: 32_000,
		},
		{ bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 },
	);
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
	assert.deepEqual(plan.excluded, []);
});

test("context-aware routes still install prewalk when all context windows are equal", () => {
	const equalPhysical = [
		member("provider/large", 1_000_000, { protocols: ["openai-responses"] }),
		member("provider/small", 1_000_000, { protocols: ["openai-completions"] }),
		member("provider/large-two", 1_000_000, { protocols: ["openai-completions"] }),
	];
	const catalog = applyDynamicRouteProfiles(
		{
			models: [{ ...member("omp-default", 1_000_000), maxTokens: 32_000 }],
			diagnostics: [{
				id: "omp-default", name: "omp-default", chain: ["provider/large", "provider/small", "provider/large-two"],
				resolved: [], unresolved: [], contextWindow: 1_000_000, maxTokens: 32_000, image: false, reasoning: true, reasoningEfforts: ["high"], tools: true,
			}],
		},
		equalPhysical,
		aliases,
		(reference, models) => models.find((model) => model.id === reference),
	);
	const route = extractDynamicRouteProfiles(catalog.models).get("omp-default");
	assert.ok(route);
	assert.equal(route.staticContextWindow, 1_000_000);
	assert.equal(route.advertisedContextWindow, 1_000_000);
	const result = rewriteDynamicOpenAIRequest(
		route,
		{ model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 },
		{ bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 },
	);
	assert.equal(result.body.model, "provider/small");
});

test("final-wire fetch rewrites logical aliases and adds routing diagnostics headers", async () => {
	const route = profile();
	let capturedBody: Record<string, unknown> | undefined;
	let capturedHeaders: Headers | undefined;
	const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		capturedBody = JSON.parse(String(init?.body));
		capturedHeaders = new Headers(init?.headers);
		return new Response("ok", { status: 200 });
	}) as typeof fetch;
	const wrapped = createDynamicRoutingFetch(fakeFetch, new Map([["omp-default", route]]), {
		bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0,
	});
	await wrapped("http://bifrost/v1/chat/completions", {
		method: "POST",
		headers: { "content-type": "application/json", "x-bf-eh-user-agent": "pifrost/test" },
		body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "hello" }], max_tokens: 32_000 }),
	});
	assert.equal(capturedBody?.model, "provider/large");
	assert.deepEqual(capturedBody?.fallbacks, ["provider/small", "provider/large-two"]);
	assert.equal(capturedHeaders?.get("x-pifrost-logical-model"), "omp-default");
	assert.equal(capturedHeaders?.get("x-bf-eh-user-agent"), "pifrost/test");
});

test("capability guard excludes non-tool members when the actual wire request uses tools", () => {
	const route = profile();
	route.members[0] = { ...route.members[0]!, supportsTools: false };
	const body = {
		model: "omp-default",
		messages: [{ role: "user", content: "hello" }],
		tools: [{ type: "function", function: { name: "x", parameters: { type: "object" } } }],
		max_tokens: 32_000,
	};
	const result = rewriteDynamicOpenAIRequest(route, body, { bytesPerToken: 100, safetyMargin: 0, fixedHeadroom: 0, imageTokenReserve: 0 });
	assert.equal(result.body.model, "provider/small");
});


test("tool-choice reasoning suppression does not reject ordinary reasoning requests that merely offer tools", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		compat: {
			...route.members[0]!.compat,
			supportsReasoningWithTools: true,
			disableReasoningOnToolChoice: true,
		},
	};
	const body = {
		model: "omp-default",
		messages: [{ role: "user", content: "hello" }],
		tools: [{ type: "function", function: { name: "x", parameters: { type: "object" } } }],
		reasoning_effort: "high",
		max_completion_tokens: 32_000,
	};
	const result = rewriteDynamicOpenAIRequest(route, body, {
		bytesPerToken: 100,
		safetyMargin: 0,
		fixedHeadroom: 0,
		imageTokenReserve: 0,
		outputCapExplicit: false,
	});
	assert.equal(result.body.model, "provider/large");
	assert.equal(result.decision.outputReserveExplicit, false);
});

test("tool-choice reasoning suppression applies only when tool_choice is actually serialized", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		compat: {
			...route.members[0]!.compat,
			supportsReasoningWithTools: true,
			disableReasoningOnToolChoice: true,
		},
	};
	const body = {
		model: "omp-default",
		messages: [{ role: "user", content: "hello" }],
		tools: [{ type: "function", function: { name: "x", parameters: { type: "object" } } }],
		tool_choice: "auto",
		reasoning_effort: "high",
		max_tokens: 32_000,
	};
	const result = rewriteDynamicOpenAIRequest(route, body, {
		bytesPerToken: 100,
		safetyMargin: 0,
		fixedHeadroom: 0,
		imageTokenReserve: 0,
	});
	assert.equal(result.body.model, "provider/small");
	assert.deepEqual(result.decision.excluded[0], {
		reference: "provider/large",
		reasons: ["reasoning incompatible with tool_choice"],
	});
});

test("dedicated reasoning-with-tools capability can reject reasoning requests with offered tools", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		compat: { ...route.members[0]!.compat, supportsReasoningWithTools: false },
	};
	const body = {
		model: "omp-default",
		messages: [{ role: "user", content: "hello" }],
		tools: [{ type: "function", function: { name: "x", parameters: { type: "object" } } }],
		reasoning_effort: "high",
		max_tokens: 32_000,
	};
	const result = rewriteDynamicOpenAIRequest(route, body, {
		bytesPerToken: 100,
		safetyMargin: 0,
		fixedHeadroom: 0,
		imageTokenReserve: 0,
	});
	assert.equal(result.body.model, "provider/small");
	assert.deepEqual(result.decision.excluded[0], {
		reference: "provider/large",
		reasons: ["cannot combine reasoning with tools"],
	});
});

test("capacity errors identify implicit output caps and report every member exclusion", () => {
	const route = profile();
	for (let index = 0; index < route.members.length; index++) {
		route.members[index] = {
			...route.members[index]!,
			protocols: ["openai-responses"],
		};
	}
	assert.throws(
		() => rewriteDynamicOpenAIRequest(
			route,
			{
				model: "omp-default",
				messages: [{ role: "user", content: "hello" }],
				max_completion_tokens: 32_000,
			},
			{
				bytesPerToken: 100,
				safetyMargin: 0,
				fixedHeadroom: 0,
				imageTokenReserve: 0,
				outputCapExplicit: false,
			},
		),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /implicit OMP\/model output cap 32000/u);
			assert.match(error.message, /provider\/large \[protocol openai-responses incompatible with openai-completions\]/u);
			assert.match(error.message, /provider\/small \[protocol openai-responses incompatible with openai-completions\]/u);
			return true;
		},
	);
});


test("runtime compiler refuses dynamic routing when the alias carries Bifrost key pins", () => {
	const pinnedAliases: PifrostAliasConfig = {
		includePhysicalModels: false,
		aliases: {
			"omp-default": {
				name: "omp-default",
				chain: ["provider/large", "provider/small", "provider/large-two"],
				routingPins: [{ source: "fallback", reference: "provider/small", keyId: "pinned-key" }],
				dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },
			},
		},
	};
	const catalog = applyDynamicRouteProfiles(baseCatalog(), physical, pinnedAliases, (reference, models) =>
		models.find((model) => model.id === reference),
	);
	assert.equal(catalog.models[0]?.contextWindow, 256_000);
	assert.equal(extractDynamicRouteProfiles(catalog.models).size, 0);
});

test("heterogeneous fallback groups clamp oversized Chat output caps instead of excluding lower-ceiling models", () => {
	const route = profile();
	route.members[0] = { ...route.members[0]!, maxTokens: 384_000 };
	route.members[1] = { ...route.members[1]!, maxTokens: 131_072 };
	route.members[2] = { ...route.members[2]!, maxTokens: 65_536 };
	const body = {
		model: "omp-default",
		messages: [{ role: "user", content: "hello" }],
		max_completion_tokens: 262_144,
	};
	const result = rewriteDynamicOpenAIRequest(route, body, {
		estimatedInputTokens: 10_000,
		outputCapExplicit: true,
	});
	assert.equal(result.body.model, "provider/large");
	assert.deepEqual(result.body.fallbacks, ["provider/small", "provider/large-two"]);
	assert.equal(result.body.max_completion_tokens, 65_536);
	assert.deepEqual(result.decision.excluded, []);
});

test("Responses max_output_tokens is recognized and clamped to the physical route ceiling", () => {
	const route = profile();
	for (let index = 0; index < route.members.length; index++) {
		route.members[index] = { ...route.members[index]!, maxTokens: 131_072 };
	}
	const result = rewriteDynamicOpenAIRequest(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "hello" }],
			max_output_tokens: 262_144,
		},
		{ estimatedInputTokens: 10_000, outputCapExplicit: true },
	);
	assert.equal(result.body.max_output_tokens, 131_072);
	assert.equal(result.decision.outputReserveTokens, 262_144);
});

test("context eligibility reserves the clamped member output ceiling", () => {
	const route = profile();
	route.members = [{
		...route.members[0]!,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	}];
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "hello" }],
			max_completion_tokens: 262_144,
		},
		{ estimatedInputTokens: 900_000, outputCapExplicit: true },
	);
	assert.equal(plan.attempts[0]?.primary, "provider/large");
	assert.deepEqual(plan.excluded, []);
	assert.equal(plan.requiredContextTokens, 1_162_144);
});


test("Tool Search prewalk keeps only Responses members that explicitly support it", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		protocols: ["openai-responses", "openai-completions"],
		supportsToolSearch: true,
	};
	route.members[1] = {
		...route.members[1]!,
		protocols: ["openai-responses"],
		supportsToolSearch: false,
	};
	route.members[2] = {
		...route.members[2]!,
		protocols: ["openai-completions"],
		supportsToolSearch: true,
	};
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "search" }],
			tools: [
				{ type: "function", name: "fourget_web_search", parameters: { type: "object" }, defer_loading: true },
				{ type: "tool_search", execution: "server" },
			],
			max_output_tokens: 32_000,
		},
		{ estimatedInputTokens: 2_000, outputCapExplicit: true },
	);
	assert.deepEqual(plan.attempts.map((attempt) => [attempt.protocol, attempt.primary]), [
		["openai-responses", "provider/large"],
	]);
	assert.deepEqual(plan.excluded, [
		{ reference: "provider/small", reasons: ["no tool-search/deferred-tool support"] },
		{ reference: "provider/large-two", reasons: ["tool search requires Responses transport"] },
	]);
});

test("between-tools thinking excludes members that cannot preserve the requested semantics", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		compat: { ...route.members[0]!.compat, supportsBetweenToolsThinking: true },
	};
	route.members[1] = {
		...route.members[1]!,
		compat: { ...route.members[1]!.compat, supportsBetweenToolsThinking: false },
	};
	route.members[2] = {
		...route.members[2]!,
		compat: { ...route.members[2]!.compat, supportsBetweenToolsThinking: true },
	};
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "continue" }],
			reasoning: { type: "between_tools" },
			max_tokens: 32_000,
		},
		{ estimatedInputTokens: 2_000, outputCapExplicit: true },
	);
	assert.deepEqual(plan.excluded, [
		{ reference: "provider/small", reasons: ["no between-tools thinking support"] },
	]);
});

test("service-tier prewalk preserves only members that advertise the requested tier", () => {
	const route = profile();
	route.members[0] = {
		...route.members[0]!,
		supportsServiceTier: true,
		serviceTiers: ["priority", "ultrafast"],
	};
	route.members[1] = {
		...route.members[1]!,
		supportsServiceTier: true,
		serviceTiers: ["priority"],
	};
	route.members[2] = {
		...route.members[2]!,
		supportsServiceTier: false,
	};
	const plan = planDynamicRouteAttempts(
		route,
		{
			model: "omp-default",
			messages: [{ role: "user", content: "fast" }],
			service_tier: "ultrafast",
			max_tokens: 32_000,
		},
		{ estimatedInputTokens: 2_000, outputCapExplicit: true },
	);
	assert.equal(plan.attempts[0]?.primary, "provider/large");
	assert.deepEqual(plan.excluded, [
		{ reference: "provider/small", reasons: ["service tier ultrafast unavailable"] },
		{ reference: "provider/large-two", reasons: ["no service-tier support"] },
	]);
});
