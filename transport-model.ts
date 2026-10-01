import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";

const AUTHOR_PREFIX = /^[A-Za-z][A-Za-z0-9 .+&'-]{0,23}: /;
const NOISE_TAGS = /\s*\((?:latest|Antigravity|\$+|>?\d+% off|retires [^)]*)\)/g;

function cleanTransportModelName(name: string): string {
	const cleaned = name.replace(AUTHOR_PREFIX, "").replace(NOISE_TAGS, "").replace(/ {2,}/g, " ").trim();
	return cleaned.length > 0 ? cleaned : name;
}

function parseRevision(value: string | undefined): readonly [number, number, number] | undefined {
	if (!value) return undefined;
	const out: [number, number, number] = [0, 0, 0];
	let count = 0;
	for (const part of value.split(/[.-]/u)) {
		if (count === 3 || !/^\d+$/u.test(part)) return undefined;
		const parsed = Number(part);
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) return undefined;
		out[count] = parsed;
		count += 1;
	}
	return count > 0 ? out : undefined;
}

function revisionAtLeast(value: string | undefined, floor: string): boolean {
	const revision = parseRevision(value);
	const minimum = parseRevision(floor);
	if (!revision || !minimum) return false;
	return (
		revision[0] > minimum[0] ||
		(revision[0] === minimum[0] && revision[1] > minimum[1]) ||
		(revision[0] === minimum[0] && revision[1] === minimum[1] && revision[2] >= minimum[2])
	);
}

function resolveTransportTokenizer(identity: { class: string; family?: string; revision?: string }): Model["tokenizer"] {
	if (identity.class === "anthropic") {
		if (identity.family === "opus") {
			if (revisionAtLeast(identity.revision, "5")) return "claude-v5";
			if (revisionAtLeast(identity.revision, "4.7")) return "claude-v47";
			return "claude-v3";
		}
		if (identity.family === "sonnet" || identity.family === "fable" || identity.family === "mythos") {
			return revisionAtLeast(identity.revision, "5") ? "claude-v5-sonnet" : "claude-v3";
		}
		return "claude-v3";
	}
	if (identity.class === "qwen" && revisionAtLeast(identity.revision, "3.5")) return "qwen3";
	if (identity.class === "deepseek") return "deepseek-v3";
	if (identity.class === "kimi") return "kimi-k2";
	if (identity.class === "glm" && revisionAtLeast(identity.revision, "5")) return "glm5";
	return undefined;
}

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

function numericRevisionAtLeast(identity: { revision?: string }, major: number, minor: number): boolean {
	if (identity.revision === undefined) return false;
	const revision = parseRevision(identity.revision);
	if (!revision) return false;
	return revision[0] > major || (revision[0] === major && revision[1] >= minor);
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
	return identity.class === "openai" && numericRevisionAtLeast(identity, 5, 4);
}

/**
 * Apply only catalog axes that can change the shape or safety of the immediate
 * provider request. Pricing, display and selection metadata stay on Pifrost's
 * logical model and in Bifrost, where routing/billing authority belongs.
 */
function applyTransportCatalogAssignments<TApi extends Api>(
	model: Model<TApi>,
	catalog: Record<string, unknown>,
): void {
	if (catalog.contextWindowAuthoritative === true) {
		model.contextWindowAuthoritative = true;
	} else {
		delete model.contextWindowAuthoritative;
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
 * Compiled OMP 18.4.x cannot currently load pi-catalog's root-level /build
 * subpath (upstream #13940). OMP does bundle compat/resolve, which is the
 * authoritative request-policy resolver. Pifrost uses that narrow public
 * surface and locally mirrors the small request-boundary normalization needed
 * by its ephemeral transport models.
 *
 * This is intentionally transport-only, not a replacement for OMP's complete
 * catalog builder. Pricing and selection metadata are not recomputed here.
 */
export function buildPifrostTransportModel<TApi extends Api>(spec: ModelSpec<TApi>): Model<TApi> {
	const policy = resolveModelPolicy(spec);
	const supportsComputerUseConfig = explicitComputerUseConfig(spec);
	const model = {
		...spec,
		reasoning: spec.reasoning || policy.thinking !== undefined,
		name: cleanTransportModelName(spec.name),
		identity: policy.identity,
		requiresGlyphTokenization: policy.identity.class === "anthropic",
		tokenizer: spec.tokenizer ?? resolveTransportTokenizer(policy.identity),
		thinking: policy.thinking,
		supportsComputerUse: supportsOpenAIGAComputerUse(spec, policy.identity, supportsComputerUseConfig),
		supportsComputerUseConfig,
		compat: policy.compat,
		compatConfig: spec.compat,
	} as Model<TApi>;

	applyTransportCatalogAssignments(model, policy.catalog);
	return model;
}
