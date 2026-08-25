import assert from "node:assert/strict";
import test from "node:test";

import { toProviderModel } from "../index.ts";

test("live max_input_tokens is the context ceiling, not input plus output", () => {
	const mapped = toProviderModel({
		id: "vendor/live-context-model",
		max_input_tokens: 1_000_000,
		max_output_tokens: 128_000,
	});
	assert.ok(mapped);
	assert.equal(mapped.contextWindow, 1_000_000);
	assert.equal(mapped.maxTokens, 128_000);
	assert.equal(mapped.capabilitySources?.contextWindow, "live");
	assert.equal(mapped.capabilitySources?.maxTokens, "live");
});
