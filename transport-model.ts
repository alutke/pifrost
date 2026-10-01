import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-ai";
import {
	cleanModelName,
	MODEL_KINDS,
	resolveModelTokenizer,
} from "@oh-my-pi/pi-catalog";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";

function numberField(source: object, key: string): number | undefined {
	const value: unknown = Reflect.get(source, key);
	return typeof value === "number" ? value : undefined;
}

function objectPayload(value: unknown): object | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function isInputModalities(value: unknown): value is ("text" | "image")[] {
	return Array.isArray(value) && value.every((entry) => entry === "text" || entry === "image");
}

function explicitComputerUseConfig<TApi extends Api>(spec: ModelSpec<TApi>): boolean | undefined {
	if (!("supportsComputerUseConfig" in spec)) return spec.supportsComputerUse;
	const value: unknown = Reflect.get(spec, "supportsComputerUseConfig");
	return typeof value === "boolean" ? value : undefined;
}

function revisionAtLeast(identity: { revision?: string }, major: number, minor: number): boolean {
	if (identity.revision === undefined) return false;
	const [revMajor = 0, revMinor = 0] = identity.revision.split(".").map(Number);
	return revMajor > major || (revMajor === major && revMinor >= minor);
}

function isDirectOpenAIResponsesEndpoint<TApi extends Api>(spec: ModelSpec<TApi>): boolean {
	if (spec.api === "openai-responses") {
		if (spec.provider !== "openai") return false;
		if (!spec.baseUrl) return true;
		try {
			const url = new URL(spec.baseUrl);
			return url.protocol === "https:" && url.hostname === "api.openai.com";
		} catch {
			return false;
		}
	}
	if (spec.api !== "azure-openai-responses" || (spec.provider !== "azure" && spec.provider !== "azure-openai")) {
		return false;
	}
	if (!spec.baseUrl) return true;
	try {
		const url = new URL(spec.baseUrl);
		return (
			url.protocol === "https:" &&
			(url.hostname.endsWith(".openai.azure.com") || url.hostname === "models.inference.ai.azure.com")
		);
	} catch {
		return false;
	}
}

function supportsOpenAIGAComputerUse<TApi extends Api>(
	spec: ModelSpec<TApi>,
	identity: { class: string; revision?: string },
	explicitSupport: boolean | undefined,
): boolean {
	if (explicitSupport !== undefined) return explicitSupport;
	if (!isDirectOpenAIResponsesEndpoint(spec)) return false;
	return identity.class === "openai" && revisionAtLeast(identity, 5, 4);
}

/**
 * Apply the request-relevant catalog axes that OMP's buildModel normally
 * materializes. Pifrost does not need pricing mutations for these ephemeral
 * transport models: billing/routing metadata remains owned by the logical
 * Pifrost model and Bifrost.
 */
function applyTransportCatalogAssignments<TApi extends Api>(
	model: Model<TApi>,
	catalog: Record<string, unknown>,
): void {
	const kind = MODEL_KINDS.find((value) => value === catalog.kind);
	if (kind !== undefined) model.kind = kind;

	if (catalog.contextWindowAuthoritative === true) {
		model.contextWindowAuthoritative = true;
	} else {
		delete model.contextWindowAuthoritative;
	}

	const webSearch = catalog.webSearch;
	if (
		webSearch === "gemini" ||
		webSearch === "anthropic" ||
		webSearch === "codex" ||
		webSearch === "xai" ||
		webSearch === "openrouter" ||
		webSearch === "openai"
	) {
		model.webSearch = webSearch;
	}
	if (typeof catalog.webSearchModel === "string") model.webSearchModel = catalog.webSearchModel;
	if (catalog.hostedImage === true) model.hostedImage = true;
	else if (catalog.hostedImage === false) delete model.hostedImage;
	if (typeof catalog.imageModel === "string") model.imageModel = catalog.imageModel;
	else if (catalog.imageModel === false) delete model.imageModel;

	const serviceTierCost = objectPayload(catalog.serviceTierCost);
	if (serviceTierCost !== undefined) {
		const flex = numberField(serviceTierCost, "flex");
		const priority = numberField(serviceTierCost, "priority");
		model.serviceTierCost = {
			...(flex !== undefined && { flex }),
			...(priority !== undefined && { priority }),
		};
	}
	if (typeof catalog.priority === "number") model.priority = catalog.priority;

	const promptCache = objectPayload(catalog.promptCache);
	if (promptCache !== undefined) {
		const short = numberField(promptCache, "short");
		const long = numberField(promptCache, "long");
		model.promptCache = {
			...(short !== undefined && { short }),
			...(long !== undefined && { long }),
		};
	}

	if (catalog.applyPatchToolType === "freeform" || catalog.applyPatchToolType === "function") {
		model.applyPatchToolType = catalog.applyPatchToolType;
	}
	if (catalog.editPromptVariant === "full" || catalog.editPromptVariant === "compact") {
		model.editPromptVariant = catalog.editPromptVariant;
	}
	if (
		catalog.pricingStatus === "free" ||
		catalog.pricingStatus === "included" ||
		catalog.pricingStatus === "variable" ||
		catalog.pricingStatus === "unknown"
	) {
		model.pricingStatus = catalog.pricingStatus;
	}

	if (catalog.requiresCursorToolSchemaProjection === true) {
		model.requiresCursorToolSchemaProjection = true;
	} else {
		delete model.requiresCursorToolSchemaProjection;
	}
	if (catalog.requiresToolResultImageHoisting === true) {
		model.requiresToolResultImageHoisting = true;
	} else {
		delete model.requiresToolResultImageHoisting;
	}
	if (catalog.supportsAssistantPrefill === true) {
		model.supportsAssistantPrefill = true;
	} else {
		delete model.supportsAssistantPrefill;
	}
	if (typeof catalog.omitMaxOutputTokens === "boolean" && model.omitMaxOutputTokens === undefined) {
		model.omitMaxOutputTokens = catalog.omitMaxOutputTokens;
	}
	if (typeof catalog.contextPromotionTarget === "string" && model.contextPromotionTarget === undefined) {
		model.contextPromotionTarget = catalog.contextPromotionTarget;
	}

	const limitsPatch = objectPayload(catalog.limitsPatch);
	if (limitsPatch !== undefined) {
		const contextWindow = numberField(limitsPatch, "contextWindow");
		if (contextWindow !== undefined) model.contextWindow = contextWindow;
		const maxTokens = numberField(limitsPatch, "maxTokens");
		if (maxTokens !== undefined) model.maxTokens = maxTokens;
	}
	if (typeof catalog.contextWindowFloor === "number") {
		model.contextWindow = Math.max(model.contextWindow ?? 0, catalog.contextWindowFloor);
	}
	if (isInputModalities(catalog.inputModalities)) {
		model.input = catalog.inputModalities;
	}
}

/**
 * Materialize the temporary physical transport model used by Pifrost without
 * importing @oh-my-pi/pi-catalog/build.
 *
 * Compiled OMP 18.4.x currently cannot load pi-catalog's root-level /build
 * subpath (upstream #13940). The public package root and compat/resolve path
 * are bundled by OMP, so this keeps the same request-policy resolution while
 * avoiding the broken compiled-extension import edge.
 *
 * This is intentionally transport-only, not a replacement for OMP's complete
 * catalog builder: price-card mutation is irrelevant to a single outbound
 * request and remains on Pifrost's logical/Bifrost catalog.
 */
export function buildPifrostTransportModel<TApi extends Api>(spec: ModelSpec<TApi>): Model<TApi> {
	const policy = resolveModelPolicy(spec);
	const supportsComputerUseConfig = explicitComputerUseConfig(spec);
	const model = {
		...spec,
		reasoning: spec.reasoning || policy.thinking !== undefined,
		name: cleanModelName(spec.name),
		identity: policy.identity,
		requiresGlyphTokenization: policy.identity.class === "anthropic",
		tokenizer: spec.tokenizer ?? resolveModelTokenizer(spec.requestModelId ?? spec.id, spec.provider),
		thinking: policy.thinking,
		supportsComputerUse: supportsOpenAIGAComputerUse(spec, policy.identity, supportsComputerUseConfig),
		supportsComputerUseConfig,
		compat: policy.compat,
		compatConfig: spec.compat,
	} as Model<TApi>;

	applyTransportCatalogAssignments(model, policy.catalog);
	return model;
}
