import type {
	ModelParametersDatasheet,
	ModelParameterEntry,
	PricingDatasheet,
	PricingDatasheetEntry,
} from "./datasheet.ts";

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function tail(value: string): string {
	const parts = normalized(value).split("/");
	return parts[parts.length - 1] ?? normalized(value);
}

function canonicalFamily(value: string): string {
	return tail(value).replace(/:batch$/u, "").replace(/-free$/u, "");
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasContext(entry: PricingDatasheetEntry): boolean {
	return positive(entry.context_length) || positive(entry.max_input_tokens);
}

function hasOutput(entry: PricingDatasheetEntry): boolean {
	return positive(entry.max_output_tokens) || positive(entry.max_tokens);
}

function capabilityScore(entry: PricingDatasheetEntry): number {
	let score = 0;
	if (positive(entry.context_length)) score += 8;
	if (positive(entry.max_input_tokens)) score += 6;
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
	const leftTail = canonicalFamily(leftKey);
	const rightTail = canonicalFamily(rightKey);
	if (leftTail === rightTail) return true;

	const leftBase = left.base_model ? canonicalFamily(left.base_model) : undefined;
	const rightBase = right.base_model ? canonicalFamily(right.base_model) : undefined;
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

function applyKnownArchitecture(entry: PricingDatasheetEntry, key: string): PricingDatasheetEntry {
	const family = canonicalFamily(entry.base_model ?? key);

	// Xiaomi's official Pi integration publishes MiMo-V2.5 as text+image and
	// MiMo-V2.5-Pro as text-only. Bifrost's pricing feed currently omits the
	// architecture field on these rows.
	if (family === "mimo-v2.5") {
		return {
			...entry,
			architecture: {
				...entry.architecture,
				input_modalities: ["text", "image"],
			},
		};
	}
	if (family === "mimo-v2.5-pro") {
		return {
			...entry,
			architecture: {
				...entry.architecture,
				input_modalities: ["text"],
			},
		};
	}

	// OpenAI's current GPT-5.6 model cards explicitly support image input on
	// Luna, Terra and Sol. The Bifrost pricing rows presently omit architecture.
	if (/^gpt-5\.6-(?:luna|terra|sol)$/u.test(family)) {
		return {
			...entry,
			architecture: {
				...entry.architecture,
				input_modalities: ["text", "image"],
			},
		};
	}
	return entry;
}

/**
 * Bifrost's public datasheet can contain provider-specific rows that deliberately
 * carry only price information while another row for the same underlying model
 * carries the canonical limits. Preserve provider-specific prices while filling
 * only missing capability fields from the richest complete equivalent row.
 *
 * `max_input_tokens` is treated as the usable context/input ceiling, not added to
 * `max_output_tokens`. This matches current upstream model cards (for example
 * GPT-5.6 Luna: 1,050,000 context, 128,000 max output) and avoids advertising an
 * impossible 1,178,000-token context window.
 */
export function normalizePricingDatasheet(sheet: PricingDatasheet): PricingDatasheet {
	const source = Object.entries(sheet);
	const result: PricingDatasheet = { ...sheet };

	for (const [targetKey, target] of source) {
		let enriched = target;
		if (!hasContext(target) || !hasOutput(target) || !target.architecture) {
			const donors = source
				.filter(([donorKey, donor]) =>
					donorKey !== targetKey &&
					sameFamily(targetKey, target, donorKey, donor) &&
					hasContext(donor) &&
					hasOutput(donor),
				)
				.sort((a, b) => capabilityScore(b[1]) - capabilityScore(a[1]) || a[0].length - b[0].length);
			const donor = donors[0]?.[1];
			if (donor) enriched = mergeCapabilities(target, donor);
		}

		// Normalize an absent context_length to the provider/catalog input ceiling.
		// Do not sum input and output: upstream context windows include the request
		// budget rather than being max_input + max_output.
		if (!positive(enriched.context_length) && positive(enriched.max_input_tokens)) {
			enriched = { ...enriched, context_length: enriched.max_input_tokens };
		}
		result[targetKey] = applyKnownArchitecture(enriched, targetKey);
	}

	for (const [key, value] of Object.entries(result)) {
		if (key.endsWith("-free")) continue;
		const freeKey = `${key}-free`;
		if (!(freeKey in result)) result[freeKey] = value;
	}

	return result;
}

function mergeParameterHint(target: ModelParameterEntry | undefined, hint: ModelParameterEntry): ModelParameterEntry {
	return {
		...hint,
		...target,
		model_parameters: target?.model_parameters ?? hint.model_parameters,
		reasoning_effort_levels: target?.reasoning_effort_levels ?? hint.reasoning_effort_levels,
		reasoning_effort_renames: target?.reasoning_effort_renames ?? hint.reasoning_effort_renames,
	};
}

/**
 * Fill narrowly-scoped capability facts that are documented by the model vendor
 * but currently absent from Bifrost's public model-parameters feed. Existing
 * Bifrost values always win.
 */
export function normalizeModelParametersDatasheet(sheet: ModelParametersDatasheet): ModelParametersDatasheet {
	const result: ModelParametersDatasheet = { ...sheet };
	const hints: Record<string, ModelParameterEntry> = {
		"gpt-5.6-luna": {
			provider: "openai",
			supports_reasoning: true,
			supports_reasoning_effort: true,
			reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"],
			supports_function_calling: true,
		},
		"gpt-5.6-terra": {
			provider: "openai",
			supports_reasoning: true,
			supports_reasoning_effort: true,
			reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"],
			supports_function_calling: true,
		},
		"gpt-5.6-sol": {
			provider: "openai",
			supports_reasoning: true,
			supports_reasoning_effort: true,
			reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"],
			supports_function_calling: true,
		},
		"deepseek-v4-flash": {
			provider: "deepseek",
			supports_reasoning: true,
			supports_reasoning_effort: true,
			reasoning_effort_levels: ["high", "max"],
			supports_function_calling: true,
		},
		"deepseek-v4-pro": {
			provider: "deepseek",
			supports_reasoning: true,
			supports_reasoning_effort: true,
			reasoning_effort_levels: ["high", "max"],
			supports_function_calling: true,
		},
		"mimo-v2.5": {
			provider: "xiaomi",
			supports_reasoning: true,
			supports_function_calling: true,
		},
		"mimo-v2.5-pro": {
			provider: "xiaomi",
			supports_reasoning: true,
			supports_function_calling: true,
		},
		"kimi-k2.7-code": {
			supports_reasoning: true,
			supports_function_calling: true,
		},
	};

	for (const [family, hint] of Object.entries(hints)) {
		result[family] = mergeParameterHint(result[family], hint);
		for (const [key, value] of Object.entries(result)) {
			if (canonicalFamily(value.base_model ?? key) === family) {
				result[key] = mergeParameterHint(value, hint);
			}
		}
	}
	return result;
}
