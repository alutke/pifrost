/**
 * Bounded conformance probes only. These run on explicit CLI invocation;
 * regular inference, judge caching, fallback, concurrency and session usage
 * are owned by Bifrost and OMP, not by Pifrost.
 */
import { requestJson } from "./http-client.mjs";
import { deflateSync } from "node:zlib";
import {
  nativeJudgeGateway, nativeJudgeProbeRequest,
  parseNativeJudgeModelsResponse, validateNativeJudgeResponse,
} from "./judge-bridge.mjs";

function authHeaders(judge) {
  // Modern Bifrost 2.x virtual keys are accepted as bearer authentication.
  // OMP TypeSafeJudge itself supplies this same bearer credential.
  return { "x-bf-vk": judge.virtualKey, Authorization: "Bearer " + judge.virtualKey };
}

/** Strictly validate the OpenAI-compatible model listing, not its chat capabilities. */
export function parseOpenAIDecisionModelsResponse(payload) {
  if (!payload || !Array.isArray(payload.data) ||
      payload.data.some(item => !item || typeof item.id !== "string" || !item.id.trim())) {
    throw new Error("Bifrost native OpenAI model listing returned an invalid response");
  }
  return [...new Set(payload.data.map(item => item.id))];
}

export function openAIDecisionProbeRequest(model, image) {
  const base = nativeJudgeProbeRequest(model);
  return {
    model,
    input: image ? [{
      role: "user",
      content: [
        { type: "input_text", text: base.state + " A white test image is attached." },
        { type: "input_image", image_url: "data:image/png;base64," + image },
      ],
    }] : base.state,
    questions: [
      { type: "predicate", name: "urgent", instructions: base.questions.urgent.instructions },
      { type: "choice", name: "category", instructions: base.questions.category.instructions,
        choices: Object.entries(base.questions.category.criteria).map(([value, description]) => ({ value, description })) },
      { type: "score", name: "severity", instructions: base.questions.severity.instructions,
        levels: base.questions.severity.criteria.map(label => ({ label })) },
      ...(image ? [{ type: "predicate", name: "visual", instructions: "Is the attached image predominantly white?" }] : []),
    ],
  };
}

/** OpenAI Decisions uses an ordered answer array, not TypeSafe's keyed map. */
export function validateOpenAIDecisionResponse(body, expected) {
  if (!body || typeof body !== "object" || !Array.isArray(body.answers)) {
    throw new Error("Bifrost OpenAI Decisions returned an invalid response envelope");
  }
  const result = new Map();
  for (const answer of body.answers) {
    if (!answer || typeof answer.name !== "string" || result.has(answer.name)) {
      throw new Error("Bifrost OpenAI Decisions returned missing or duplicate answer names");
    }
    result.set(answer.name, answer);
  }
  const probability = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  for (const [name, type] of Object.entries(expected)) {
    const answer = result.get(name);
    const kind = type === "noul" ? "predicate" : type;
    if (!answer || answer.type !== kind) {
      throw new Error("Bifrost OpenAI Decisions returned a missing or mismatched " + kind + " answer for " + name);
    }
    if (type === "noul" && !probability(answer.probability)) {
      throw new Error("Bifrost OpenAI Decisions returned an invalid predicate probability for " + name);
    }
    if (type === "choice" || type === "score") {
      const options = type === "choice" ? ["refund", "technical"] : ["0", "1"];
      if (type === "choice" && !options.includes(String(answer.choice))) {
        throw new Error("Bifrost OpenAI Decisions returned an invalid choice for " + name);
      }
      if (type === "score" && !probability(answer.score)) {
        throw new Error("Bifrost OpenAI Decisions returned an invalid score for " + name);
      }
      if (!probability(answer.confidence) || !Array.isArray(answer.probabilities) ||
          !answer.probabilities.length ||
          answer.probabilities.some(row => !row || !probability(row.probability) ||
            (typeof row.value !== "string" && typeof row.value !== "number" && typeof row.value !== "boolean"))) {
        throw new Error("Bifrost OpenAI Decisions returned invalid probabilities for " + name);
      }
    }
  }
  return { model: typeof body.model === "string" ? body.model : "unreported",
    answered: Object.keys(expected).length, hasUsage: Boolean(body.usage) };
}

// A deterministic 280x280 PNG (white) is used *only* by an explicit billed probe.
// It is generated locally without fetching images or reading personal files.
function pngChunk(tag, data) {
  const type = Buffer.from(tag, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const bytes = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const check = Buffer.alloc(4); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, check]);
}

export function nativeJudgeImageProbeFixture() {
  const size = 280;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((size * 3 + 1) * size, 255);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0; // PNG filter None
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

export async function inspectNativeJudgeModels(config, env = process.env, options = {}) {
  const judge = nativeJudgeGateway(config, env);
  if (!judge) return { status: "disabled", models: [] };
  const request = options.requestJson ?? requestJson;
  const response = await request(judge.baseUrl + (judge.api === "typesafe" ? "/v1/models" : "/models"), {
    method: "GET", headers: authHeaders(judge), timeoutMs: 8_000, maxResponseBytes: 512_000,
  });
  const models = judge.api === "typesafe"
    ? parseNativeJudgeModelsResponse(response)
    : parseOpenAIDecisionModelsResponse(response);
  // Discovery only verifies a listed model. It does NOT prove its judgment
  // endpoint is enabled: run the explicitly billable probe for that assurance.
  return { status: models.includes(judge.requestModelId) ? "available" : "missing-model",
    model: judge.model, family: judge.family, images: judge.imageEnabled, models };
}

export function canonicalDecisionProbeRequest(model) {
  const native = nativeJudgeProbeRequest(model);
  return {
    model: "typesafe/" + model,
    state: native.state,
    questions: Object.fromEntries(Object.entries(native.questions).map(([id, question]) =>
      [id, { ...question, kind: question.type, type: undefined }])),
  };
}

export function validateCanonicalDecisionResponse(body, expected) {
  if (!body || typeof body !== "object" || typeof body.model !== "string" ||
      !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
    throw new Error("Bifrost Decisions returned an invalid response envelope");
  }
  for (const [id, kind] of Object.entries(expected)) {
    const answer = body.answers[id];
    if (!answer || answer.kind !== kind) throw new Error("Bifrost Decisions returned a missing or mismatched " + kind + " answer for " + id);
    if (kind === "noul" && !(typeof answer.value === "number" && Number.isFinite(answer.value) &&
        answer.value >= 0 && answer.value <= 1)) throw new Error("Bifrost Decisions returned an invalid noul value for " + id);
    if (kind === "choice" && (answer.value !== "refund" && answer.value !== "technical")) {
      throw new Error("Bifrost Decisions returned an invalid choice for " + id);
    }
    if (kind === "score" && !(typeof answer.value === "number" && Number.isFinite(answer.value) &&
        answer.value >= 0 && answer.value <= 1)) throw new Error("Bifrost Decisions returned an invalid score for " + id);
  }
  return { model: body.model, answered: Object.keys(expected).length, hasUsage: Boolean(body.usage) };
}

export async function probeNativeJudge(config, env = process.env, options = {}) {
  const judge = nativeJudgeGateway(config, env);
  if (!judge) throw new Error("Native judge is not enabled; set PIFROST_NATIVE_JUDGE_MODEL first");
  if (options.image === true && !judge.imageEnabled) {
    throw new Error("Image judgment probing is disabled; opt in with PIFROST_NATIVE_JUDGE_IMAGES=1");
  }
  if (options.box === true && (options.image !== true || judge.api !== "typesafe" || judge.model.toLowerCase() !== "jev-1.14.0")) {
    throw new Error("Box probe requires explicit --image --box with verified TypeSafe jev-1.14.0; no inference sent");
  }
  if (options.decisions === true && judge.api === "openai-decisions") {
    throw new Error("OpenAI Decisions already uses its native endpoint; --decisions is for the TypeSafe canonical comparison");
  }
  const request = options.requestJson ?? requestJson;
  const kind = judge.api === "openai-decisions" ? "openai-decisions"
    : options.decisions === true ? "decisions" : "systemone";
  if (kind === "decisions" && options.image === true) {
    throw new Error("Canonical cross-provider image probes are not implemented; use the native System One image probe");
  }
  const image = options.image === true ? nativeJudgeImageProbeFixture() : undefined;
  const url = kind === "decisions" ? new URL("/v1/decisions", judge.baseUrl).toString()
    : judge.baseUrl + (kind === "systemone" ? "/v1/systemone" : "/decisions");
  const nativeBody = nativeJudgeProbeRequest(judge.requestModelId);
  if (kind === "systemone" && image) {
    nativeBody.state = [nativeBody.state, "Test image reference: pifrost-fixture-image"];
    nativeBody.assets = { "pifrost-fixture-image": { type: "image", format: "png", data_base64: image } };
    nativeBody.questions.visual = { type: "noul", instructions: "Is the referenced white image predominantly white?" };
  }
  if (options.box === true) {
    if (kind !== "systemone") throw new Error("Box probe is supported only by TypeSafe System One Jev 1.14.0");
    nativeBody.questions.visual_box = { type: "box", instructions: "Locate the entire white image identified by pifrost-fixture-image" };
  }
  const body = kind === "decisions" ? canonicalDecisionProbeRequest(judge.model)
    : kind === "systemone" ? nativeBody : openAIDecisionProbeRequest(judge.requestModelId, image);
  const response = await request(url, {
    method: "POST", headers: authHeaders(judge), body, timeoutMs: 20_000, maxResponseBytes: 512_000,
  });
  const expected = { urgent: "noul", category: "choice", severity: "score",
    ...(image ? { visual: "noul" } : {}),
    ...(options.box === true ? { visual_box: "box" } : {}) };
  const result = kind === "decisions"
    ? validateCanonicalDecisionResponse(response, expected)
    : kind === "systemone" ? validateNativeJudgeResponse(response, expected)
    : validateOpenAIDecisionResponse(response, expected);
  return { ...result, kind, image: options.image === true };
}
