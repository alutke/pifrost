/** Evidence-backed endpoint limits. Unknown endpoints are not constrained by
 * this registry; live/datasheet limits still apply. Never strip :free. */
export interface ConfirmedEndpointContract {
  provider: string;
  model: string;
  maxOutputTokens: number;
  evidence: string;
}
export const CONFIRMED_ENDPOINT_CONTRACTS: readonly ConfirmedEndpointContract[] = [{
  provider: "commandcode",
  model: "inclusionai/ling-3.1-flash:free",
  maxOutputTokens: 32768,
  evidence: "CommandCode GOAT upstream HTTP 400 (2026-10-09): max_tokens 65536 exceeds maximum 32768",
}, {
  provider: "commandcode",
  model: "deepseek/deepseek-v4.1-flash",
  maxOutputTokens: 393_216,
  evidence: "CommandCode GOAT DeepSeek V4.1 Flash fallback HTTP 400 (2026-10-20): max_output_tokens 712434 exceeds provider limit 393216",
}, {
  provider: "opencode-go",
  model: "deepseek-v4.1-flash",
  maxOutputTokens: 393_216,
  evidence: "OpenCode Go DeepSeek V4.1 Flash affinity HTTP 400 (2026-10-22): max_tokens must be between 1 and 393216",
}];

export function normalizedPhysicalProvider(value: string): string {
  const key = value.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  switch (key) {
    case "commandcodegoat":
    case "commandcode": return "commandcode";
    case "opencodego": return "opencode-go";
    case "opencodezen": return "opencode-zen";
    case "xiaomimimo": return "xiaomi";
    case "azureopenai": return "azure-openai";
    case "openaicodex": return "openai-codex";
    case "githubcopilot": return "github-copilot";
    default: return value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  }
}

export function confirmedProviderOutputCeiling(reference: string): number | undefined {
  const slash = reference.indexOf("/");
  if (slash < 1) return undefined;
  const provider = normalizedPhysicalProvider(reference.slice(0,slash));
  const model = reference.slice(slash+1).trim().toLowerCase();
  return CONFIRMED_ENDPOINT_CONTRACTS.find(c=>c.provider===provider && c.model===model)?.maxOutputTokens;
}
