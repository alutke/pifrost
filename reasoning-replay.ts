/**
 * Remove redundant *visible* synthetic thinking that OMP demoted to assistant
 * text during cross-model history replay. DeepSeek Responses still requires
 * its structured, non-empty reasoning_text items; these are never changed.
 *
 * Apply at the physical Responses wire boundary for every provider.
 * No rewriting occurs without a matching OMP synthetic reasoning item
 * in the same assistant run. Do not mutate persisted session messages,
 * tool call IDs, or real model-generated reasoning.
 */
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : undefined;
}

const PURE_SYNTHETIC_THINKING = /^\s*<think>\s*reasoning unavailable\s*<\/think>\s*$/u;

/** A strict exact-shape match: never rewrite mixed text, real thoughts or user content. */
function isRedundantAssistantPlaceholder(value: unknown): boolean {
  const item = record(value);
  if (item?.type !== "message" || item.role !== "assistant" ||
      !Array.isArray(item.content) || item.content.length !== 1) return false;
  const block = record(item.content[0]);
  if (block?.type !== "output_text" || typeof block.text !== "string") return false;
  if (Array.isArray(block.annotations) && block.annotations.length > 0) return false;
  return PURE_SYNTHETIC_THINKING.test(block.text);
}

/** OMP's exact all-turn replay fallback; genuine/opaque reasoning is never a match. */
function isSyntheticReasoningReplay(value: unknown): boolean {
  const item = record(value);
  if (item?.type !== "reasoning" || typeof item.encrypted_content === "string" ||
      !Array.isArray(item.content) || item.content.length !== 1) return false;
  if (Array.isArray(item.summary) && item.summary.length > 0) return false;
  const part = record(item.content[0]);
  return part?.type === "reasoning_text" && part.text === "reasoning unavailable";
}

function isBoundary(value: unknown): boolean {
  const item = record(value);
  if (!item) return true;
  if (item.type === "compaction" || item.type === "function_call_output" ||
      item.type === "custom_tool_call_output" || item.type === "computer_call_output") return true;
  if (item.type === "message" && item.role !== "assistant") return true;
  return item.role === "user" || item.role === "developer" || item.role === "system";
}

function isMeaningfulAssistant(value: unknown): boolean {
  const item = record(value);
  if (!item) return false;
  if (item.type === "message" && item.role === "assistant") {
    if (isRedundantAssistantPlaceholder(item) || !Array.isArray(item.content)) return false;
    return item.content.some((part: unknown) => {
      const block = record(part);
      return block?.type === "output_text" && typeof block.text === "string" && block.text.trim().length > 0;
    });
  }
  return item.type === "function_call" || item.type === "custom_tool_call" ||
    item.type === "computer_call" || item.type === "local_shell_call";
}

export interface ResponsesReplayHygiene {
  payload: unknown;
  removedVisiblePlaceholders: number;
  retainedAmbiguousPlaceholders: number;
  retainedReasoningItems: number;
}

/**
 * The atomic unit is the assistant run between a user/tool-result boundary.
 * If a run has a real assistant message or tool call, its stand-alone synthetic
 * text is redundant. Otherwise retain one message so the run does not become
 * reasoning-only; this fails closed for unrecognised host contracts.
 */
export function normalizeResponsesReplay(payload: unknown): ResponsesReplayHygiene {
  const body = record(payload);
  const input = body?.input;
  if (!Array.isArray(input)) return {
    payload, removedVisiblePlaceholders: 0, retainedAmbiguousPlaceholders: 0, retainedReasoningItems: 0,
  };

  let removedVisiblePlaceholders = 0;
  let retainedAmbiguousPlaceholders = 0;
  let retainedReasoningItems = 0;
  let changed = false;
  const result: unknown[] = [];
  let run: unknown[] = [];

  function flush() {
    if (!run.length) return;
    const hasMeaningful = run.some(isMeaningfulAssistant);
    const hasSyntheticReasoning = run.some(isSyntheticReasoningReplay);
    let keptPure = false;
    for (const item of run) {
      if (record(item)?.type === "reasoning") retainedReasoningItems++;
      // Without corroborating OMP synthetic reasoning this could be literal
      // model-generated text; preserve it, regardless of provider identity.
      if (!hasSyntheticReasoning || !isRedundantAssistantPlaceholder(item)) { result.push(item); continue; }
      if (!hasMeaningful && !keptPure) {
        keptPure = true;
        retainedAmbiguousPlaceholders++;
        result.push(item);
      } else {
        removedVisiblePlaceholders++;
        changed = true;
      }
    }
    run = [];
  }

  for (const item of input) {
    if (isBoundary(item)) {
      flush();
      result.push(item);
    } else {
      run.push(item);
    }
  }
  flush();
  return {
    payload: changed ? { ...body, input: result } : payload,
    removedVisiblePlaceholders, retainedAmbiguousPlaceholders, retainedReasoningItems,
  };
}
