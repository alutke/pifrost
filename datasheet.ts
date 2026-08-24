import type { Effort as OmpEffort, Model as OmpModel } from "@oh-my-pi/pi-ai";

import {
	resolveAliasReference,
	type BifrostProviderModel,
	type PifrostAliasConfig,
} from "./index.ts";

export const BIFROST_PRICING_DATASHEET_URL = "https://getbifrost.ai/datasheet";
export const BIFROST_MODEL_PARAMETERS_URL = "https://getbifrost.ai/datasheet/model-parameters";

const EFFORT_NAMES = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

type Fetch = typeof globalThis.fetch;
type EffortName = (typeof EFFORT_NAMES)[number];
type OmpThinkingConfig = NonNullable<OmpModel["thinking"]>;

export interface DatasheetArchitecture {
	input_modalities?: string[];
	output_modalities?: string[];
}

export interface PricingDatasheetEntry {
	provider?: string;
	mode?: string;
	base_model?: string;
	context_length?: number;
	max_input_tokens?: number;
	max_output_tokens?: number;
	max_tokens?: number;
	architecture?: DatasheetArchitecture;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	cache_creation_input_token_cost?: number;
	cache_read_input_token_cost?: number;
}

export interface ModelParameterDescriptor {
	id?: string;
}

export interface ModelParameterEntry {
	provider?: string;
	mode?: string;
	base_model?: string;
	supports_function_calling?: boolean;
	supports_parallel_function_calling?: boolean;
	supports_tool_choice?: boolean;
	supports_reasoning?: boolean;
	supports_reasoning_effort?: boolean;
	supports_reasoning_disable?: boolean;
	supports_none_reasoning_effort?: boolean;
	is_reasoning_model?: boolean;
	always_reasoning?: boolean;
	reasoning_required?: boolean;
	reasoning_effort_levels?: string[];
	reasoning_effort_renames?: Record<string, string>;
	max_output_tokens?: number;
	model_parameters?: ModelParameterDescriptor[];
	supported_endpoints?: string[];
}

export type PricingDatasheet = Record<string, PricingDatasheetEntry>;
export type ModelParametersDatasheet = Record<string, ModelParameterEntry>;

export interface BifrostDatasheets {
	pricing: PricingDatasheet;
	parameters: ModelParametersDatasheet;
}

export interface RichRouteDiagnostic {
	reference: string;
	liveModelId?: string;
	pricingKey?: string;
	parametersKey?: string;
	status: "ok" | "not-live" | "missing-pricing";
}

export interface RichRouteCatalog {
	models: BifrostProviderModel[];
	diagnostics: RichRouteDiagnostic[];
}

interface MatchedEntry<T> {
	key: string;
	value: T;
	score: number;
}

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

/**
 * Build the same useful identifier family Bifrost itself uses for catalog lookup:
 * exact provider-qualified form, progressively provider-stripped forms, then bare model name.
 */
export function modelReferenceCandidates(...values: Array<string | undefined>): string[] {
	const candidates: string[] = [];
	for (const raw of values) {
		if (!raw) continue;
		let current = normalized(raw);
		if (!current) continue;
		while (current) {
			candidates.push(current);
			const slash = current.indexOf("/");
			if (slash < 0) break;
			current = current.slice(slash + 1);
		}
	}
	return unique(candidates);
}

function modelTail(value: string): string {
	const parts = normalized(value).split("/");
	return parts[parts.length - 1] ?? normalized(value);
}

function providerHint(reference: string): string | undefined {
	const slash = reference.indexOf("/");
	return slash > 0 ? normalized(reference.slice(0, slash)) : undefined;
}

function matchScore<T extends { provider?: string; base_model?: string; mode?: string }>(
	key: string,
	entry: T,
	candidates: readonly string[],
	reference: string,
): number {
	const normalizedKey = normalized(key);
	if (entry.mode && normalized(entry.mode) !== "chat") return -1;

	let score = -1;
	for (const candidate of candidates) {
		if (normalizedKey === candidate) score = Math.max(score, 100);
		if (normalizedKey.endsWith(`/${candidate}`)) score = Math.max(score, 90);
		if (candidate.endsWith(`/${normalizedKey}`)) score = Math.max(score, 85);
		if (modelTail(normalizedKey) === modelTail(candidate)) score = Math.max(score, 60);
		if (entry.base_model && normalized(entry.base_model) === modelTail(candidate)) score = Math.max(score, 55);
	}

	const hint = providerHint(reference);
	if (score >= 0 && hint && entry.provider && normalized(entry.provider) === hint) score += 20;
	return score;
}

export function findDatasheetEntry<T extends { provider?: string; base_model?: string; mode?: string }>(
	sheet: Record<string, T>,
	reference: string,
	liveModelId?: string,
): MatchedEntry<T> | undefined {
	const candidates = modelReferenceCandidates(reference, liveModelId);
	let best: MatchedEntry<T> | undefined;
	for (const [key, value] of Object.entries(sheet)) {
		const score = matchScore(key, value, candidates, reference);
		if (score < 0) continue;
		if (!best || score > best.score || (score === best.score && key.length < best.key.length)) {
			best = { key, value, score };
		}
	}
	return best;
}

function positiveInteger(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	}
	return undefined;
}

function perMillion(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
	return value <= 0.01 ? value * 1_000_000 : value;
}

function effortName(value: string): EffortName | undefined {
	const candidate = normalized(value);
	return EFFORT_NAMES.find((effort) => effort === candidate);
}

function thinkingFromParameters(parameters: ModelParameterEntry | undefined): OmpThinkingConfig | undefined {
	if (!parameters) return undefined;
	const names = unique((parameters.reasoning_effort_levels ?? []).map(effortName).filter((v): v is EffortName => Boolean(v)));
	if (names.length === 0) return undefined;

	const effortMap = Object.fromEntries(
		names.map((name) => [name, parameters.reasoning_effort_renames?.[name] ?? name]),
	) as OmpThinkingConfig["effortMap"];

	return {
		mode: "effort",
		efforts: names as unknown as readonly OmpEffort[],
		effortMap,
		...(parameters.reasoning_required ? { requiresEffort: true } : {}),
	};
}

function reasoningFromParameters(parameters: ModelParameterEntry | undefined): boolean {
	if (!parameters) return false;
	return Boolean(
		parameters.supports_reasoning ||
		parameters.supports_reasoning_effort ||
		parameters.is_reasoning_model ||
		parameters.always_reasoning ||
		(parameters.reasoning_effort_levels?.length ?? 0) > 0 ||
		parameters.model_parameters?.some((item) => item.id?.toLowerCase().includes("reasoning")),
	);
}

function toolsFromParameters(parameters: ModelParameterEntry | undefined): boolean {
	if (!parameters) return false;
	return Boolean(
		parameters.supports_function_calling ||
		parameters.supports_parallel_function_calling ||
		parameters.supports_tool_choice ||
		parameters.model_parameters?.some((item) => /tool|function/u.test(item.id?.toLowerCase() ?? "")),
	);
}

function routeReferences(aliasConfig: PifrostAliasConfig): string[] {
	const result: string[] = [];
	for (const definition of Object.values(aliasConfig.aliases)) {
		const chain = Array.isArray(definition) ? definition : definition.chain;
		result.push(...chain);
	}
	return unique(result);
}

export function buildRichRouteCatalog(
	liveModels: readonly BifrostProviderModel[],
	aliasConfig: PifrostAliasConfig,
	datasheets: BifrostDatasheets,
): RichRouteCatalog {
	const models: BifrostProviderModel[] = [];
	const diagnostics: RichRouteDiagnostic[] = [];

	for (const reference of routeReferences(aliasConfig)) {
		const liveModel = resolveAliasReference(reference, liveModels);
		if (!liveModel) {
			diagnostics.push({ reference, status: "not-live" });
			continue;
		}

		const pricing = findDatasheetEntry(datasheets.pricing, reference, liveModel.id);
		if (!pricing) {
			diagnostics.push({ reference, liveModelId: liveModel.id, status: "missing-pricing" });
			continue;
		}
		const parameters = findDatasheetEntry(datasheets.parameters, reference, liveModel.id);

		const contextWindow = positiveInteger(
			pricing.value.context_length,
			pricing.value.max_input_tokens && pricing.value.max_output_tokens
				? pricing.value.max_input_tokens + pricing.value.max_output_tokens
				: undefined,
			pricing.value.max_input_tokens,
		);
		const maxTokens = positiveInteger(
			pricing.value.max_output_tokens,
			parameters?.value.max_output_tokens,
			pricing.value.max_tokens,
		);

		// A context envelope is the central reason Pifrost exists. Do not publish a route
		// member if the authoritative Bifrost datasheet cannot give both limits.
		if (!contextWindow || !maxTokens) {
			diagnostics.push({
				reference,
				liveModelId: liveModel.id,
				pricingKey: pricing.key,
				parametersKey: parameters?.key,
				status: "missing-pricing",
			});
			continue;
		}

		const inputModalities = pricing.value.architecture?.input_modalities?.map(normalized) ?? [];
		const reasoning = reasoningFromParameters(parameters?.value) || liveModel.reasoning;
		const thinking = thinkingFromParameters(parameters?.value) ?? liveModel.thinking;
		const inputCost = perMillion(pricing.value.input_cost_per_token) ?? liveModel.cost.input;
		const outputCost = perMillion(pricing.value.output_cost_per_token) ?? liveModel.cost.output;

		models.push({
			...liveModel,
			// Keep each Bifrost route member distinct. The alias synthesizer therefore
			// cannot accidentally collapse two provider routes that serve the same model ID.
			id: reference,
			name: reference,
			contextWindow,
			maxTokens: Math.min(contextWindow, maxTokens),
			input: inputModalities.some((modality) => modality.includes("image"))
				? ["text", "image"]
				: ["text"],
			reasoning,
			thinking: reasoning ? thinking : undefined,
			supportsTools: toolsFromParameters(parameters?.value) || liveModel.supportsTools,
			cost: {
				input: inputCost,
				output: outputCost,
				cacheRead: perMillion(pricing.value.cache_read_input_token_cost) ?? inputCost,
				cacheWrite: perMillion(pricing.value.cache_creation_input_token_cost) ?? inputCost,
			},
			compat: {
				...liveModel.compat,
				supportsDeveloperRole: false,
				supportsReasoningEffort: Boolean(thinking),
			},
		});
		diagnostics.push({
			reference,
			liveModelId: liveModel.id,
			pricingKey: pricing.key,
			parametersKey: parameters?.key,
			status: "ok",
		});
	}

	return { models, diagnostics };
}

async function fetchJsonObject<T>(url: string, fetchImpl: Fetch, signal?: AbortSignal): Promise<Record<string, T>> {
	const response = await fetchImpl(url, {
		headers: { Accept: "application/json" },
		signal,
	});
	if (!response.ok) throw new Error(`Bifrost datasheet fetch failed (${response.status}) for ${url}`);
	const body = await response.json();
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error(`Bifrost datasheet returned invalid JSON object for ${url}`);
	}
	return body as Record<string, T>;
}

let cachedDatasheets: { expiresAt: number; value: BifrostDatasheets } | undefined;

export async function fetchBifrostDatasheets(options: {
	fetch?: Fetch;
	signal?: AbortSignal;
	cacheTtlMs?: number;
} = {}): Promise<BifrostDatasheets> {
	const now = Date.now();
	if (cachedDatasheets && cachedDatasheets.expiresAt > now) return cachedDatasheets.value;

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const [pricing, parameters] = await Promise.all([
		fetchJsonObject<PricingDatasheetEntry>(BIFROST_PRICING_DATASHEET_URL, fetchImpl, options.signal),
		fetchJsonObject<ModelParameterEntry>(BIFROST_MODEL_PARAMETERS_URL, fetchImpl, options.signal),
	]);
	const value = { pricing, parameters };
	cachedDatasheets = { expiresAt: now + (options.cacheTtlMs ?? 15 * 60_000), value };
	return value;
}
