import assert from "node:assert/strict";
import test from "node:test";

import {
	compactBeforeContextSkipEnabled,
	createCompactBeforeSkipCoordinator,
	planCompactBeforeContextSkip,
	requiredContextFromOmpUsage,
	type CompactBeforeSkipRuntimeContext,
} from "../compact-before-skip.ts";
import type { DynamicRouteProfile } from "../dynamic-routing.ts";

function profile(): DynamicRouteProfile {
	return {
		id: "omp-default",
		mode: "context-aware",
		source: "bifrost-simple-rule",
		staticContextWindow: 256_000,
		advertisedContextWindow: 1_000_000,
		maxTokens: 32_000,
		members: [
			{
				reference: "provider/small",
				resolvedModelId: "provider/small",
				contextWindow: 256_000,
				maxTokens: 32_000,
				input: ["text"],
				reasoning: true,
				supportsTools: true,
				compat: {},
			},
			{
				reference: "provider/large",
				resolvedModelId: "provider/large",
				contextWindow: 1_000_000,
				maxTokens: 32_000,
				input: ["text"],
				reasoning: true,
				supportsTools: true,
				compat: {},
			},
		],
		bands: [
			{ maxRequiredTokens: 256_000, members: ["provider/small", "provider/large"] },
			{ maxRequiredTokens: 1_000_000, members: ["provider/large"] },
		],
	};
}

test("compact-before-skip is enabled by default and has an explicit opt-out", () => {
	assert.equal(compactBeforeContextSkipEnabled({}), true);
	assert.equal(compactBeforeContextSkipEnabled({ PIFROST_COMPACT_BEFORE_CONTEXT_SKIP: "false" }), false);
	assert.equal(compactBeforeContextSkipEnabled({ PIFROST_COMPACT_BEFORE_CONTEXT_SKIP: "0" }), false);
	assert.equal(compactBeforeContextSkipEnabled({ PIFROST_COMPACT_BEFORE_CONTEXT_SKIP: "yes" }), true);
});

test("OMP usage is converted to a conservative input plus output requirement", () => {
	const capacity = requiredContextFromOmpUsage(profile(), 200_000);
	assert.equal(capacity.estimatedInputTokens, 222_048);
	assert.equal(capacity.outputReserveTokens, 32_000);
	assert.equal(capacity.requiredContextTokens, 254_048);
});

test("plans compaction before a smaller route member would be skipped for context", () => {
	const plan = planCompactBeforeContextSkip(profile(), 210_000);
	assert.equal(plan.shouldCompact, true);
	assert.equal(plan.reason, "context-skip");
	assert.equal(plan.targetReference, "provider/small");
	assert.equal(plan.targetContextWindow, 256_000);
	assert.ok(plan.requiredContextTokens > 256_000);
});

test("does not compact while every member still has safe context headroom", () => {
	const plan = planCompactBeforeContextSkip(profile(), 190_000);
	assert.equal(plan.shouldCompact, false);
	assert.equal(plan.reason, "no-context-skip");
});

test("suppresses repeated ineffective compaction until context changes materially", () => {
	const route = profile();
	const previous = {
		logicalModel: route.id,
		targetReference: "provider/small",
		targetContextWindow: 256_000,
		afterContextTokens: 210_000,
	};
	const cooled = planCompactBeforeContextSkip(route, 220_000, previous);
	assert.equal(cooled.shouldCompact, false);
	assert.equal(cooled.reason, "cooldown");
	const retry = planCompactBeforeContextSkip(route, 245_000, previous);
	assert.equal(retry.shouldCompact, true);
});

test("does not compact for a member that also cannot satisfy the output reserve", () => {
	const route = profile();
	route.members[0] = { ...route.members[0]!, maxTokens: 8_000 };
	const plan = planCompactBeforeContextSkip(route, 210_000);
	assert.equal(plan.shouldCompact, false);
	assert.equal(plan.reason, "no-context-skip");
});

test("coordinator compacts once while idle and re-evaluates after compression", async () => {
	const route = profile();
	let tokens = 210_000;
	let compactCalls = 0;
	const timers: Array<() => void> = [];
	const sessionManager = {};
	const ctx: CompactBeforeSkipRuntimeContext = {
		sessionManager,
		model: { provider: "bifrost", id: "omp-default" },
		models: { current: () => ({ provider: "bifrost", id: "omp-default" }) },
		getContextUsage: () => ({ tokens, contextWindow: 1_000_000, percent: tokens / 10_000 }),
		isIdle: () => true,
		compact: async () => {
			compactCalls++;
			tokens = 120_000;
		},
		setTimeout: (callback) => {
			timers.push(() => callback());
			return 0;
		},
	};
	const schedule = createCompactBeforeSkipCoordinator(
		(id) => id === "omp-default" ? route : undefined,
		{ env: {}, idleRetryMs: 1 },
	);

	schedule(ctx);
	assert.equal(timers.length, 1);
	timers.shift()!();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(compactCalls, 1);
	assert.equal(tokens, 120_000);

	schedule(ctx);
	timers.shift()!();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(compactCalls, 1);
});
