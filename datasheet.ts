import type { Effort as OmpEffort, Model as OmpModel } from "@oh-my-pi/pi-ai";
import type { PeakHoursSchedule, RoutePricingDiagnostic } from "./pricing-time.ts";
import { resolvePifrostReasoningWithToolsPolicy } from "./transport-model.ts";
import { confirmedProviderOutputCeiling } from "./endpoint-contracts.ts";
import {
	wireProtocolsFrom,
	type PifrostWireProtocol,
} from "./protocol-capability.ts";

import {
	findCatalogCapabilityFallback,
	findCatalogProtocolCapability,
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
	toolChoice?: CapabilitySource;
	forcedToolChoice?: CapabilitySource;
	namedToolChoice?: CapabilitySource;
	reasoningWithTools?: CapabilitySource;
	toolSearch?: CapabilitySource;
	betweenToolsThinking?: CapabilitySource;
	serviceTier?: CapabilitySource;
	serviceTiers?: CapabilitySource;
	pricingStatus?: CapabilitySource;
	protocol?: CapabilitySource;
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
	off_peak_cost_multiplier?: number;
	peak_hours?: PeakHoursSchedule;
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
	supports_forced_tool_choice?: boolean;
	supports_reasoning_with_tool_calls?: boolean;
	supports_tool_search?: boolean;
	supports_between_tools_thinking?: boolean;
	supports_service_tier?: boolean;
	service_tiers?: string[];
	tool_choice_struct_supported?: boolean;
	unsupported_fields?: Record<string, boolean>;
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

function routeProvider(reference: string): string | undefined {
	const slash = reference.indexOf("/");
	return slash > 0 ? normalized(reference.slice(0, slash)) : undefined;
}

function routeModelId(reference: string): string {
	const slash = reference.indexOf("/");
	return slash >= 0 ? reference.slice(slash + 1) : reference;
}

function ompPolicyProvider(reference: string): string | undefined {
	switch (routeProvider(reference)) {
		case "openai": return "openai";
		case "openai-codex": return "openai-codex";
		case "azure": return "azure";
		case "azure-openai": return "azure-openai";
		case "deepseek": return "deepseek";
		case "openrouter": return "openrouter";
		case "opencode-go": return "opencode-go";
		case "opencode-zen": return "opencode-zen";
		case "xiaomi mimo":
		case "xiaomi": return "xiaomi";
		case "commandcode goat":
		case "commandcode": return "commandcode";
		default: return undefined;
	}
}

/**
 * Resolve the actual OMP runtime policy for the physical provider/model route.
 * This deliberately does not infer policy by intersecting bundled catalogue
 * rows: one Bifrost provider may map to several OMP catalogue families.
 */
export function resolveRouteReasoningWithToolsPolicy(
	reference: string,
	liveModelId: string | undefined,
	protocols: readonly PifrostWireProtocol[] | undefined,
): boolean | undefined {
	const provider = ompPolicyProvider(reference);
	if (!provider) return undefined;

	const modelIds = unique([
		routeModelId(reference),
		...(liveModelId ? [routeModelId(liveModelId)] : []),
	].filter(Boolean));
	const candidateProtocols = (protocols?.length ? protocols : ["openai-completions"])
		.filter((protocol): protocol is "openai-completions" | "openai-responses" =>
			protocol === "openai-completions" || protocol === "openai-responses",
		);
	if (!candidateProtocols.length) return undefined;

	const resolved: boolean[] = [];
	for (const protocol of candidateProtocols) {
		let value: boolean | undefined;
		for (const modelId of modelIds) {
			value = resolvePifrostReasoningWithToolsPolicy(provider, modelId, protocol);
			if (value !== undefined) break;
		}
		if (value === undefined) return undefined;
		resolved.push(value);
	}
	return resolved.some((value) => value === false) ? false : true;
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

function toolChoiceFromParameters(parameters: ModelParameterEntry | undefined): boolean | undefined {
	if (!parameters) return undefined;
	if (parameters.supports_tool_choice !== undefined) return parameters.supports_tool_choice;
	if (parameters.model_parameters?.some((item) => item.id?.toLowerCase() === "tool_choice")) return true;
	return undefined;
}

function forcedToolChoiceFromParameters(parameters: ModelParameterEntry | undefined): boolean | undefined {
	return parameters?.supports_forced_tool_choice;
}

function namedToolChoiceFromParameters(parameters: ModelParameterEntry | undefined): boolean | undefined {
	if (!parameters) return undefined;
	if (parameters.tool_choice_struct_supported !== undefined) return parameters.tool_choice_struct_supported;
	if (parameters.unsupported_fields?.tool_choice_struct === true) return false;
	return undefined;
}

function reasoningWithToolsFromParameters(parameters: ModelParameterEntry | undefined): boolean | undefined {
	return parameters?.supports_reasoning_with_tool_calls;
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

function routePricingDiagnostic(
	pricing: MatchedEntry<PricingDatasheetEntry> | undefined,
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number },
): RoutePricingDiagnostic {
	const hasDatasheetRate = [
		pricing?.value.input_cost_per_token,
		pricing?.value.output_cost_per_token,
		pricing?.value.cache_read_input_token_cost,
		pricing?.value.cache_creation_input_token_cost,
	].some((value) => typeof value === "number" && Number.isFinite(value));
	const source: RoutePricingDiagnostic["source"] = hasDatasheetRate
		? (pricing?.source ?? "bifrost-datasheet")
		: "live";
	return {
		...(pricing?.key ? { pricingKey: pricing.key } : {}),
		source,
		peakCost: { ...cost },
		...(typeof pricing?.value.off_peak_cost_multiplier === "number"
			? { offPeakCostMultiplier: pricing.value.off_peak_cost_multiplier }
			: {}),
		...(pricing?.value.peak_hours ? { peakHours: pricing.value.peak_hours } : {}),
	};
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

function selectBooleanCapability(
	liveValue: boolean | undefined,
	liveSource: CapabilitySource | undefined,
	sheetValue: boolean | undefined,
	sheetSourceValue: CapabilitySource | undefined,
	vendorValue: boolean | undefined,
	catalogValue: boolean | undefined,
	catalogSource: CapabilitySource | undefined,
): Selected<boolean> {
	if (liveSource === "live" && liveValue !== undefined) return { value: liveValue, source: "live" };
	if (sheetValue !== undefined) return { value: sheetValue, source: sheetSourceValue ?? "bifrost-datasheet" };
	if (vendorValue !== undefined) return { value: vendorValue, source: "vendor-override" };
	if (catalogValue !== undefined) return { value: catalogValue, source: catalogSource ?? "fallback" };
	return {};
}

/**
 * Reasoning-with-tools is a transport compatibility policy, not just a generic
 * model-family feature. OMP's provider-authored policy therefore outranks the
 * public Bifrost model-parameters sheet when both describe the same provider
 * route. This prevents stale negative datasheet rows from deleting a capable
 * physical member before Bifrost can attempt it, while preserving explicit
 * provider restrictions such as Azure models that disable reasoning with tools.
 */
function selectReasoningWithToolsCapability(
	reference: string,
	liveModel: BifrostProviderModel,
	protocols: readonly PifrostWireProtocol[] | undefined,
	parameters: MatchedEntry<ModelParameterEntry> | undefined,
	vendor: CatalogCapabilityFallback | undefined,
	catalog: CatalogCapabilityFallback | undefined,
): Selected<boolean> {
	if (
		liveModel.capabilitySources?.reasoningWithTools === "live" &&
		liveModel.compat.supportsReasoningWithTools !== undefined
	) {
		return { value: liveModel.compat.supportsReasoningWithTools, source: "live" };
	}
	const providerPolicy = resolveRouteReasoningWithToolsPolicy(reference, liveModel.id, protocols);
	if (providerPolicy !== undefined) {
		return { value: providerPolicy, source: "omp-provider-policy" };
	}
	const sheetValue = reasoningWithToolsFromParameters(parameters?.value);
	if (sheetValue !== undefined) {
		return {
			value: sheetValue,
			source: sheetSource(parameters, "reasoningWithTools") ?? "bifrost-datasheet",
		};
	}
	if (vendor?.supportsReasoningWithTools !== undefined) {
		return { value: vendor.supportsReasoningWithTools, source: "vendor-override" };
	}
	if (catalog?.supportsReasoningWithTools !== undefined) {
		return { value: catalog.supportsReasoningWithTools, source: fallbackSource(catalog) };
	}
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

function selectProtocols(
	reference: string,
	liveModel: BifrostProviderModel,
	parameters: MatchedEntry<ModelParameterEntry> | undefined,
	catalog: CatalogCapabilityFallback | undefined,
	vendor: CatalogCapabilityFallback | undefined,
): Selected<PifrostWireProtocol[]> {
	if (liveModel.capabilitySources?.protocol === "live" && liveModel.protocols?.length) {
		return { value: [...liveModel.protocols], source: "live" };
	}
	// Provider-specific OMP api-routes describe the actual gateway transport for
	// ids such as OpenCode Go Muse. They must outrank generic Bifrost/model-family
	// datasheet rows: a sibling provider may expose the same underlying model over
	// Chat while this provider requires Responses.
	const policyProtocols = findCatalogProtocolCapability(reference, liveModel.id);
	if (policyProtocols?.length) return { value: policyProtocols, source: "canonical-family" };
	const sheetProtocols = wireProtocolsFrom(parameters?.value.supported_endpoints);
	if (sheetProtocols?.length) {
		return {
			value: sheetProtocols,
			source: sheetSource(parameters, "protocol") ?? "bifrost-datasheet",
		};
	}
	// Bundled provider rows remain useful for providers whose transport is
	// encoded directly on the model rather than in a separate api-routes rule.
	if (catalog?.protocols?.length) return { value: [...catalog.protocols], source: fallbackSource(catalog) };
	if (vendor?.protocols?.length) return { value: [...vendor.protocols], source: "vendor-override" };
	return {};
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
		const protocols = selectProtocols(reference, liveModel, parameters, catalog, vendor);
		const toolChoice = selectBooleanCapability(
			liveModel.compat.supportsToolChoice,
			liveModel.capabilitySources?.toolChoice,
			toolChoiceFromParameters(parameters?.value),
			sheetSource(parameters, "toolChoice"),
			vendor?.supportsToolChoice,
			catalog?.supportsToolChoice,
			catalogCapabilitySource,
		);
		const forcedToolChoice = selectBooleanCapability(
			liveModel.compat.supportsForcedToolChoice,
			liveModel.capabilitySources?.forcedToolChoice,
			forcedToolChoiceFromParameters(parameters?.value),
			sheetSource(parameters, "forcedToolChoice"),
			vendor?.supportsForcedToolChoice,
			catalog?.supportsForcedToolChoice,
			catalogCapabilitySource,
		);
		const namedToolChoice = selectBooleanCapability(
			liveModel.compat.supportsNamedToolChoice,
			liveModel.capabilitySources?.namedToolChoice,
			namedToolChoiceFromParameters(parameters?.value),
			sheetSource(parameters, "namedToolChoice"),
			vendor?.supportsNamedToolChoice,
			catalog?.supportsNamedToolChoice,
			catalogCapabilitySource,
		);
		const reasoningWithTools = selectReasoningWithToolsCapability(
			reference,
			liveModel,
			protocols.value,
			parameters,
			vendor,
			catalog,
		);
		const toolSearch = selectBooleanCapability(
			liveModel.supportsToolSearch,
			liveModel.capabilitySources?.toolSearch,
			parameters?.value.supports_tool_search,
			sheetSource(parameters, "toolSearch"),
			vendor?.supportsToolSearch,
			catalog?.supportsToolSearch,
			catalogCapabilitySource,
		);
		const betweenToolsThinking = selectBooleanCapability(
			liveModel.compat.supportsBetweenToolsThinking,
			liveModel.capabilitySources?.betweenToolsThinking,
			parameters?.value.supports_between_tools_thinking,
			sheetSource(parameters, "betweenToolsThinking"),
			vendor?.supportsBetweenToolsThinking,
			catalog?.supportsBetweenToolsThinking,
			catalogCapabilitySource,
		);
		const serviceTier = selectBooleanCapability(
			liveModel.supportsServiceTier,
			liveModel.capabilitySources?.serviceTier,
			parameters?.value.supports_service_tier,
			sheetSource(parameters, "serviceTier"),
			vendor?.supportsServiceTier,
			catalog?.supportsServiceTier,
			catalogCapabilitySource,
		);
		const serviceTiers = liveModel.serviceTiers?.length
			? { value: [...liveModel.serviceTiers], source: liveModel.capabilitySources?.serviceTiers ?? "live" as CapabilitySource }
			: parameters?.value.service_tiers?.length
				? { value: unique(parameters.value.service_tiers.map(String)), source: sheetSource(parameters, "serviceTiers") ?? "bifrost-datasheet" as CapabilitySource }
				: catalog?.serviceTiers?.length
					? { value: [...catalog.serviceTiers], source: catalogCapabilitySource }
					: {};
		const pricingStatus = liveModel.pricingStatus ?? catalog?.pricingStatus;
		const pricingStatusSource = liveModel.pricingStatus
			? (liveModel.capabilitySources?.pricingStatus ?? "live" as CapabilitySource)
			: catalog?.pricingStatus ? catalogCapabilitySource : undefined;

		const disableReasoningOnToolChoice =
			vendor?.disableReasoningOnToolChoice ??
			catalog?.disableReasoningOnToolChoice ??
			liveModel.compat.disableReasoningOnToolChoice;
		const inputCost = perMillion(pricing?.value.input_cost_per_token) ?? liveModel.cost.input ?? vendor?.cost.input ?? catalog?.cost.input ?? 0;
		const outputCost = perMillion(pricing?.value.output_cost_per_token) ?? liveModel.cost.output ?? vendor?.cost.output ?? catalog?.cost.output ?? 0;
		const cacheRead = perMillion(pricing?.value.cache_read_input_token_cost) ?? liveModel.cost.cacheRead ?? vendor?.cost.cacheRead ?? catalog?.cost.cacheRead ?? inputCost;
		const cacheWrite = perMillion(pricing?.value.cache_creation_input_token_cost) ?? liveModel.cost.cacheWrite ?? vendor?.cost.cacheWrite ?? catalog?.cost.cacheWrite ?? inputCost;
		const pricingDiagnostic = routePricingDiagnostic(pricing, {
			input: inputCost,
			output: outputCost,
			cacheRead,
			cacheWrite,
		});
		const confirmedOutputCeiling = confirmedProviderOutputCeiling(reference);
		const contractedOutput = confirmedOutputCeiling === undefined ? output.value : Math.min(output.value!, confirmedOutputCeiling);
		const sources: CapabilityProvenance = {
			contextWindow: context.source,
			maxTokens: confirmedOutputCeiling !== undefined && contractedOutput! < output.value!
				? "vendor-override" : output.source,
			image: image.source,
			reasoning: reasoning.source,
			reasoningEfforts: thinking.source,
			tools: tools.source,
			toolChoice: toolChoice.source,
			forcedToolChoice: forcedToolChoice.source,
			namedToolChoice: namedToolChoice.source,
			reasoningWithTools: reasoningWithTools.source,
			toolSearch: toolSearch.source,
			betweenToolsThinking: betweenToolsThinking.source,
			serviceTier: serviceTier.source,
			serviceTiers: serviceTiers.source,
			pricingStatus: pricingStatusSource,
			protocol: protocols.source,
		};

		models.push({
			...liveModel,
			// Keep each Bifrost route member distinct. The alias synthesizer therefore
			// cannot collapse two provider routes that serve the same underlying model.
			id: reference,
			name: reference,
			contextWindow: context.value,
			maxTokens: Math.min(context.value, contractedOutput!),
			input: image.value ? ["text", "image"] : ["text"],
			reasoning: Boolean(reasoning.value),
			thinking: reasoning.value ? thinking.value : undefined,
			supportsTools: Boolean(tools.value),
			supportsToolSearch: toolSearch.value,
			supportsServiceTier: serviceTier.value,
			...(serviceTiers.value?.length ? { serviceTiers: [...serviceTiers.value] } : {}),
			...(pricingStatus ? { pricingStatus } : {}),
			...(protocols.value?.length ? { protocols: [...protocols.value] } : {}),
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
				supportsToolChoice: toolChoice.value ?? liveModel.compat.supportsToolChoice ?? true,
				supportsForcedToolChoice: forcedToolChoice.value ?? liveModel.compat.supportsForcedToolChoice ?? true,
				supportsNamedToolChoice: namedToolChoice.value ?? liveModel.compat.supportsNamedToolChoice ?? true,
				supportsReasoningWithTools: reasoning.value ? reasoningWithTools.value : true,
				supportsBetweenToolsThinking: betweenToolsThinking.value,
				disableReasoningOnToolChoice: reasoning.value ? disableReasoningOnToolChoice : false,
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
			pricing: pricingDiagnostic,
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
