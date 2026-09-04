const BIFROST_2_0_0_COMMIT = "e4a30d6041c0446603aea615bc5da340dac001b1";

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
