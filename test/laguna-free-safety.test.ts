import assert from "node:assert/strict";
import test from "node:test";

import {
	canonicalModelFamily,
	equivalentModelId,
	findVendorCapabilityOverride,
} from "../catalog-fallback.ts";

test("Laguna S 2.1 Free is not capability-equivalent to the paid model", () => {
	assert.equal(canonicalModelFamily("poolside/laguna-s-2.1-free"), "laguna-s-2.1-free");
	assert.equal(canonicalModelFamily("poolside/laguna-s-2.1"), "laguna-s-2.1");
	assert.equal(equivalentModelId("poolside/laguna-s-2.1-free", "poolside/laguna-s-2.1"), false);
});

test("Laguna free override uses the conservative hosted entitlement envelope", () => {
	const override = findVendorCapabilityOverride("CommandCode GOAT/poolside/laguna-s-2.1-free");
	assert.ok(override);
	assert.equal(override.contextWindow, 256_000);
	assert.equal(override.maxTokens, 32_768);
	assert.deepEqual(override.input, ["text"]);
	assert.equal(override.reasoning, false);
	assert.equal(override.supportsTools, true);
});

test("Laguna free override cannot leak to the paid Poolside model", () => {
	assert.equal(findVendorCapabilityOverride("poolside/laguna-s-2.1"), undefined);
});
