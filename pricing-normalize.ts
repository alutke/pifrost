import { canonicalModelFamily, equivalentModelId } from "./catalog-fallback.ts";
import type {
	DatasheetCapabilitySources,
	ModelParametersDatasheet,
	ModelParameterEntry,
	PricingDatasheet,
	PricingDatasheetEntry,
} from "./datasheet.ts";

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
	const leftIds = [leftKey, left.base_model].filter((value): value is string => Boolean(value));
	const rightIds = [rightKey, right.base_model].filter((value): value is string => Boolean(value));
	return leftIds.some((leftId) => rightIds.some((rightId) => equivalentModelId(leftId, rightId)));
}

function capabilitySources(entry: PricingDatasheetEntry): DatasheetCapabilitySources {
	return { ...(entry._pifrost_sources ?? {}) };
}

function mergeCapabilities(target: PricingDatasheetEntry, donor: PricingDatasheetEntry): PricingDatasheetEntry {
	const sources = capabilitySources(target);
	const inheritContext = !hasContext(target) && hasContext(donor);
	const inheritOutput = !hasOutput(target) && hasOutput(donor);
	const inheritArchitecture = !(target.architecture?.input_modalities?.length) && Boolean(donor.architecture?.input_modalities?.length);
	if (inheritContext) sources.contextWindow = "canonical-family";
	if (inheritOutput) sources.maxTokens = "canonical-family";
	if (inheritArchitecture) sources.image = "canonical-family";

	return {
		...target,
		base_model: target.base_model ?? donor.base_model,
		context_length: target.context_length ?? donor.context_length,
		max_input_tokens: target.max_input_tokens ?? donor.max_input_tokens,
		max_output_tokens: target.max_output_tokens ?? donor.max_output_tokens,
		max_tokens: target.max_tokens ?? donor.max_tokens,
		architecture: target.architecture ?? donor.architecture,
		...(Object.keys(sources).length ? { _pifrost_sources: sources } : {}),
	};
}

function withVendorImage(entry: PricingDatasheetEntry, modalities: string[]): PricingDatasheetEntry {
	if (entry.architecture?.input_modalities?.length) return entry;
	return {
		...entry,
		architecture: {
			...entry.architecture,
			input_modalities: modalities,
		},
		_pifrost_sources: {
			...(entry._pifrost_sources ?? {}),
			image: "vendor-override",
		},
	};
}

function applyKnownArchitecture(entry: PricingDatasheetEntry, key: string): PricingDatasheetEntry {
	const identity = entry.base_model ?? key;

	// Narrow vendor-backed facts used only when Bifrost omits architecture. The
	// vendor-qualified identity check prevents a same-named model from another
	// vendor inheriting the hint. Bare canonical rows remain eligible.
	if (equivalentModelId(identity, "xiaomi/mimo-v2.5")) return withVendorImage(entry, ["text", "image"]);
	if (equivalentModelId(identity, "xiaomi/mimo-v2.5-pro")) return withVendorImage(entry, ["text"]);
	if (equivalentModelId(identity, "deepseek/deepseek-v4-flash-vision-exp")) {
		return withVendorImage(entry, ["text", "image"]);
	}
	if (equivalentModelId(identity, "stealth/ox-alpha")) return withVendorImage(entry, ["text", "image"]);
	for (const model of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
		if (equivalentModelId(identity, `openai/${model}`)) return withVendorImage(entry, ["text", "image"]);
	}
	return entry;
}

interface PricingRow {
	key: string;
	entry: PricingDatasheetEntry;
}

function familyKeys(key: string, entry: PricingDatasheetEntry): string[] {
	return [...new Set(
		[key, entry.base_model]
			.filter((value): value is string => Boolean(value))
			.map(canonicalModelFamily)
			.filter(Boolean),
	)];
}

function buildFamilyIndex(rows: readonly PricingRow[]): Map<string, PricingRow[]> {
	const index = new Map<string, PricingRow[]>();
	for (const row of rows) {
		for (const family of familyKeys(row.key, row.entry)) {
			const bucket = index.get(family);
			if (bucket) bucket.push(row);
			else index.set(family, [row]);
		}
	}
	return index;
}

/**
 * Bifrost's public datasheet can contain provider-specific rows that carry only
 * price information while another row for the same underlying model carries
 * canonical limits. Preserve provider prices while filling only missing
 * capability fields from collision-safe equivalent rows.
 *
 * Arbitrary `-free` suffixes are not stripped. Only model identities explicitly
 * declared equivalent by model-resolution.ts can inherit one another.
 *
 * Candidate donors are first indexed by canonical family. The final
 * `equivalentModelId` check remains authoritative, so this optimization does not
 * weaken vendor-collision protection while avoiding an all-rows × all-rows scan.
 */
export function normalizePricingDatasheet(sheet: PricingDatasheet): PricingDatasheet {
	const source: PricingRow[] = Object.entries(sheet).map(([key, entry]) => ({ key, entry }));
	const familyIndex = buildFamilyIndex(source);
	const result: PricingDatasheet = { ...sheet };

	for (const { key: targetKey, entry: target } of source) {
		let enriched = target;
		if (!hasContext(target) || !hasOutput(target) || !(target.architecture?.input_modalities?.length)) {
			const candidateRows = new Map<string, PricingRow>();
			for (const family of familyKeys(targetKey, target)) {
				for (const row of familyIndex.get(family) ?? []) candidateRows.set(row.key, row);
			}
			const donors = [...candidateRows.values()]
				.filter(({ key: donorKey, entry: donor }) =>
					donorKey !== targetKey &&
					sameFamily(targetKey, target, donorKey, donor) &&
					hasContext(donor) &&
					hasOutput(donor),
				)
				.sort((a, b) => capabilityScore(b.entry) - capabilityScore(a.entry) || a.key.length - b.key.length);
			const donor = donors[0]?.entry;
			if (donor) enriched = mergeCapabilities(target, donor);
		}

		// max_input_tokens is the request/context ceiling; never add max output on
		// top of it when synthesizing OMP's contextWindow.
		if (!positive(enriched.context_length) && positive(enriched.max_input_tokens)) {
			enriched = { ...enriched, context_length: enriched.max_input_tokens };
		}
		result[targetKey] = applyKnownArchitecture(enriched, targetKey);
	}

	return result;
}

function hasReasoningMetadata(entry: ModelParameterEntry | undefined): boolean {
	if (!entry) return false;
	return [
		entry.supports_reasoning,
		entry.supports_reasoning_effort,
		entry.is_reasoning_model,
		entry.always_reasoning,
		entry.reasoning_required,
	].some((value) => value !== undefined) || (entry.reasoning_effort_levels?.length ?? 0) > 0;
}

function hasToolMetadata(entry: ModelParameterEntry | undefined): boolean {
	if (!entry) return false;
	return entry.supports_function_calling !== undefined ||
		entry.supports_parallel_function_calling !== undefined ||
		entry.supports_tool_choice !== undefined ||
		entry.model_parameters?.some((item) => /tool|function/u.test(item.id?.toLowerCase() ?? "")) === true;
}

function mergeParameterHint(target: ModelParameterEntry | undefined, hint: ModelParameterEntry): ModelParameterEntry {
	const sources: DatasheetCapabilitySources = { ...(target?._pifrost_sources ?? {}) };
	if (!hasReasoningMetadata(target) && hasReasoningMetadata(hint)) sources.reasoning = "vendor-override";
	if (!(target?.reasoning_effort_levels?.length) && (hint.reasoning_effort_levels?.length ?? 0) > 0) {
		sources.reasoningEfforts = "vendor-override";
	}
	if (!hasToolMetadata(target) && hasToolMetadata(hint)) sources.tools = "vendor-override";
	if (!positive(target?.max_output_tokens) && positive(hint.max_output_tokens)) sources.maxTokens = "vendor-override";

	return {
		...hint,
		...target,
		model_parameters: target?.model_parameters ?? hint.model_parameters,
		reasoning_effort_levels: target?.reasoning_effort_levels ?? hint.reasoning_effort_levels,
		reasoning_effort_renames: target?.reasoning_effort_renames ?? hint.reasoning_effort_renames,
		...(Object.keys(sources).length ? { _pifrost_sources: sources } : {}),
	};
}

interface ParameterHint {
	family: string;
	qualified: string;
	value: ModelParameterEntry;
}

/**
 * Fill narrowly-scoped capability facts that are documented upstream but may
 * lag in Bifrost's model-parameters feed. Existing Bifrost values always win.
 * Qualified identities prevent a same-named model from another vendor from
 * receiving the hint accidentally.
 */
export function normalizeModelParametersDatasheet(sheet: ModelParametersDatasheet): ModelParametersDatasheet {
	const result: ModelParametersDatasheet = { ...sheet };
	const hints: ParameterHint[] = [
		{ family: "gpt-5.6-luna", qualified: "openai/gpt-5.6-luna", value: { provider: "openai", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"], supports_function_calling: true } },
		{ family: "gpt-5.6-terra", qualified: "openai/gpt-5.6-terra", value: { provider: "openai", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"], supports_function_calling: true } },
		{ family: "gpt-5.6-sol", qualified: "openai/gpt-5.6-sol", value: { provider: "openai", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["none", "low", "medium", "high", "xhigh", "max"], supports_function_calling: true } },
		{ family: "deepseek-v4-flash", qualified: "deepseek/deepseek-v4-flash", value: { provider: "deepseek", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["high", "max"], supports_function_calling: true } },
		{ family: "deepseek-v4-pro", qualified: "deepseek/deepseek-v4-pro", value: { provider: "deepseek", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["high", "max"], supports_function_calling: true } },
		{ family: "deepseek-v4-flash-vision-exp", qualified: "deepseek/deepseek-v4-flash-vision-exp", value: { provider: "deepseek", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["high", "xhigh"], supports_function_calling: true } },
		{ family: "ox-alpha", qualified: "stealth/ox-alpha", value: { supports_reasoning: true, supports_reasoning_effort: true, reasoning_required: true, reasoning_effort_levels: ["low", "high", "max"], supports_function_calling: true } },
		{ family: "gemini-3.7-flash", qualified: "google/gemini-3.7-flash", value: { provider: "google", supports_reasoning: true, supports_function_calling: true } },
		{ family: "glm-5.2", qualified: "zai/glm-5.2", value: { provider: "zai", supports_reasoning: true, supports_reasoning_effort: true, reasoning_effort_levels: ["high", "max"], supports_function_calling: true } },
		{ family: "mimo-v2.5", qualified: "xiaomi/mimo-v2.5", value: { provider: "xiaomi", supports_reasoning: true, supports_function_calling: true } },
		{ family: "mimo-v2.5-pro", qualified: "xiaomi/mimo-v2.5-pro", value: { provider: "xiaomi", supports_reasoning: true, supports_function_calling: true } },
		{ family: "kimi-k2.7-code", qualified: "moonshotai/kimi-k2.7-code", value: { supports_reasoning: true, supports_function_calling: true } },
	];

	for (const hint of hints) {
		result[hint.family] = mergeParameterHint(result[hint.family], hint.value);
		for (const [key, value] of Object.entries(result)) {
			const identities = [key, value.base_model].filter((candidate): candidate is string => Boolean(candidate));
			if (identities.some((candidate) => equivalentModelId(candidate, hint.qualified))) {
				result[key] = mergeParameterHint(value, hint.value);
			}
		}
	}
	return result;
}
