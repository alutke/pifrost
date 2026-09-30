const OMP_18_4_5_COMMIT = "79808c3bf8f8cd9826decc63e3e18b13035f64f8";

const SOURCES = [
  {
    name: "OMP 18.4.5 modern model capability contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/catalog/src/types.ts`,
    required: [
      "webSearchModel?: string",
      "serviceTiers?: readonly ServiceTier[]",
      "pricingStatus?:",
      "supportsBetweenToolsThinking?: boolean",
    ],
  },
  {
    name: "OMP 18.4.5 deferred tool intent contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/ai/src/types.ts`,
    required: [
      "deferLoading?: boolean",
      "serviceTier?: ServiceTier",
    ],
  },
  {
    name: "OMP 18.4.5 MCP schema instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/config/mcp-schema.json`,
    required: [
      "\"instructions\"",
      "Include server-provided instructions in the system prompt",
      "\"type\": \"boolean\"",
    ],
  },
  {
    name: "OMP 18.4.5 MCP runtime instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/mcp/manager.ts`,
    required: [
      "getServerInstructions",
      "connection.config.instructions !== false",
    ],
  },
  {
    name: "OMP 18.4.5 agent identity contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/extensibility/extensions/types.ts`,
    required: [
      "export interface ExtensionAgentIdentity",
      'kind: "main" | "sub"',
      "id: string",
      "name: string",
      "depth: number",
      "parentId?: string",
      "agent: ExtensionAgentIdentity",
    ],
  },
  {
    name: "OMP 18.4.5 project Agent Skills discovery contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/discovery/agents.ts`,
    required: [
      'const AGENT_DIR_CANDIDATES = [".agent", ".agents"]',
      'getProjectPathCandidates(ctx, "skills")',
      'level: "project"',
      'registerProvider<Skill>(skillCapability.id',
    ],
  },
  {
    name: "OMP 18.4.5 skill identity contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/capability/skill.ts`,
    required: [
      "export interface SkillFrontmatter",
      "name?: string",
      "description?: string",
      "toExtensionId: skill => `skill:${skill.name}`",
    ],
  },
  {
    name: "OMP 18.4.5 cfg:// approval and persistence contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_4_5_COMMIT}/packages/coding-agent/src/internal-urls/cfg-protocol.ts`,
    required: [
      "export class CfgProtocolHandler",
      "setCfgApprovalHost",
      "session.settingsApproval !== true",
      "Changing settings requires user approval",
      "leaf.override(settings, value)",
      "await persistent.flush()",
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
