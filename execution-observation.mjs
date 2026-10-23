/**
 * Release 30A: diagnostic-only classification of model/agent settlements.
 * Never retries a request, modifies history, selects a model, or compacts.
 * All identifiers and payloads are intentionally excluded from results.
 */
const record = value => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const textPart = part => {
  const p = record(part);
  return p && (p.type === "text" || p.type === "output_text") && typeof p.text === "string" ? p.text : "";
};
const artifactOnly = value => typeof value === "string" &&
  value.replace(/reasoning unavailable|<\/?(?:think|thinking)>/giu, "").trim().length === 0;
const toolType = type => ["toolCall", "tool_call", "function_call"].includes(type);

export function inspectOutput(items, stopReason = null) {
  const output = Array.isArray(items) ? items : [];
  let visible = "", toolCalls = 0, reasoning = 0;
  for (const entry of output) {
    const item = record(entry);
    if (!item) continue;
    if (toolType(item.type)) toolCalls++;
    if (item.type === "reasoning" || item.type === "thinking") reasoning++;
    if (item.type === "message" || item.role === "assistant") {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        const p = record(part);
        if (!p) continue;
        if (toolType(p.type)) toolCalls++;
        visible += textPart(p);
        if (p.type === "thinking" || p.type === "reasoning") reasoning++;
      }
    }
  }
  const noUsefulText = !visible.trim() || artifactOnly(visible);
  const terminal = stopReason === "stop" || stopReason === "end_turn";
  const reason = terminal && toolCalls === 0 && noUsefulText
    ? reasoning > 0 ? "REASONING_ONLY_STOP" : "EMPTY_STOP"
    : terminal && toolCalls === 0 && /<\/?thinking>/iu.test(visible) && /\b(?:i need to|we should|let's)\b/iu.test(visible.slice(-300))
    ? "LEAKED_THINKING_STOP" : "NONE";
  return Object.freeze({
    reason,
    stopReason: typeof stopReason === "string" ? stopReason : null,
    hasAction: toolCalls > 0,
    visibleText: !noUsefulText,
    reasoningBlocks: reasoning,
    toolCallCount: toolCalls,
    // This is only a request-level signal, not proof that the user task remains incomplete.
    isNonproductive: reason !== "NONE",
  });
}

export function inspectContextUsage(inputTokens, windowTokens = null) {
  const input = nonnegative(inputTokens);
  const window = nonnegative(windowTokens);
  const validWindow = window !== null && window > 0 ? window : null;
  const fraction = input !== null && validWindow !== null ? input / validWindow : null;
  return Object.freeze({
    inputTokens: input, contextWindowTokens: validWindow, fraction,
    severity: input === null ? "unknown" : fraction !== null && fraction >= 0.80 ? "pressure" :
      input >= 120000 ? "large-absolute" : "normal",
    // Absolute observations never assert that the physical model context is exhausted.
    interpretation: fraction === null ? "model-window-unverified" : "window-reported-not-physically-verified",
  });
}

/** Read-only Bifrost log diagnosis; never copies raw requests, prompts or keys. */
export function inspectBifrostLog(raw) {
  const log = record(raw) ?? {};
  const usage = record(log.token_usage) ?? {};
  const details = record(usage.completion_tokens_details) ?? {};
  const output = inspectOutput(log.responses_output, log.stop_reason);
  const context = inspectContextUsage(usage.prompt_tokens);
  return Object.freeze({
    schemaVersion: 1,
    status: typeof log.status === "string" ? log.status : "unknown",
    provider: typeof log.provider === "string" ? log.provider : null,
    routeModel: typeof log.model === "string" ? log.model : null,
    gatewayServedModel: typeof log.served_model === "string" ? log.served_model : null,
    attribution: "gateway-reported-not-physical-proof",
    output,
    context,
    completionTokens: nonnegative(usage.completion_tokens),
    reasoningTokens: nonnegative(details.reasoning_tokens),
    retries: nonnegative(log.number_of_retries),
    // Caller must correlate request with host progress; success alone is not task completion.
    taskCompleted: "unknown",
  });
}

/** OMP agent_end assessment. A missing output is suspicious only after tool activity.
 * Event messages are turn-local in some OMP hosts, not an entire durable plan. */
export function inspectAgentEnd(event) {
  const e = record(event) ?? {};
  const messages = Array.isArray(e.messages) ? e.messages : [];
  const last = record(messages.at(-1)) ?? {};
  const chunks = Array.isArray(last.content) ? last.content : [];
  const output = inspectOutput([{ type: "message", role: last.role, content: chunks }], last.stopReason);
  const toolActivity = messages.slice(0, -1).some(msg => {
    const item = record(msg);
    return item && (item.role === "toolResult" || item.role === "tool_result" ||
      (item.role === "assistant" && Array.isArray(item.content) &&
        item.content.some(part => toolType(record(part)?.type))));
  });
  const safeBoundary = !(e.willContinue || e.awaitingAsyncWork || e.interrupted || e.cancelled ||
    e.historyRewritePending || e.hasUncertainToolOutcome);
  return Object.freeze({
    schemaVersion: 1, output,
    toolActivity: !!toolActivity, safeBoundary,
    diagnostic: safeBoundary && toolActivity && last.role === "assistant" && output.isNonproductive
      ? "SUSPECT_NONPRODUCTIVE_SETTLEMENT" : "NONE",
    workRemaining: "unverified",
    recoveryPermitted: "not-assessed",
  });
}
