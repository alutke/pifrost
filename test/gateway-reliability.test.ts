import assert from "node:assert/strict";
import test from "node:test";
import { classifyGatewayHttpStatus, gatewayFailureAdvice, parseGatewayRetryAfter, safeGatewayHeaderToken } from "../gateway-reliability.ts";
import { bridgeBifrostUsageCostResponse } from "../bifrost-cost-bridge.ts";
import { formatPifrostRouteTraces, gatewayRouteEvidence, recordBifrostCaptureTrace, releasePifrostRouteTraces } from "../request-provenance.ts";

test("classifies gateway status without provider-specific retry decisions", () => {
  assert.equal(classifyGatewayHttpStatus(200), undefined);
  assert.equal(classifyGatewayHttpStatus(401), "credential");
  assert.equal(classifyGatewayHttpStatus(403), "authorization");
  assert.equal(classifyGatewayHttpStatus(402), "quota-or-rate-limit");
  assert.equal(classifyGatewayHttpStatus(429), "quota-or-rate-limit");
  assert.equal(classifyGatewayHttpStatus(408), "timeout");
  assert.equal(classifyGatewayHttpStatus(504), "timeout");
  assert.equal(classifyGatewayHttpStatus(503), "upstream");
  assert.equal(classifyGatewayHttpStatus(400), "request");
  assert.equal(classifyGatewayHttpStatus(499), "request");
  assert.match(gatewayFailureAdvice("credential") ?? "", /rotation/u);
});
test("retry-after accepts bounded delta seconds and UTC date only", () => {
  assert.equal(parseGatewayRetryAfter("20"), 20);
  assert.equal(parseGatewayRetryAfter("0"), 0);
  assert.equal(parseGatewayRetryAfter("86401"), undefined);
  assert.equal(parseGatewayRetryAfter("1.5"), undefined);
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(parseGatewayRetryAfter("Wed, 14 Oct 2026 12:00:30 GMT", now), 30);
  assert.equal(parseGatewayRetryAfter("secret-value"), undefined);
  assert.equal(safeGatewayHeaderToken("trace-123"), "trace-123");
  assert.equal(safeGatewayHeaderToken("Bearer secret value"), undefined);
  assert.equal(safeGatewayHeaderToken("bad\\nnewline"), undefined);
});
test("captures gateway trace, cache, status and retry information without logging response bodies", async () => {
  const capture: import("../bifrost-cost-bridge.ts").BifrostCostCapture = {};
  const res = new Response(JSON.stringify({ error: { message: "sk-secret-should-never-be-logged", code: "quota" } }), {
    status: 429, headers: {
      "content-type": "application/json", "x-bifrost-request-id": "req-88",
      "x-bifrost-trace-id": "trace-81", "retry-after": "35",
      "x-bifrost-cache-hit": "false", "x-bifrost-cache-hit-type": "exact",
    },
  });
  const bridged = await bridgeBifrostUsageCostResponse(res, capture);
  assert.equal(bridged.status, 429);
  assert.equal(capture.httpStatus, 429);
  assert.equal(capture.failureClass, "quota-or-rate-limit");
  assert.equal(capture.retryAfterSeconds, 35);
  assert.equal(capture.traceId, "trace-81");
  assert.equal(capture.requestId, "req-88");
  assert.equal(capture.cacheHit, false);
  assert.equal(capture.cacheHitType, "exact");
  const sessionId = "release-c-failure";
  recordBifrostCaptureTrace(sessionId, {
    logicalModel: "omp-default", routeMode: "bifrost-native",
    protocol: "openai-completions", attempt: 1,
    requestedPrimary: "omp-default", outcome: "error",
  }, { ...capture, outputStarted: false });
  const report = formatPifrostRouteTraces(sessionId);
  assert.match(report, /http=429 failure=quota-or-rate-limit/u);
  assert.match(report, /retry-after=35s/u);
  assert.match(report, /output-started=no/u);
  assert.match(report, /route-evidence=unverified/u);
  assert.match(report, /served=unverified/u);
  assert.match(report, /trace-id=trace-81/u);
  assert.doesNotMatch(report, /sk-secret-should-never-be-logged/u);
  releasePifrostRouteTraces(sessionId);
});
test("success cache hit is not misreported as a live upstream inference", async () => {
  const capture: import("../bifrost-cost-bridge.ts").BifrostCostCapture = {};
  await bridgeBifrostUsageCostResponse(new Response(JSON.stringify({usage:{prompt_tokens:1}}),{
    status:200, headers: {"content-type":"application/json","x-bifrost-cache-hit":"true","x-bifrost-cache-hit-type":"semantic"},
  }),capture);
  assert.equal(capture.httpStatus, undefined);
  assert.equal(capture.cacheHit, true);
  assert.equal(capture.cacheHitType, "semantic");
  const sessionId = "release-c-cache";
  recordBifrostCaptureTrace(sessionId, { logicalModel:"omp-task", routeMode:"bifrost-native",
    protocol:"openai-completions", attempt:1, requestedPrimary:"omp-task",outcome:"done" }, {...capture, outputStarted:true});
  assert.match(formatPifrostRouteTraces(sessionId), /cache-hit=yes cache-type=semantic/u);
  releasePifrostRouteTraces(sessionId);
});
test("native alias is only request evidence, never a proven matched routing rule", () => {
  assert.equal(gatewayRouteEvidence({routeMode:"bifrost-native",logicalModel:"omp-default",requestedModel:"omp-default"}),
    "alias-requested (rule match unverified)");
  assert.match(gatewayRouteEvidence({routeMode:"bifrost-native",logicalModel:"omp-default",requestedModel:"other"}) ?? "", /mismatch/u);
  assert.match(gatewayRouteEvidence({routeMode:"pifrost-compatibility",logicalModel:"omp-default",requestedModel:"physical"}) ?? "", /counters not expected/u);
});
