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


test("direct Bifrost discovery respects exact reseller-specific completion cap", () => {
	const exact = toProviderModel({ id: "CommandCode GOAT/inclusionai/ling-3.1-flash:free", context_length: 262_144, max_output_tokens: 65_536 });
	assert.equal(exact?.maxTokens, 32_768);
	assert.equal(exact?.capabilitySources?.maxTokens, "vendor-override");
	const other = toProviderModel({ id: "other/inclusionai/ling-3.1-flash:free", context_length: 262_144, max_output_tokens: 65_536 });
	assert.equal(other?.maxTokens, 65_536);
});
