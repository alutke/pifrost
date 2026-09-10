import assert from "node:assert/strict";
import test from "node:test";

import type { BifrostProviderModel, PifrostAliasConfig, PifrostCatalog } from "../index.ts";
import {
	applyDynamicRouteProfiles,
	createDynamicRoutingFetch,
	extractDynamicRouteProfiles,
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
