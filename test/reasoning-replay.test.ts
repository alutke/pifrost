import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompletionsReplay, normalizeResponsesReplay } from "../reasoning-replay.ts";

const reason = () => ({ type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "reasoning unavailable" }] });
const placeholder = () => ({
  type: "message", status: "completed", role: "assistant",
  content: [{ type: "output_text", text: "<think>\nreasoning unavailable\n</think>", annotations: [] }],
});
const call = (id: string) => ({ type: "function_call", call_id: id, name: "grep", arguments: "{}" });
const output = (id: string) => ({ type: "function_call_output", call_id: id, output: "ok" });

test("preserves required DeepSeek reasoning and tool pairing, drops only redundant visible assistant placeholders", () => {
  const a = reason(), b = placeholder(), c = call("call_a"), d = output("call_a");
  const input = [{ role: "user", content: "task" }, a, b, c, d, reason(), placeholder(), {
    type: "message", role: "assistant", content: [{ type: "output_text", text: "Useful response" }],
  }];
  const body = { model: "CommandCode GOAT/deepseek/deepseek-v4.1-flash", input, store: false, tools: [] };
  const original = JSON.stringify(body);
  const hygiene = normalizeResponsesReplay(body);
  assert.equal(hygiene.removedVisiblePlaceholders, 2);
  assert.equal(hygiene.retainedAmbiguousPlaceholders, 0);
  const clean = (hygiene.payload as typeof body).input;
  assert.deepEqual(clean, [input[0], a, c, d, input[5], input[7]]);
  assert.equal(clean[1], a);
  assert.equal(clean[2], c);
  assert.equal(JSON.stringify(body), original, "must not mutate original OMP payload");
  assert.equal(normalizeResponsesReplay(hygiene.payload).payload, hygiene.payload, "idempotent");
});

test("retains one ambiguous placeholder in an otherwise reasoning-only assistant run", () => {
  const input = [{ role: "user", content: "task" }, reason(), placeholder(), placeholder(), {
    role: "user", content: "continue",
  }];
  const normalized = normalizeResponsesReplay({ input });
  assert.equal(normalized.removedVisiblePlaceholders, 1);
  assert.equal(normalized.retainedAmbiguousPlaceholders, 1);
  assert.equal((normalized.payload as { input: unknown[] }).input.length, 4);
});

test("leaves mixed thinking, real reasoning, quoted user text, annotated messages and unknown structures untouched", () => {
  const mixed = { type: "message", role: "assistant", content: [{
    type: "output_text", text: "<think>\nreasoning unavailable<dy>Actual further thought</think>",
  }] };
  const annotated = { type: "message", role: "assistant", content: [{
    type: "output_text", text: "<think>reasoning unavailable</think>", annotations: [{ type: "file_citation" }],
  }] };
  const input = [{ role: "user", content: "<think>reasoning unavailable</think>" }, reason(), mixed, annotated,
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Real reasoning unavailable details" }] },
  ];
  const body = { input };
  const normalized = normalizeResponsesReplay(body);
  assert.equal(normalized.payload, body);
  assert.equal(normalized.removedVisiblePlaceholders, 0);
  assert.equal(normalized.retainedReasoningItems, 1);
  assert.equal(normalizeResponsesReplay({ data: "no input" }).removedVisiblePlaceholders, 0);
  assert.equal(normalizeResponsesReplay(null).payload, null);
});

test("exact 590-item Bifrost history shape retains 133 reasoning items and 106 call/output pairs", () => {
  // Redacted structural fixture: original count by type (58 user, 133 reasoning,
  // 187 assistant message, 106 function calls and 106 outputs). No real content.
  const input: unknown[] = [{ role: "user", content: "task" }];
  for (let i = 0; i < 106; i++) input.push(reason(), placeholder(), call("call_" + i), output("call_" + i));
  for (let i = 0; i < 27; i++) input.push(reason(), placeholder(), {
    type: "message", role: "assistant", content: [{ type: "output_text", text: "Useful" }],
  });
  for (let i = 0; i < 27; i++) input.push({
    type: "message", role: "assistant", content: [{ type: "output_text", text: "Useful" }],
  });
  for (let i = 0; i < 57; i++) input.push({ role: "user", content: "next" });
  assert.equal(input.length, 590);
  const originals = input.filter((x): x is ReturnType<typeof call> =>
    typeof x === "object" && x !== null && "type" in x && x.type === "function_call").map(x => x.call_id);
  const normalized = normalizeResponsesReplay({ input });
  const result = (normalized.payload as { input: Record<string, unknown>[] }).input;
  assert.equal(result.filter(x => x.type === "reasoning").length, 133);
  assert.deepEqual(result.filter(x => x.type === "function_call").map(x => x.call_id), originals);
  assert.deepEqual(result.filter(x => x.type === "function_call_output").map(x => x.call_id), originals);
  assert.equal(normalized.removedVisiblePlaceholders, 133);
  assert.equal(normalized.retainedAmbiguousPlaceholders, 0);
});

test("works uniformly across provider identities, without stripping their real reasoning", () => {
  const models = [
    "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
    "opencode-go/deepseek/deepseek-r1",
    "openrouter/deepseek/deepseek-r1",
    "openrouter/anthropic/claude-sonnet-4",
    "openrouter/openai/gpt-5",
    "xiaomi/mimo-v2-flash",
    "opencode-go/muse-spark-1.3-contributor",
    "openai/gpt-5.4",
    "gemini/gemini-3",
  ];
  for (const model of models) {
    const source = { model, input: [reason(), placeholder(), call("tc"), output("tc")] };
    const result = normalizeResponsesReplay(source);
    assert.equal(result.removedVisiblePlaceholders, 1, model);
    const clean = (result.payload as typeof source).input;
    assert.deepEqual(clean, [source.input[0], source.input[2], source.input[3]], model);
  }
});

test("never discards lookalike model text unless the same turn has synthetic reasoning", () => {
  const text = placeholder();
  for (const previous of [
    { type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "real private reasoning" }] },
    { type: "reasoning", summary: [{ type: "summary_text", text: "Actual summary" }], content: [{ type: "reasoning_text", text: "reasoning unavailable" }] },
    { type: "reasoning", encrypted_content: "opaque", content: [{ type: "reasoning_text", text: "reasoning unavailable" }] },
  ]) {
    const source = { input: [previous, text, call("keep")] };
    assert.equal(normalizeResponsesReplay(source).payload, source);
  }
});

test("no rewrites for physical non-Responses payload and never changes user content", () => {
  const source = { messages: [{ role: "user", content: "<think>reasoning unavailable</think>" }] };
  assert.equal(normalizeResponsesReplay(source).payload, source);
});

test("rewrites corroborated mixed DeepSeek/OMP assistant history while retaining real text and metadata", () => {
  const mixedSamples = [
    "<think>\nreasoning unavailable<dy>\nThe actual analysis is important\n</dy>",
    "<think>\nreasoning unavailable<think>\nThe next thought",
    "<think>\nreasoning unavailable<parameter name=\"i\">Checking state</parameter>",
    "<think>\nreasoning unavailable\nreasoning unavailable<think>\nMore important thought",
  ];
  for (const raw of mixedSamples) {
    const item = { type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: raw, annotations: [] }] };
    const source = { input: [reason(), item, call("call_m"), output("call_m")] };
    const original = JSON.stringify(source);
    const normalized = normalizeResponsesReplay(source);
    assert.equal(normalized.removedVisiblePlaceholders, 0);
    assert.equal(normalized.rewrittenMixedMessages, 1);
    const result = (normalized.payload as typeof source).input;
    const rewritten = (result[1] as typeof item).content[0].text;
    assert.equal(rewritten.includes("reasoning unavailable"), false);
    assert.equal(rewritten.startsWith("<think>\n<"), true);
    assert.equal(rewritten.endsWith(raw.slice(raw.lastIndexOf("<") + 1)) ||
      rewritten.includes("The actual analysis") || rewritten.includes("The next thought") ||
      rewritten.includes("Checking state") || rewritten.includes("More important thought"), true);
    assert.equal(result[0], source.input[0], "structured reasoning untouched");
    assert.equal(result[2], source.input[2], "tool-call untouched");
    assert.equal(JSON.stringify(source), original, "original OMP body untouched");
    assert.equal(normalizeResponsesReplay(normalized.payload).payload, normalized.payload, "idempotent");
  }
});

test("does not rewrite mixed content without synthetic same-turn reason or with annotations", () => {
  const mixed = { type: "message", role: "assistant",
    content: [{ type: "output_text", text: "<think>\nreasoning unavailable<dy>Real" }] };
  const real = { type: "reasoning", summary: [{ type: "summary_text", text: "genuine" }],
    content: [{ type: "reasoning_text", text: "reasoning unavailable" }] };
  const noReason = { input: [mixed, call("x")] };
  assert.equal(normalizeResponsesReplay(noReason).payload, noReason);
  const actual = { input: [real, mixed, call("x")] };
  assert.equal(normalizeResponsesReplay(actual).payload, actual);
  const annotated = { ...mixed, content: [{ ...mixed.content[0],
    annotations: [{ type: "citation", text: "reasoning unavailable" }] }] };
  const withAnnotations = { input: [reason(), annotated, call("x")] };
  assert.equal(normalizeResponsesReplay(withAnnotations).payload, withAnnotations);
  const boundary = { input: [reason(), { role: "user", content: "Question" }, mixed, call("x")] };
  assert.equal(normalizeResponsesReplay(boundary).payload, boundary);
});

test("matches the new Bifrost capture mixed-history shapes across every Responses provider", () => {
  // 20 known mixed candidates, 7 ambiguous pure placeholders, 158 reasoning
  // items in v0.12.5. Redacted structural fixture without prompts/tool output.
  const models = ["commandcode", "opencode-go", "openrouter", "xiaomi", "openai"];
  for (const provider of models) {
    const input: unknown[] = [{ role: "user", content: "request" }];
    for (let i = 0; i < 20; i++) {
      input.push(reason(), {
        type: "message", role: "assistant", content: [{ type: "output_text",
          text: "<think>\nreasoning unavailable<dy>Retained-" + i + "</dy>", annotations: [] }],
      }, call("t" + i), output("t" + i));
    }
    for (let i = 0; i < 7; i++) input.push(reason(), placeholder(), { role: "user", content: "next" });
    const normalized = normalizeResponsesReplay({ model: provider, input });
    assert.equal(normalized.rewrittenMixedMessages, 20);
    assert.equal(normalized.retainedAmbiguousPlaceholders, 7);
    assert.equal(normalized.removedVisiblePlaceholders, 0);
    const out = (normalized.payload as { input: Record<string, unknown>[] }).input;
    for (let i = 0; i < 20; i++) assert(out.some(x => x.type === "function_call" && x.call_id === "t" + i));
  }
});

test("Chat Completions normalises only corroborated synthetic assistant demotion for all models", () => {
  for (const model of ["commandcode/deepseek", "opencode-go/muse", "openrouter/claude",
    "deepseek/direct", "xiaomi/mimo", "openai/gpt", "qwen/flash"]) {
    const tagged = { role: "assistant", reasoning_content: "reasoning unavailable",
      content: "<think>\nreasoning unavailable<dy>Keep these words</dy>",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "grep", arguments: "{}" } }] };
    const source = { model, messages: [{ role: "user", content: "question" }, tagged,
      { role: "tool", tool_call_id: "call_1", content: "success" }] };
    const a = normalizeCompletionsReplay(source);
    assert.equal(a.rewrittenMixedMessages, 1);
    const modified = (a.payload as typeof source).messages[1] as typeof tagged;
    assert.equal(modified.content, "<think>\n<dy>Keep these words</dy>");
    assert.equal(modified.reasoning_content, "reasoning unavailable");
    assert.equal(modified.tool_calls, tagged.tool_calls);
    assert.deepEqual(source.messages[1], tagged, "source unchanged");
    assert.equal(normalizeCompletionsReplay(a.payload).payload, a.payload);
  }
});

test("Chat Completions never strips quoted phrases, user messages or uncorraborated reasoning", () => {
  const user = { role: "user", content: "<think>\nreasoning unavailable<dy>user content" };
  const plain = { role: "assistant", content: "<think>\nreasoning unavailable<dy>real text" };
  const annotated = { role: "assistant", reasoning_content: "valid genuine content",
    content: "<think>\nreasoning unavailable<dy>real text" };
  const source = { messages: [user, plain, annotated] };
  assert.equal(normalizeCompletionsReplay(source).payload, source);
  assert.equal(normalizeCompletionsReplay({ input: [] }).rewrittenMixedMessages, 0);
});
