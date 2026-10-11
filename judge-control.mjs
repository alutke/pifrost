/**
 * Bounded conformance probes only. These run on explicit CLI invocation;
 * regular inference, judge caching, fallback, concurrency and session usage
 * are owned by Bifrost and OMP, not by Pifrost.
 */
import { requestJson } from "./http-client.mjs";
import {
  nativeJudgeGateway, nativeJudgeProbeRequest,
  parseNativeJudgeModelsResponse, validateNativeJudgeResponse,
} from "./judge-bridge.mjs";

function authHeaders(judge) {
  // Modern Bifrost 2.x virtual keys are accepted as bearer authentication.
  // OMP TypeSafeJudge itself supplies this same bearer credential.
  return { "x-bf-vk": judge.virtualKey, Authorization: "Bearer " + judge.virtualKey };
}

export async function inspectNativeJudgeModels(config, env = process.env, options = {}) {
  const judge = nativeJudgeGateway(config, env);
  if (!judge) return { status: "disabled", models: [] };
  const request = options.requestJson ?? requestJson;
  const response = await request(judge.baseUrl + "/v1/models", {
    method: "GET", headers: authHeaders(judge), timeoutMs: 8_000, maxResponseBytes: 512_000,
  });
  const models = parseNativeJudgeModelsResponse(response);
  return { status: models.includes(judge.model) ? "available" : "missing-model", model: judge.model, models };
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
  if (!judge) throw new Error("Native judge is not enabled; set PIFROST_NATIVE_JUDGE_MODEL=jev-latest first");
  const request = options.requestJson ?? requestJson;
  const kind = options.decisions === true ? "decisions" : "systemone";
  const url = kind === "decisions"
    ? new URL("/v1/decisions", judge.baseUrl).toString()
    : judge.baseUrl + "/v1/systemone";
  const body = kind === "decisions"
    ? canonicalDecisionProbeRequest(judge.model)
    : nativeJudgeProbeRequest(judge.model);
  const response = await request(url, {
    method: "POST", headers: authHeaders(judge), body, timeoutMs: 20_000, maxResponseBytes: 512_000,
  });
  const expected = { urgent: "noul", category: "choice", severity: "score" };
  const result = kind === "decisions"
    ? validateCanonicalDecisionResponse(response, expected)
    : validateNativeJudgeResponse(response, expected);
  return { ...result, kind };
}
