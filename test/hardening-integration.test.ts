import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import { bridgePifrostPayload, deferredToolNames } from "../capability-bridge.ts";
import {
	createDynamicRoutingFetch,
	planDynamicRouteAttempts,
	type DynamicRouteMemberProfile,
	type DynamicRouteProfile,
} from "../dynamic-routing.ts";
// @ts-expect-error mcp-rpc.mjs is intentionally dependency-free JavaScript used by the standalone CLI.
import { postMcpJsonRpc } from "../mcp-rpc.mjs";

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
	const server = createServer((req, res) => {
		void Promise.resolve(handler(req, res)).catch((error) => {
			res.statusCode = 500;
			res.end(String(error));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
	};
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

function member(
	reference: string,
	contextWindow: number,
	overrides: Partial<DynamicRouteMemberProfile> = {},
): DynamicRouteMemberProfile {
	return {
		reference,
		resolvedModelId: reference,
		contextWindow,
		maxTokens: 32_000,
		input: ["text"],
		reasoning: true,
		supportsTools: true,
		protocols: ["openai-completions"],
		compat: {
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
		},
		...overrides,
	};
}

function profile(members: DynamicRouteMemberProfile[]): DynamicRouteProfile {
	return {
		id: "omp-integration",
		mode: "context-aware",
		source: "bifrost-simple-rule",
		staticContextWindow: Math.min(...members.map((item) => item.contextWindow)),
		advertisedContextWindow: Math.max(...members.map((item) => item.contextWindow)),
		maxTokens: 32_000,
		members,
		bands: [],
	};
}

test("real HTTP boundary rewrites a logical Chat request without changing surviving Bifrost order", async () => {
	let receivedBody: Record<string, unknown> | undefined;
	let receivedHeaders: IncomingMessage["headers"] | undefined;
	const server = await listen(async (req, res) => {
		receivedHeaders = req.headers;
		receivedBody = JSON.parse(await readBody(req));
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ ok: true }));
	});
	try {
		const route = profile([
			member("provider/first", 256_000),
			member("provider/too-small", 120_000),
			member("provider/third", 256_000),
		]);
		const routedFetch = createDynamicRoutingFetch(
			globalThis.fetch,
			new Map([[route.id, route]]),
			{ estimatedInputTokens: 100_000, outputCapExplicit: true },
		);
		const response = await routedFetch(`${server.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: route.id,
				messages: [{ role: "user", content: "hello" }],
				max_tokens: 32_000,
			}),
		});
		assert.equal(response.status, 200);
		assert.equal(receivedBody?.model, "provider/first");
		assert.deepEqual(receivedBody?.fallbacks, ["provider/third"]);
		assert.equal(receivedHeaders?.["x-pifrost-logical-model"], route.id);
		assert.equal(receivedHeaders?.["x-pifrost-eligible-members"], "2");
	} finally {
		await server.close();
	}
});

test("real MCP Streamable HTTP boundary ignores notifications and unrelated response ids", async () => {
	let requestBody: Record<string, unknown> | undefined;
	let virtualKey: string | undefined;
	const server = await listen(async (req, res) => {
		virtualKey = Array.isArray(req.headers["x-bf-vk"]) ? req.headers["x-bf-vk"][0] : req.headers["x-bf-vk"];
		requestBody = JSON.parse(await readBody(req));
		res.statusCode = 200;
		res.setHeader("content-type", "text/event-stream");
		res.end([
			'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
			"",
			'data: {"jsonrpc":"2.0","id":91,"result":{"tools":[]}}',
			"",
			'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"hound-mcp_smart_search"}]}}',
			"",
		].join("\n"));
	});
	try {
		const result = await postMcpJsonRpc(
			`${server.url}/mcp`,
			"vk-integration",
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
		);
		assert.equal(result.ok, true);
		assert.equal(virtualKey, "vk-integration");
		assert.equal(requestBody?.method, "tools/list");
		assert.equal(result.body?.id, 2);
		assert.deepEqual(result.body?.result?.tools, [{ name: "hound-mcp_smart_search" }]);
	} finally {
		await server.close();
	}
});

test("Tool Search planning and wire bridging agree on the same Responses-only capability boundary", () => {
	const route = profile([
		member("openai/tool-search", 256_000, {
			protocols: ["openai-responses", "openai-completions"],
			supportsToolSearch: true,
		}),
		member("deepseek/chat-fallback", 256_000, {
			protocols: ["openai-completions"],
			supportsToolSearch: false,
		}),
	]);
	const toolDefinitions = [
		{ name: "read" },
		{ name: "mcp_smart_search", deferLoading: true },
	];
	const serialized = {
		model: route.id,
		input: [{ role: "user", content: [{ type: "input_text", text: "search" }] }],
		tools: [
			{ type: "function", name: "read", parameters: { type: "object" } },
			{ type: "function", name: "mcp_smart_search", parameters: { type: "object" } },
		],
		max_output_tokens: 16_000,
	};
	const bridged = bridgePifrostPayload(serialized, {
		deferredTools: deferredToolNames(toolDefinitions),
		enableToolSearch: true,
	}) as Record<string, unknown>;
	const plan = planDynamicRouteAttempts(
		route,
		bridged,
		{ estimatedInputTokens: 4_000, outputCapExplicit: true },
	);
	assert.equal(plan.attempts.length, 1);
	assert.equal(plan.attempts[0]?.protocol, "openai-responses");
	assert.equal(plan.attempts[0]?.primary, "openai/tool-search");
	assert.deepEqual(plan.excluded, [{
		reference: "deepseek/chat-fallback",
		reasons: ["no tool-search/deferred-tool support", "tool search requires Responses transport"],
	}]);
	const tools = bridged.tools as Array<Record<string, unknown>>;
	assert.equal(tools.find((tool) => tool.name === "mcp_smart_search")?.defer_loading, true);
	assert.ok(tools.some((tool) => tool.type === "tool_search" && tool.execution === "server"));
});
