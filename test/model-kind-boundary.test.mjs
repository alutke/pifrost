import assert from "node:assert/strict";
import test from "node:test";
import {
  bifrostModelKindEvidence, isBifrostChatModel, bifrostModelKindSummary,
} from "../model-kind-boundary.mjs";

test("excludes native judge, embeddings, image, TTS and non-chat gateway models from chat transport", () => {
  const rows = [
    { kind: "judge", id: "typesafe/jev-latest" },
    { model_kind: "image", id: "openai/gpt-image-1" },
    { supported_methods: ["image.generate"], id: "image-gen" },
    { supported_methods: ["audio.transcribe"], id: "speech" },
    { supported_methods: ["embeddings"], id: "embed" },
    { supported_methods: ["rerank"], id: "rerank" },
    { architecture: { output_modalities: ["audio"] }, id: "audio-out" },
    { kind: "video", id: "video-out" },
    { kind: "weird-new-kind", id: "unknown-kind" },
  ];
  for (const row of rows) assert.equal(isBifrostChatModel(row), false, row.id);
  assert.equal(bifrostModelKindSummary(rows).nonChat, rows.length);
});

test("does not disable ordinary chat and text-generation API methods", () => {
  const rows = [
    { kind: "chat", supported_methods: ["chat.completions"] },
    { kind: "tiny", supported_methods: ["chat.completions"] },
    { supported_methods: ["responses"] },
    { supported_methods: ["chat.completions"] },
    { supported_methods: ["generateContent"] },
    { supported_methods: ["generate_text"] },
    { architecture: { output_modalities: ["text"] } },
    {},
  ];
  for (const row of rows) assert.equal(isBifrostChatModel(row), true, JSON.stringify(row));
  assert.equal(bifrostModelKindEvidence(rows[7]).source, "unspecified");
  assert.deepEqual(bifrostModelKindSummary(rows), { chat: 6, unknown: 2, nonChat: 0 });
});

test("unsupported response shapes and mixed capabilities fail conservatively", () => {
  assert.equal(isBifrostChatModel({ kind: "judge", supported_methods: ["chat.completions"] }), false);
  assert.equal(isBifrostChatModel({ supported_methods: ["generate-image", "chat.completions"] }), true);
  assert.equal(isBifrostChatModel({ supported_methods: ["generate-image"] }), false);
  assert.equal(isBifrostChatModel({ supported_methods: ["systemone"] }), false);
  assert.equal(isBifrostChatModel({ supported_methods: ["unsupported-new-method"] }), false);
});
