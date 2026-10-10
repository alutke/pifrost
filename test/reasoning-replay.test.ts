import assert from "node:assert/strict";
import test from "node:test";
import { normalizeResponsesReplay } from "../reasoning-replay.ts";

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
