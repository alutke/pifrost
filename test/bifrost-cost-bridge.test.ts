import assert from "node:assert/strict";
import test from "node:test";

import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import {
	bridgeBifrostUsageCostPayload,
	bridgeBifrostUsageCostResponse,
	bridgeBifrostUsageCostStream,
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


test("applies captured Bifrost total after OMP parsing for the bifrost provider", async () => {
	const capture = {
		total: 0.06,
		breakdown: { input_cost: 0.01, output_cost: 0.05, total_cost: 0.06 },
	};
	const source = new AssistantMessageEventStream();
	const bridged = bridgeBifrostUsageCostStream(source, capture);
	source.push({
		type: "done",
		reason: "stop",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "openai-completions",
			provider: "bifrost",
			model: "omp-default",
			usage: {
				input: 100,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 120,
				cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		},
	} as never);
	const message = await bridged.result();
	assert.equal(message.usage.cost.total, 0.06);
	assert.equal(message.usage.cost.input, 0.03);
	assert.equal(message.usage.cost.output, 0.03);
});
