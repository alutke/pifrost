const BIFROST_2_0_0_COMMIT = "e4a30d6041c0446603aea615bc5da340dac001b1";
const BIFROST_2_2_0_COMMIT = "fa3d4f2b97a25f5a0d5a233998777811b2bc05a8";
const BIFROST_2_2_2_COMMIT = "9f0d71dba7274d8673de1e69529991035dae49e4";
const BIFROST_2_2_3_COMMIT = "b840c82caed6919d84c21bd7be5bf7fa27a7ba17";
const BIFROST_2_2_4_COMMIT = "ed8371a9779bfbc8aa689d4d77964cf8ce9308bf";
const BIFROST_2_2_6_COMMIT = "8b4fce4f1709d66f9208d02f50552da522535f9e";

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
    name: "Bifrost 2.2.3 Skills CRUD contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/transports/bifrost-http/handlers/skills.go`,
    required: [
      'r.GET("/api/skills"',
      'r.GET("/api/skills/{id}"',
      '"skill_md_body"',
      '"files,omitempty"',
      '"allowed_tools,omitempty"',
    ],
  },
  {
    name: "Bifrost 2.2.3 Skills wire contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/framework/configstore/tables/skills.go`,
    required: [
      "type TableSkill struct",
      'json:"id"',
      'json:"name"',
      'json:"latest_version"',
      'json:"files,omitempty"',
      'json:"file_count"',
      'json:"allowed_tools,omitempty"',
    ],
  },
  {
    name: "Bifrost 2.2.3 Skills serving contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/transports/bifrost-http/handlers/skills_serving.go`,
    required: [
      'r.GET("/api/skills/serve/{skill-name}/download.zip"',
      'r.GET("/api/skills/serve/{skill-name}/files/{filepath:*}"',
      "func composeSkillMD",
      "genericFileDownload",
      'path.Join(skill.Name, "SKILL.md")',
    ],
  },
  {
    name: "Bifrost 2.2.3 time-of-day pricing data contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/framework/modelcatalog/datasheet/types.go`,
    required: [
      "OffPeakCostMultiplier",
      "off_peak_cost_multiplier",
      "PeakHours",
      "peak_hours",
      "BilledAt",
      "request's START time",
    ],
  },
  {
    name: "Bifrost 2.2.3 time-of-day pricing evaluator contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_3_COMMIT}/framework/modelcatalog/datasheet/cost.go`,
    required: [
      "func isWithinPeakWindows",
      "func offPeakMultiplier",
      "prevWeekday",
      "end <= start",
      "minutes >= start && minutes < end",
      "m > 0 && m <= 1",
    ],
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
    name: "Bifrost 2.2.4 capability schema contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/core/schemas/modelcapabilities.go`,
    required: [
      "SupportsToolSearch",
      "supports_tool_search",
      "SupportsBetweenToolsThinking",
      "supports_between_tools_thinking",
      "SupportsServiceTier",
      "supports_service_tier",
      "ServiceTiers",
      "service_tiers",
    ],
  },
  {
    name: "Bifrost 2.2.4 between-tools downgrade contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/core/providers/anthropic/utils.go`,
    required: [
      'req.Thinking.Type == "between_tools"',
      "SupportsBetweenToolsThinking",
      'req.Thinking.Type = "disabled"',
    ],
  },
  {
    name: "Bifrost 2.2.4 OpenAI Tool Search contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/core/providers/openai/responses.go`,
    required: [
      "keepDeferLoading",
      "SupportsToolSearch",
      "defaultSupportsToolSearch",
    ],
  },
  {
    name: "Bifrost 2.2.4 MCP image relay limitation contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/transports/bifrost-http/handlers/mcpserver.go`,
    required: [
      "ChatContentBlockTypeText",
      "mcp.NewToolResultText(resultText)",
    ],
  },
  {
    name: "Bifrost 2.2.4 classic MCP image marker contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/core/mcp/utils.go`,
    required: ['[Image Response: %s, MIME: %s]\\n'],
  },
  {
    name: "Bifrost 2.2.4 Code Mode image marker contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_4_COMMIT}/core/mcp/codemode/starlark/utils.go`,
    required: ['[Image Response: %s, MIME: %s]\\n'],
  },
  {
    name: "Bifrost 2.2.6 authoritative usage-cost contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_6_COMMIT}/core/schemas/chatcompletions.go`,
    required: [
      "type BifrostCost struct",
      'json:"total_cost,omitempty"',
      'json:"mcp_cost,omitempty"',
      'json:"routing_cost,omitempty"',
    ],
  },
  {
    name: "Bifrost 2.2.6 Responses usage-cost contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_6_COMMIT}/core/schemas/responses.go`,
    required: [
      "*BifrostCost",
      'json:"cost,omitempty"',
    ],
  },
  {
    name: "Bifrost 2.2.6 setup-lock state contract",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_6_COMMIT}/transports/bifrost-http/handlers/session.go`,
    required: [
      '"/api/session/is-auth-enabled"',
      '"setup_required"',
      '"setup_token_configured"',
      '"inference_auth_enforced"',
    ],
  },
  {
    name: "Bifrost 2.2.6 routed-response provenance headers",
    url: `https://raw.githubusercontent.com/maximhq/bifrost/${BIFROST_2_2_6_COMMIT}/transports/bifrost-http/lib/responseheaders.go`,
    required: [
      '"x-bifrost-provider"',
      '"x-bifrost-resolved-model"',
      '"x-bifrost-fallback-index"',
      '"x-bifrost-request-type"',
      '"x-bifrost-upstream-latency-ms"',
    ],
  },
];

const DEV_SOURCES = [
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
    name: "current Bifrost dev request-id provenance canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/transports/bifrost-http/lib/responseheaders.go",
    required: [
      "HeaderBifrostRequestID",
      '"x-bifrost-request-id"',
    ],
  },
  {
    name: "current Bifrost dev Chat-to-Responses compatibility canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/plugins/compat/main.go",
    required: [
      "ForceReasoningOnlyModelsToResponses",
      "force_reasoning_only_models_to_responses",
      "converting request to",
    ],
  },
  {
    name: "current Bifrost dev bounded Code Mode canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/core/mcp/codemode/starlark/sandbox.go",
    required: [
      "SetMaxSteps",
      "MaxSourceBytes",
      "MaxLogBytes",
      "MaxToolCalls",
      "code mode resource limit",
    ],
  },
  {
    name: "current Bifrost dev authoritative usage-cost canary",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/core/schemas/chatcompletions.go",
    required: [
      "type BifrostCost struct",
      'json:"total_cost,omitempty"',
      'json:"mcp_cost,omitempty"',
      'json:"routing_cost,omitempty"',
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

const sources = process.env.PIFROST_BIFROST_UPSTREAM_CANARY === "1"
  ? [...SOURCES, ...DEV_SOURCES]
  : SOURCES;

for (const source of sources) {
  const response = await fetch(source.url, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  const body = await response.text();
  const missing = source.required.filter((token) => !body.includes(token));
  if (missing.length) {
    throw new Error(`${source.name}: upstream contract changed; missing ${missing.join(", ")}`);
  }
  console.log(`${source.name}: OK`);
}
