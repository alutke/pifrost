import {
	resolveAliasReferenceDetailed,
	type BifrostProviderModel,
	type PifrostAliasConfig,
} from "./index.ts";

function routeReferences(aliasConfig: PifrostAliasConfig): string[] {
	const references: string[] = [];
	for (const definition of Object.values(aliasConfig.aliases)) {
		const chain = Array.isArray(definition) ? definition : definition.chain;
		references.push(...chain);
	}
	return [...new Set(references)];
}

/**
 * A configured Bifrost route can legitimately reference a model that the
 * inference Virtual Key can invoke even while Bifrost's aggregated /v1/models
 * inventory has not learned that alias yet. This placeholder carries NO trusted
 * capabilities: every field is explicitly marked fallback so datasheet/vendor/
 * catalog enrichment must establish safe limits before the route can synthesize.
 */
function metadataOnlyRouteMember(reference: string): BifrostProviderModel {
	return {
		id: reference,
		name: reference,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsTools: false,
		capabilitySources: {
			contextWindow: "fallback",
			maxTokens: "fallback",
			image: "fallback",
			reasoning: "fallback",
			reasoningEfforts: "fallback",
			tools: "fallback",
		},
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
		},
	};
}

/**
 * Add metadata-only identities for configured route members absent from the live
 * inventory. Ambiguous live identities are deliberately NOT augmented: that is
 * a safety failure requiring diagnostics, not a reason to guess.
 */
export function augmentLiveInventoryForRoutes(
	liveModels: readonly BifrostProviderModel[],
	aliasConfig: PifrostAliasConfig,
): BifrostProviderModel[] {
	const augmented = [...liveModels];
	for (const reference of routeReferences(aliasConfig)) {
		const resolution = resolveAliasReferenceDetailed(reference, liveModels);
		if (resolution.model || resolution.reason === "ambiguous") continue;
		augmented.push(metadataOnlyRouteMember(reference));
	}
	return augmented;
}
