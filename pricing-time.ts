export interface PeakHoursWindow {
	days: number[];
	start: string;
	end: string;
}

export interface PeakHoursSchedule {
	timezone?: string;
	windows?: PeakHoursWindow[];
}

export interface PricingCostRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface RoutePricingDiagnostic {
	pricingKey?: string;
	source: "bifrost-datasheet" | "canonical-family" | "live" | "vendor-override" | "fallback";
	peakCost: PricingCostRates;
	offPeakCostMultiplier?: number;
	peakHours?: PeakHoursSchedule;
}

export interface PricingBandEvaluation {
	band: "static" | "peak" | "off-peak" | "peak-fail-closed";
	multiplier: number;
	effectiveCost: PricingCostRates;
	reason?: string;
}

const WEEKDAY = new Map([
	["Sun", 0],
	["Mon", 1],
	["Tue", 2],
	["Wed", 3],
	["Thu", 4],
	["Fri", 5],
	["Sat", 6],
]);

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseClockMinutes(value: string): number | undefined {
	const match = /^(\d{2}):(\d{2})$/u.exec(value);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) {
		return undefined;
	}
	if (hour === 24 && minute !== 0) return undefined;
	return hour * 60 + minute;
}

function zonedWeekdayMinutes(at: Date, timeZone: string): { weekday: number; minutes: number } | undefined {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(at);
		const weekdayName = parts.find((part) => part.type === "weekday")?.value;
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = Number(parts.find((part) => part.type === "minute")?.value);
		const weekday = weekdayName ? WEEKDAY.get(weekdayName) : undefined;
		if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
		return { weekday, minutes: hour * 60 + minute };
	} catch {
		return undefined;
	}
}

export function isWithinPeakWindows(
	schedule: PeakHoursSchedule | undefined,
	at: Date,
): { peak: boolean; valid: boolean; reason?: string } {
	const windows = schedule?.windows;
	if (!Array.isArray(windows) || windows.length === 0) {
		return { peak: false, valid: false, reason: "missing peak windows" };
	}
	const timezone = schedule?.timezone?.trim() || "UTC";
	const local = zonedWeekdayMinutes(at, timezone);
	if (!local) return { peak: false, valid: false, reason: `invalid or unavailable timezone ${timezone}` };

	const prevWeekday = (local.weekday + 6) % 7;
	const prevMinutes = local.minutes + 24 * 60;
	let valid = false;

	for (const window of windows) {
		const start = parseClockMinutes(window.start);
		let end = parseClockMinutes(window.end);
		if (start === undefined || end === undefined || !Array.isArray(window.days) || window.days.length === 0) continue;
		const wrapped = end <= start;
		if (wrapped) end += 24 * 60;
		for (const day of window.days) {
			if (!Number.isInteger(day) || day < 0 || day > 6) continue;
			valid = true;
			if (day === local.weekday && local.minutes >= start && local.minutes < end) return { peak: true, valid: true };
			if (wrapped && day === prevWeekday && prevMinutes >= start && prevMinutes < end) return { peak: true, valid: true };
		}
	}
	return valid ? { peak: false, valid: true } : { peak: false, valid: false, reason: "no usable peak windows" };
}

function scaled(cost: PricingCostRates, multiplier: number): PricingCostRates {
	return {
		input: cost.input * multiplier,
		output: cost.output * multiplier,
		cacheRead: cost.cacheRead * multiplier,
		cacheWrite: cost.cacheWrite * multiplier,
	};
}

export function evaluateRoutePricing(
	pricing: RoutePricingDiagnostic,
	at = new Date(),
): PricingBandEvaluation {
	const multiplier = pricing.offPeakCostMultiplier;
	const schedule = pricing.peakHours;
	if (multiplier === undefined && schedule === undefined) {
		return { band: "static", multiplier: 1, effectiveCost: { ...pricing.peakCost } };
	}
	if (!(typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 && multiplier <= 1)) {
		return {
			band: "peak-fail-closed",
			multiplier: 1,
			effectiveCost: { ...pricing.peakCost },
			reason: "off_peak_cost_multiplier must be in (0, 1]",
		};
	}
	if (!schedule) {
		return {
			band: "peak-fail-closed",
			multiplier: 1,
			effectiveCost: { ...pricing.peakCost },
			reason: "peak_hours is missing",
		};
	}
	const peak = isWithinPeakWindows(schedule, at);
	if (!peak.valid) {
		return {
			band: "peak-fail-closed",
			multiplier: 1,
			effectiveCost: { ...pricing.peakCost },
			reason: peak.reason,
		};
	}
	if (peak.peak) return { band: "peak", multiplier: 1, effectiveCost: { ...pricing.peakCost } };
	return { band: "off-peak", multiplier, effectiveCost: scaled(pricing.peakCost, multiplier) };
}

function contiguousDays(days: number[]): string {
	const valid = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
	if (valid.length === 0) return "?";
	if (valid.length === 7) return "Sun-Sat";
	if (valid.length >= 2 && valid.every((day, index) => index === 0 || day === valid[index - 1]! + 1)) {
		return `${WEEKDAY_NAMES[valid[0]!]}-${WEEKDAY_NAMES[valid[valid.length - 1]!]}`;
	}
	return valid.map((day) => WEEKDAY_NAMES[day]).join(",");
}

export function formatPeakHoursSchedule(schedule: PeakHoursSchedule | undefined): string {
	if (!schedule?.windows?.length) return "n/a";
	const timezone = schedule.timezone?.trim() || "UTC";
	return `${schedule.windows.map((window) => `${contiguousDays(window.days)} ${window.start}-${window.end}`).join("; ")} ${timezone}`;
}

function price(value: number): string {
	if (!Number.isFinite(value)) return "n/a";
	if (value === 0) return "$0";
	return `$${value < 0.01 ? value.toPrecision(3) : value.toFixed(value < 1 ? 4 : 2)}`;
}

export function formatRoutePricing(
	pricing: RoutePricingDiagnostic,
	at = new Date(),
): string {
	const evaluation = evaluateRoutePricing(pricing, at);
	const source = pricing.pricingKey ? `${pricing.source}:${pricing.pricingKey}` : pricing.source;
	const schedule = pricing.offPeakCostMultiplier !== undefined || pricing.peakHours
		? ` multiplier=${pricing.offPeakCostMultiplier ?? "n/a"}x schedule=${formatPeakHoursSchedule(pricing.peakHours)}`
		: "";
	const fail = evaluation.reason ? ` reason=${evaluation.reason}` : "";
	return `pricing band=${evaluation.band} source=${source}${schedule} peak(input/output)=${price(pricing.peakCost.input)}/${price(pricing.peakCost.output)} per 1M current(input/output)=${price(evaluation.effectiveCost.input)}/${price(evaluation.effectiveCost.output)} per 1M${fail}`;
}
