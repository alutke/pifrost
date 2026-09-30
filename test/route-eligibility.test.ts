import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluateRouteMemberEligibility,
	resolveRouteMemberProtocol,
} from "../route-eligibility.ts";

const member = {
	contextWindow: 128_000,
	maxTokens: 32_000,
	input: ["text"] as const,
	reasoning: true,
	supportsTools: true,
	supportsToolSearch: true,
	supportsServiceTier: true,
	serviceTiers: ["priority"],
	protocols: ["openai-completions", "openai-responses"],
	compat: {
		supportsToolChoice: true,
		supportsForcedToolChoice: true,
		supportsNamedToolChoice: false,
		supportsReasoningWithTools: true,
		supportsBetweenToolsThinking: false,
		disableReasoningOnToolChoice: false,
	},
};

test("shared eligibility treats between-tools downgrade as notice, not exclusion", () => {
	const protocol = resolveRouteMemberProtocol(member.protocols, ["openai-completions", "openai-responses"], {
		defaultProtocol: "openai-completions",
	});
	const result = evaluateRouteMemberEligibility(member, {
		estimatedInputTokens: 10_000,
		outputReserveTokens: 16_000,
		hasImages: false,
		usesTools: true,
		usesReasoning: true,
		usesToolSearch: false,
		usesBetweenToolsThinking: true,
		toolChoicePresent: false,
		protocol,
		protocolAvailable: true,
		supportedProtocols: ["openai-completions", "openai-responses"],
	});
	assert.equal(result.eligible, true);
	assert.deepEqual(result.reasons, []);
	assert.match(result.notices[0] ?? "", /downgraded or omitted by Bifrost/u);
});

test("shared eligibility keeps exact request capability failures deterministic", () => {
	const protocol = resolveRouteMemberProtocol(member.protocols, ["openai-completions", "openai-responses"], {
		toolSearch: true,
		defaultProtocol: "openai-completions",
	});
	const result = evaluateRouteMemberEligibility(member, {
		estimatedInputTokens: 120_000,
		outputReserveTokens: 16_000,
		hasImages: true,
		usesTools: true,
		usesReasoning: true,
		usesToolSearch: true,
		usesBetweenToolsThinking: false,
		toolChoicePresent: true,
		toolChoiceKind: "named",
		serviceTier: "ultrafast",
		protocol,
		protocolAvailable: true,
		supportedProtocols: ["openai-completions", "openai-responses"],
	});
	assert.equal(protocol, "openai-responses");
	assert.equal(result.eligible, false);
	assert.ok(result.reasons.includes("context 128000 < required 136000"));
	assert.ok(result.reasons.includes("no image input"));
	assert.ok(result.reasons.includes("no named tool_choice support"));
	assert.ok(result.reasons.includes("service tier ultrafast unavailable"));
});
