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

/** Normalise the *whole* OMP compat policy, including future flags. Unknown
 * recursive/function values cannot be proved compatible and must force an
 * individual pre-output attempt instead of sharing a Bifrost fallback request. */
function stableWireValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "boolean" || typeof value === "number") return value ?? null;
  if (value instanceof RegExp) return value.toString();
  if (typeof value !== "object" || depth > 12 || seen.has(value)) throw new Error("unsupported physical wire policy value");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(v => stableWireValue(v, seen, depth + 1));
    return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
      .map(([key,v]) => [key, stableWireValue(v, seen, depth + 1)]));
  } finally {
    seen.delete(value);
  }
}

/** Conservative signature of the full physical wire encoder. No request,
 * prompt, credential or response content is incorporated. */
export function physicalRequestContractKey(model: Model): string {
  if (!model.compat || !model.provider || !model.api) throw new Error("unknown physical wire compatibility");
  const identity = model.identity as { class?: string; family?: string; revision?: string } | undefined;
  const thinking = model.thinking ? {
    mode: model.thinking.mode, requiresEffort: model.thinking.requiresEffort ?? null,
    suppressWhenOff: model.thinking.suppressWhenOff ?? null,
    efforts: model.thinking.efforts?.map(String) ?? [],
    effortMap: model.thinking.effortMap ?? {},
  } : null;
  return JSON.stringify(stableWireValue({
    api: model.api, provider: model.provider, identityClass: identity?.class ?? null,
    identityFamily: identity?.family ?? null, identityRevision: identity?.revision ?? null,
    reasoning: model.reasoning, thinking, compat: model.compat,
  }, new WeakSet<object>()));
}
