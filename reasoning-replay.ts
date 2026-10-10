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

// OMP sometimes serialises a nested opening <think> around its fallback.
// The entire message is still synthetic; retain a safe ambiguous turn below.
const PURE_SYNTHETIC_THINKING = /^\s*(?:<think>\s*)+reasoning unavailable\s*<\/think>\s*$/u;
/** Only strip exact OMP replay markers immediately before recognised markup.
 * Plain language occurrences, arbitrary tags and unsigned reasoning stay intact. */
// Require complete marker boundaries (newline or known OMP markup), NEVER
// a substring inside real prose. Corroborating structured synthetic reasoning
// in the same assistant run is mandatory for Responses history rewriting.
const MIXED_SYNTHETIC_PREFIX = /^(\s*<think>\s*)(?:(?:<think>\s*)*reasoning unavailable(?:[ \t]*\r?\n[ \t]*|(?=<(?:dy\b|think\b|parameter\b|\/think\b))))+(?=\S)/u;

function mixedSyntheticReplacement(value: unknown): JsonRecord | undefined {
  const item = record(value);
  if (item?.type !== "message" || item.role !== "assistant" ||
      !Array.isArray(item.content) || item.content.length !== 1) return undefined;
  const block = record(item.content[0]);
  if (block?.type !== "output_text" || typeof block.text !== "string" ||
      (Array.isArray(block.annotations) && block.annotations.length > 0)) return undefined;
  const cleaned = block.text.replace(MIXED_SYNTHETIC_PREFIX, "$1");
  return cleaned !== block.text && cleaned.trim().length > 0
    ? { ...item, content: [{ ...block, text: cleaned }] }
    : undefined;
}

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
  rewrittenMixedMessages: number;
  rewrittenNestedMessages: number;
  rewrittenProseMessages: number;
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
    payload, removedVisiblePlaceholders: 0, rewrittenMixedMessages: 0, rewrittenNestedMessages: 0, rewrittenProseMessages: 0, retainedAmbiguousPlaceholders: 0, retainedReasoningItems: 0,
  };

  let removedVisiblePlaceholders = 0;
  let rewrittenMixedMessages = 0;
  let rewrittenNestedMessages = 0;
  let rewrittenProseMessages = 0;
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
      if (!hasSyntheticReasoning) { result.push(item); continue; }
      if (!isRedundantAssistantPlaceholder(item)) {
        const cleaned = mixedSyntheticReplacement(item);
        if (cleaned) {
          result.push(cleaned);
          rewrittenMixedMessages++;
          const beforeText = (record(item)?.content as JsonRecord[])?.[0]?.text;
          if (typeof beforeText === "string" && /^\s*<think>\s*<think>/u.test(beforeText)) rewrittenNestedMessages++;
          if (typeof beforeText === "string" && /^\s*<think>\s*reasoning unavailable\s*\r?\n[ \t]*[^<\s]/u.test(beforeText)) rewrittenProseMessages++;
          changed = true;
        }
        else result.push(item);
        continue;
      }
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
    removedVisiblePlaceholders, rewrittenMixedMessages, rewrittenNestedMessages, rewrittenProseMessages, retainedAmbiguousPlaceholders, retainedReasoningItems,
  };
}

/**
 * Chat Completions: preserve every assistant/tool turn and native reasoning
 * continuation field. Only remove a redundant visible OMP demotion prefix
 * when the SAME assistant message carries the exact synthetic reasoning hint.
 * Works on direct aliases and all dynamic physical Chat routes.
 */
export function normalizeCompletionsReplay(payload: unknown): ResponsesReplayHygiene {
  const body = record(payload);
  if (!body || !Array.isArray(body.messages)) return {
    payload, removedVisiblePlaceholders: 0, rewrittenMixedMessages: 0, rewrittenNestedMessages: 0, rewrittenProseMessages: 0,
    retainedAmbiguousPlaceholders: 0, retainedReasoningItems: 0,
  };
  let rewrittenMixedMessages = 0;
  let rewrittenNestedMessages = 0;
  let rewrittenProseMessages = 0;
  const messages = body.messages.map((raw: unknown) => {
    const item = record(raw);
    if (item?.role !== "assistant" || typeof item.content !== "string") return raw;
    const synthetic = item.reasoning_content === "reasoning unavailable" ||
      item.reasoning_text === "reasoning unavailable" ||
      item.reasoning === "reasoning unavailable";
    if (!synthetic) return raw;
    const cleaned = item.content.replace(MIXED_SYNTHETIC_PREFIX, "$1");
    if (cleaned === item.content || !cleaned.trim()) return raw;
    rewrittenMixedMessages++;
    if (/^\s*<think>\s*<think>/u.test(item.content)) rewrittenNestedMessages++;
    if (/^\s*<think>\s*reasoning unavailable\s*\r?\n[ \t]*[^<\s]/u.test(item.content)) rewrittenProseMessages++;
    return { ...item, content: cleaned };
  });
  return {
    payload: rewrittenMixedMessages ? { ...body, messages } : payload,
    removedVisiblePlaceholders: 0, rewrittenMixedMessages, rewrittenNestedMessages, rewrittenProseMessages,
    retainedAmbiguousPlaceholders: 0, retainedReasoningItems: 0,
  };
}
