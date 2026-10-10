import type { Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { normalizedPhysicalProvider } from "./endpoint-contracts.ts";

/** Every qualified Bifrost route gets its actual provider/model OMP policy.
 * Never send this short ID to Bifrost; requestModelId preserves the full route. */
export function physicalPolicyIdentity(reference: string): { id: string; provider: string; requestModelId: string } | undefined {
  const slash = reference.indexOf("/");
  if (slash < 1) return undefined;
  const id = reference.slice(slash + 1).trim();
  const provider = normalizedPhysicalProvider(reference.slice(0, slash));
  return id && provider ? { id, provider, requestModelId: reference } : undefined;
}

/** Exact observed workaround; preserve synthetic replay for DeepSeek tool calls. */
export function shouldOmitOpaqueReasoningSummary(reference: string): boolean {
  const identity = physicalPolicyIdentity(reference);
  return identity?.provider === "commandcode" && identity.id.toLowerCase() === "deepseek/deepseek-v4.1-flash";
}

/** Always preserve explicit caller reasoning-off. */
export function normalizePifrostReasoningOptions(
  model: Pick<Model, "reasoning" | "thinking">,
  options: SimpleStreamOptions | undefined,
): SimpleStreamOptions | undefined {
  if (!model.reasoning || !model.thinking?.requiresEffort || model.thinking.suppressWhenOff ||
    options?.disableReasoning === true || options?.forceReasoningOff === true || options?.reasoning !== undefined) return options;
  const floor = model.thinking.efforts[0];
  return floor === undefined ? options : { ...options, reasoning: floor };
}

/** Never round fractional caller budgets upward above a model ceiling. */
export function pifrostDirectMaxTokens(requested: number | null | undefined, advertised: number | null | undefined): number | undefined {
  const limits = [requested, advertised].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 1);
  return limits.length ? Math.min(...limits.map(Math.floor)) : undefined;
}

/** Fail closed on heterogeneous wire dialects; no prompts, keys, user text or
 * request bodies are embedded in this compatibility signature. All known OMP
 * reasoning/replay/tool/role request-affecting axes and physical identity are
 * compared. Model version and provider differences force separate attempts. */
export function physicalRequestContractKey(model: Model): string {
  const compat = model.compat as unknown as Record<string, unknown>;
  const keys = [
    "supportsDeveloperRole", "supportsMultipleSystemMessages", "supportsReasoningEffort",
    "supportsReasoningParams", "supportsReasoningSummary", "includeEncryptedReasoning",
    "omitReasoningEffort", "reasoningDisableMode", "reasoningContentField",
    "requiresReasoningContentForToolCalls", "requiresReasoningContentForAllAssistantTurns",
    "allowsSyntheticReasoningContentForToolCalls", "syntheticReasoningContentFallback",
    "replayReasoningContent", "filterReasoningHistory", "requiresThinkingAsText",
    "thinkingFormat", "reasoningDeltasMayBeCumulative", "stripDeepseekSpecialTokens",
    "streamMarkupHealingPattern", "disableReasoningWithTools", "supportsReasoningWithTools",
    "disableReasoningOnToolChoice", "disableReasoningOnForcedToolChoice",
    "supportsToolChoice", "supportsForcedToolChoice", "supportsNamedToolChoice",
    "supportsStrictMode", "strictResponsesPairing", "supportsAssistantPrefill",
    "requiresAssistantContentForToolCalls", "requiresMistralToolIds",
    "usesOpenAIToolCallIdLimit", "wireModelIdMode", "clampOutputToModelMax",
    "alwaysSendMaxTokens", "supportsSamplingParams", "supportsPenaltyAndStopParams",
    "dropThinkingWhenReasoningEffort", "requiresReasoningOffJuiceInstruction",
  ];
  const axes = keys.map((key) => {
    const value = compat[key];
    // RegExp and string-backed stream healers must not collapse to JSON {}.
    return [key, value instanceof RegExp ? String(value) : value ?? null];
  });
  const effortMap = model.thinking?.effortMap
    ? Object.entries(model.thinking.effortMap).sort(([a], [b]) => a.localeCompare(b)) : [];
  const identity = model.identity as { class?: string; family?: string; revision?: string } | undefined;
  return JSON.stringify([model.api, model.provider, identity?.class ?? null, identity?.family ?? null,
    identity?.revision ?? null, model.reasoning, model.thinking?.mode ?? null,
    model.thinking?.requiresEffort ?? null, effortMap, axes]);
}
