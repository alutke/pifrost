import assert from "node:assert/strict";
import test from "node:test";

import {
	formatPifrostRouteTraces,
	formatPifrostSessionCosts,
	recordBifrostCaptureTrace,
	releasePifrostRouteTraces,
} from "../request-provenance.ts";

test("records and formats actual Bifrost route provenance", () => {
	const sessionId = "session-trace-test";
	recordBifrostCaptureTrace(sessionId, {
		logicalModel: "omp-default",
		routeMode: "bifrost-native",
		protocol: "openai-completions",
		attempt: 2,
		requestedPrimary: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
		compatibilityBoundaryCount: 1,
		outcome: "done",
	}, {
		requestId: "req-42",
		requestedModel: "omp-default",
		requestedProvider: "bifrost",
		provider: "deepseek",
		resolvedModel: "deepseek-v4.1-flash",
		fallbackIndex: 1,
		isFallback: true,
		upstreamLatencyMs: 88.2,
		total: 0.0042,
	});

	const report = formatPifrostRouteTraces(sessionId);
	assert.match(report, /omp-default/u);
	assert.match(report, /attempt=2/u);
	assert.match(report, /route-mode=bifrost-native/u);
	assert.match(report, /gateway-request=bifrost\/omp-default/u);
	assert.match(report, /wire-boundaries=1 boundary-retry=pre-output-only/u);
	assert.equal(report.includes("\\n"), false, "format readable newlines, never escaped backslash-n");
	assert.match(report, /served=deepseek\/deepseek-v4\.1-flash/u);
	assert.match(report, /fallback=1/u);
	assert.match(report, /request-id=req-42/u);
	assert.match(report, /upstream=88\.2ms/u);
	assert.match(report, /cost=\$0\.004200/u);

	releasePifrostRouteTraces(sessionId);
	assert.match(formatPifrostRouteTraces(sessionId), /no requests recorded/u);
});


test("compatibility exception trace explicitly identifies bypass and reason", () => {
	const sessionId = "session-compatibility-bypass";
	recordBifrostCaptureTrace(sessionId, {
		logicalModel: "omp-advisor",
		routeMode: "pifrost-compatibility",
		exceptionReason: "member-eligibility",
		protocol: "openai-completions",
		attempt: 1,
		requestedPrimary: "physical/model",
		outcome: "done",
	}, { requestedModel: "physical/model" });
	const report = formatPifrostRouteTraces(sessionId);
	assert.match(report, /route-mode=pifrost-compatibility exception=member-eligibility/u);
	assert.match(report, /gateway-request=physical\/model/u);
	releasePifrostRouteTraces(sessionId);
});

test("trace leaves compatible routes free of wire-boundary notices", () => {
	const sessionId = "session-compatible-route";
	recordBifrostCaptureTrace(sessionId, {
		logicalModel: "omp-task",
		protocol: "openai-completions",
		attempt: 1,
		requestedPrimary: "commandcode-goat/deepseek-v4.1-flash",
		outcome: "done",
	}, {});
	const report = formatPifrostRouteTraces(sessionId);
	assert.doesNotMatch(report, /wire-boundaries|boundary-retry/u);
	releasePifrostRouteTraces(sessionId);
});

test("session gateway cost report groups confirmed costs by logical model and leaves missing values unknown", () => {
  const id = "release-d-cost-review";
  const base = (logicalModel: string, outcome: "done" | "error" = "done") => ({
    logicalModel, protocol: "openai-completions", attempt: 1,
    requestedPrimary: logicalModel, outcome,
  });
  recordBifrostCaptureTrace(id, base("omp-default"), {
    requestId: "gateway-r1", total: 0.002, isFallback: true, cacheHit: false,
  });
  recordBifrostCaptureTrace(id, base("omp-default"), {
    requestId: "gateway-r2", total: 0, cacheHit: true,
  });
  recordBifrostCaptureTrace(id, base("omp-advisor", "error"), {
    requestId: "gateway-r3", cacheHit: false,
  });
  const report = formatPifrostSessionCosts(id);
  assert.match(report, /reported=2\/3 reported-subtotal=\$0\.002000/u);
  assert.match(report, /omp-default: reported=2\/2 reported-subtotal=\$0\.002000 fallbacks=1 cache-hits=1/u);
  assert.match(report, /omp-advisor: reported=0\/1 cost=unknown/u);
  assert.match(report, /cache-metadata=3\/3/u);
  assert.match(report, /missing costs excluded, not zero/u);
  assert.doesNotMatch(report, /gateway-r1|gateway-r2|gateway-r3/u);
  releasePifrostRouteTraces(id);
  assert.match(formatPifrostSessionCosts(id), /no requests recorded/u);
});
