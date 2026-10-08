const OMP_MIN_COMMIT = "79808c3bf8f8cd9826decc63e3e18b13035f64f8";
const OMP_VALIDATED_COMMIT = "40e9368ef0458fd9073329cdff4174895f91bc6b";
const OMP_CURRENT_REF = process.env.PIFROST_OMP_UPSTREAM_CANARY === "1" ? "main" : OMP_VALIDATED_COMMIT;

const SOURCES = [
  {
    name: "OMP 18.4.5 modern model capability contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/catalog/src/types.ts`,
    required: [
      "webSearchModel?: string",
      "serviceTiers?: readonly string[]",
      "pricingStatus?:",
      "supportsBetweenToolsThinking?: boolean",
    ],
  },
  {
    name: "OMP 18.4.5 deferred tool intent contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/ai/src/types.ts`,
    required: [
      "deferLoading?: boolean",
      "serviceTier?: ServiceTier",
    ],
  },
  {
    name: "OMP 18.4.5 MCP schema instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/config/mcp-schema.json`,
    required: [
      "\"instructions\"",
      "Include server-provided instructions in the system prompt",
      "\"type\": \"boolean\"",
    ],
  },
  {
    name: "OMP 18.4.5 MCP runtime instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/mcp/manager.ts`,
    required: [
      "getServerInstructions",
      "connection.config.instructions !== false",
    ],
  },
  {
    name: "OMP 18.4.5 agent identity contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/extensibility/extensions/types.ts`,
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
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/discovery/agents.ts`,
    required: [
      'const AGENT_DIR_CANDIDATES = [".agent", ".agents"]',
      'getProjectPathCandidates(ctx, "skills")',
      'level: "project"',
      'registerProvider<Skill>(skillCapability.id',
    ],
  },
  {
    name: "OMP 18.4.5 skill identity contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/capability/skill.ts`,
    required: [
      "export interface SkillFrontmatter",
      "name?: string",
      "description?: string",
      "toExtensionId: skill => `skill:${skill.name}`",
    ],
  },
  {
    name: "OMP 18.4.5 cfg:// approval and persistence contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/coding-agent/src/internal-urls/cfg-protocol.ts`,
    required: [
      "export class CfgProtocolHandler",
      "setCfgApprovalHost",
      "session.settingsApproval !== true",
      "Changing settings requires user approval",
      "leaf.override(settings, value)",
      "await persistent.flush()",
    ],
  },
  {
    name: "OMP 18.4.5 image-on-wire capability contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_MIN_COMMIT}/packages/ai/src/providers/vision-guard.ts`,
    required: [
      "export function sendsImageInputOnWire",
      'if (model.transport === "pi-native") return model.input.includes("image");',
      'if (model.api === "openai-completions") return true;',
      'return model.api === "openrouter" && $env.PI_OPENROUTER_RESPONSES === "0";',
      "if (model.compat.stripImageInput) return false;",
    ],
  },
];

const CURRENT_SOURCES = [
  {
    name: `OMP ${process.env.PIFROST_OMP_UPSTREAM_CANARY === "1" ? "main" : "18.8.4"} image-tokenization contract`,
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_CURRENT_REF}/packages/catalog/src/compat/image-tokenization.ts`,
    required: [
      "export function resolveImageTokenization",
      "export function imageTokens",
      'regime: "openai-patch"',
      'regime: "anthropic-patch"',
      'regime: "fixed"',
    ],
  },
  {
    name: `OMP ${process.env.PIFROST_OMP_UPSTREAM_CANARY === "1" ? "main" : "18.8.4"} dimension-aware image accounting`,
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_CURRENT_REF}/packages/agent/src/image-tokens.ts`,
    required: [
      "estimateImageContentTokens",
      "base64ImageSize",
      "UNKNOWN_SIZE",
      "imageTokens(openAiWireRule()",
    ],
  },
  {
    name: `OMP ${process.env.PIFROST_OMP_UPSTREAM_CANARY === "1" ? "main" : "18.8.4"} provider-cost contract`,
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_CURRENT_REF}/packages/ai/src/providers/openai-shared.ts`,
    required: [
      "export function applyProviderReportedCost",
      'model.provider !== "openrouter"',
      'Reflect.get(rawUsage, "cost")',
      "upstream_inference_cost",
      "usage.cost.total = reportedCost",
    ],
  },
  {
    name: `OMP ${process.env.PIFROST_OMP_UPSTREAM_CANARY === "1" ? "main" : "18.8.4"} model-preset contract`,
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_CURRENT_REF}/packages/coding-agent/src/config/model-presets.ts`,
    required: [
      "findActiveModelPreset",
      "modelRoles",
      "defaultThinkingLevel",
      "applyModelPreset",
    ],
  },
];

for (const source of [...SOURCES, ...CURRENT_SOURCES]) {
  const response = await fetch(source.url, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  const body = await response.text();
  const missing = source.required.filter((token) => !body.includes(token));
  if (missing.length) {
    throw new Error(`${source.name}: upstream contract changed; missing ${missing.join(", ")}`);
  }
  console.log(`${source.name}: OK`);
}
