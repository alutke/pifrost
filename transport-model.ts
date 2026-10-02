import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-ai";

export type PifrostModelPolicy = {
	thinking: Model["thinking"];
	identity: Model["identity"];
	compat: Model["compat"];
	catalog: Record<string, unknown>;
};

export type PifrostModelPolicyResolver = <TApi extends Api>(spec: ModelSpec<TApi>) => PifrostModelPolicy;

let resolveHostModelPolicy: PifrostModelPolicyResolver | undefined;

/** Install OMP's host-owned policy resolver from the extension entry module. */
export function installPifrostModelPolicyResolver(resolver: PifrostModelPolicyResolver): void {
	resolveHostModelPolicy = resolver;
}

function resolveModelPolicyFromHost<TApi extends Api>(spec: ModelSpec<TApi>): PifrostModelPolicy {
	if (!resolveHostModelPolicy) {
		throw new Error("Pifrost host model-policy resolver is not installed");
	}
	return resolveHostModelPolicy(spec);
}

export type PifrostReasoningWithToolsApi = "openai-completions" | "openai-responses";
type OmpPolicyProbeApi =
	| PifrostReasoningWithToolsApi
	| "openai-codex-responses"
	| "azure-openai-responses";

const POLICY_PROBE_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

function ompPolicyProbeApi(provider: string, api: PifrostReasoningWithToolsApi): OmpPolicyProbeApi {
	if (api !== "openai-responses") return api;
	const normalizedProvider = provider.trim().toLowerCase();
	if (normalizedProvider === "openai-codex") return "openai-codex-responses";
	if (normalizedProvider === "azure" || normalizedProvider === "azure-openai") return "azure-openai-responses";
	return "openai-responses";
}

/**
 * Resolve OMP's host-authored reasoning+tools policy for a physical upstream
 * identity without materializing a complete model. Pifrost's generic wire
 * protocol is translated to OMP's provider-specific Responses API first, so
 * provider rules such as Azure and Codex are evaluated on their authored axis.
 *
 * Unknown/unsupported identities fail open to "unknown" here so callers can
 * fall back to Bifrost metadata instead of fabricating compatibility.
 */
export function resolvePifrostReasoningWithToolsPolicy(
	provider: string,
	modelId: string,
	api: PifrostReasoningWithToolsApi,
): boolean | undefined {
	if (!resolveHostModelPolicy) return undefined;
	try {
		const policyApi = ompPolicyProbeApi(provider, api);
		const policy = resolveHostModelPolicy({
			id: modelId,
			name: modelId,
			provider,
			api: policyApi,
			reasoning: true,
			input: ["text"],
			supportsTools: true,
			cost: POLICY_PROBE_COST,
			contextWindow: 128_000,
			maxTokens: 8_192,
		} as ModelSpec<OmpPolicyProbeApi>);
		const compat = policy.compat;
		if (!compat || typeof compat !== "object") return undefined;
		const disabled = Reflect.get(compat, "disableReasoningWithTools");
		return typeof disabled === "boolean" ? !disabled : undefined;
	} catch {
		return undefined;
	}
}

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
 * Compiled OMP 18.4.x has a known dependency-resolution failure when a
 * nested extension module imports pi-catalog and the loader falls back to the
 * plugin-local package graph (upstream #13731/#13940). native.ts imports the
 * supported host surface directly and injects the resolver here, keeping every
 * nested Pifrost module independent of pi-catalog at runtime.
 *
 * This is intentionally transport-only, not a replacement for OMP's complete
 * catalog builder. Pricing and selection metadata are not recomputed here.
 */
export function buildPifrostTransportModel<TApi extends Api>(spec: ModelSpec<TApi>): Model<TApi> {
	const policy = resolveModelPolicyFromHost(spec);
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
