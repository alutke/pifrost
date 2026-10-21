/**
 * Read-only, provider-neutral final-wire reasoning replay verification.
 * OMP owns construction and any policy-authorized synthetic *non-substantive*
 * replay markers. Pifrost never invents reasoning, signatures, item IDs or
 * conversation history; no prompt content leaves this function.
 */
export type ReasoningReplayRequirement = "all-assistant-runs" | "tool-call-runs" | "not-required" | "unknown";
export type ReasoningWireProtocol = "openai-responses" | "openai-completions";
export interface ReasoningReplayContract {
  requirement: ReasoningReplayRequirement;
  protocol: ReasoningWireProtocol;
  /** Only an actually resolved physical policy may be strict. */
  source: "physical-omp-policy" | "unanimous-physical-members" | "unverified";
}
export interface ReasoningReplayAudit {
  protocol: ReasoningWireProtocol;
  requirement: ReasoningReplayRequirement;
  assistantRuns: number;
  runsRequiringReasoning: number;
  missingRequiredRuns: number;
  toolCalls: number;
  nativeReasoningItems: number;
  /** No item content, IDs, model reasoning, or user messages are retained. */
  reason: "verified" | "incompatible-history" | "not-required" | "contract-unknown" | "not-applicable";
}
export class ReasoningReplayIntegrityError extends Error {
  readonly code = "REASONING_REPLAY_INVALID" as const;
  constructor(
    public readonly audit: ReasoningReplayAudit,
  ) {
    super(`Pifrost rejected an incompatible ${audit.protocol} thinking-mode continuation: ${audit.missingRequiredRuns} of ${audit.runsRequiringReasoning} required assistant runs lack native reasoning replay. OMP session history was not modified. Verify physical reasoning policy and Bifrost conversion; use a new OMP session if the original reasoning is unavailable`);
    this.name = "ReasoningReplayIntegrityError";
  }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function hasChatNativeReasoning(message: Record<string, unknown>): boolean {
  for (const key of ["reasoning_content", "reasoning_text", "reasoning"]) {
    const value = message[key];
    // A present, possibly empty native replay field is OMP's documented Chat
    // representation; only the target provider can decide if it accepts it.
    if (typeof value === "string") return true;
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return false;
}
function isResponsesToolCall(item: Record<string, unknown>): boolean {
  return ["function_call","custom_tool_call","computer_call","local_shell_call"].includes(String(item.type));
}
function isResponsesBoundary(item: Record<string, unknown>): boolean {
  const type = item.type;
  return type === "compaction" || type === "function_call_output" ||
    type === "custom_tool_call_output" || type === "computer_call_output" ||
    (item.role !== undefined && item.role !== "assistant");
}
function reasoningRequired(contract: ReasoningReplayRequirement, hasCall: boolean): boolean {
  return contract === "all-assistant-runs" || (contract === "tool-call-runs" && hasCall);
}
/**
 * Verify final wire request after OMP has performed its built-in native replay
 * serializer/repair and after Pifrost has normalized only known visible output.
 * An opaque gateway route without consensus stays diagnostic-only; it must
 * not be arbitrarily rejected or attributed to a made-up provider.
 */
export function auditReasoningReplay(
  payload: unknown,
  contract: ReasoningReplayContract,
  active: boolean,
): ReasoningReplayAudit {
  const body = object(payload);
  let assistantRuns = 0;
  let runsRequiringReasoning = 0;
  let missingRequiredRuns = 0;
  let nativeReasoningItems = 0;
  let toolCalls = 0;
  if (body && active && contract.protocol === "openai-responses" && Array.isArray(body.input)) {
    let hasAssistant = false, hasReasoning = false, hasCall = false;
    const flush = () => {
      if (!hasAssistant) return;
      assistantRuns++;
      if (reasoningRequired(contract.requirement, hasCall)) {
        runsRequiringReasoning++;
        if (!hasReasoning) missingRequiredRuns++;
      }
      hasAssistant = false; hasReasoning = false; hasCall = false;
    };
    for (const raw of body.input) {
      const item = object(raw);
      if (!item) continue;
      if (isResponsesBoundary(item)) { flush(); continue; }
      if (item.type === "reasoning") {
        nativeReasoningItems++;
        hasReasoning = true; hasAssistant = true;
      } else if (isResponsesToolCall(item)) {
        toolCalls++; hasCall = true; hasAssistant = true;
      } else if (item.type === "message" && item.role === "assistant") {
        hasAssistant = true;
      }
    }
    flush();
  } else if (body && active && contract.protocol === "openai-completions" && Array.isArray(body.messages)) {
    for (const raw of body.messages) {
      const message = object(raw);
      if (message?.role !== "assistant") continue;
      assistantRuns++;
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
      toolCalls += calls;
      if (reasoningRequired(contract.requirement, calls > 0)) {
        runsRequiringReasoning++;
        if (!hasChatNativeReasoning(message)) missingRequiredRuns++;
        else nativeReasoningItems++;
      }
    }
  }
  const unknown = contract.requirement === "unknown";
  const mandatory = contract.requirement !== "not-required" && !unknown;
  return {
    protocol: contract.protocol,
    requirement: contract.requirement,
    assistantRuns, runsRequiringReasoning, missingRequiredRuns, toolCalls, nativeReasoningItems,
    reason: !active ? "not-applicable" : unknown ? "contract-unknown"
      : !mandatory ? "not-required" : missingRequiredRuns ? "incompatible-history" : "verified",
  };
}
export function enforceReasoningReplay(
  payload: unknown,
  contract: ReasoningReplayContract,
  active: boolean,
): ReasoningReplayAudit {
  const result = auditReasoningReplay(payload, contract, active);
  if (result.reason === "incompatible-history") throw new ReasoningReplayIntegrityError(result);
  return result;
}

/** OMP physical policy rather than model name or guessed provider families. */
export function reasoningReplayRequirementFromCompat(compat: unknown): ReasoningReplayRequirement {
  const c = object(compat);
  if (!c) return "unknown";
  if (c.requiresReasoningContentForAllAssistantTurns === true) return "all-assistant-runs";
  if (c.requiresReasoningContentForToolCalls === true) return "tool-call-runs";
  if (c.requiresReasoningContentForAllAssistantTurns === false &&
      c.requiresReasoningContentForToolCalls === false) return "not-required";
  return "unknown";
}

/** Choose a common OMP serialization contract only when *every* reachable
 * gateway member was resolved and reports the same strict requirement. An
 * unknown/tolerant/heterogeneous member must not be forced into a foreign
 * reasoning format or silently excluded from Bifrost's fallback chain. */
export function unanimousStrictReasoningRequirement(
  requirements: readonly ReasoningReplayRequirement[],
  complete: boolean,
): ReasoningReplayRequirement {
  if (!complete || !requirements.length) return "unknown";
  const first = requirements[0];
  return (first === "all-assistant-runs" || first === "tool-call-runs") &&
    requirements.every(value => value === first) ? first : "unknown";
}

/** Only the documented OMP replay switches are set. This lets OMP run its
 * own synthetic non-substantive compatibility logic, not Pifrost's. */
export function strictReplayCompatOverrides(requirement: ReasoningReplayRequirement): Record<string, boolean> {
  if (requirement === "all-assistant-runs") return {
    requiresReasoningContentForAllAssistantTurns: true,
    requiresReasoningContentForToolCalls: true,
  };
  if (requirement === "tool-call-runs") return {
    requiresReasoningContentForToolCalls: true,
  };
  return {};
}
