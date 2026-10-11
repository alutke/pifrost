import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayInjectedToolDiagnostics, formatGatewayInjectedToolDiagnostics,
} from "../provider-tool-policy.mjs";

test("provider-injected web search stays gateway-owned and is only reported, never executed", () => {
  const response = {
    providers: [
      { name: "deepseek", provider_status: "active",
        injected_tools: { web_search: { mcp_client_name: "DonSeTch", tool_name: "web_search" } },
        keys: [{ value: "sk-super-secret" }], network_config: { extra_headers: { Authorization: "sk-hidden" } } },
      { name: "openrouter", provider_status: "active", injected_tools: null },
    ],
  };
  const diagnostics = gatewayInjectedToolDiagnostics(response, [{ name: "donsetch", tools: ["web_search", "web_fetch"] }]);
  assert.equal(diagnostics.configured, 1);
  assert.equal(diagnostics.schemaReported, true);
  assert.deepEqual(diagnostics.policies.map(p => p.provider), ["deepseek", "openrouter"]);
  assert.deepEqual(diagnostics.policies[0].concerns, []);
  const report = formatGatewayInjectedToolDiagnostics(diagnostics);
  assert.match(report, /deepseek: configured web_search=DonSeTch\/web_search/);
  assert.match(report, /Bifrost owns execution/);
  assert.doesNotMatch(report, /sk-super-secret|sk-hidden|Authorization|extra_headers|network_config/);
});

test("gateway absent injected-tool schema is unknown, not an assertion that policy is disabled", () => {
  const diagnostics = gatewayInjectedToolDiagnostics({ providers: [{ name: "deepseek", provider_status: "active" }] }, []);
  assert.equal(diagnostics.schemaReported, false);
  assert.equal(diagnostics.policies[0].status, "unreported");
  assert.match(formatGatewayInjectedToolDiagnostics(diagnostics), /not exposed.*cannot establish/);
});

test("provider injection detects missing registered client, tool and inactive provider as advisory drift", () => {
  const input = { providers: [
    { name: "provider-a", provider_status: "error", injected_tools: { web_search: { mcp_client_name: "donsetch", tool_name: "web_search" } } },
    { name: "provider-b", provider_status: "active", injected_tools: { web_search: { mcp_client_name: "missing", tool_name: "web_search" } } },
    { name: "provider-c", provider_status: "active", injected_tools: { web_search: { mcp_client_name: "donsetch", tool_name: "missing_tool" } } },
  ] };
  const diagnostics = gatewayInjectedToolDiagnostics(input, [{ name: "DonSeTch", tools: ["web_search"] }]);
  assert.deepEqual(diagnostics.policies[0].concerns, ["provider not active"]);
  assert.deepEqual(diagnostics.policies[1].concerns, ["configured MCP client not found"]);
  assert.deepEqual(diagnostics.policies[2].concerns, ["tool not present in MCP client metadata"]);
  const unknown = gatewayInjectedToolDiagnostics(input, undefined);
  assert.match(unknown.policies[0].concerns.join(), /unverified/);
  assert.doesNotMatch(formatGatewayInjectedToolDiagnostics(unknown), /executable=yes/);
});

test("invalid or unrecognized provider inventory stays fail-closed", () => {
  for(const input of [undefined, {}, { providers: {} }]) {
    assert.throws(() => gatewayInjectedToolDiagnostics(input, []), /no providers array/);
  }
  const invalid = gatewayInjectedToolDiagnostics({ providers: [{ name: "bad", injected_tools: { web_search: { tool_name: "search" } } }] }, []);
  assert.equal(invalid.policies[0].status, "invalid-reference");
  assert.match(formatGatewayInjectedToolDiagnostics(invalid), /requires review/);
});
