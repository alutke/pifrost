/**
 * Classify only chat-compatible entries from Bifrost /v1/models.
 * Non-chat OMP kinds are first-class but cannot use Pifrost's OpenAI chat
 * transport. Unknown metadata stays conservative; never infer a native judge
 * from a text generation model or a methods:["generate-image"] card.
 */
const NON_CHAT_KINDS = new Set(["judge", "search", "image", "tts", "stt", "speech", "dictation", "embedding", "rerank", "video"]);
const KNOWN_CHAT_KINDS = new Set(["chat", "tiny", "text"]);
const NON_CHAT_METHOD = /decision|systemone|embed|rerank|search|transcrib|transcript|speech|synthes|audio|image|video|vision[_-]?generation|classif/i;
const CHAT_METHOD = /chat|messages?|completions?|responses?|generate[_-]?content|generate[_-]?text|text[_-]?generation/i;

export function bifrostModelKindEvidence(model) {
  const explicit = [model?.kind, model?.model_kind].find(v => typeof v === "string" && v.trim());
  if (explicit) {
    const kind = explicit.trim().toLowerCase();
    return { kind, source: "explicit", chat: KNOWN_CHAT_KINDS.has(kind) };
  }
  const methods = Array.isArray(model?.supported_methods)
    ? model.supported_methods.filter(v => typeof v === "string").map(v => v.toLowerCase()) : [];
  if (methods.length > 0) {
    const chat = methods.some(method => !NON_CHAT_METHOD.test(method) && CHAT_METHOD.test(method));
    const nonChat = methods.some(method => NON_CHAT_METHOD.test(method) && !CHAT_METHOD.test(method));
    return { kind: chat ? "chat" : nonChat ? "non-chat" : "unknown", source: "methods", chat };
  }
  const outputs = Array.isArray(model?.architecture?.output_modalities)
    ? model.architecture.output_modalities.map(v => String(v).toLowerCase()) : [];
  if (outputs.length > 0 && !outputs.some(v => /text/i.test(v))) {
    return { kind: "non-text-output", source: "output_modalities", chat: false };
  }
  return { kind: "unknown", source: "unspecified", chat: true };
}

export function isBifrostChatModel(model) {
  return bifrostModelKindEvidence(model).chat;
}

/** Name-only grouping for model-kind awareness, never a new OMP runner. */
export function bifrostModelKindSummary(models) {
  const summary = { chat: 0, nonChat: 0, unknown: 0 };
  for (const model of models ?? []) {
    const evidence = bifrostModelKindEvidence(model);
    if (evidence.chat && evidence.source === "unspecified") summary.unknown++;
    else if (evidence.chat) summary.chat++;
    else summary.nonChat++;
  }
  return summary;
}
