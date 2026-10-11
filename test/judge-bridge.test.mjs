import assert from "node:assert/strict";
import test from "node:test";
import {
  PIFROST_JUDGE_PROVIDER, nativeJudgeSelection, nativeJudgeGateway,
  parseNativeJudgeModelsResponse, nativeJudgeProbeRequest, validateNativeJudgeResponse,
} from "../judge-bridge.mjs";
import {
  inspectNativeJudgeModels, probeNativeJudge, canonicalDecisionProbeRequest,
  validateCanonicalDecisionResponse,
} from "../judge-control.mjs";

const config = { url: "http://127.0.0.1:8180/v1", virtualKey: "sk-bf-abc123" };
const env = { PIFROST_NATIVE_JUDGE_MODEL: "typesafe/jev-latest" };
const nativeAnswers = {
  urgent: { type: "noul", noul: 0.9 },
  category: { type: "choice", choice: "refund", probabilities: { refund: 0.9, technical: 0.1 }, confidence: 0.9 },
  severity: { type: "score", score: 1, probabilities: { "0": 0, "1": 1 }, confidence: 1 },
};
const canonicalAnswers = {
  urgent: { kind: "noul", value: 0.9 },
  category: { kind: "choice", value: "refund", probabilities: { refund: 0.9, technical: 0.1 }, confidence: 0.9 },
  severity: { kind: "score", value: 1, probabilities: { "0": 0, "1": 1 }, confidence: 1 },
};

test("native judgment is disabled unless explicitly opted in, with a distinct provider namespace", () => {
  assert.equal(nativeJudgeSelection({}), undefined);
  assert.equal(nativeJudgeGateway(config, {}), undefined);
  assert.equal(PIFROST_JUDGE_PROVIDER, "bifrost-judge");
  assert.deepEqual(nativeJudgeSelection(env), { model: "jev-latest", selector: "bifrost-judge/jev-latest" });
  const result = nativeJudgeGateway(config, env);
  assert.equal(result.baseUrl, "http://127.0.0.1:8180/typesafe");
  assert.equal(result.provider, "bifrost-judge");
  assert.equal(result.model, "jev-latest");
  assert.equal(result.virtualKey, config.virtualKey);
  assert.equal(nativeJudgeGateway({ ...config, url: "https://bifrost.example.com/v1/" }, env).baseUrl, "https://bifrost.example.com/typesafe");
});

test("reject other model kinds, providers, malicious model ids and non-Bifrost virtual keys", () => {
  for (const model of ["openrouter/foo", "openai/gpt-6", "other-thing", "../x", "jev-foo/bar", "jev-%2f"]) {
    assert.throws(() => nativeJudgeSelection({ PIFROST_NATIVE_JUDGE_MODEL: model }), /TypeSafe jev model/);
  }
  for (const key of ["ordinary-api-key", "legacy", "", undefined]) {
    assert.throws(() => nativeJudgeGateway({ ...config, virtualKey: key }, env), /Bifrost 2.x sk-bf/);
  }
  for (const url of [
    "https://evil.example.com/v1?key=abc", "https://user:secret@gateway.example.com/v1",
    "file:///v1", "https://example.com/not-bifrost", "http://example.com/v1#something",
  ]) assert.throws(() => nativeJudgeGateway({ ...config, url }, env), /Bifrost URL/);
});

test("GET native judge model discovery is VK-authenticated but submits no inference", async () => {
  let calls = 0;
  const result = await inspectNativeJudgeModels(config, env, {
    requestJson: async (url, options) => {
      calls++;
      assert.equal(url, "http://127.0.0.1:8180/typesafe/v1/models");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer sk-bf-abc123");
      assert.equal(options.headers["x-bf-vk"], config.virtualKey);
      assert.equal(options.body, undefined);
      return { models: [{ name: "jev-latest", description: "Jev", release_date: "2026-01-01" }] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "available");
  assert.deepEqual(result.models, ["jev-latest"]);
  assert.equal((await inspectNativeJudgeModels(config, {}, { requestJson: () => { throw Error("must not call"); } })).status, "disabled");
  assert.equal((await inspectNativeJudgeModels(config, env, { requestJson: async () => ({ models: [] }) })).status, "missing-model");
  for (const payload of [{}, { models: 2 }, { models: [null] }]) {
    assert.throws(() => parseNativeJudgeModelsResponse(payload), /invalid/);
  }
});

test("explicit native probe uses OMP's System One wire shape and validates typed answers", async () => {
  let calls = 0;
  const result = await probeNativeJudge(config, env, {
    requestJson: async (url, options) => {
      calls++;
      assert.equal(url, "http://127.0.0.1:8180/typesafe/v1/systemone");
      assert.equal(options.method, "POST");
      assert.deepEqual(Object.keys(options.body.questions).sort(), ["category", "severity", "urgent"]);
      assert.equal(options.body.questions.urgent.type, "noul");
      assert.equal(options.body.questions.category.type, "choice");
      assert.equal(options.body.questions.severity.type, "score");
      assert.equal(options.body.model, "jev-latest");
      return { model: "jev-latest", answers: nativeAnswers, usage: { input_tokens: 120, output_tokens: 7 } };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { kind: "systemone", model: "jev-latest", answered: 3, hasUsage: true });
  assert.equal(nativeJudgeProbeRequest("jev-latest").questions.urgent.type, "noul");
});

test("canonical Decisions probe is explicitly selected, never silently substituted for native OMP judge", async () => {
  const body = canonicalDecisionProbeRequest("jev-latest");
  assert.equal(body.model, "typesafe/jev-latest");
  assert.equal(body.questions.urgent.kind, "noul");
  assert.equal(JSON.stringify(body).includes('"type"'), false);
  const result = await probeNativeJudge(config, env, {
    decisions: true,
    requestJson: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8180/v1/decisions");
      assert.deepEqual(options.body, body);
      return { model: "jev-latest", answers: canonicalAnswers };
    },
  });
  assert.deepEqual(result, { kind: "decisions", model: "jev-latest", answered: 3, hasUsage: false });
});

test("incomplete, mismatched or malformed typed judgments are never reported as success", () => {
  const expected = { urgent: "noul", category: "choice", severity: "score" };
  const valid = { model: "jev-latest", answers: nativeAnswers };
  assert.equal(validateNativeJudgeResponse(valid, expected).answered, 3);
  assert.throws(() => validateNativeJudgeResponse({}, expected), /invalid/);
  assert.throws(() => validateNativeJudgeResponse({ ...valid, answers: { ...nativeAnswers, urgent: { type: "noul", noul: 4 } } }, expected), /invalid noul/);
  assert.throws(() => validateNativeJudgeResponse({ ...valid, answers: { ...nativeAnswers, category: { type: "noul", noul: 0 } } }, expected), /missing a choice/);
  assert.throws(() => validateNativeJudgeResponse({ ...valid, answers: { ...nativeAnswers, severity: { type: "score", score: NaN } } }, expected), /invalid score/);
  assert.throws(() => validateCanonicalDecisionResponse({ model: "jev", answers: { ...canonicalAnswers, urgent: { kind: "noul", value: 2 } } }, expected), /invalid noul/);
  assert.throws(() => validateCanonicalDecisionResponse({ model: "jev", answers: { ...canonicalAnswers, category: { kind: "choice", value: "wrong" } } }, expected), /invalid choice/);
});
