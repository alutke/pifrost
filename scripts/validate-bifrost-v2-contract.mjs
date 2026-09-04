const SOURCES = [
  {
    name: "Bifrost 2.0 changelog",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/docs/changelogs/v2.0.0.mdx",
    required: [
      "/api/routing/rules",
      "/api/routing/complexity-analyzer-config",
      "Reasoning Effort None",
    ],
  },
  {
    name: "current Bifrost routing contract",
    url: "https://raw.githubusercontent.com/maximhq/bifrost/dev/ui/lib/types/routingRules.ts",
    required: ["chain_rule", "virtual_key", "priority", "fallbacks", "weight"],
  },
  {
    name: "current Bifrost MCP contract",
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
    name: "current Bifrost governance contract",
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
