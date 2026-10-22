import assert from "node:assert/strict";
import test from "node:test";

import { bridgePifrostPayload, deferredToolNames } from "../capability-bridge.ts";

test("extracts OMP deferred-tool intent without treating ordinary tools as deferred", () => {
	const names = deferredToolNames([
		{ name: "read" },
		{ name: "mcp_smart_search", deferLoading: true },
		{ name: "mcp_smart_fetch", deferLoading: true },
	]);
	assert.deepEqual([...names], ["mcp_smart_search", "mcp_smart_fetch"]);
});

test("bridges deferred functions to Responses Tool Search only when explicitly enabled", () => {
	const deferred = new Set(["mcp_smart_search"]);
	const payload = {
		model: "provider/model",
		tools: [
			{ type: "function", name: "read", parameters: { type: "object" } },
			{ type: "function", name: "mcp_smart_search", parameters: { type: "object" } },
		],
	};
	const bridged = bridgePifrostPayload(payload, {
		deferredTools: deferred,
		enableToolSearch: true,
	}) as Record<string, unknown>;
	const tools = bridged.tools as Array<Record<string, unknown>>;
	assert.equal(tools[0]?.defer_loading, undefined);
	assert.equal(tools[1]?.defer_loading, true);
	assert.deepEqual(tools[2], { type: "tool_search", execution: "server" });
});

test("does not invent Tool Search when OMP did not defer a declared tool", () => {
	const payload = {
		tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
	};
	assert.equal(
		bridgePifrostPayload(payload, { deferredTools: new Set(["missing"]), enableToolSearch: true }),
		payload,
	);
});

test("bridges between-tools thinking without retaining incompatible reasoning_effort", () => {
	const bridged = bridgePifrostPayload(
		{ reasoning: { effort: "low" }, reasoning_effort: "low", tools: [] },
		{ betweenToolsThinking: true },
	) as Record<string, unknown>;
	assert.deepEqual(bridged.reasoning, { effort: "low", type: "between_tools" });
	assert.equal("reasoning_effort" in bridged, false);
});

test("Release 5E preserves gateway-mediated discovery without adding native tool_search", () => {
  const body = {
    tools: [
      { type: "function", name: "listToolFiles", parameters: { type: "object" } },
      { type: "function", name: "web_search", parameters: { type: "object" } },
    ],
  };
  const response = bridgePifrostPayload(body, {
    deferredTools: new Set(["web_search"]),
    enableToolSearch: true,
    deferredToolExecution: "gateway",
  });
  assert.equal(response, body, "Bifrost is the authority for gateway-mediated search and Code Mode");
});

test("Release 5E does not synthesize duplicate tool-search definitions", () => {
  const native = {
    tools: [
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "tool_search", execution: "client", parameters: { type: "object" } },
    ],
  };
  const bridged = bridgePifrostPayload(native, {
    deferredTools: new Set(["web_search"]), enableToolSearch: true,
  }) as { tools: Array<Record<string, unknown>> };
  assert.equal(bridged.tools.filter(tool => tool.type === "tool_search").length, 1);
  assert.equal(bridged.tools[1]!.execution, "client", "preserve caller-managed discovery semantics");
  const ambiguous = {
    tools: [
      { type: "function", name: "web_search" },
      { type: "function", name: "web_search" },
    ],
  };
  assert.equal(bridgePifrostPayload(ambiguous, {
    deferredTools: new Set(["web_search"]), enableToolSearch: true,
  }), ambiguous, "duplicated function identities must not silently receive deferred flags");
});
