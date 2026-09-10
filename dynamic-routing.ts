import type { BifrostProviderModel, PifrostAliasConfig, PifrostCatalog } from "./index.ts";

export const DYNAMIC_ROUTE_MODE = "context-aware" as const;
export const DEFAULT_CONTEXT_BYTES_PER_TOKEN = 2.5;
export const DEFAULT_CONTEXT_SAFETY_MARGIN = 0.1;
export const DEFAULT_CONTEXT_FIXED_HEADROOM = 2_048;
export const DEFAULT_IMAGE_TOKEN_RESERVE = 4_096;

export interface DynamicRouteMemberProfile {
	reference: string;
	resolvedModelId: string;
	contextWindow: number;
	maxTokens: number;
	input: ("text" | "image")[];
	reasoning: boolean;
	supportsTools: boolean;
	compat: {
		supportsToolChoice?: boolean;
		supportsForcedToolChoice?: boolean;
		supportsNamedToolChoice?: boolean;
		disableReasoningOnToolChoice?: boolean;
	};
}

export interface DynamicRouteBand {
	maxRequiredTokens: number;
	members: string[];
}

export interface DynamicRouteProfile {
	id: string;
	mode: typeof DYNAMIC_ROUTE_MODE;
	source: "bifrost-simple-rule";
	staticContextWindow: number;
	advertisedContextWindow: number;
	maxTokens: number;
	members: DynamicRouteMemberProfile[];
	bands: DynamicRouteBand[];
}

export interface DynamicRouteDecision {
	logicalModel: string;
	estimatedInputTokens: number;
	outputReserveTokens: number;
	requiredContextTokens: number;
	primary: string;
	fallbacks: string[];
	excluded: Array<{ reference: string; reasons: string[] }>;
}

export interface DynamicRouteEstimateOptions {
	bytesPerToken?: number;
	safetyMargin?: number;
	fixedHeadroom?: number;
	imageTokenReserve?: number;
}

type DynamicAliasDefinition = {
	name?: string;
	chain: string[];
	dynamicRouting?: {
		mode?: string;
		source?: string;
	};
};

type DynamicModelCarrier = BifrostProviderModel & {
	pifrostDynamicRoute?: DynamicRouteProfile;
};

type DynamicDiagnosticCarrier = PifrostCatalog["diagnostics"][number] & {
	dynamicRouting?: boolean;
	staticContextWindow?: number;
	contextBands?: DynamicRouteBand[];
};

function dynamicDefinition(value: PifrostAliasConfig["aliases"][string] | undefined): DynamicAliasDefinition | undefined {
	if (!value || Array.isArray(value)) return undefined;
	return value as DynamicAliasDefinition;
}

function finitePositive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function profileIsValid(value: unknown): value is DynamicRouteProfile {
	if (!value || typeof value !== "object") return false;
	const profile = value as Partial<DynamicRouteProfile>;
	return (
		typeof profile.id === "string" &&
		profile.mode === DYNAMIC_ROUTE_MODE &&
		profile.source === "bifrost-simple-rule" &&
		finitePositive(profile.advertisedContextWindow) !== undefined &&
		finitePositive(profile.staticContextWindow) !== undefined &&
		finitePositive(profile.maxTokens) !== undefined &&
		Array.isArray(profile.members) &&
		profile.members.length > 0
	);
}

function routeBands(members: readonly DynamicRouteMemberProfile[]): DynamicRouteBand[] {
	const thresholds = [...new Set(members.map((member) => member.contextWindow))].sort((a, b) => a - b);
	return thresholds.map((maxRequiredTokens) => ({
		maxRequiredTokens,
		members: members.filter((member) => member.contextWindow >= maxRequiredTokens).map((member) => member.reference),
	}));
}

/**
 * Upgrade only aliases explicitly marked safe by routes-sync. The normal alias
 * synthesis remains conservative; this post-process raises the OMP context
 * envelope only when Pifrost can enforce member eligibility on every request.
 */
export function applyDynamicRouteProfiles(
	catalog: PifrostCatalog,
	physicalModels: readonly BifrostProviderModel[],
	aliasConfig: PifrostAliasConfig | undefined,
	resolveReference: (reference: string, models: readonly BifrostProviderModel[]) => BifrostProviderModel | undefined,
): PifrostCatalog {
	if (!aliasConfig) return catalog;
	const diagnosticCopies = catalog.diagnostics.map((item) => ({ ...item })) as DynamicDiagnosticCarrier[];
	const diagnosticsById = new Map(diagnosticCopies.map((item) => [item.id.toLowerCase(), item]));

	const models = catalog.models.map((model): BifrostProviderModel => {
		const definition = dynamicDefinition(aliasConfig.aliases[model.id]);
		if (definition?.dynamicRouting?.mode !== DYNAMIC_ROUTE_MODE || definition.dynamicRouting.source !== "bifrost-simple-rule") {
			return model;
		}
		const resolved = definition.chain.map((reference) => ({
			reference,
			model: resolveReference(reference, physicalModels),
		}));
		if (resolved.length === 0 || resolved.some((entry) => !entry.model)) return model;

		const members: DynamicRouteMemberProfile[] = resolved.map((entry) => {
			const member = entry.model!;
			return {
				reference: entry.reference,
				resolvedModelId: member.id,
				contextWindow: member.contextWindow,
				maxTokens: member.maxTokens,
				input: [...member.input],
				reasoning: member.reasoning,
				supportsTools: member.supportsTools,
				compat: {
					supportsToolChoice: member.compat.supportsToolChoice,
					supportsForcedToolChoice: member.compat.supportsForcedToolChoice,
					supportsNamedToolChoice: member.compat.supportsNamedToolChoice,
					disableReasoningOnToolChoice: member.compat.disableReasoningOnToolChoice,
				},
			};
		});
		const staticContextWindow = Math.min(...members.map((member) => member.contextWindow));
		const advertisedContextWindow = Math.max(...members.map((member) => member.contextWindow));
		if (advertisedContextWindow <= staticContextWindow) return model;

		const profile: DynamicRouteProfile = {
			id: model.id,
			mode: DYNAMIC_ROUTE_MODE,
			source: "bifrost-simple-rule",
			staticContextWindow,
			advertisedContextWindow,
			// Output remains the route-wide safe minimum. Dynamic routing solves
			// context-window down-ranking without silently increasing output ceilings.
			maxTokens: model.maxTokens,
			members,
			bands: routeBands(members),
		};
		const diagnostic = diagnosticsById.get(model.id.toLowerCase());
		if (diagnostic) {
			diagnostic.staticContextWindow = staticContextWindow;
			diagnostic.contextWindow = advertisedContextWindow;
			diagnostic.dynamicRouting = true;
			diagnostic.contextBands = profile.bands;
		}
		return {
			...model,
			contextWindow: advertisedContextWindow,
			pifrostDynamicRoute: profile,
		} as DynamicModelCarrier;
	});

	return { ...catalog, models, diagnostics: diagnosticCopies };
}

export function extractDynamicRouteProfiles(models: readonly BifrostProviderModel[]): Map<string, DynamicRouteProfile> {
	const result = new Map<string, DynamicRouteProfile>();
	for (const model of models) {
		const profile = (model as DynamicModelCarrier).pifrostDynamicRoute;
		if (profileIsValid(profile)) result.set(profile.id.toLowerCase(), profile);
	}
	return result;
}

function imagePartCount(value: unknown, depth = 0): number {
	if (depth > 40 || value == null) return 0;
	if (Array.isArray(value)) return value.reduce((sum, item) => sum + imagePartCount(item, depth + 1), 0);
	if (typeof value !== "object") return 0;
	const record = value as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
	if (type.includes("image")) return 1;
	return Object.values(record).reduce<number>((sum, item) => sum + imagePartCount(item, depth + 1), 0);
}

function estimatePayload(value: Record<string, unknown>): { json: string; images: number } {
	const promptPayload = { ...value };
	for (const key of ["model", "fallbacks", "stream", "stream_options", "max_tokens", "max_completion_tokens"]) {
		delete promptPayload[key];
	}
	const images = imagePartCount(promptPayload);
	const json = JSON.stringify(promptPayload, (key, item) => {
		if (typeof item !== "string") return item;
		if (item.toLowerCase().startsWith("data:image/")) return "[image-data]";
		if (/image/iu.test(key) && item.length > 512) return "[image-data]";
		return item;
	});
	return { json, images };
}

export function estimateOpenAIRequestInputTokens(
	body: Record<string, unknown>,
	options: DynamicRouteEstimateOptions = {},
): number {
	const bytesPerToken = finitePositive(options.bytesPerToken) ?? DEFAULT_CONTEXT_BYTES_PER_TOKEN;
	const safetyMargin = typeof options.safetyMargin === "number" && Number.isFinite(options.safetyMargin)
		? Math.max(0, options.safetyMargin)
		: DEFAULT_CONTEXT_SAFETY_MARGIN;
	const fixedHeadroom = typeof options.fixedHeadroom === "number" && Number.isFinite(options.fixedHeadroom)
		? Math.max(0, Math.floor(options.fixedHeadroom))
		: DEFAULT_CONTEXT_FIXED_HEADROOM;
	const imageTokenReserve = typeof options.imageTokenReserve === "number" && Number.isFinite(options.imageTokenReserve)
		? Math.max(0, Math.floor(options.imageTokenReserve))
		: DEFAULT_IMAGE_TOKEN_RESERVE;
	const { json, images } = estimatePayload(body);
	const bytes = new TextEncoder().encode(json).byteLength;
	return Math.max(1, Math.ceil((bytes / bytesPerToken) * (1 + safetyMargin)) + fixedHeadroom + images * imageTokenReserve);
}

function requestedOutputTokens(body: Record<string, unknown>, profile: DynamicRouteProfile): number {
	for (const key of ["max_completion_tokens", "max_tokens"]) {
		const value = body[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.ceil(value);
	}
	return profile.maxTokens;
}

function requestHasImages(body: Record<string, unknown>): boolean {
	return imagePartCount(body.messages ?? body.input) > 0;
}

function requestUsesTools(body: Record<string, unknown>): boolean {
	return Array.isArray(body.tools) && body.tools.length > 0;
}

function requestUsesReasoning(body: Record<string, unknown>): boolean {
	return body.reasoning !== undefined || body.reasoning_effort !== undefined;
}

function memberExclusionReasons(
	member: DynamicRouteMemberProfile,
	body: Record<string, unknown>,
	requiredContextTokens: number,
	outputReserveTokens: number,
): string[] {
	const reasons: string[] = [];
	if (member.contextWindow < requiredContextTokens) reasons.push("context " + member.contextWindow + " < required " + requiredContextTokens);
	if (member.maxTokens < outputReserveTokens) reasons.push("max-output " + member.maxTokens + " < requested " + outputReserveTokens);
	if (requestHasImages(body) && !member.input.includes("image")) reasons.push("no image input");
	const usesTools = requestUsesTools(body);
	if (usesTools && !member.supportsTools) reasons.push("no tool support");
	const toolChoice = body.tool_choice;
	if (toolChoice !== undefined && member.compat.supportsToolChoice === false) reasons.push("no tool_choice support");
	if ((toolChoice === "required" || toolChoice === "any") && member.compat.supportsForcedToolChoice === false) {
		reasons.push("no forced tool_choice support");
	}
	if (toolChoice && typeof toolChoice === "object" && member.compat.supportsNamedToolChoice === false) {
		reasons.push("no named tool_choice support");
	}
	if (requestUsesReasoning(body) && !member.reasoning) reasons.push("no reasoning support");
	if (requestUsesReasoning(body) && usesTools && member.compat.disableReasoningOnToolChoice === true) {
		reasons.push("cannot combine reasoning with tools");
	}
	return reasons;
}

export class DynamicRouteCapacityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DynamicRouteCapacityError";
	}
}

export function rewriteDynamicOpenAIRequest(
	profile: DynamicRouteProfile,
	body: Record<string, unknown>,
	options: DynamicRouteEstimateOptions = {},
): { body: Record<string, unknown>; decision: DynamicRouteDecision } {
	const estimatedInputTokens = estimateOpenAIRequestInputTokens(body, options);
	const outputReserveTokens = requestedOutputTokens(body, profile);
	const requiredContextTokens = estimatedInputTokens + outputReserveTokens;
	const excluded: DynamicRouteDecision["excluded"] = [];
	const eligible: DynamicRouteMemberProfile[] = [];
	for (const member of profile.members) {
		const reasons = memberExclusionReasons(member, body, requiredContextTokens, outputReserveTokens);
		if (reasons.length) excluded.push({ reference: member.reference, reasons });
		else eligible.push(member);
	}
	if (!eligible.length) {
		throw new DynamicRouteCapacityError(
			"Pifrost dynamic route " + profile.id + " has no eligible member for estimated input " + estimatedInputTokens + " + output reserve " + outputReserveTokens + " = " + requiredContextTokens + " tokens; compact the session or lower the requested output ceiling",
		);
	}
	const primary = eligible[0]!.reference;
	const fallbacks = eligible.slice(1).map((member) => member.reference);
	return {
		body: {
			...body,
			model: primary,
			...(fallbacks.length ? { fallbacks } : { fallbacks: [] }),
		},
		decision: {
			logicalModel: profile.id,
			estimatedInputTokens,
			outputReserveTokens,
			requiredContextTokens,
			primary,
			fallbacks,
			excluded,
		},
	};
}

async function requestBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
	const body = init?.body;
	if (typeof body === "string") return body;
	if (body instanceof URLSearchParams) return body.toString();
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
	if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
	if (typeof Request !== "undefined" && input instanceof Request) {
		try {
			return await input.clone().text();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function mergedHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
	const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
	if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
	return headers;
}

/**
 * Intercept the final OpenAI-compatible JSON payload after OMP has serialized
 * messages/tools. For a context-aware alias, replace the logical model with the
 * first capability-safe physical route member and supply the remaining eligible
 * members through Bifrost's documented top-level fallback list.
 */
export function createDynamicRoutingFetch(
	baseFetch: typeof globalThis.fetch,
	profiles: ReadonlyMap<string, DynamicRouteProfile>,
	estimateOptions: DynamicRouteEstimateOptions = {},
): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const text = await requestBodyText(input, init);
		if (!text) return baseFetch(input, init);
		let body: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(text);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return baseFetch(input, init);
			body = parsed as Record<string, unknown>;
		} catch {
			return baseFetch(input, init);
		}
		const logicalModel = typeof body.model === "string" ? body.model.toLowerCase() : "";
		const profile = profiles.get(logicalModel);
		if (!profile) return baseFetch(input, init);

		const rewritten = rewriteDynamicOpenAIRequest(profile, body, estimateOptions);
		const headers = mergedHeaders(input, init);
		headers.delete("content-length");
		headers.set("x-pifrost-logical-model", profile.id);
		headers.set("x-pifrost-estimated-input-tokens", String(rewritten.decision.estimatedInputTokens));
		headers.set("x-pifrost-required-context-tokens", String(rewritten.decision.requiredContextTokens));
		headers.set("x-pifrost-eligible-members", String(1 + rewritten.decision.fallbacks.length));
		const nextBody = JSON.stringify(rewritten.body);

		if (typeof Request !== "undefined" && input instanceof Request) {
			const request = new Request(input, { ...init, method: init?.method ?? input.method, headers, body: nextBody });
			return baseFetch(request);
		}
		return baseFetch(input, { ...init, headers, body: nextBody });
	}) as typeof globalThis.fetch;
}
