import assert from "node:assert/strict";
import test from "node:test";

import { findDatasheetEntry } from "../datasheet.ts";
import { normalizeModelParametersDatasheet } from "../pricing-normalize.ts";

test("synthetic parameter hints are vendor-qualified", () => {
	const normalized = normalizeModelParametersDatasheet({});
	assert.ok(normalized["deepseek/deepseek-v4-flash-vision-exp"]);
	assert.equal(normalized["deepseek-v4-flash-vision-exp"], undefined);
	assert.ok(normalized["stealth/ox-alpha"]);
	assert.equal(normalized["ox-alpha"], undefined);
});

test("different-vendor route cannot match a synthetic DeepSeek parameter hint", () => {
	const normalized = normalizeModelParametersDatasheet({});
	assert.equal(
		findDatasheetEntry(
			normalized,
			"google/deepseek-v4-flash-vision-exp",
			"google/deepseek-v4-flash-vision-exp",
		),
		undefined,
	);
});

test("provider-qualified existing rows receive only their own vendor hint", () => {
	const normalized = normalizeModelParametersDatasheet({
		"deepseek-v4-flash-vision-exp": { provider: "google", mode: "chat" },
	});
	assert.equal(normalized["deepseek-v4-flash-vision-exp"]?.supports_reasoning, undefined);
	assert.equal(normalized["deepseek-v4-flash-vision-exp"]?.supports_function_calling, undefined);
	assert.equal(normalized["deepseek/deepseek-v4-flash-vision-exp"]?.supports_reasoning, true);
});
