/**
 * Shape-only OpenAI Chat/Responses request inspection. Never inspect message
 * text, reasoning contents, tool arguments, user instructions, or credentials.
 * Raw IDs are transiently used for matching but never returned.
 */
export interface InferenceRequestDiagnostics {
  protocol: "openai-responses" | "openai-completions" | "unknown";
  historyItems: number;
  assistantMessages: number;
  nativeReasoningItems: number;
  chatReasoningMessages: number;
  toolCalls: number;
  toolResults: number;
  orphanToolResults: number;
  toolDefinitions: number;
  requestedOutputTokens?: number;
  reasoningEffort?: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function boundedCount(value: unknown): number { return Array.isArray(value) ? value.length : 0; }
function finiteOutput(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
export function inspectInferenceRequest(payload: unknown): InferenceRequestDiagnostics | undefined {
  const body = asObject(payload);
  if (!body) return undefined;
  const responses = Array.isArray(body.input);
  const chat = !responses && Array.isArray(body.messages);
  if (!responses && !chat) return undefined;
  const items = (responses ? body.input : body.messages) as unknown[];
  const result: InferenceRequestDiagnostics = {
    protocol: responses ? "openai-responses" : "openai-completions",
    historyItems: items.length, assistantMessages: 0,
    nativeReasoningItems: 0, chatReasoningMessages: 0,
    toolCalls: 0, toolResults: 0, orphanToolResults: 0,
    toolDefinitions: boundedCount(body.tools),
  };
  const calls = new Set<string>();
  const resultIds: string[] = [];
  for (const item of items) {
    const part = asObject(item);
    if (!part) continue;
    if (responses) {
      if (part.type === "reasoning") result.nativeReasoningItems++;
      if (part.type === "message" && part.role === "assistant") result.assistantMessages++;
      if (part.type === "function_call" || part.type === "custom_tool_call" || part.type === "computer_call") {
        result.toolCalls++;
        if (typeof part.call_id === "string") calls.add(part.call_id);
      }
      if (part.type === "function_call_output" || part.type === "custom_tool_call_output" || part.type === "computer_call_output") {
        result.toolResults++;
        if (typeof part.call_id === "string") resultIds.push(part.call_id);
        else result.orphanToolResults++;
      }
    } else {
      if (part.role === "assistant") {
        result.assistantMessages++;
        if (typeof part.reasoning_content === "string" || typeof part.reasoning_text === "string") result.chatReasoningMessages++;
        const tools = Array.isArray(part.tool_calls) ? part.tool_calls : [];
        result.toolCalls += tools.length;
        for (const t of tools) { const c = asObject(t); if (typeof c?.id === "string") calls.add(c.id); }
      }
      if (part.role === "tool") {
        result.toolResults++;
        if (typeof part.tool_call_id === "string") resultIds.push(part.tool_call_id);
        else result.orphanToolResults++;
      }
    }
  }
  result.orphanToolResults += resultIds.filter(id => !calls.has(id)).length;
  const requested = finiteOutput(body.max_output_tokens) ?? finiteOutput(body.max_completion_tokens) ?? finiteOutput(body.max_tokens);
  if (requested !== undefined) result.requestedOutputTokens = requested;
  const effort = asObject(body.reasoning)?.effort ?? body.reasoning_effort;
  if (typeof effort === "string" && ["minimal","low","medium","high","xhigh","max"].includes(effort)) result.reasoningEffort = effort;
  return result;
}
