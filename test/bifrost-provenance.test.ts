import assert from "node:assert/strict";
import test from "node:test";

import {
	captureBifrostRoutingProvenance,
	createBifrostProvenanceFetch,
	formatBifrostRoutingProvenanceReport,
	recentBifrostRoutingProvenance,
	resetBifrostRoutingProvenanceForTests,
} from "../bifrost-provenance.ts";

test("captures stable Bifrost 2.2.6 routed-identity response headers", () => {
	resetBifrostRoutingProvenanceForTests();
	const response = new Response("ok", {
		status: 200,
		headers: {
			"x-bifrost-provider": "deepseek",
			"x-bifrost-resolved-model": "deepseek-v4.1-flash",
			"x-bifrost-fallback-index": "1",
			"x-bifrost-request-type": "chat_completion",
			"x-bifrost-routing-info-provider": "deepseek",
			"x-bifrost-routing-info-model": "deepseek-v4.1-flash",
			"x-bifrost-routing-info-primary-provider": "opencode-go",
			"x-bifrost-routing-info-primary-model": "muse-spark-1.3-contributor",
			"x-bifrost-upstream-latency-ms": "123.456",
		},
	});
	const row = captureBifrostRoutingProvenance(response, {
		sessionId: "session-1",
		logicalModel: "omp-advisor",
		protocol: "openai-completions",
		attemptIndex: 1,
		routePrimary: "opencode-go/muse-spark-1.3-contributor",
	});
	assert.equal(row.provider, "deepseek");
	assert.equal(row.resolvedModel, "deepseek-v4.1-flash");
	assert.equal(row.isFallback, true);
	assert.equal(row.fallbackIndex, 1);
	assert.equal(row.upstreamLatencyMs, 123.456);
	assert.equal(row.primaryProvider, "opencode-go");
});

test("captures future correlation headers without depending on them", async () => {
	resetBifrostRoutingProvenanceForTests();
	const baseFetch = (async () => new Response("ok", {
		status: 201,
		headers: {
			"x-bifrost-request-id": "bf-request-123",
			"x-bifrost-trace-id": "trace-456",
			"x-bifrost-routing-info-provider": "openai",
			"x-bifrost-routing-info-model": "gpt-6.1-sol",
		},
	})) as typeof fetch;
	const wrapped = createBifrostProvenanceFetch(baseFetch, {
		sessionId: "session-2",
		logicalModel: "omp-plan",
		protocol: "openai-responses",
		attemptIndex: 2,
		routePrimary: "openai/gpt-6.1-sol",
	});
	await wrapped("http://bifrost/v1/responses");
	const [row] = recentBifrostRoutingProvenance("session-2");
	assert.equal(row?.requestId, "bf-request-123");
	assert.equal(row?.traceId, "trace-456");
	assert.equal(row?.routingProvider, "openai");
	assert.equal(row?.routingModel, "gpt-6.1-sol");
});

test("provenance report is scoped to the active OMP session", () => {
	resetBifrostRoutingProvenanceForTests();
	for (const sessionId of ["one", "two"]) {
		captureBifrostRoutingProvenance(new Response("ok", {
			headers: {
				"x-bifrost-provider": "openai",
				"x-bifrost-resolved-model": "gpt-6.1-sol",
			},
		}), {
			sessionId,
			logicalModel: "omp-default",
			protocol: "openai-responses",
			attemptIndex: 1,
			routePrimary: "openai/gpt-6.1-sol",
		});
	}
	const report = formatBifrostRoutingProvenanceReport("two");
	assert.match(report, /omp-default attempt=1 openai-responses -> openai\/gpt-6\.1-sol primary HTTP 200/u);
	assert.equal(recentBifrostRoutingProvenance("two").length, 1);
});
