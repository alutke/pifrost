import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeepSeekResponsesReplay } from "../reasoning-replay.ts";

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
  const hygiene = normalizeDeepSeekResponsesReplay(body);
  assert.equal(hygiene.removedVisiblePlaceholders, 2);
  assert.equal(hygiene.retainedAmbiguousPlaceholders, 0);
  const clean = (hygiene.payload as typeof body).input;
  assert.deepEqual(clean, [input[0], a, c, d, input[5], input[7]]);
  assert.equal(clean[1], a);
  assert.equal(clean[2], c);
  assert.equal(JSON.stringify(body), original, "must not mutate original OMP payload");
  assert.equal(normalizeDeepSeekResponsesReplay(hygiene.payload).payload, hygiene.payload, "idempotent");
});

test("retains one ambiguous placeholder in an otherwise reasoning-only assistant run", () => {
  const input = [{ role: "user", content: "task" }, reason(), placeholder(), placeholder(), {
    role: "user", content: "continue",
  }];
  const normalized = normalizeDeepSeekResponsesReplay({ input });
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
  const normalized = normalizeDeepSeekResponsesReplay(body);
  assert.equal(normalized.payload, body);
  assert.equal(normalized.removedVisiblePlaceholders, 0);
  assert.equal(normalized.retainedReasoningItems, 1);
  assert.equal(normalizeDeepSeekResponsesReplay({ data: "no input" }).removedVisiblePlaceholders, 0);
  assert.equal(normalizeDeepSeekResponsesReplay(null).payload, null);
});

test("590-item transcript-shaped replay preserves calls, outputs, reasoning and boundaries", () => {
  // Shape and cardinalities from a redacted Bifrost capture; no user content or
  // secrets copied into the test. Each assistant tool turn has required reasoning.
  const input: unknown[] = [{ role: "user", content: "task" }];
  for (let i = 0; i < 117; i++) {
    input.push(reason(), placeholder(), call("call_" + i), output("call_" + i));
  }
  for (let i = 0; i < 40; i++) {
    input.push(reason(), placeholder(), { type: "message", role: "assistant", content: [{ type: "output_text", text: "Useful" }] });
  }
  const originalCallIds = input.filter((x): x is ReturnType<typeof call> =>
    typeof x === "object" && x !== null && "type" in x && x.type === "function_call").map(x => x.call_id);
  const normalized = normalizeDeepSeekResponsesReplay({ input });
  const outputItems = (normalized.payload as { input: Record<string, unknown>[] }).input;
  assert.equal(outputItems.filter(x => x.type === "reasoning").length, 157);
  assert.deepEqual(outputItems.filter(x => x.type === "function_call").map(x => x.call_id), originalCallIds);
  assert.deepEqual(outputItems.filter(x => x.type === "function_call_output").map(x => x.call_id), originalCallIds);
  assert.equal(normalized.removedVisiblePlaceholders, 157);
  assert.equal(normalized.retainedAmbiguousPlaceholders, 0);
});

test("no rewrites for physical non-Responses payload and never changes user content", () => {
  const source = { messages: [{ role: "user", content: "<think>reasoning unavailable</think>" }] };
  assert.equal(normalizeDeepSeekResponsesReplay(source).payload, source);
});
