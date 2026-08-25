import type { Effort as OmpEffort, Model as OmpModel } from "@oh-my-pi/pi-ai";

import {
	findCatalogCapabilityFallback,
	findVendorCapabilityOverride,
	modelIdentityCandidates,
	equivalentModelId,
	type CatalogCapabilityFallback,
	type CatalogModelLike,
} from "./catalog-fallback.ts";
import {
	resolveAliasReferenceDetailed,
	type BifrostProviderModel,
	type CapabilityKey,
	type CapabilityProvenance,
	type CapabilitySource,
	type PifrostAliasConfig,
	type RouteMemberCapabilityDiagnostic,
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

export interface DatasheetCapabilitySources {
	contextWindow?: CapabilitySource;
	maxTokens?: CapabilitySource;
	image?: CapabilitySource;
	reasoning?: CapabilitySource;
	reasoningEfforts?: CapabilitySource;
	tools?: CapabilitySource;
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
	/** Internal provenance added by pricing-normalize.ts; never sent upstream. */
	_pifrost_sources?: DatasheetCapabilitySources;
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
	/** Internal provenance added by pricing-normalize.ts; never sent upstream. */
	_pifrost_sources?: DatasheetCapabilitySources;
}

export type PricingDatasheet = Record<string, PricingDatasheetEntry>;
export type ModelParametersDatasheet = Record<string, ModelParameterEntry>;

export interface BifrostDatasheets {
	pricing: PricingDatasheet;
	parameters: ModelParametersDatasheet;
}

export interface RichRouteDiagnostic extends RouteMemberCapabilityDiagnostic {
	pricingKey?: string;
	parametersKey?: string;
	fallbackMatches?: string[];
	status: "ok" | "fallback-catalog" | "not-live" | "missing-pricing";
}

export interface RichRouteCatalog {
	models: BifrostProviderModel[];
	diagnostics: RichRouteDiagnostic[];
}

interface MatchedEntry<T> {
	key: string;
	value: T;
	score: number;
	source: "bifrost-datasheet" | "canonical-family";
}

interface Selected<T> {
	value?: T;
	source?: CapabilitySource;
}

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

/**
 * Build provider-qualified, progressively stripped and known-equivalent model
 * identifiers. Equivalence stays deliberately narrow: arbitrary `-free`
 * variants are never merged automatically.
 */
export function modelReferenceCandidates(...values: Array<string | undefined>): string[] {
	return modelIdentityCandidates(...values);
}

function providerHint(reference: string): string | undefined {
	const slash = reference.indexOf("/");
	return slash > 0 ? normalized(reference.slice(0, slash)) : undefined;
}

function exactPathMatch(left: string, right: string): boolean {
	const leftNormalized = normalized(left);
	const rightNormalized = normalized(right);
	return leftNormalized === rightNormalized ||
		leftNormalized.endsWith(`/${rightNormalized}`) ||
		rightNormalized.endsWith(`/${leftNormalized}`);
}

function matchScore<T extends { provider?: string; base_model?: string; mode?: string }>(
	key: string,
	entry: T,
	reference: string,
	liveModelId?: string,
): { score: number; source: MatchedEntry<T>["source"] } | undefined {
	if (entry.mode && normalized(entry.mode) !== "chat") return undefined;
	const targets = [reference, liveModelId].filter((value): value is string => Boolean(value));
	let score = -1;
	let source: MatchedEntry<T>["source"] = "canonical-family";

	for (const target of targets) {
		if (normalized(key) === normalized(target)) {
			score = Math.max(score, 1_000);
			source = "bifrost-datasheet";
			continue;
		}
		if (!equivalentModelId(target, key) && !(entry.base_model && equivalentModelId(target, entry.base_model))) continue;
		if (exactPathMatch(key, target)) score = Math.max(score, 900);
		else if (entry.base_model && exactPathMatch(entry.base_model, target)) score = Math.max(score, 800);
		else score = Math.max(score, 600);
	}
	if (score < 0) return undefined;

	const hint = providerHint(reference);
	if (hint && entry.provider && normalized(entry.provider) === hint) {
		score += 50;
		if (score >= 900) source = "bifrost-datasheet";
	}
	return { score, source };
}

export function findDatasheetEntry<T extends { provider?: string; base_model?: string; mode?: string }>(
	sheet: Record<string, T>,
	reference: string,
	liveModelId?: string,
): MatchedEntry<T> | undefined {
	let best: MatchedEntry<T> | undefined;
	for (const [key, value] of Object.entries(sheet)) {
		const match = matchScore(key, value, reference, liveModelId);
		if (!match) continue;
		const candidate: MatchedEntry<T> = { key, value, ...match };
		if (!best || candidate.score > best.score ||
			(candidate.score === best.score && candidate.key.length < best.key.length)) {
			best = candidate;
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

function hasReasoningMetadata(parameters: ModelParameterEntry | undefined): boolean {
	if (!parameters) return false;
	return [
		parameters.supports_reasoning,
		parameters.supports_reasoning_effort,
		parameters.is_reasoning_model,
		parameters.always_reasoning,
		parameters.reasoning_required,
	].some((value) => value !== undefined) ||
		(parameters.reasoning_effort_levels?.length ?? 0) > 0 ||
		parameters.model_parameters?.some((item) => item.id?.toLowerCase().includes("reasoning")) === true;
}

function reasoningFromParameters(parameters: ModelParameterEntry | undefined): boolean {
	if (!parameters) return false;
	return Boolean(
		parameters.supports_reasoning ||
		parameters.supports_reasoning_effort ||
		parameters.is_reasoning_model ||
		parameters.always_reasoning ||
		parameters.reasoning_required ||
		(parameters.reasoning_effort_levels?.length ?? 0) > 0 ||
		parameters.model_parameters?.some((item) => item.id?.toLowerCase().includes("reasoning")),
	);
}

function hasToolMetadata(parameters: ModelParameterEntry | undefined): boolean {
	if (!parameters) return false;
	return parameters.supports_function_calling !== undefined ||
		parameters.supports_parallel_function_calling !== undefined ||
		parameters.supports_tool_choice !== undefined ||
		parameters.model_parameters?.some((item) => /tool|function/u.test(item.id?.toLowerCase() ?? "")) === true;
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

function fallbackSource(fallback: CatalogCapabilityFallback | undefined): CapabilitySource | undefined {
	if (!fallback) return undefined;
	if (fallback.source === "verified-model-hint") return "vendor-override";
	if (fallback.source === "omp-catalog-family") return "canonical-family";
	return "fallback";
}

function sheetSource(
	match: MatchedEntry<PricingDatasheetEntry> | MatchedEntry<ModelParameterEntry> | undefined,
	key: CapabilityKey,
): CapabilitySource | undefined {
	if (!match) return undefined;
	return match.value._pifrost_sources?.[key] ?? match.source;
}

function selectNumber(
	liveValue: number,
	liveSource: CapabilitySource | undefined,
	sheetValue: number | undefined,
	sheetCapabilitySource: CapabilitySource | undefined,
	vendorValue: number | undefined,
	catalogValue: number | undefined,
	catalogSource: CapabilitySource | undefined,
): Selected<number> {
	if (liveSource === "live" && positiveInteger(liveValue)) return { value: liveValue, source: "live" };
	const sheet = positiveInteger(sheetValue);
	if (sheet) return { value: sheet, source: sheetCapabilitySource ?? "bifrost-datasheet" };
	const vendor = positiveInteger(vendorValue);
	if (vendor) return { value: vendor, source: "vendor-override" };
	const catalog = positiveInteger(catalogValue);
	if (catalog) return { value: catalog, source: catalogSource ?? "fallback" };
	return {};
}

function selectImage(
	liveModel: BifrostProviderModel,
	pricing: MatchedEntry<PricingDatasheetEntry> | undefined,
	vendor: CatalogCapabilityFallback | undefined,
	catalog: CatalogCapabilityFallback | undefined,
): Selected<boolean> {
	if (liveModel.capabilitySources?.image === "live") {
		return { value: liveModel.input.includes("image"), source: "live" };
	}
	const modalities = pricing?.value.architecture?.input_modalities?.map(normalized) ?? [];
	if (modalities.length) {
		return {
			value: modalities.some((modality) => modality.includes("image")),
			source: sheetSource(pricing, "image") ?? "bifrost-datasheet",
		};
	}
	if (vendor) return { value: vendor.input.includes("image"), source: "vendor-override" };
	if (catalog) return { value: catalog.input.includes("image"), source: fallbackSource(catalog) };
	return { value: false };
}

function selectReasoning(
	liveModel: BifrostProviderModel,
	parameters: MatchedEntry<ModelParameterEntry> | undefined,
	vendor: CatalogCapabilityFallback | undefined,
	catalog: CatalogCapabilityFallback | undefined,
): Selected<boolean> {
	if (liveModel.capabilitySources?.reasoning === "live") return { value: liveModel.reasoning, source: "live" };
	if (hasReasoningMetadata(parameters?.value)) {
		return {
			value: reasoningFromParameters(parameters?.value),
			source: sheetSource(parameters, "reasoning") ?? "bifrost-datasheet",
		};
	}
	if (vendor) return { value: vendor.reasoning, source: "vendor-override" };
	if (catalog) return { value: catalog.reasoning, source: fallbackSource(catalog) };
	return { value: false };
}

function selectThinking(
	liveModel: BifrostProviderModel,
	parameters: MatchedEntry<ModelParameterEntry> | undefined,
	vendor: CatalogCapabilityFallback | undefined,
	catalog: CatalogCapabilityFallback | undefined,
): Selected<OmpThinkingConfig> {
	if (liveModel.capabilitySources?.reasoningEfforts === "live" && liveModel.thinking) {
		return { value: liveModel.thinking, source: "live" };
	}
	const parameterThinking = thinkingFromParameters(parameters?.value);
	if (parameterThinking) {
		return {
			value: parameterThinking,
			source: sheetSource(parameters, "reasoningEfforts") ?? "bifrost-datasheet",
		};
	}
	if (vendor?.thinking) return { value: vendor.thinking, source: "vendor-override" };
	if (catalog?.thinking) return { value: catalog.thinking, source: fallbackSource(catalog) };
	return {};
}

function selectTools(
	liveModel: BifrostProviderModel,
	parameters: MatchedEntry<ModelParameterEntry> | undefined,
	vendor: CatalogCapabilityFallback | undefined,
	catalog: CatalogCapabilityFallback | undefined,
): Selected<boolean> {
	if (liveModel.capabilitySources?.tools === "live") return { value: liveModel.supportsTools, source: "live" };
	if (hasToolMetadata(parameters?.value)) {
		return {
			value: toolsFromParameters(parameters?.value),
			source: sheetSource(parameters, "tools") ?? "bifrost-datasheet",
		};
	}
	if (vendor) return { value: vendor.supportsTools, source: "vendor-override" };
	if (catalog) return { value: catalog.supportsTools, source: fallbackSource(catalog) };
	return { value: false };
}

export function buildRichRouteCatalog(
	liveModels: readonly BifrostProviderModel[],
	aliasConfig: PifrostAliasConfig,
	datasheets: BifrostDatasheets,
	catalogOverride?: readonly CatalogModelLike[],
): RichRouteCatalog {
	const models: BifrostProviderModel[] = [];
	const diagnostics: RichRouteDiagnostic[] = [];

	for (const reference of routeReferences(aliasConfig)) {
		const liveResolution = resolveAliasReferenceDetailed(reference, liveModels);
		const liveModel = liveResolution.model;
		if (!liveModel) {
			diagnostics.push({
				reference,
				status: "not-live",
				resolution: liveResolution.kind,
				reason: liveResolution.reason === "ambiguous"
					? `ambiguous live model identity: ${liveResolution.ambiguousIds?.join(", ")}`
					: "no equivalent model was found in Bifrost /v1/models",
			});
			continue;
		}

		const pricing = findDatasheetEntry(datasheets.pricing, reference, liveModel.id);
		const parameters = findDatasheetEntry(datasheets.parameters, reference, liveModel.id);
		const vendor = findVendorCapabilityOverride(reference, liveModel.id);
		const catalog = findCatalogCapabilityFallback(reference, liveModel.id, catalogOverride);
		const catalogCapabilitySource = fallbackSource(catalog);

		const context = selectNumber(
			liveModel.contextWindow,
			liveModel.capabilitySources?.contextWindow,
			positiveInteger(pricing?.value.context_length, pricing?.value.max_input_tokens),
			sheetSource(pricing, "contextWindow"),
			vendor?.contextWindow,
			catalog?.contextWindow,
			catalogCapabilitySource,
		);
		const output = selectNumber(
			liveModel.maxTokens,
			liveModel.capabilitySources?.maxTokens,
			positiveInteger(pricing?.value.max_output_tokens, parameters?.value.max_output_tokens, pricing?.value.max_tokens),
			positiveInteger(pricing?.value.max_output_tokens, pricing?.value.max_tokens)
				? sheetSource(pricing, "maxTokens")
				: sheetSource(parameters, "maxTokens"),
			vendor?.maxTokens,
			catalog?.maxTokens,
			catalogCapabilitySource,
		);

		if (!context.value || !output.value) {
			const missing = [!context.value ? "context limit" : undefined, !output.value ? "output limit" : undefined]
				.filter((value): value is string => Boolean(value));
			diagnostics.push({
				reference,
				liveModelId: liveModel.id,
				resolution: liveResolution.kind,
				pricingKey: pricing?.key,
				parametersKey: parameters?.key,
				fallbackMatches: unique([...(vendor?.matched ?? []), ...(catalog?.matched ?? [])]),
				status: "missing-pricing",
				reason: `no safe authoritative ${missing.join(" and ")} could be established; generic /v1 defaults are ignored`,
				sources: {
					contextWindow: context.source,
					maxTokens: output.source,
				},
			});
			continue;
		}

		const image = selectImage(liveModel, pricing, vendor, catalog);
		const reasoning = selectReasoning(liveModel, parameters, vendor, catalog);
		const thinking = reasoning.value ? selectThinking(liveModel, parameters, vendor, catalog) : {};
		const tools = selectTools(liveModel, parameters, vendor, catalog);
		const inputCost = perMillion(pricing?.value.input_cost_per_token) ?? liveModel.cost.input ?? vendor?.cost.input ?? catalog?.cost.input ?? 0;
		const outputCost = perMillion(pricing?.value.output_cost_per_token) ?? liveModel.cost.output ?? vendor?.cost.output ?? catalog?.cost.output ?? 0;
		const cacheRead = perMillion(pricing?.value.cache_read_input_token_cost) ?? liveModel.cost.cacheRead ?? vendor?.cost.cacheRead ?? catalog?.cost.cacheRead ?? inputCost;
		const cacheWrite = perMillion(pricing?.value.cache_creation_input_token_cost) ?? liveModel.cost.cacheWrite ?? vendor?.cost.cacheWrite ?? catalog?.cost.cacheWrite ?? inputCost;
		const sources: CapabilityProvenance = {
			contextWindow: context.source,
			maxTokens: output.source,
			image: image.source,
			reasoning: reasoning.source,
			reasoningEfforts: thinking.source,
			tools: tools.source,
		};

		models.push({
			...liveModel,
			// Keep each Bifrost route member distinct. The alias synthesizer therefore
			// cannot collapse two provider routes that serve the same underlying model.
			id: reference,
			name: reference,
			contextWindow: context.value,
			maxTokens: Math.min(context.value, output.value),
			input: image.value ? ["text", "image"] : ["text"],
			reasoning: Boolean(reasoning.value),
			thinking: reasoning.value ? thinking.value : undefined,
			supportsTools: Boolean(tools.value),
			capabilitySources: sources,
			cost: {
				input: inputCost,
				output: outputCost,
				cacheRead,
				cacheWrite,
			},
			compat: {
				...liveModel.compat,
				supportsDeveloperRole: false,
				supportsReasoningEffort: Boolean(reasoning.value && thinking.value),
				supportsUsageInStreaming: catalog?.supportsUsageInStreaming ?? liveModel.compat.supportsUsageInStreaming,
			},
		});

		const usesCatalogFallback = Object.values(sources).some((source) => source === "fallback");
		diagnostics.push({
			reference,
			liveModelId: liveModel.id,
			resolution: liveResolution.kind,
			pricingKey: pricing?.key,
			parametersKey: parameters?.key,
			fallbackMatches: unique([...(vendor?.matched ?? []), ...(catalog?.matched ?? [])]),
			status: usesCatalogFallback ? "fallback-catalog" : "ok",
			sources,
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
