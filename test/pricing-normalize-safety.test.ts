import assert from "node:assert/strict";
import test from "node:test";

import { normalizePricingDatasheet } from "../pricing-normalize.ts";

test("vendor vision hints do not leak to a same-named model from another vendor", () => {
	const normalized = normalizePricingDatasheet({
		"google/deepseek-v4-flash-vision-exp": {
			provider: "google",
			mode: "chat",
			context_length: 100_000,
			max_output_tokens: 10_000,
		},
		"deepseek/deepseek-v4-flash-vision-exp": {
			provider: "deepseek",
			mode: "chat",
			context_length: 1_000_000,
			max_output_tokens: 384_000,
		},
	});
	assert.equal(normalized["google/deepseek-v4-flash-vision-exp"]?.architecture, undefined);
	assert.deepEqual(
		normalized["deepseek/deepseek-v4-flash-vision-exp"]?.architecture?.input_modalities,
		["text", "image"],
	);
	assert.equal(
		normalized["deepseek/deepseek-v4-flash-vision-exp"]?._pifrost_sources?.image,
		"vendor-override",
	);
});

test("canonical-family enrichment carries explicit provenance", () => {
	const normalized = normalizePricingDatasheet({
		"aggregator/vendor/future-model": {
			provider: "aggregator",
			mode: "chat",
			base_model: "vendor/future-model",
			input_cost_per_token: 0.000001,
		},
		"vendor/future-model": {
			provider: "vendor",
			mode: "chat",
			context_length: 524_288,
			max_output_tokens: 65_536,
			architecture: { input_modalities: ["text", "image"] },
		},
	});
	const row = normalized["aggregator/vendor/future-model"];
	assert.equal(row?.context_length, 524_288);
	assert.equal(row?.max_output_tokens, 65_536);
	assert.deepEqual(row?.architecture?.input_modalities, ["text", "image"]);
	assert.equal(row?._pifrost_sources?.contextWindow, "canonical-family");
	assert.equal(row?._pifrost_sources?.maxTokens, "canonical-family");
	assert.equal(row?._pifrost_sources?.image, "canonical-family");
});

test("arbitrary free variants do not inherit base-model limits", () => {
	const normalized = normalizePricingDatasheet({
		"vendor/model": {
			provider: "vendor",
			mode: "chat",
			context_length: 1_000_000,
			max_output_tokens: 128_000,
		},
		"vendor/model-free": {
			provider: "vendor",
			mode: "chat",
		},
	});
	assert.equal(normalized["vendor/model-free"]?.context_length, undefined);
	assert.equal(normalized["vendor/model-free"]?.max_output_tokens, undefined);
});
