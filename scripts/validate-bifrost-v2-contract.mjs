const BIFROST_2_0_0_COMMIT = "e4a30d6041c0446603aea615bc5da340dac001b1";
const BIFROST_2_2_0_COMMIT = "fa3d4f2b97a25f5a0d5a233998777811b2bc05a8";
const BIFROST_2_2_2_COMMIT = "9f0d71dba7274d8673de1e69529991035dae49e4";
const BIFROST_2_2_3_COMMIT = "b840c82caed6919d84c21bd7be5bf7fa27a7ba17";

const SOURCES = [
  {
    name: "Bifrost 2.0.0 routing contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_0_0_COMMIT}/ui/lib/types/routingRules.ts`,
    required: ["chain_rule", "virtual_key", "priority", "fallbacks", "weight"],
  },
  {
    name: "Bifrost 2.0.0 MCP contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_0_0_COMMIT}/ui/lib/types/mcp.ts`,
    required: [
      "is_code_mode_client",
      "tools_to_auto_execute",
      "per_user_oauth",
      "per_user_headers",
      "token_exchange",
      "needs_session_stickiness",
    ],
  },
  {
    name: "Bifrost 2.0.0 governance contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_0_0_COMMIT}/transports/bifrost-http/handlers/governance.go`,
    required: [
      "/api/governance/virtual-keys/quota",
      "provider_configs",
      "model_configs",
      "rate_limits",
    ],
  },
  {
    name: "Bifrost 2.0.0 routing endpoints",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_0_0_COMMIT}/transports/bifrost-http/handlers/routing.go`,
    required: [
      "/api/routing/rules",
      "/api/routing/complexity-analyzer-config",
      "/api/governance/routing-rules",
    ],
  },
  {
    name: "Bifrost 2.0.0 reasoning contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_0_0_COMMIT}/core/schemas/modelcapsreasoning.go`,
    required: ["ReasoningEffortNone", "\"none\"", "ReasoningEffortMinimal"],
  },
  {
    name: "Bifrost 2.2.0 Virtual MCP API contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_0_COMMIT}/transports/bifrost-http/handlers/virtualmcp.go`,
    required: [
      "/api/mcp/virtual-mcps",
      "/virtual-keys/{vkId}",
      "virtual_key_ids",
      "endpoint_slug",
    ],
  },
  {
    name: "Bifrost 2.2.0 Virtual MCP wire contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_0_COMMIT}/ui/lib/types/virtualMcps.ts`,
    required: ["VirtualMCP", "mcp_client_id", "tool_names", "virtual_key_ids"],
  },
  {
    name: "Bifrost 2.2.2 session-affinity contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_2_COMMIT}/docs/providers/session-affinity.mdx`,
    required: ["Session affinity", "x-bf-session-id", "x-bf-session-affinity", "BifrostContextKeySessionID"],
  },
  {
    name: "Bifrost 2.2.3 quota SourceRef contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/framework/configstore/tables/modelconfig.go`,
    required: ["type SourceRef struct", "source_type", "source_id", "source_name"],
  },
  {
    name: "Bifrost 2.2.3 sourced quota contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/transports/bifrost-http/handlers/governance.go`,
    required: ["SourcedBudget", "SourcedRateLimit", "rate_limits", "getVirtualKeyQuota"],
  },
  {
    name: "Bifrost 2.2.3 pinned-fallback API contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/ui/lib/types/routingRules.ts`,
    required: ["RoutingFallbackObject", "RoutingFallbackWire", "key_id", "fallbacks"],
  },
  {
    name: "Bifrost 2.2.3 pinned-fallback config contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/docs/providers/routing-rules.mdx`,
    required: ["provider_key_name", "key_id", "fallbacks"],
  },
  {
    name: "current Bifrost dev routing canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/ui/lib/types/routingRules.ts",
    required: ["chain_rule", "virtual_key", "priority", "fallbacks", "weight"],
  },
  {
    name: "current Bifrost dev MCP canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/ui/lib/types/mcp.ts",
    required: [
      "is_code_mode_client",
      "tools_to_auto_execute",
      "per_user_oauth",
      "per_user_headers",
      "token_exchange",
      "needs_session_stickiness",
      "endpoint_slug",
    ],
  },
  {
    name: "current Bifrost dev governance canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/transports/bifrost-http/handlers/governance.go",
    required: [
      "/api/governance/virtual-keys/quota",
      "provider_configs",
      "model_configs",
      "rate_limits",
    ],
  },
];

for (const source of SOURCES) {
  const response = await fetch(source.url, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  const body = await response.text();
  const missing = source.required.filter((token) => !body.includes(token));
  if (missing.length) {
    throw new Error(`${source.name}: upstream contract changed; missing ${missing.join(", ")}`);
  }
  console.log(`${source.name}: OK`);
}
