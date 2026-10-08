import assert from "node:assert/strict";
import test from "node:test";

import {
	formatPifrostRouteTraces,
	recordBifrostCaptureTrace,
	releasePifrostRouteTraces,
} from "../request-provenance.ts";

test("records and formats actual Bifrost route provenance", () => {
	const sessionId = "session-trace-test";
	recordBifrostCaptureTrace(sessionId, {
		logicalModel: "omp-default",
		protocol: "openai-completions",
		attempt: 2,
		requestedPrimary: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
		outcome: "done",
	}, {
		requestId: "req-42",
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
	assert.match(report, /served=deepseek\/deepseek-v4\.1-flash/u);
	assert.match(report, /fallback=1/u);
	assert.match(report, /request-id=req-42/u);
	assert.match(report, /upstream=88\.2ms/u);
	assert.match(report, /cost=\$0\.004200/u);

	releasePifrostRouteTraces(sessionId);
	assert.match(formatPifrostRouteTraces(sessionId), /no requests recorded/u);
});
