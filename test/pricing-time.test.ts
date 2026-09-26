import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluateRoutePricing,
	formatPeakHoursSchedule,
	isWithinPeakWindows,
	parseClockMinutes,
	type RoutePricingDiagnostic,
} from "../pricing-time.ts";

const deepSeek: RoutePricingDiagnostic = {
	source: "bifrost-datasheet",
	pricingKey: "deepseek/deepseek-v4-flash",
	peakCost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
	offPeakCostMultiplier: 0.5,
	peakHours: {
		timezone: "UTC",
		windows: [
			{ days: [1, 2, 3, 4, 5], start: "01:00", end: "04:00" },
			{ days: [1, 2, 3, 4, 5], start: "06:00", end: "10:00" },
		],
	},
};

test("matches Bifrost half-open DeepSeek peak windows", () => {
	assert.equal(evaluateRoutePricing(deepSeek, new Date("2026-08-17T01:00:00Z")).band, "peak");
	assert.equal(evaluateRoutePricing(deepSeek, new Date("2026-08-17T03:59:59Z")).band, "peak");
	const end = evaluateRoutePricing(deepSeek, new Date("2026-08-17T04:00:00Z"));
	assert.equal(end.band, "off-peak");
	assert.equal(end.multiplier, 0.5);
	assert.equal(end.effectiveCost.input, 0.22);
	assert.equal(evaluateRoutePricing(deepSeek, new Date("2026-08-15T02:00:00Z")).band, "off-peak");
});

test("matches Bifrost midnight-wrapping semantics against the previous weekday", () => {
	const schedule = {
		timezone: "UTC",
		windows: [{ days: [1], start: "22:00", end: "02:00" }],
	};
	assert.deepEqual(isWithinPeakWindows(schedule, new Date("2026-08-17T23:00:00Z")), { peak: true, valid: true });
	assert.deepEqual(isWithinPeakWindows(schedule, new Date("2026-08-18T01:00:00Z")), { peak: true, valid: true });
	assert.deepEqual(isWithinPeakWindows(schedule, new Date("2026-08-18T02:00:00Z")), { peak: false, valid: true });
});

test("evaluates IANA timezone schedules at the supplied request instant", () => {
	const pricing: RoutePricingDiagnostic = {
		...deepSeek,
		peakHours: {
			timezone: "Europe/London",
			windows: [{ days: [1], start: "02:00", end: "03:00" }],
		},
	};
	// 2026-08-17 01:30Z is 02:30 BST on Monday.
	assert.equal(evaluateRoutePricing(pricing, new Date("2026-08-17T01:30:00Z")).band, "peak");
});

test("fails closed to peak for malformed pricing schedules", () => {
	for (const pricing of [
		{ ...deepSeek, offPeakCostMultiplier: 0 },
		{ ...deepSeek, peakHours: undefined },
		{ ...deepSeek, peakHours: { timezone: "Mars/Olympus_Mons", windows: deepSeek.peakHours?.windows } },
		{ ...deepSeek, peakHours: { timezone: "UTC", windows: [{ days: [7], start: "01:00", end: "04:00" }] } },
		{ ...deepSeek, peakHours: { timezone: "UTC", windows: [{ days: [1], start: "0100", end: "04:00" }] } },
	]) {
		const result = evaluateRoutePricing(pricing as RoutePricingDiagnostic, new Date("2026-08-17T05:00:00Z"));
		assert.equal(result.band, "peak-fail-closed");
		assert.equal(result.multiplier, 1);
		assert.equal(result.effectiveCost.input, deepSeek.peakCost.input);
	}
});

test("clock parsing and schedule formatting mirror Bifrost constraints", () => {
	assert.equal(parseClockMinutes("24:00"), 1440);
	assert.equal(parseClockMinutes("24:01"), undefined);
	assert.equal(parseClockMinutes("0100"), undefined);
	assert.equal(formatPeakHoursSchedule(deepSeek.peakHours), "Mon-Fri 01:00-04:00; Mon-Fri 06:00-10:00 UTC");
});
