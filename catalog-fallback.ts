import type { Model as OmpModel } from "@oh-my-pi/pi-ai";
import {
	wireProtocolsFrom,
	type PifrostWireProtocol,
} from "./protocol-capability.ts";

import {
	canonicalModelFamily,
	equivalentModelId,
	modelIdentityCandidates,
} from "./model-resolution.ts";

export {
	canonicalModelFamily,
	equivalentModelId,
	modelIdentityCandidates,
} from "./model-resolution.ts";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type EffortName = (typeof EFFORTS)[number];
type Thinking = NonNullable<OmpModel["thinking"]>;

export interface CatalogModelLike {
	id: string;
	name?: string;
	provider?: string;
	api?: string;
	contextWindow?: number | null;
	maxTokens?: number | null;
	reasoning?: boolean;
	thinking?: Thinking;
	thinkingLevelMap?: Record<string, string | null | undefined>;
	input?: string[];
	supportsTools?: boolean;
	serviceTiers?: readonly string[];
	pricingStatus?: OmpModel["pricingStatus"];
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	compat?: {
		supportsReasoningEffort?: boolean;
		supportsUsageInStreaming?: boolean;
		supportsToolChoice?: boolean;
		supportsForcedToolChoice?: boolean;
		supportsNamedToolChoice?: boolean;
		supportsReasoningWithTools?: boolean;
		supportsBetweenToolsThinking?: boolean;
		disableReasoningOnToolChoice?: boolean;
	};
}

export interface OmpCatalogRuntime {
	getBundledProviders(): readonly string[];
	getBundledModels(provider: string): readonly CatalogModelLike[];
	apiRouteFor(provider: string, modelId: string): { api: string } | undefined;
}

let ompCatalogRuntime: OmpCatalogRuntime | undefined;

/** Install OMP catalog accessors from native.ts so nested modules never resolve host packages from disk. */
export function installOmpCatalogRuntime(runtime: OmpCatalogRuntime): void {
	ompCatalogRuntime = runtime;
	catalogCache = undefined;
}

export interface CatalogCapabilityFallback {
	source: "omp-catalog-provider" | "omp-catalog-family" | "verified-model-hint";
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
	supportsToolChoice: boolean;
	supportsForcedToolChoice: boolean;
	supportsNamedToolChoice: boolean;
	supportsReasoningWithTools?: boolean;
	supportsToolSearch?: boolean;
	supportsBetweenToolsThinking?: boolean;
	supportsServiceTier?: boolean;
	serviceTiers?: string[];
	pricingStatus?: OmpModel["pricingStatus"];
	disableReasoningOnToolChoice: boolean;
	protocols?: PifrostWireProtocol[];
}

function normalized(value: string): string {
	return value.trim().toLowerCase();
}

function routeProvider(reference: string): string | undefined {
	const slash = reference.indexOf("/");
	return slash > 0 ? normalized(reference.slice(0, slash)) : undefined;
}

export function preferredCatalogProviders(reference: string): string[] {
	switch (routeProvider(reference)) {
		case "opencode-go": return ["opencode-go"];
		case "opencode":
		case "opencode-zen": return ["opencode", "opencode-zen"];
		case "deepseek": return ["deepseek"];
		case "openrouter": return ["openrouter"];
		case "xiaomi mimo":
		case "xiaomi": return ["xiaomi"];
		case "openai": return ["openai-codex", "openai"];
		case "commandcode goat":
		case "commandcode": return ["commandcode"];
		default: return [];
	}
}

function routeModelId(reference: string): string {
	const slash = reference.indexOf("/");
	return slash >= 0 ? reference.slice(slash + 1) : reference;
}

/**
 * Resolve provider-authored wire routing even when the model is gateway-only
 * and therefore absent from OMP's bundled model snapshot. OMP's compiled
 * api-routes table is the same authoritative surface its provider managers use
 * for ids such as OpenCode Go Muse Spark.
 */
export function findCatalogProtocolCapability(
	reference: string,
	liveModelId?: string,
): PifrostWireProtocol[] | undefined {
	const providers = preferredCatalogProviders(reference);
	if (!providers.length) return undefined;
	const ids = [...new Set([
		routeModelId(reference),
		...(liveModelId ? [routeModelId(liveModelId)] : []),
	].filter(Boolean))];

	const resolved: PifrostWireProtocol[] = [];
	for (const provider of providers) {
		for (const id of ids) {
			const route = ompCatalogRuntime?.apiRouteFor(provider, id);
			const protocol = route ? wireProtocolsFrom([route.api])?.[0] : undefined;
			if (protocol) resolved.push(protocol);
		}
	}
	if (!resolved.length) return undefined;
	const uniqueProtocols = [...new Set(resolved)];
	// Alias/provider fallbacks must agree. Ambiguity is safer than inventing a
	// transport contract for a provider family with divergent authored routes.
	return uniqueProtocols.length === 1 ? uniqueProtocols : undefined;
}

function thinking(efforts: EffortName[], requiresEffort = false): Thinking {
	return {
		mode: "effort",
		efforts: efforts as unknown as Thinking["efforts"],
		effortMap: Object.fromEntries(efforts.map((effort) => [effort, effort])) as Thinking["effortMap"],
		...(requiresEffort ? { requiresEffort: true } : {}),
	};
}

function mappedThinking(
	effortMap: Partial<Record<EffortName, string>>,
	requiresEffort = false,
): Thinking {
	const efforts = EFFORTS.filter((effort) => effortMap[effort] !== undefined);
	return {
		mode: "effort",
		efforts: efforts as unknown as Thinking["efforts"],
		effortMap: Object.fromEntries(efforts.map((effort) => [effort, effortMap[effort]!])) as Thinking["effortMap"],
		...(requiresEffort ? { requiresEffort: true } : {}),
	};
}

// Narrow vendor-backed capability records. These are intentionally separate
// from the OMP bundled-catalog fallback so the resolver can honour the explicit
// priority: live -> Bifrost -> canonical family -> vendor override -> fallback.
const VERIFIED_MODEL_HINTS: Record<string, CatalogCapabilityFallback> = {
	"ox-alpha": {
		source: "verified-model-hint",
		matched: ["verified/stealth/ox-alpha"],
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		input: ["text", "image"],
		reasoning: true,
		thinking: thinking(["low", "high", "max"], true),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		supportsTools: true,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsForcedToolChoice: true,
		supportsNamedToolChoice: true,
		disableReasoningOnToolChoice: false,
	},
	"deepseek-v4-flash-vision-exp": {
		source: "verified-model-hint",
		matched: ["verified/deepseek/deepseek-v4-flash-vision-exp"],
		contextWindow: 1_048_576,
		maxTokens: 384_000,
		input: ["text", "image"],
		reasoning: true,
		thinking: thinking(["high", "xhigh"]),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		protocols: ["openai-completions"],
		supportsTools: true,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsForcedToolChoice: true,
		supportsNamedToolChoice: true,
		disableReasoningOnToolChoice: false,
	},
	"pixel-canary": {
		source: "verified-model-hint",
		matched: ["verified/stealth/pixel-canary"],
		// Command Code publishes a 262K context; Vercel's model contract
		// publishes a 131,072-token output ceiling and image input support.
		contextWindow: 262_144,
		maxTokens: 131_072,
		input: ["text", "image"],
		reasoning: true,
		thinking: mappedThinking({
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
		}),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		supportsTools: true,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		// The public contracts establish generic tool use but not every forced
		// or named tool-choice form through each reseller surface.
		supportsForcedToolChoice: false,
		supportsNamedToolChoice: false,
		// Keep reasoning+tools conservative until the reseller contract
		// explicitly guarantees the combination. This is distinct from OMP's
		// tool_choice-triggered reasoning suppression policy.
		supportsReasoningWithTools: false,
		disableReasoningOnToolChoice: false,
	},
	"mimo-v2.6-flash": {
		source: "verified-model-hint",
		matched: ["verified/xiaomi/mimo-v2.6-flash"],
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		input: ["text", "image"],
		reasoning: true,
		thinking: mappedThinking({
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "high",
			max: "high",
		}),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		protocols: ["openai-completions"],
		supportsTools: true,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsForcedToolChoice: false,
		supportsNamedToolChoice: false,
		disableReasoningOnToolChoice: false,
	},
	"mimo-v2.6-pro": {
		source: "verified-model-hint",
		matched: ["verified/xiaomi/mimo-v2.6-pro"],
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		input: ["text", "image"],
		reasoning: true,
		thinking: mappedThinking({
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "high",
			max: "high",
		}),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		protocols: ["openai-completions"],
		supportsTools: true,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsForcedToolChoice: false,
		supportsNamedToolChoice: false,
		disableReasoningOnToolChoice: false,
	},
	"longcat-2.0-commandcode-free": {
		source: "verified-model-hint",
		matched: ["verified/commandcode-goat/meituan/longcat-2.0:free"],
		// CommandCode GOAT currently exposes this exact free entitlement. The
		// upstream LongCat-2.0 contract publishes a 1M context window and a
		// 131,072-token output ceiling. Keep the hint exact to this provider/SKU:
		// arbitrary :free variants must not inherit paid-model limits.
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		input: ["text"],
		reasoning: true,
		// LongCat exposes thinking as enabled/disabled, not a portable effort
		// ladder. Do not invent low/medium/high reasoning-effort semantics.
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		protocols: ["openai-completions"],
		supportsTools: true,
		supportsReasoningEffort: false,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		// The vendor documents native tool calling but not every forced/named
		// tool_choice sub-form through this reseller entitlement. Stay conservative.
		supportsForcedToolChoice: false,
		supportsNamedToolChoice: false,
		disableReasoningOnToolChoice: false,
	},
	"laguna-s-2.1-free": {
		source: "verified-model-hint",
		matched: ["verified/poolside/laguna-s-2.1-free"],
		// Current hosted free endpoints publish 256K context and 32,768 output.
		// Use 256,000 rather than 262,144 where providers differ in K semantics.
		contextWindow: 256_000,
		maxTokens: 32_768,
		input: ["text"],
		// Reasoning exists on some hosted surfaces, but Pifrost does not assume a
		// portable effort contract for the subscription alias. Under-advertise it.
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		protocols: ["openai-completions"],
		supportsTools: true,
		supportsReasoningEffort: false,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsForcedToolChoice: true,
		supportsNamedToolChoice: true,
		disableReasoningOnToolChoice: false,
	},
};

/**
 * Vendor overrides are intentionally qualified. A bare model id may match a
 * known vendor model, but an explicitly different vendor must never inherit the
 * override merely because the model tail happens to be identical.
 */
export function findVendorCapabilityOverride(
	reference: string,
	liveModelId?: string,
): CatalogCapabilityFallback | undefined {
	const values = [reference, liveModelId].filter((value): value is string => Boolean(value));
	if (values.some((value) => equivalentModelId(value, "stealth/ox-alpha"))) {
		return VERIFIED_MODEL_HINTS["ox-alpha"];
	}
	if (values.some((value) => equivalentModelId(value, "deepseek/deepseek-v4-flash-vision-exp"))) {
		return VERIFIED_MODEL_HINTS["deepseek-v4-flash-vision-exp"];
	}
	if (values.some((value) => equivalentModelId(value, "stealth/pixel-canary"))) {
		return VERIFIED_MODEL_HINTS["pixel-canary"];
	}
	if (values.some((value) => equivalentModelId(value, "xiaomi/mimo-v2.6-flash"))) {
		return VERIFIED_MODEL_HINTS["mimo-v2.6-flash"];
	}
	if (values.some((value) => equivalentModelId(value, "xiaomi/mimo-v2.6-pro"))) {
		return VERIFIED_MODEL_HINTS["mimo-v2.6-pro"];
	}
	if (
		routeProvider(reference) === "commandcode goat" &&
		equivalentModelId(reference, "meituan/longcat-2.0:free")
	) {
		return VERIFIED_MODEL_HINTS["longcat-2.0-commandcode-free"];
	}
	if (values.some((value) => equivalentModelId(value, "poolside/laguna-s-2.1-free"))) {
		return VERIFIED_MODEL_HINTS["laguna-s-2.1-free"];
	}
	return undefined;
}

let catalogCache: CatalogModelLike[] | undefined;

function bundledCatalog(): CatalogModelLike[] {
	if (catalogCache) return catalogCache;
	const models: CatalogModelLike[] = [];
	for (const provider of ompCatalogRuntime?.getBundledProviders() ?? []) {
		for (const model of ompCatalogRuntime?.getBundledModels(provider) ?? []) {
			if (!model?.id) continue;
			models.push({ ...model, provider: model.provider ?? provider } as CatalogModelLike);
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

function thinkingNames(config: Thinking | undefined): EffortName[] {
	if (!config) return [];
	const set = new Set(config.efforts.map(String));
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
	const modelThinking = reasoning ? intersectThinking(complete) : undefined;
	const image = complete.every((model) => model.input?.includes("image"));
	const costs = complete.map((model) => ({
		input: positive(model.cost?.input) || model.cost?.input === 0 ? model.cost.input : 0,
		output: positive(model.cost?.output) || model.cost?.output === 0 ? model.cost.output : 0,
		cacheRead: positive(model.cost?.cacheRead) || model.cost?.cacheRead === 0 ? model.cost.cacheRead : 0,
		cacheWrite: positive(model.cost?.cacheWrite) || model.cost?.cacheWrite === 0 ? model.cost.cacheWrite : 0,
	}));
	const protocolRows = complete.map((model) => wireProtocolsFrom(model.api ? [model.api] : undefined));
	const protocolKeys = protocolRows.map((protocols) => protocols?.join(","));
	const protocols =
		protocolKeys.every((value) => Boolean(value)) && new Set(protocolKeys).size === 1
			? protocolRows[0]
			: undefined;
	const reasoningWithTools = complete.some((model) => model.compat?.supportsReasoningWithTools === false)
		? false
		: complete.every((model) => model.compat?.supportsReasoningWithTools === true)
			? true
			: undefined;
	const betweenToolsThinking = complete.some((model) => model.compat?.supportsBetweenToolsThinking === false)
		? false
		: complete.every((model) => model.compat?.supportsBetweenToolsThinking === true)
			? true
			: undefined;
	const serviceTierLists = complete.map((model) => model.serviceTiers?.map(String).filter(Boolean));
	const serviceTiers = serviceTierLists.every((tiers) => Boolean(tiers?.length))
		? [...serviceTierLists.slice(1).reduce(
			(set, tiers) => new Set([...set].filter((tier) => tiers!.includes(tier))),
			new Set(serviceTierLists[0]!),
		)]
		: undefined;
	const pricingStates = complete.map((model) => model.pricingStatus ?? (Object.values(model.cost ?? {}).some((value) => typeof value === "number" && value > 0) ? "fixed" : "unknown"));
	const pricingStatus: OmpModel["pricingStatus"] = new Set(pricingStates).size === 1
		? (pricingStates[0] === "fixed" ? undefined : pricingStates[0] as OmpModel["pricingStatus"])
		: "variable";
	return {
		source,
		matched: complete.map((model) => `${model.provider ?? "unknown"}/${model.id}`),
		contextWindow: Math.min(...complete.map((model) => model.contextWindow as number)),
		maxTokens: Math.min(...complete.map((model) => model.maxTokens as number)),
		input: image ? ["text", "image"] : ["text"],
		reasoning,
		thinking: modelThinking,
		cost: {
			input: Math.max(...costs.map((cost) => cost.input)),
			output: Math.max(...costs.map((cost) => cost.output)),
			cacheRead: Math.max(...costs.map((cost) => cost.cacheRead)),
			cacheWrite: Math.max(...costs.map((cost) => cost.cacheWrite)),
		},
		supportsTools: complete.every((model) => model.supportsTools !== false),
		supportsReasoningEffort: Boolean(modelThinking),
		supportsUsageInStreaming: complete.every((model) => model.compat?.supportsUsageInStreaming !== false),
		supportsToolChoice: complete.every((model) => model.compat?.supportsToolChoice !== false),
		supportsForcedToolChoice: complete.every((model) => model.compat?.supportsForcedToolChoice !== false),
		supportsNamedToolChoice: complete.every((model) => model.compat?.supportsNamedToolChoice !== false),
		...(reasoningWithTools !== undefined ? { supportsReasoningWithTools: reasoningWithTools } : {}),
		...(betweenToolsThinking !== undefined ? { supportsBetweenToolsThinking: betweenToolsThinking } : {}),
		supportsServiceTier: complete.every((model) => (model.serviceTiers?.length ?? 0) > 0),
		...(serviceTiers?.length ? { serviceTiers } : {}),
		...(pricingStatus ? { pricingStatus } : {}),
		disableReasoningOnToolChoice: complete.some((model) => model.compat?.disableReasoningOnToolChoice === true),
		...(protocols ? { protocols } : {}),
	};
}

export function findCatalogCapabilityFallback(
	reference: string,
	liveModelId?: string,
	catalogOverride?: readonly CatalogModelLike[],
): CatalogCapabilityFallback | undefined {
	const all = catalogOverride ? [...catalogOverride] : bundledCatalog();
	const preferred = new Set(preferredCatalogProviders(reference));
	const targets = [reference, liveModelId].filter((value): value is string => Boolean(value));
	const matchesIdentity = (model: CatalogModelLike): boolean =>
		targets.some((target) => equivalentModelId(target, model.id));

	if (preferred.size) {
		const providerMatches = all.filter((model) => preferred.has(normalized(model.provider ?? "")) && matchesIdentity(model));
		const exactProviderFallback = toFallback(providerMatches, "omp-catalog-provider");
		if (exactProviderFallback) return exactProviderFallback;
	}

	return toFallback(all.filter(matchesIdentity), "omp-catalog-family");
}
