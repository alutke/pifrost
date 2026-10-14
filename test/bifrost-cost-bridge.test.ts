import assert from "node:assert/strict";
import test from "node:test";

import {
	applyBifrostAuthoritativeCost,
	applyBifrostResolvedModel,
	bridgeBifrostUsageCostPayload,
	bridgeBifrostUsageCostResponse,
	clearUnverifiedNativeOrigin,
	createBifrostCostBridgeFetch,
} from "../bifrost-cost-bridge.ts";

test("bridges nested Bifrost usage cost into OMP's scalar provider-cost shape", () => {
	const source = {
		id: "chatcmpl-test",
		usage: {
			prompt_tokens: 100,
			completion_tokens: 20,
			cost: {
				input_cost: 0.001,
				output_cost: 0.002,
				additional_cost: 0.003,
				total_cost: 0.006,
			},
		},
	};
	const bridged = bridgeBifrostUsageCostPayload(source) as typeof source & {
		usage: typeof source.usage & { cost: number; pifrost_bifrost_cost: object };
	};
	assert.equal(bridged.usage.cost, 0.006);
	assert.deepEqual(bridged.usage.pifrost_bifrost_cost, source.usage.cost);
	assert.deepEqual(source.usage.cost, {
		input_cost: 0.001,
		output_cost: 0.002,
		additional_cost: 0.003,
		total_cost: 0.006,
	});
});

test("leaves ordinary OpenAI scalar usage costs unchanged", () => {
	const source = { usage: { prompt_tokens: 10, completion_tokens: 1, cost: 0.01 } };
	assert.equal(bridgeBifrostUsageCostPayload(source), source);
});

test("bridges non-streaming JSON responses without losing Bifrost breakdown", async () => {
	const response = new Response(JSON.stringify({
		response: {
			usage: {
				input_tokens: 50,
				output_tokens: 5,
				cost: { input_cost: 0.01, output_cost: 0.02, total_cost: 0.03 },
			},
		},
	}), {
		headers: { "content-type": "application/json", "content-length": "999" },
	});
	const bridged = await bridgeBifrostUsageCostResponse(response);
	assert.equal(bridged.headers.has("content-length"), false);
	const body = await bridged.json() as {
		response: { usage: { cost: number; pifrost_bifrost_cost: { total_cost: number } } };
	};
	assert.equal(body.response.usage.cost, 0.03);
	assert.equal(body.response.usage.pifrost_bifrost_cost.total_cost, 0.03);
});

test("bridges nested cost in streaming SSE without buffering the whole response", async () => {
	const encoder = new TextEncoder();
	const payload = JSON.stringify({
		type: "response.completed",
		response: {
			usage: {
				input_tokens: 25,
				output_tokens: 4,
				cost: { input_cost: 0.02, output_cost: 0.01, total_cost: 0.03 },
			},
		},
	});
	const raw = `data: ${payload}\n\ndata: [DONE]\n\n`;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(raw.slice(0, 31)));
			controller.enqueue(encoder.encode(raw.slice(31)));
			controller.close();
		},
	});
	const baseFetch = (async () => new Response(stream, {
		headers: { "content-type": "text/event-stream" },
	})) as typeof fetch;
	const response = await createBifrostCostBridgeFetch(baseFetch)("http://bifrost/v1/responses");
	const text = await response.text();
	assert.match(text, /"cost":0\.03/u);
	assert.match(text, /"pifrost_bifrost_cost":\{"input_cost":0\.02/u);
	assert.match(text, /data: \[DONE\]/u);
});


test("applies captured Bifrost total to OMP-shaped parsed usage", () => {
	const capture = {
		total: 0.06,
		breakdown: { input_cost: 0.01, output_cost: 0.05, total_cost: 0.06 },
	};
	const usage = applyBifrostAuthoritativeCost({
		cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
	}, capture);
	assert.equal(usage.cost.total, 0.06);
	assert.equal(usage.cost.input, 0.03);
	assert.equal(usage.cost.output, 0.03);
});


test("native alias never treats encoder primary as actual Bifrost serving model", () => {
	const incoming = { model: "physical/first", upstreamModel: "physical/first", upstreamProvider: "old-host" };
	const cleaned = clearUnverifiedNativeOrigin(incoming, "omp-default");
	assert.equal(cleaned.model, "omp-default");
	assert.equal(cleaned.upstreamModel, undefined);
	assert.equal(cleaned.upstreamProvider, undefined);
	assert.equal(incoming.model, "physical/first", "do not mutate upstream event");
	assert.deepEqual(applyBifrostResolvedModel(cleaned, {}), cleaned);
	const confirmed = applyBifrostResolvedModel(cleaned, { resolvedModel: "physical/fallback", provider: "new-host" });
	assert.equal(confirmed.upstreamModel, "physical/fallback");
	assert.equal(confirmed.upstreamProvider, "new-host");
	assert.equal(confirmed.model, "omp-default");
});

test("captures Bifrost routed identity and request provenance headers", async () => {
	const capture: import("../bifrost-cost-bridge.ts").BifrostCostCapture = {};
	const response = new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
		headers: {
			"content-type": "application/json",
			"x-bifrost-request-id": "req-123",
			"x-bifrost-routing-info-requested-model": "omp-default",
			"x-bifrost-routing-info-requested-provider": "bifrost",
			"x-bifrost-provider": "deepseek",
			"x-bifrost-resolved-model": "deepseek-v4.1-flash",
			"x-bifrost-original-model": "omp-default",
			"x-bifrost-fallback-index": "1",
			"x-bifrost-routing-info-is-fallback": "true",
			"x-bifrost-routing-info-primary-provider": "commandcode-goat",
			"x-bifrost-routing-info-primary-model": "deepseek-v4.1-flash",
			"x-bifrost-request-type": "chat_completion",
			"x-bifrost-upstream-latency-ms": "123.45",
		},
	});
	await bridgeBifrostUsageCostResponse(response, capture);
	assert.deepEqual(capture, {
		requestId: "req-123",
		requestedModel: "omp-default",
		requestedProvider: "bifrost",
		provider: "deepseek",
		originalModel: "omp-default",
		resolvedModel: "deepseek-v4.1-flash",
		fallbackIndex: 1,
		isFallback: true,
		primaryProvider: "commandcode-goat",
		primaryModel: "deepseek-v4.1-flash",
		requestType: "chat_completion",
		upstreamLatencyMs: 123.45,
	});
});


test("authoritative Bifrost resolved model overrides ambiguous response identity", () => {
	const message = { upstreamModel: "route-primary", value: 1 };
	const resolved = applyBifrostResolvedModel(message, { resolvedModel: "actual-fallback-model" });
	assert.deepEqual(resolved, { upstreamModel: "actual-fallback-model", value: 1 });
	assert.deepEqual(applyBifrostResolvedModel(message, {}), message);
});

test("records only Bifrost-confirmed physical origin without changing logical session identity", () => {
	const original = { provider: "bifrost", model: "omp-default", api: "openai-completions", upstreamModel: "primary", upstreamProvider: "commandcode" };
	const actual = applyBifrostResolvedModel(original, { provider: "deepseek", resolvedModel: "deepseek-v4" });
	assert.deepEqual(actual, { ...original, upstreamModel: "deepseek-v4", upstreamProvider: "deepseek" });
	assert.deepEqual(original, { provider: "bifrost", model: "omp-default", api: "openai-completions", upstreamModel: "primary", upstreamProvider: "commandcode" });
	assert.strictEqual(applyBifrostResolvedModel(actual, { provider: "deepseek", resolvedModel: "deepseek-v4" }), actual);
	assert.strictEqual(applyBifrostResolvedModel(original, { provider: "deepseek" }), original, "no model evidence");
	const withoutProvider = applyBifrostResolvedModel(original, { resolvedModel: "different-fallback" });
	assert.equal(withoutProvider.upstreamModel, "different-fallback");
	assert.equal(withoutProvider.upstreamProvider, undefined, "never attach a stale provider to a different model");
	const sameModelWithoutProvider = applyBifrostResolvedModel(original, { resolvedModel: "primary" });
	assert.equal(sameModelWithoutProvider.upstreamModel, "primary");
	assert.equal(sameModelWithoutProvider.upstreamProvider, undefined,
		"same model ID is not proof of serving provider across hosts");
	assert.notStrictEqual(sameModelWithoutProvider, original);
	assert.equal(original.upstreamProvider, "commandcode", "do not modify OMP history");
	const sameModelDifferentProvider = applyBifrostResolvedModel(original, {
		resolvedModel: "primary", provider: "deepseek",
	});
	assert.equal(sameModelDifferentProvider.upstreamProvider, "deepseek",
		"explicit Bifrost serving-provider evidence supersedes prior inferred host");
});

test("preserves native reasoning and complete tool arguments while bridging routed JSON", async () => {
	const payload = {
		id: "resp-opaque",
		output: [
			{ type: "reasoning", encrypted_content: "signed-provider-opaque", summary: [] },
			{ type: "function_call", call_id: "call_1", name: "search", arguments: '{"query":"all providers","limit":4}' },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Complete" }] },
		],
		usage: { input_tokens: 10, output_tokens: 20, cost: { total_cost: 0.031 } },
	};
	const capture: import("../bifrost-cost-bridge.ts").BifrostCostCapture = {};
	const response = new Response(JSON.stringify(payload), { headers: {
		"content-type": "application/json", "x-bifrost-provider": "deepseek", "x-bifrost-resolved-model": "deepseek-v4",
	} });
	const bridged = await (await bridgeBifrostUsageCostResponse(response, capture)).json() as Record<string, unknown>;
	assert.deepEqual(bridged.output, payload.output, "reasoning and tool args are opaque to this boundary");
	assert.deepEqual({ provider: capture.provider, model: capture.resolvedModel }, { provider: "deepseek", model: "deepseek-v4" });
});
