import assert from "node:assert/strict";
import test from "node:test";

import { findVendorCapabilityOverride } from "../catalog-fallback.ts";

test("vendor override resolves known Ox and DeepSeek identities including bare aliases", () => {
	assert.equal(findVendorCapabilityOverride("CommandCode GOAT/stealth/ox-alpha")?.maxTokens, 131_072);
	assert.equal(findVendorCapabilityOverride("opencode-go/x-preview-f-free")?.contextWindow, 1_048_576);
	assert.deepEqual(
		findVendorCapabilityOverride("deepseek/deepseek-v4-flash-vision-exp")?.input,
		["text", "image"],
	);
});

test("vendor override does not leak across an explicitly different vendor", () => {
	assert.equal(findVendorCapabilityOverride("google/ox-alpha"), undefined);
	assert.equal(findVendorCapabilityOverride("google/deepseek-v4-flash-vision-exp"), undefined);
	assert.equal(findVendorCapabilityOverride("moonshotai/deepseek-v4-flash-vision-exp"), undefined);
});
