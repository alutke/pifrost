import { getModels, getProviders, type Model as OmpModel } from "@oh-my-pi/pi-ai";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type EffortName = (typeof EFFORTS)[number];
type Thinking = NonNullable<OmpModel["thinking"]>;

export interface CatalogModelLike {
	id: string;
	name?: string;
	provider?: string;
	contextWindow?: number | null;
	maxTokens?: number | null;
	reasoning?: boolean;
	thinking?: Thinking;
	thinkingLevelMap?: Record<string, string | null | undefined>;
	input?: string[];
	supportsTools?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	compat?: {
		supportsReasoningEffort?: boolean;
		supportsUsageInStreaming?: boolean;
	};
}

export interface CatalogCapabilityFallback {
	source: "omp-catalog-provider" | "omp-catalog-family";
	matched: string[];
	contextWindow: number;
	maxTokens: number;
	input: ("text" | "image")[];
	reasoning: boolean;
	thinking?: Thinking;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	supportsTools: boolean;
	supportsReasoningEffort: boolean;
	supportsUsageInStreaming: boolean;
}

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function tail(value: string): string {
	const parts = normalized(value).split("/").filter(Boolean);
	return parts[parts.length - 1] ?? normalized(value);
}

/**
 * Only aliases known to be the same capability surface belong here. Do not
 * generically strip `-free`: some free routes have materially smaller limits.
 */
const MODEL_EQUIVALENCE = new Map<string, string>([
	["stealth/ox-alpha", "ox-alpha"],
	["ox-alpha", "ox-alpha"],
	["ox-alpha-free", "ox-alpha"],
	["x-preview-f-free", "ox-alpha"],
	["laguna-s-2.1-free", "laguna-s-2.1"],
	["laguna-s-2.1", "laguna-s-2.1"],
]);

export function canonicalModelFamily(value: string): string {
	const full = normalized(value).replace(/:batch$/u, "");
	const fullAlias = MODEL_EQUIVALENCE.get(full);
	if (fullAlias) return fullAlias;
	const model = tail(full);
	return MODEL_EQUIVALENCE.get(model) ?? model;
}

export function modelIdentityCandidates(...values: Array<string | undefined>): string[] {
	const result: string[] = [];
	for (const raw of values) {
		if (!raw) continue;
		let current = normalized(raw);
		while (current) {
			result.push(current);
			result.push(canonicalModelFamily(current));
			const slash = current.indexOf("/");
			if (slash < 0) break;
			current = current.slice(slash + 1);
		}
	}
	return [...new Set(result.filter(Boolean))];
}

function routeProvider(reference: string): string | undefined {
	const slash = reference.indexOf("/");
	return slash > 0 ? normalized(reference.slice(0, slash)) : undefined;
}

/** Map Pifrost/Bifrost provider labels to the closest OMP catalog provider. */
export function preferredCatalogProviders(reference: string): string[] {
	switch (routeProvider(reference)) {
		case "opencode-go":
			return ["opencode-go"];
		case "opencode":
		case "opencode-zen":
			return ["opencode", "opencode-zen"];
		case "deepseek":
			return ["deepseek"];
		case "xiaomi mimo":
		case "xiaomi":
			return ["xiaomi"];
		case "openai":
			// Pifrost's OpenAI route is intentionally Codex/ChatGPT backed. Bifrost
			// datasheets remain the primary source; this is only a safe fallback.
			return ["openai-codex", "openai"];
		default:
			return [];
	}
}

let catalogCache: CatalogModelLike[] | undefined;

function bundledCatalog(): CatalogModelLike[] {
	if (catalogCache) return catalogCache;
	const providers = getProviders() as unknown as string[];
	const getModelsUntyped = getModels as unknown as (provider: string) => CatalogModelLike[];
	const models: CatalogModelLike[] = [];
	for (const provider of providers) {
		for (const model of getModelsUntyped(provider) ?? []) {
			if (!model?.id) continue;
			models.push({ ...model, provider: model.provider ?? provider });
		}
	}
	catalogCache = models;
	return models;
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function thinkingFromLevelMap(model: CatalogModelLike): Thinking | undefined {
	if (model.thinking?.efforts?.length) return model.thinking;
	const map = model.thinkingLevelMap;
	if (!map) return undefined;
	const names = EFFORTS.filter((effort) => Object.hasOwn(map, effort) && map[effort] !== null && map[effort] !== undefined);
	if (!names.length) return undefined;
	const effortMap = Object.fromEntries(names.map((name) => [name, map[name] ?? name])) as Thinking["effortMap"];
	return {
		mode: "effort",
		efforts: names as unknown as Thinking["efforts"],
		effortMap,
		...(Object.hasOwn(map, "off") && map.off === null ? { requiresEffort: true } : {}),
	};
}

function thinkingNames(thinking: Thinking | undefined): EffortName[] {
	if (!thinking) return [];
	const set = new Set(thinking.efforts.map(String));
	return EFFORTS.filter((effort) => set.has(effort));
}

function intersectThinking(models: CatalogModelLike[]): Thinking | undefined {
	if (!models.length || models.some((model) => !model.reasoning)) return undefined;
	const configs = models.map(thinkingFromLevelMap);
	if (configs.some((config) => !config)) return undefined;
	const names = EFFORTS.filter((effort) => configs.every((config) => thinkingNames(config).includes(effort)));
	if (!names.length) return undefined;
	return {
		mode: "effort",
		efforts: names as unknown as Thinking["efforts"],
		effortMap: Object.fromEntries(names.map((name) => [name, name])) as Thinking["effortMap"],
		...(configs.some((config) => config?.requiresEffort) ? { requiresEffort: true } : {}),
	};
}

function toFallback(models: CatalogModelLike[], source: CatalogCapabilityFallback["source"]): CatalogCapabilityFallback | undefined {
	const complete = models.filter((model) => positive(model.contextWindow) && positive(model.maxTokens));
	if (!complete.length) return undefined;
	const reasoning = complete.every((model) => Boolean(model.reasoning));
	const thinking = reasoning ? intersectThinking(complete) : undefined;
	const image = complete.every((model) => model.input?.includes("image"));
	const costs = complete.map((model) => ({
		input: positive(model.cost?.input) || model.cost?.input === 0 ? model.cost.input : 0,
		output: positive(model.cost?.output) || model.cost?.output === 0 ? model.cost.output : 0,
		cacheRead: positive(model.cost?.cacheRead) || model.cost?.cacheRead === 0 ? model.cost.cacheRead : 0,
		cacheWrite: positive(model.cost?.cacheWrite) || model.cost?.cacheWrite === 0 ? model.cost.cacheWrite : 0,
	}));
	return {
		source,
		matched: complete.map((model) => `${model.provider ?? "unknown"}/${model.id}`),
		contextWindow: Math.min(...complete.map((model) => model.contextWindow as number)),
		maxTokens: Math.min(...complete.map((model) => model.maxTokens as number)),
		input: image ? ["text", "image"] : ["text"],
		reasoning,
		thinking,
		cost: {
			input: Math.max(...costs.map((cost) => cost.input)),
			output: Math.max(...costs.map((cost) => cost.output)),
			cacheRead: Math.max(...costs.map((cost) => cost.cacheRead)),
			cacheWrite: Math.max(...costs.map((cost) => cost.cacheWrite)),
		},
		// OMP treats supportsTools === false as the exceptional case that requires
		// in-band tool syntax. Undefined therefore means normal/native tool support.
		supportsTools: complete.every((model) => model.supportsTools !== false),
		supportsReasoningEffort: Boolean(thinking),
		supportsUsageInStreaming: complete.every((model) => model.compat?.supportsUsageInStreaming !== false),
	};
}

/**
 * Resolve a route member against OMP's bundled catalog. Bifrost metadata remains
 * primary; this fills newly-added/reseller aliases that Bifrost's public feeds
 * have not indexed yet. `catalogOverride` exists for deterministic tests and
 * offline diagnostics; production callers use OMP's installed catalog.
 */
export function findCatalogCapabilityFallback(
	reference: string,
	liveModelId?: string,
	catalogOverride?: readonly CatalogModelLike[],
): CatalogCapabilityFallback | undefined {
	const candidates = new Set(modelIdentityCandidates(reference, liveModelId));
	const family = canonicalModelFamily(liveModelId ?? reference);
	const all = catalogOverride ? [...catalogOverride] : bundledCatalog();
	const preferred = new Set(preferredCatalogProviders(reference));
	const matchesIdentity = (model: CatalogModelLike): boolean => {
		const modelCandidates = modelIdentityCandidates(model.id);
		return modelCandidates.some((candidate) => candidates.has(candidate)) || canonicalModelFamily(model.id) === family;
	};

	if (preferred.size) {
		const providerMatches = all.filter((model) => preferred.has(normalized(model.provider ?? "")) && matchesIdentity(model));
		const exactProviderFallback = toFallback(providerMatches, "omp-catalog-provider");
		if (exactProviderFallback) return exactProviderFallback;
	}

	// For reseller/custom providers (for example CommandCode), use all matching
	// OMP catalog surfaces and take the conservative intersection/minimum.
	return toFallback(all.filter(matchesIdentity), "omp-catalog-family");
}
