import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMcpClientShape, mcpClientExecutionDiagnostics } from "../mcp-client-shape.mjs";
import { gatewayInjectedToolDiagnostics, formatGatewayInjectedToolDiagnostics } from "../provider-tool-policy.mjs";
import { inspectMcpToolResult, summarizeMcpProgress, postMcpJsonRpc } from "../mcp-rpc.mjs";

test("R5E-01 OpenAPI operations are diagnostic-only and retain exact Bifrost per-key grants", () => {
  const client = normalizeMcpClientShape({
    config: {
      name: "imported-api", connection_type: "openapi", openapi_spec_url: "https://private.example/spec?token=secret",
      tools_to_execute: ["list_orders"], tools_to_auto_execute: ["list_orders"],
    },
    tools: [
      { name: "list_orders", annotations: { readOnlyHint: true } },
      { name: "delete_order", annotations: { idempotentHint: false } },
    ],
  });
  assert.equal(client.openApiSource, true);
  const policy = mcpClientExecutionDiagnostics(client, ["*"]);
  assert.equal(policy.grantedCount, 2);
  assert.equal(policy.executableCount, 1);
  assert.equal(policy.autoExecutableCount, 1);
  assert.equal(policy.rows.find(row => row.tool === "delete_order").executable, false);
  const report = policy.warnings.join("\n");
  assert.match(report, /OpenAPI-derived MCP operations/);
  assert.match(report, /approval-free gateway execution/);
  assert.doesNotMatch(report, /secret|private\.example/);
  assert.deepEqual(client.toolsToExecute, ["list_orders"]);
});

test("R5E-02 Code Mode nested operations are not conflated with OMP-visible meta-tools", () => {
  const client = normalizeMcpClientShape({
    config: { name: "crm", is_code_mode_client: true, tools_to_execute: ["read", "update"], tools_to_auto_execute: ["read"] },
    tools: [{ name: "read" }, { name: "update", annotations: { idempotentHint: false } }],
  });
  const policy = mcpClientExecutionDiagnostics(client, ["read"]);
  assert.equal(policy.grantedCount, 1);
  assert.equal(policy.autoExecutableCount, 1);
  assert.match(policy.warnings.join(" "), /Code Mode exposes on-demand gateway meta-tools/);
  assert.equal(policy.rows.find(row => row.tool === "update"), undefined);
});

test("R5E-03 provider-injected tools stay gateway-owned and duplicate aliases require review", () => {
  const report = gatewayInjectedToolDiagnostics({ providers: [{
    name: "model-a", provider_status: "active",
    injected_tools: [
      { name: "search", mcp_client_name: "mcp-client", tool_name: "find" },
      { name: "search", mcp_client_name: "mcp-client", tool_name: "delete" },
    ],
    api_key: "do-not-leak",
  }] }, [{ name: "mcp-client", tools: ["find", "delete"] }]);
  assert.equal(report.configured, 2);
  assert.equal(report.policies[0].executionOwner, "bifrost");
  assert.ok(report.policies[0].concerns.some(value => value.includes("duplicate")));
  const formatted = formatGatewayInjectedToolDiagnostics(report);
  assert.match(formatted, /OMP.*approvals are not a complete gateway authorization boundary/);
  assert.doesNotMatch(formatted, /do-not-leak/);
});

test("R5E-04 Code Mode preserves structuredContent authority and parses JSON-in-string diagnostics", () => {
  const structured = inspectMcpToolResult({
    structuredContent: { answer: 5 }, content: [{ type: "text", text: '{"answer":6}' }],
  });
  assert.equal(structured.shape, "structuredContent");
  assert.equal(structured.toolError, false);
  assert.equal(structured.possibleNestedError, false);
  const encoded = inspectMcpToolResult({
    content: [{ type: "text", text: JSON.stringify(JSON.stringify({ result: [1, 2] })) }],
  });
  assert.equal(encoded.shape, "json-in-text");
  const nested = inspectMcpToolResult({
    structuredContent: { error: "nested tool failed" }, content: [{ type: "text", text: "raw-secret" }],
  });
  assert.equal(nested.possibleNestedError, true);
  assert.equal(nested.toolError, false, "application error field is not proof of MCP-level failure");
  assert.equal(inspectMcpToolResult({ isError: true, content: [] }).toolError, true);
  assert.equal(inspectMcpToolResult({ content: [{ type: "text", text: "plain text" }] }).shape, "text");
  assert.equal(inspectMcpToolResult({ content: [{ type: "text", text: "1" }, { type: "text", text: "2" }] }).shape, "multiple-text-blocks");
  assert.doesNotMatch(JSON.stringify(nested), /raw-secret|nested tool failed/);
});

test("R5E-05 explicit progress token filters notifications, ignores untrusted text and bounds history", () => {
  const text = [
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"mine","progress":1,"total":4,"message":"private"}}',
    "",
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"other","progress":2,"message":"secret"}}',
    "",
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"mine","progress":2,"total":4}}',
    "",
  ].join("\n");
  assert.deepEqual(summarizeMcpProgress(text, "mine", 1), { events: [{ progress: 1, total: 4 }], truncated: true });
  assert.deepEqual(summarizeMcpProgress(text, undefined), { events: [], truncated: false });
  assert.doesNotMatch(JSON.stringify(summarizeMcpProgress(text, "mine")), /private|secret|message/);
});

test("R5E-06 one bounded MCP response carries optional diagnostics without extra requests or progress by default", async () => {
  const text = [
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"abc","progress":1}}',
    "",
    'data: {"jsonrpc":"2.0","id":14,"result":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}}',
    "",
  ].join("\n");
  let wireCalls = 0;
  const opts = { fetch: async (_endpoint, request) => {
    wireCalls++;
    assert.equal(request.redirect, "error");
    return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
  } };
  const request = { jsonrpc: "2.0", id: 14, method: "tools/list" };
  const normal = await postMcpJsonRpc("https://fixture.example/mcp", "private-vk", request, opts);
  assert.equal(normal.progress, undefined);
  assert.equal(normal.resultShape, undefined);
  const inspected = await postMcpJsonRpc("https://fixture.example/mcp", "private-vk", request,
    { ...opts, progressToken: "abc", inspectResult: true });
  assert.deepEqual(inspected.progress, { events: [{ progress: 1 }], truncated: false });
  assert.equal(inspected.resultShape.shape, "json-in-text");
  assert.equal(wireCalls, 2, "exactly one network call for each explicit request, no polling");
  assert.doesNotMatch(JSON.stringify(inspected.resultShape), /private-vk/);
});
