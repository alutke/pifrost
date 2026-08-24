import type { PricingDatasheet, PricingDatasheetEntry } from "./datasheet.ts";

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function tail(value: string): string {
	const parts = normalized(value).split("/");
	return parts[parts.length - 1] ?? normalized(value);
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasContext(entry: PricingDatasheetEntry): boolean {
	return positive(entry.context_length) || (positive(entry.max_input_tokens) && positive(entry.max_output_tokens));
}

function hasOutput(entry: PricingDatasheetEntry): boolean {
	return positive(entry.max_output_tokens) || positive(entry.max_tokens);
}

function capabilityScore(entry: PricingDatasheetEntry): number {
	let score = 0;
	if (positive(entry.context_length)) score += 8;
	if (positive(entry.max_input_tokens)) score += 3;
	if (positive(entry.max_output_tokens)) score += 8;
	if (positive(entry.max_tokens)) score += 4;
	if ((entry.architecture?.input_modalities?.length ?? 0) > 0) score += 4;
	if ((entry.architecture?.output_modalities?.length ?? 0) > 0) score += 1;
	return score;
}

function sameFamily(
	leftKey: string,
	left: PricingDatasheetEntry,
	rightKey: string,
	right: PricingDatasheetEntry,
): boolean {
	const leftTail = tail(leftKey).replace(/:batch$/u, "");
	const rightTail = tail(rightKey).replace(/:batch$/u, "");
	if (leftTail === rightTail) return true;

	const leftBase = left.base_model ? normalized(left.base_model) : undefined;
	const rightBase = right.base_model ? normalized(right.base_model) : undefined;
	if (leftBase && rightBase && leftBase === rightBase) return true;
	if (leftBase && leftBase === rightTail) return true;
	if (rightBase && rightBase === leftTail) return true;
	return false;
}

function mergeCapabilities(target: PricingDatasheetEntry, donor: PricingDatasheetEntry): PricingDatasheetEntry {
	return {
		...target,
		base_model: target.base_model ?? donor.base_model,
		context_length: target.context_length ?? donor.context_length,
		max_input_tokens: target.max_input_tokens ?? donor.max_input_tokens,
		max_output_tokens: target.max_output_tokens ?? donor.max_output_tokens,
		max_tokens: target.max_tokens ?? donor.max_tokens,
		architecture: target.architecture ?? donor.architecture,
	};
}

/**
 * Bifrost's public datasheet can contain provider-specific rows that deliberately
 * carry only price information while another row for the same underlying model
 * carries the canonical context/output/architecture limits. This mirrors how
 * Bifrost separates provider price from base-model capabilities internally.
 *
 * Preserve the provider row's price fields, but fill only missing capability
 * fields from the richest complete row for the same model family. This prevents
 * an exact `opencode-go/*` price row from masking richer canonical metadata.
 */
export function normalizePricingDatasheet(sheet: PricingDatasheet): PricingDatasheet {
	const source = Object.entries(sheet);
	const result: PricingDatasheet = { ...sheet };

	for (const [targetKey, target] of source) {
		if (hasContext(target) && hasOutput(target) && target.architecture) continue;

		const donors = source
			.filter(([donorKey, donor]) =>
				donorKey !== targetKey &&
				sameFamily(targetKey, target, donorKey, donor) &&
				hasContext(donor) &&
				hasOutput(donor),
			)
			.sort((a, b) => capabilityScore(b[1]) - capabilityScore(a[1]) || a[0].length - b[0].length);

		const donor = donors[0]?.[1];
		if (donor) result[targetKey] = mergeCapabilities(target, donor);
	}

	// Subscription gateways may expose a `-free` entitlement alias for an
	// otherwise identical underlying model. Add capability-equivalent rows only
	// when Bifrost does not already publish a distinct one.
	for (const [key, value] of Object.entries(result)) {
		if (key.endsWith("-free")) continue;
		const freeKey = `${key}-free`;
		if (!(freeKey in result)) result[freeKey] = value;
	}

	return result;
}
