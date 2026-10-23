import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectAgentEnd, inspectBifrostLog, inspectContextUsage, inspectOutput,
} from "../execution-observation.mjs";

const response = {
  status: "success", provider: "CommandCode GOAT",
  model: "deepseek/deepseek-v4.1-flash",
  served_model: "deepseek/deepseek-v4.1-flash-1017",
  stop_reason: "stop", number_of_retries: 0,
  token_usage: { prompt_tokens: 614978, completion_tokens: 16,
    completion_tokens_details: { reasoning_tokens: 16 } },
  responses_output: [{
    type: "reasoning", role: "assistant", content: [],
    summary: [{ type: "summary_text", text:
      "reasoning unavailable<thinking>\nreasoning unavailable\n</thinking>\n</thinking>" }],
  }],
  selected_key_id: "NEVER-EXPOSE", raw_request: "USER SECRET",
};

test("30A-01 diagnoses the recorded 614,978-token DeepSeek stop without treating HTTP success as task completion", () => {
  const result = inspectBifrostLog(response);
  assert.equal(result.status, "success");
  assert.equal(result.output.reason, "REASONING_ONLY_STOP");
  assert.equal(result.output.hasAction, false);
  assert.equal(result.output.visibleText, false);
  assert.equal(result.context.inputTokens, 614978);
  assert.equal(result.context.severity, "large-absolute");
  assert.equal(result.context.contextWindowTokens, null);
  assert.equal(result.context.fraction, null);
  assert.equal(result.completionTokens, 16);
  assert.equal(result.reasoningTokens, 16);
  assert.equal(result.taskCompleted, "unknown");
  assert.equal(result.attribution, "gateway-reported-not-physical-proof");
  assert.doesNotMatch(JSON.stringify(result), /NEVER-EXPOSE|USER SECRET/);
});

test("30A-02 advisor calls distinguish real content and tool output from silent reasoning", () => {
  const advisor = {
    status: "success", provider: "opencode-go", model: "muse-spark-1.3-contributor",
    token_usage: { prompt_tokens: 526832, completion_tokens: 15 },
    responses_output: [{ type: "message", role: "assistant",
      content: [{ type: "output_text", text: "Silence — scoped file addition, annotating return type." }] }],
  };
  const a = inspectBifrostLog(advisor);
  assert.equal(a.context.severity, "large-absolute");
  assert.equal(a.output.visibleText, true);
  assert.equal(a.output.isNonproductive, false);
  assert.equal(a.reasoningTokens, null);
  const tool = inspectOutput([{ type: "function_call", name: "read" }], "stop");
  assert.equal(tool.hasAction, true);
  assert.equal(tool.reason, "NONE");
});

test("30A-03 treats literal thinking markers as artifacts only when the response has no meaningful output", () => {
  const artifact = inspectOutput([{ type: "message", role: "assistant", content:
    [{ type: "output_text", text: "reasoning unavailable<thinking>\n</thinking>" }] }], "stop");
  assert.equal(artifact.reason, "EMPTY_STOP");
  assert.equal(inspectOutput([{ type: "message", role: "assistant", content:
    [{ type: "output_text", text: "The answer includes <thinking> as literal quoted syntax." }] }], "stop").reason, "NONE");
  assert.equal(inspectOutput([{ type: "reasoning", summary: [] }], "max_tokens").reason, "NONE");
});

test("30A-04 classifies OMP agent_end conservatively and does not authorise retries", () => {
  const event = { messages: [
    { role: "user", content: [{ type: "text", text: "Implement Release C" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash" }] },
    { role: "toolResult", toolCallId: "a", content: [{ type: "text", text: "TS2345" }] },
    { role: "assistant", stopReason: "stop", content:
      [{ type: "thinking", thinking: "reasoning unavailable" }] },
  ] };
  const r = inspectAgentEnd(event);
  assert.equal(r.diagnostic, "SUSPECT_NONPRODUCTIVE_SETTLEMENT");
  assert.equal(r.workRemaining, "unverified");
  assert.equal(r.recoveryPermitted, "not-assessed");
  assert.equal(inspectAgentEnd({ ...event, willContinue: true }).diagnostic, "NONE");
  assert.equal(inspectAgentEnd({ ...event, hasUncertainToolOutcome: true }).diagnostic, "NONE");
  assert.equal(inspectAgentEnd({ messages: event.messages.slice(-1) }).diagnostic, "NONE");
});

test("30A-05 no false declaration of task completion, context exhaustion or physical attribution", () => {
  assert.deepEqual(inspectContextUsage(undefined), {
    inputTokens: null, contextWindowTokens: null, fraction: null,
    severity: "unknown", interpretation: "model-window-unverified",
  });
  assert.equal(inspectContextUsage(70000, 100000).severity, "normal");
  assert.equal(inspectContextUsage(80000, 100000).severity, "pressure");
  assert.equal(inspectContextUsage(615000).severity, "large-absolute");
  assert.equal(inspectContextUsage(-1).severity, "unknown");
  assert.equal(inspectBifrostLog({}).output.reason, "NONE");
});
