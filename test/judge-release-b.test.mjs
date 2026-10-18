import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { nativeJudgeGateway, nativeJudgeSelection } from "../judge-bridge.mjs";
import {
  inspectNativeJudgeModels, probeNativeJudge, nativeJudgeImageProbeFixture,
  openAIDecisionProbeRequest, validateOpenAIDecisionResponse, parseOpenAIDecisionModelsResponse,
} from "../judge-control.mjs";

const config = { url: "http://127.0.0.1:8180/v1", virtualKey: "sk-bf-b-release" };
const openai = { PIFROST_NATIVE_JUDGE_MODEL: "openai/gpt-6-luna" };
const images = { PIFROST_NATIVE_JUDGE_MODEL: "typesafe/jev-1.14.0", PIFROST_NATIVE_JUDGE_IMAGES: "1" };
const answers = {
  urgent: { type: "noul", noul: 0.8 },
  category: { type: "choice", choice: "refund", probabilities: { refund: 0.8, technical: 0.2 }, confidence: 0.8 },
  severity: { type: "score", score: 1, probabilities: { "0": 0.2, "1": 0.8 }, confidence: 0.8 },
  visual: { type: "noul", noul: 0.99 },
};
const openaiAnswers = [
  { name: "urgent", type: "predicate", probability: 0.8 },
  { name: "category", type: "choice", choice: "refund", confidence: 0.8, probabilities: [
    { value: "refund", probability: 0.8 }, { value: "technical", probability: 0.2 },
  ] },
  { name: "severity", type: "score", score: 1, confidence: 0.8, probabilities: [
    { value: 0, probability: 0.2 }, { value: 1, probability: 0.8 },
  ] },
  { name: "visual", type: "predicate", probability: 0.99 },
];

test("the opt-in judge never interprets other OpenAI chat models as decision models", () => {
  assert.equal(nativeJudgeSelection({}), undefined);
  assert.deepEqual(nativeJudgeSelection(openai), {
    model: "gpt-6-luna-decisions", selector: "bifrost-judge/gpt-6-luna-decisions",
  });
  for (const value of ["openai/gpt-6", "openai/gpt-5.6", "gpt-6-luna",
    "openai/gpt-6-luna/a", "openrouter/~typesafe/jev-latest"]) {
    assert.throws(() => nativeJudgeSelection({ PIFROST_NATIVE_JUDGE_MODEL: value }), /must be a TypeSafe/);
  }
});

test("Bifrost route selection keeps native TypeSafe and OpenAI schemas separate", () => {
  const jev = nativeJudgeGateway(config, images);
  assert.deepEqual({ api: jev.api, family: jev.family, baseUrl: jev.baseUrl, model: jev.model,
    requestModelId: jev.requestModelId, imageEnabled: jev.imageEnabled },
  { api: "typesafe", family: "typesafe", baseUrl: "http://127.0.0.1:8180/typesafe",
    model: "jev-1.14.0", requestModelId: "jev-1.14.0", imageEnabled: true });
  const luna = nativeJudgeGateway(config, { ...openai, PIFROST_NATIVE_JUDGE_IMAGES: "yes" });
  assert.deepEqual({ api: luna.api, family: luna.family, baseUrl: luna.baseUrl, model: luna.model,
    requestModelId: luna.requestModelId, imageEnabled: luna.imageEnabled },
  { api: "openai-decisions", family: "openai", baseUrl: "http://127.0.0.1:8180/openai/v1",
    model: "gpt-6-luna-decisions", requestModelId: "gpt-6-luna", imageEnabled: true });
  assert.equal(nativeJudgeGateway(config, openai).imageEnabled, false);
  assert.throws(() => nativeJudgeGateway(config, {
    PIFROST_NATIVE_JUDGE_MODEL: "jev-3.0.0", PIFROST_NATIVE_JUDGE_IMAGES: "1",
  }), /verified Jev version/);
});

test("read-only OpenAI catalog listing never submits a decision request", async () => {
  assert.deepEqual(parseOpenAIDecisionModelsResponse({ data: [{ id: "gpt-6-luna" }] }), ["gpt-6-luna"]);
  assert.throws(() => parseOpenAIDecisionModelsResponse({ models: [] }), /invalid/);
  const status = await inspectNativeJudgeModels(config, openai, { requestJson: async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8180/openai/v1/models");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers["x-bf-vk"], config.virtualKey);
    return { data: [{ id: "gpt-6-luna" }] };
  }});
  assert.equal(status.status, "available");
  assert.equal(status.family, "openai");
  assert.equal(status.images, false);
});

test("the image fixture is an actual 280x280 PNG without external assets", () => {
  const decoded = Buffer.from(nativeJudgeImageProbeFixture(), "base64");
  assert.equal(decoded.subarray(0,8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(decoded.readUInt32BE(16), 280);
  assert.equal(decoded.readUInt32BE(20), 280);
  assert.equal(decoded.toString("ascii", 12,16), "IHDR");
  assert.ok(decoded.length < 16000);
});

test("TypeSafe image probe uses referenced PNG assets over native /v1/systemone", async () => {
  const result = await probeNativeJudge(config, images, { image: true, requestJson: async (url, opts) => {
    assert.equal(url, "http://127.0.0.1:8180/typesafe/v1/systemone");
    assert.equal(opts.body.model, "jev-1.14.0");
    assert.ok(JSON.stringify(opts.body.state).includes("pifrost-fixture-image"));
    assert.equal(opts.body.assets["pifrost-fixture-image"].type, "image");
    assert.equal(opts.body.assets["pifrost-fixture-image"].format, "png");
    assert.equal(opts.body.questions.visual.type, "noul");
    return { model: "jev-1.14.0", answers, usage: { input_tokens: 3 } };
  }});
  assert.deepEqual(result, { kind: "systemone", model: "jev-1.14.0", answered: 4,
    hasUsage: true, image: true });
});

test("OpenAI image probe uses native input_image and ordered typed questions", async () => {
  const env = { ...openai, PIFROST_NATIVE_JUDGE_IMAGES: "1" };
  const result = await probeNativeJudge(config, env, { image: true, requestJson: async (url, opts) => {
    assert.equal(url, "http://127.0.0.1:8180/openai/v1/decisions");
    assert.equal(opts.body.model, "gpt-6-luna");
    assert.equal(opts.body.input[0].content[1].type, "input_image");
    assert.match(opts.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
    assert.deepEqual(opts.body.questions.map(q => q.type), ["predicate", "choice", "score", "predicate"]);
    return { model: "gpt-6-luna", answers: openaiAnswers, usage: { input_tokens: 11 } };
  }});
  assert.deepEqual(result, { kind: "openai-decisions", model: "gpt-6-luna",
    answered: 4, hasUsage: true, image: true });
});

test("image probes fail closed without opt-in, and native schemas are not mixed", async () => {
  await assert.rejects(probeNativeJudge(config, openai, { image: true,
    requestJson: () => { throw Error("called unexpectedly"); } }), /opt in/);
  await assert.rejects(probeNativeJudge(config, openai, { decisions: true,
    requestJson: () => { throw Error("called unexpectedly"); } }), /already uses its native/);
  await assert.rejects(probeNativeJudge(config, images, { decisions: true, image: true,
    requestJson: () => { throw Error("called unexpectedly"); } }), /not implemented/);
});

test("malformed/refused OpenAI Decisions answers cannot pass the probe", () => {
  const expected = { urgent: "noul", category: "choice", severity: "score" };
  const base = { model: "gpt-6-luna", answers: openaiAnswers.slice(0,3) };
  assert.equal(validateOpenAIDecisionResponse(base, expected).answered, 3);
  assert.throws(() => validateOpenAIDecisionResponse({ ...base, answers: [
    { name: "urgent", type: "refusal" }, ...base.answers.slice(1)] }, expected), /missing or mismatched/);
  assert.throws(() => validateOpenAIDecisionResponse({ ...base, answers: [
    { name: "urgent", type: "predicate", probability: 10 }, ...base.answers.slice(1)] }, expected), /invalid predicate/);
  assert.throws(() => validateOpenAIDecisionResponse({ ...base, answers: [
    ...base.answers, { ...base.answers[0] }] }, expected), /duplicate/);
  assert.throws(() => validateOpenAIDecisionResponse({ ...base, answers: [
    base.answers[0], { ...base.answers[1], probabilities: [] }, base.answers[2]] }, expected), /invalid probabilities/);
});
