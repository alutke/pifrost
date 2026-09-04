import assert from "node:assert/strict";
import test from "node:test";

import { parseBifrostQuota } from "../bifrost-usage.ts";

test("maps Bifrost 2.x Virtual Key governance into OMP usage limits", () => {
	const report = parseBifrostQuota({
		virtual_key_name: "omp-global",
		is_active: true,
		budgets: [{
			id: "vk-month",
			max_limit: 100,
			current_usage: 80,
			reset_duration: "30d",
			last_reset: "2026-09-01T00:00:00Z",
		}],
		rate_limit: {
			id: "vk-rate",
			token_max_limit: 1_000_000,
			token_current_usage: 250_000,
			token_reset_duration: "1h",
			token_last_reset: "2026-09-04T12:00:00Z",
			request_max_limit: 1000,
			request_current_usage: 100,
			request_reset_duration: "1h",
			request_last_reset: "2026-09-04T12:00:00Z",
		},
		provider_configs: [{
			provider: "deepseek",
			budgets: [{ id: "ds-day", max_limit: 20, current_usage: 2, reset_duration: "1d" }],
		}],
		model_configs: [{
			model_name: "deepseek-v4-pro",
			provider: "deepseek",
			budgets: [{ id: "model-day", max_limit: 10, current_usage: 10, reset_duration: "1d" }],
		}],
	}, 1234);

	assert.ok(report);
	assert.equal(report.provider, "bifrost");
	assert.equal(report.fetchedAt, 1234);
	assert.equal(report.metadata?.virtualKeyName, "omp-global");
	assert.equal(report.limits.length, 5);

	const budget = report.limits.find((limit) => limit.id.includes("vk:budget:vk-month"));
	assert.equal(budget?.amount.unit, "usd");
	assert.equal(budget?.amount.limit, 100);
	assert.equal(budget?.amount.used, 80);
	assert.equal(budget?.status, "warning");

	const tokens = report.limits.find((limit) => limit.id.includes("vk:token:vk-rate"));
	assert.equal(tokens?.amount.unit, "tokens");
	assert.equal(tokens?.amount.remaining, 750_000);

	const model = report.limits.find((limit) => limit.scope.modelId === "deepseek-v4-pro");
	assert.equal(model?.status, "exhausted");
});

test("quota parser reports inactive keys and ignores malformed unlimited rows", () => {
	const report = parseBifrostQuota({
		virtual_key_name: "disabled",
		is_active: false,
		budgets: [{ id: "broken", max_limit: 0, current_usage: 1 }],
	});
	assert.ok(report);
	assert.equal(report.limits.length, 0);
	assert.ok(report.notes?.some((note) => note.includes("inactive")));
});
