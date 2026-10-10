import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, AssistantMessageEvent } from "@oh-my-pi/pi-ai";
import {
  newReasoningHygieneCounters, observeReasoningSse,
  ResponsesReasoningPrefixFilter,
} from "../reasoning-stream.ts";

function message(thinking: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "commandcode",
    model: "deepseek/deepseek-v4.1-flash",
    content: [{ type: "thinking", thinking }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stopReason: "stop",
    timestamp: 0,
  } as AssistantMessage;
}
function simulate(chunks: string[], enabled = true) {
  const counters = newReasoningHygieneCounters();
  const filter = new ResponsesReasoningPrefixFilter(counters, enabled);
  let acc = "";
  const sources: AssistantMessageEvent[] = [
    { type: "start", partial: message("") },
    { type: "thinking_start", contentIndex: 0, partial: message("") },
  ];
  for (const delta of chunks) {
    acc += delta;
    sources.push({ type: "thinking_delta", contentIndex: 0, delta, partial: message(acc) });
  }
  sources.push({ type: "thinking_end", contentIndex: 0, content: acc, partial: message(acc) });
  sources.push({ type: "toolcall_start", contentIndex: 1, partial: {
    ...message(acc), content: [...message(acc).content,
      { type: "toolCall", id: "call_test", name: "grep", arguments: {} }],
  } });
  sources.push({ type: "done", reason: "toolUse", message: message(acc) });
  const before = JSON.stringify(sources);
  const emitted = sources.flatMap(e => filter.consume(e));
  return { counters, emitted, sources, before };
}
function thought(m: AssistantMessage): string {
  const block = m.content[0];
  assert(block?.type === "thinking");
  return block.thinking;
}

test("removes the exact repeated upstream marker despite every-character SSE chunking", () => {
  const content = "reasoning unavailable\nreasoning unavailable<think>\nAuthentic reasoning";
  const { emitted, sources, before, counters } = simulate([...content]);
  const expected = "<think>\nAuthentic reasoning";
  assert.equal(counters.outputPrefixesRemoved, 1);
  assert.equal(counters.outputPrefixCharsRemoved,
    content.indexOf("<think>"));
  assert.equal(emitted.filter(x => x.type === "thinking_delta")
    .map(x => "delta" in x ? x.delta : "").join(""), expected);
  assert.equal(emitted.find(x => x.type === "thinking_end")?.type, "thinking_end");
  for (const event of emitted) {
    if ("partial" in event && event.partial.content[0]?.type === "thinking" &&
        event.type !== "thinking_start" && event.type !== "start") {
      // Partial snapshots are incremental, not all equal to the terminal
      // snapshot. They must remain prefixes of the cleaned final content.
      assert.equal(expected.startsWith(thought(event.partial)), true);
    }
  }
  const end = emitted.find(x => x.type === "thinking_end");
  assert(end?.type === "thinking_end");
  assert.equal(end.content, expected);
  const terminal = emitted.at(-1);
  assert(terminal?.type === "done");
  assert.equal(thought(terminal.message), expected);
  assert.equal(JSON.stringify(sources), before, "original OMP events immutable");
  assert.equal(emitted.find(x => x.type === "toolcall_start")?.type, "toolcall_start");
});

test("passes genuine content, a single marker, and malformed prefixes unchanged", () => {
  for (const text of [
    "Genuine reasoning",
    "reasoning unavailable<think>Some normal prose",
    "reasoning unavailable\nThis model does not expose its reasoning",
    "reasoning unavailable\nreasoning unavailable BUT THEN SOMETHING ELSE",
    "reasoning unavailable\nreasoning unavailable<dy>The model said this",
  ]) {
    const a = simulate([text.slice(0, 7), text.slice(7)]);
    assert.equal(a.counters.outputPrefixesRemoved, 0);
    assert.equal(a.emitted.filter(x => x.type === "thinking_delta").map(x => "delta" in x ? x.delta : "").join(""), text);
    const term = a.emitted.at(-1);
    assert(term?.type === "done");
    assert.equal(thought(term.message), text);
  }
});

test("disabled mode is byte-for-byte event pass-through for unrelated providers", () => {
  const source = "reasoning unavailable\nreasoning unavailable<think>text";
  const a = simulate([source.slice(0, 17), source.slice(17)], false);
  assert.equal(a.counters.outputPrefixesRemoved, 0);
  assert.deepEqual(a.emitted, a.sources);
});

test("SSE observer counts reasoning frames and marker presence without retaining content", () => {
  const counters = newReasoningHygieneCounters();
  observeReasoningSse(counters, { event: "response.reasoning_summary_text.delta", data: '{"delta":"reasoning unavailable"}' });
  observeReasoningSse(counters, { event: "response.reasoning_summary_part.done", data: '{"some":"text"}' });
  observeReasoningSse(counters, { event: "response.output_text.delta", data: '{"delta":"reasoning unavailable"}' });
  assert.equal(counters.rawReasoningSseFrames, 2);
  assert.equal(counters.rawReasoningMarkerFrames, 1);
  assert.equal(JSON.stringify(counters).includes("unavailable"), false);
});

test("all physical model families share the same guarded streaming semantics", () => {
  const providers = [
    "CommandCode GOAT", "OpenCode Go", "OpenRouter", "DeepSeek", "Xiaomi MiMo",
    "OpenAI", "Anthropic through OpenRouter", "ZAI", "Gemini via Bifrost",
  ];
  const encoded = "reasoning unavailable\nreasoning unavailable<think>Actual thinking";
  for (const provider of providers) {
    const x = simulate([encoded.slice(0, 6), encoded.slice(6, 22), encoded.slice(22)]);
    assert.equal(x.counters.outputPrefixesRemoved, 1, provider);
    assert.equal(x.emitted.filter(e => e.type === "thinking_delta")
      .map(e => e.type === "thinking_delta" ? e.delta : "").join(""), "<think>Actual thinking", provider);
  }
});


test("v0.12.6 captured marker-only streamed reasoning is hidden without suppressing tool calls or changing OMP input", () => {
  const text = "reasoning unavailable\nreasoning unavailable";
  for (const chunks of [[text], [...text], ["reasoning una", "vailable\nreasoning", " unavailable"]]) {
    const run = simulate(chunks);
    assert.equal(run.counters.outputMarkerOnlyCleared, 1);
    assert.equal(run.counters.outputPrefixesRemoved, 0);
    assert.equal(run.emitted.filter(e => e.type === "thinking_delta").length, 0);
    const end = run.emitted.find(e => e.type === "thinking_end");
    assert(end?.type === "thinking_end");
    assert.equal(end.content, "");
    assert.equal(thought(end.partial), "");
    const tool = run.emitted.find(e => e.type === "toolcall_start");
    assert(tool?.type === "toolcall_start");
    assert.equal(thought(tool.partial), "");
    const final = run.emitted.at(-1);
    assert(final?.type === "done");
    assert.equal(thought(final.message), "");
    assert.equal(JSON.stringify(run.sources), run.before, "must not mutate original signed session events");
  }
});

test("single exact marker-only reasoning block also suppresses safely", () => {
  const run = simulate(["reasoning ", "unavailable"]);
  assert.equal(run.counters.outputMarkerOnlyCleared, 1);
  assert.equal(run.emitted.filter(e => e.type === "thinking_delta").length, 0);
  assert(run.emitted.at(-1)?.type === "done");
});

test("marker-like content with substantive reasoning is preserved, even after marker-only partials", () => {
  for (const text of [
    "reasoning unavailable\nreasoning unavailable\nThe actual thought",
    "reasoning unavailable\nreasoning unavailable<dy>Actual thought",
    "reasoning unavailable\nA model genuinely claimed unavailable reasoning",
    "reasoning unavailable\nreasoning unavailable in prose",
  ]) {
    const chunks = [...text];
    const run = simulate(chunks);
    assert.equal(run.counters.outputMarkerOnlyCleared, 0);
    assert.equal(run.emitted.filter(e => e.type === "thinking_delta")
      .map(e => e.type === "thinking_delta" ? e.delta : "").join(""), text);
    const final = run.emitted.at(-1);
    assert(final?.type === "done");
    assert.equal(thought(final.message), text);
  }
});

test("signed/opaque exact marker-only thinking is retained byte-for-byte", () => {
  const text = "reasoning unavailable\nreasoning unavailable";
  const counters = newReasoningHygieneCounters();
  const filter = new ResponsesReasoningPrefixFilter(counters, true);
  const sign = "rs_opqaque-signature";
  const annotatedMessage = (reasoning: string): AssistantMessage => ({
    ...message(reasoning), content: [{ type: "thinking", thinking: reasoning, thinkingSignature: sign }],
  });
  const events: AssistantMessageEvent[] = [
    { type: "start", partial: annotatedMessage("") },
    { type: "thinking_start", contentIndex: 0, partial: annotatedMessage("") },
    { type: "thinking_delta", contentIndex: 0, delta: text, partial: annotatedMessage(text) },
    { type: "thinking_end", contentIndex: 0, content: text, partial: annotatedMessage(text) },
    { type: "done", reason: "stop", message: annotatedMessage(text) },
  ];
  const result = events.flatMap(e => filter.consume(e));
  assert.equal(counters.outputMarkerOnlyCleared, 0);
  assert.equal(counters.outputMarkerOnlyRetainedSigned, 1);
  assert.equal(result.filter(e => e.type === "thinking_delta").map(e => e.type === "thinking_delta" ? e.delta : "").join(""), text);
  const last = result.at(-1);
  assert(last?.type === "done");
  assert.equal(thought(last.message), text);
});

test("count-only reasoning telemetry includes marker-only suppression without retaining prompts", () => {
  const counters = newReasoningHygieneCounters();
  observeReasoningSse(counters, { event: "response.reasoning_summary_text.delta",
    data: '{"delta":"reasoning unavailable"}' });
  const filter = new ResponsesReasoningPrefixFilter(counters, true);
  const events: AssistantMessageEvent[] = [
    { type: "thinking_start", contentIndex: 0, partial: message("") },
    { type: "thinking_delta", contentIndex: 0, delta: "reasoning unavailable", partial: message("reasoning unavailable") },
    { type: "thinking_end", contentIndex: 0, content: "reasoning unavailable", partial: message("reasoning unavailable") },
    { type: "toolcall_start", contentIndex: 1, partial: { ...message("reasoning unavailable"),
      content: [...message("reasoning unavailable").content,
        { type: "toolCall", id: "call_valid", name: "bash", arguments: {} }],
    } },
  ];
  events.flatMap(e => filter.consume(e));
  assert.equal(counters.rawReasoningMarkerFrames, 1);
  assert.equal(counters.outputMarkerOnlyCleared, 1);
  assert.equal(JSON.stringify(counters).includes("reasoning unavailable"), false);
});


test("native OpenAI rs_* transport item without a signature must remain opaque", () => {
  const text = "reasoning unavailable\nreasoning unavailable";
  const counters = newReasoningHygieneCounters();
  const filter = new ResponsesReasoningPrefixFilter(counters, true);
  const msg = (thinking: string): AssistantMessage => ({
    ...message(thinking), content: [{ type: "thinking", thinking, itemId: "rs_real_provider_item" }],
  });
  const emitted = ([
    { type: "thinking_start", contentIndex: 0, partial: msg("") },
    { type: "thinking_delta", contentIndex: 0, delta: text, partial: msg(text) },
    { type: "thinking_end", contentIndex: 0, content: text, partial: msg(text) },
    { type: "done", reason: "stop", message: msg(text) },
  ] as AssistantMessageEvent[]).flatMap(event => filter.consume(event));
  assert.equal(counters.outputMarkerOnlyCleared, 0);
  assert.equal(counters.outputMarkerOnlyRetainedSigned, 1);
  assert.equal(emitted.filter(x => x.type === "thinking_delta").map(x => x.type === "thinking_delta" ? x.delta : "").join(""), text);
});


test("marker-only thinking without a substantive continuation is preserved (never create empty answer)", () => {
  const text = "reasoning unavailable\nreasoning unavailable";
  const counters = newReasoningHygieneCounters();
  const filter = new ResponsesReasoningPrefixFilter(counters, true);
  const original: AssistantMessageEvent[] = [
    { type: "start", partial: message("") },
    { type: "thinking_start", contentIndex: 0, partial: message("") },
    { type: "thinking_delta", contentIndex: 0, delta: text, partial: message(text) },
    { type: "thinking_end", contentIndex: 0, content: text, partial: message(text) },
    { type: "done", reason: "stop", message: message(text) },
  ];
  const emitted = original.flatMap(event => filter.consume(event));
  assert.deepEqual(emitted, original);
  assert.equal(counters.outputMarkerOnlyCleared, 0);
  assert.equal(counters.outputMarkerOnlyRetainedNoContinuation, 1);
});

test("marker-only thinking is suppressed if terminal response includes actual tool call even without toolcall_start", () => {
  const text = "reasoning unavailable\nreasoning unavailable";
  const counters = newReasoningHygieneCounters();
  const filter = new ResponsesReasoningPrefixFilter(counters, true);
  const terminal: AssistantMessage = { ...message(text), content: [
    { type: "thinking", thinking: text },
    { type: "toolCall", id: "call_valid", name: "bash", arguments: { command: "pwd" } },
  ] };
  const emitted = ([
    { type: "thinking_start", contentIndex: 0, partial: message("") },
    { type: "thinking_delta", contentIndex: 0, delta: text, partial: message(text) },
    { type: "thinking_end", contentIndex: 0, content: text, partial: message(text) },
    { type: "done", reason: "toolUse", message: terminal },
  ] as AssistantMessageEvent[]).flatMap(event => filter.consume(event));
  assert.equal(counters.outputMarkerOnlyCleared, 1);
  const final = emitted.at(-1);
  assert(final?.type === "done");
  assert.equal(thought(final.message), "");
  assert.deepEqual(final.message.content[1], terminal.content[1]);
});
