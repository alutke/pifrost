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


test("verified current-generation stealth and MiMo hints stay narrowly scoped", () => {
	const pixel = findVendorCapabilityOverride("CommandCode GOAT/stealth/pixel-canary");
	assert.equal(pixel?.contextWindow, 262_144);
	assert.equal(pixel?.maxTokens, 131_072);
	assert.deepEqual(pixel?.input, ["text", "image"]);
	assert.equal(pixel?.thinking?.effortMap?.xhigh, "xhigh");

	for (const reference of [
		"opencode-go/mimo-v2.6-flash",
		"CommandCode GOAT/xiaomi/mimo-v2.6-flash",
		"Xiaomi MIMO/mimo-v2.6-flash",
	]) {
		const hint = findVendorCapabilityOverride(reference);
		assert.equal(hint?.contextWindow, 1_048_576);
		assert.equal(hint?.maxTokens, 131_072);
		assert.deepEqual(hint?.input, ["text", "image"]);
		assert.equal(hint?.thinking?.effortMap?.minimal, "low");
		assert.equal(hint?.thinking?.effortMap?.max, "high");
	}

	assert.equal(findVendorCapabilityOverride("google/pixel-canary"), undefined);
	assert.equal(findVendorCapabilityOverride("google/mimo-v2.6-flash"), undefined);
	assert.equal(findVendorCapabilityOverride("deepseek/mimo-v2.6-pro"), undefined);
});
