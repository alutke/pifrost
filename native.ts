import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	ModelSpec,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import {
	streamOpenAICompletions,
	type OpenAICompletionsOptions,
} from "@oh-my-pi/pi-ai/providers/openai-completions";
import {
	streamOpenAIResponses,
	type OpenAIResponsesOptions,
} from "@oh-my-pi/pi-ai/providers/openai-responses";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModels, getBundledProviders } from "@oh-my-pi/pi-catalog";
import { apiRouteFor } from "@oh-my-pi/pi-catalog/compat/behavior";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import { registerBifrostRichContentBridge } from "./bifrost-rich-content.ts";
import { installPifrostTextTokenCounter } from "./omp-context-policy.ts";
import {
	applyBifrostAuthoritativeCost,
	createBifrostCostBridgeFetch,
	type BifrostCostCapture,
} from "./bifrost-cost-bridge.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	buildPifrostTransportModel,
	installPifrostModelPolicyResolver,
} from "./transport-model.ts";
import {
	installOmpCatalogRuntime,
	type CatalogModelLike,
} from "./catalog-fallback.ts";

import {
	buildPifrostCatalog,
	fetchBifrostModels,
	flagFromArgv,
	formatDoctorReport,
	loadAliasConfig,
	optionalConfigFromEnvironment,
	PIFROST_API,
	pifrostSessionHeaders,
	pifrostProviderHeaders,
	PROVIDER_ID,
	type AliasDiagnostic,
	type BifrostConfig,
	type PifrostCatalog,
} from "./index.ts";
import { buildRichRouteCatalog, fetchBifrostDatasheets } from "./datasheet.ts";
import {
	cacheIsFresh,
	DEFAULT_REFRESH_INTERVAL_MS,
	loadCatalogCache,
	writeCatalogCache,
} from "./cache.ts";
import { loadStoredRuntimeConfig, storedRuntimeConfigDiagnostics } from "./config-store.ts";
import {
	normalizeModelParametersDatasheet,
	normalizePricingDatasheet,
} from "./pricing-normalize.ts";
import { augmentLiveInventoryForRoutes } from "./route-inventory.ts";
import { createBifrostUsageProvider } from "./bifrost-usage.ts";
import {
	createModelAwareContextTokenizer,
	estimateOmpContextInputTokens,
} from "./context-estimator.ts";
import {
	applyDynamicRouteProfiles,
	createDynamicRoutingFetch,
	extractDynamicRouteProfiles,
	planDynamicRouteAttempts,
	resolveDynamicMemberProtocolForRequest,
	PIFROST_NATIVE_PROTOCOLS,
	type DynamicRouteAttempt,
	type DynamicRoutePlan,
	type DynamicRouteProfile,
} from "./dynamic-routing.ts";
import {
	bifrostAttemptExtraBody,
	createPifrostAttemptModelSpec,
	createPifrostMemberModelSpec,
	pifrostAttemptMaxTokens,
	runPifrostProtocolPlan,
} from "./multi-protocol-routing.ts";
import { createCompactBeforeSkipCoordinator } from "./compact-before-skip.ts";
import { bridgePifrostPayload, deferredToolNames } from "./capability-bridge.ts";
import {
	activePifrostCfgSession,
	applyPifrostOmpProfile,
	formatPifrostOmpProfile,
	formatPifrostOmpWrites,
	normalizePifrostOmpSetting,
	readPifrostOmpProfile,
	writePifrostOmpSetting,
} from "./omp-cfg.ts";
import {
	bindAgentSession,
	formatAgentAttributionReport,
	recordAgentRequest,
	releaseAgentSession,
} from "./agent-attribution.ts";
import {
	formatPifrostRouteTraces,
	recordBifrostCaptureTrace,
	releasePifrostRouteTraces,
} from "./request-provenance.ts";

installPifrostModelPolicyResolver((spec) => resolveModelPolicy(spec));

installOmpCatalogRuntime({
	getBundledProviders: () => getBundledProviders(),
	getBundledModels: (provider) =>
		getBundledModels(provider as Parameters<typeof getBundledModels>[0]) as unknown as CatalogModelLike[],
	apiRouteFor: (provider, modelId) =>
		apiRouteFor(
			provider as Parameters<typeof apiRouteFor>[0],
			modelId,
		),
});

let runtimeDynamicRoutes = new Map<string, DynamicRouteProfile>();

function installDynamicRouteProfiles(models: readonly import("./index.ts").BifrostProviderModel[]): void {
	runtimeDynamicRoutes = extractDynamicRouteProfiles(models);
}

const scheduleCompactBeforeContextSkip = createCompactBeforeSkipCoordinator(
	(logicalModel) => runtimeDynamicRoutes.get(logicalModel.toLowerCase()),
);

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function messageWithBifrostCost(
	message: AssistantMessage,
	capture: BifrostCostCapture,
): AssistantMessage {
	return {
		...message,
		usage: applyBifrostAuthoritativeCost(message.usage, capture),
	};
}

function eventWithBifrostCost(
	event: AssistantMessageEvent,
	capture: BifrostCostCapture,
): AssistantMessageEvent {
	switch (event.type) {
		case "done":
			return { ...event, message: messageWithBifrostCost(event.message, capture) };
		case "error":
			return { ...event, error: messageWithBifrostCost(event.error, capture) };
		default:
			return {
				...event,
				partial: messageWithBifrostCost(event.partial, capture),
			} as AssistantMessageEvent;
	}
}

function bridgeBifrostUsageCostStream(
	source: AssistantMessageEventStream,
	capture: BifrostCostCapture,
	onTerminal?: (outcome: "done" | "error" | "thrown") => void,
): AssistantMessageEventStream {
	const output = new AssistantMessageEventStream();
	output.forwardLocalWorkFrom(source);
	void (async () => {
		let recorded = false;
		const terminal = (outcome: "done" | "error" | "thrown") => {
			if (recorded) return;
			recorded = true;
			onTerminal?.(outcome);
		};
		try {
			for await (const event of source) {
				output.push(eventWithBifrostCost(event, capture));
				if (event.type === "done" || event.type === "error") terminal(event.type);
			}
		} catch (error) {
			terminal("thrown");
			output.fail(error);
		} finally {
			output.forwardLocalWorkFrom(undefined);
		}
	})();
	return output;
}

function pifrostSupportsBetweenToolsThinking(model: Model): boolean {
	const compat = model.compatConfig as (Record<string, unknown> | undefined);
	return compat?.supportsBetweenToolsThinking === true;
}


function normalizePifrostReasoningOptions(
	model: Model,
	options: SimpleStreamOptions | undefined,
	allowBetweenToolsThinking = false,
): SimpleStreamOptions | undefined {
	if (allowBetweenToolsThinking && options?.disableReasoning === true) return options;
	if (
		!model.reasoning ||
		!model.thinking?.requiresEffort ||
		model.thinking.suppressWhenOff ||
		(options?.reasoning !== undefined && !options.disableReasoning && !options.forceReasoningOff)
	) {
		return options;
	}
	const floor = model.thinking.efforts[0];
	if (floor === undefined) return options;
	return {
		...options,
		reasoning: floor,
		disableReasoning: undefined,
		forceReasoningOff: undefined,
	};
}

function resolvePifrostReasoningEffort(
	model: Model,
	options: SimpleStreamOptions | undefined,
): OpenAICompletionsOptions["reasoning"] {
	const reasoning = options?.reasoning;
	if (!reasoning || !model.reasoning || !model.thinking) return undefined;
	if (model.thinking.efforts.includes(reasoning) || model.thinking.effortMap?.[reasoning] !== undefined) {
		return reasoning;
	}
	throw new Error(`Pifrost model ${model.id} does not support reasoning effort ${reasoning}`);
}

function mapPifrostOpenAIToolChoice(
	choice: SimpleStreamOptions["toolChoice"],
): OpenAICompletionsOptions["toolChoice"] {
	if (!choice) return undefined;
	if (typeof choice === "string") {
		if (choice === "any") return "required";
		if (choice === "auto" || choice === "none" || choice === "required") return choice;
		return undefined;
	}
	if (choice.type === "tool") {
		return choice.name ? { type: "function", function: { name: choice.name } } : undefined;
	}
	if (choice.type === "function") {
		const name = "function" in choice ? choice.function?.name : choice.name;
		return name ? { type: "function", function: { name } } : undefined;
	}
	return undefined;
}

function dynamicRoutePlanningBody(
	model: Model,
	context: Context,
	options: SimpleStreamOptions | undefined,
	capabilities: { deferredTools: ReadonlySet<string>; betweenToolsThinking: boolean },
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: model.id,
		messages: context.messages,
		max_completion_tokens: options?.maxTokens ?? model.maxTokens,
	};
	if (context.tools?.length) {
		body.tools = capabilities.deferredTools.size
			? [...context.tools, { type: "tool_search" }]
			: context.tools;
	}
	if (options?.serviceTier) body.service_tier = options.serviceTier;
	if (capabilities.betweenToolsThinking) body.reasoning = { type: "between_tools" };
	const toolChoice = mapPifrostOpenAIToolChoice(options?.toolChoice);
	if (toolChoice !== undefined) body.tool_choice = toolChoice;
	if (!options?.disableReasoning && !options?.forceReasoningOff) {
		const reasoning = resolvePifrostReasoningEffort(model, options);
		if (reasoning !== undefined) body.reasoning_effort = reasoning;
	}
	return body;
}

function pifrostAttemptHeaders(
	headers: Record<string, string> | undefined,
	sessionId: string,
	plan: DynamicRoutePlan,
	attempt: DynamicRouteAttempt,
	attemptIndex: number,
): Record<string, string> {
	const result = pifrostSessionHeaders(headers, sessionId);
	result["x-pifrost-logical-model"] = plan.logicalModel;
	result["x-pifrost-route-protocol"] = attempt.protocol;
	result["x-pifrost-route-attempt"] = String(attemptIndex + 1);
	result["x-pifrost-route-primary"] = attempt.primary;
	result["x-pifrost-estimated-input-tokens"] = String(plan.estimatedInputTokens);
	result["x-pifrost-required-context-tokens"] = String(plan.requiredContextTokens);
	result["x-pifrost-eligible-members"] = String(
		plan.attempts.reduce((sum, item) => sum + item.members.length, 0),
	);
	return result;
}

function streamDynamicPifrostRoute(
	model: Model,
	context: Context,
	options: SimpleStreamOptions | undefined,
	rawOptions: SimpleStreamOptions | undefined,
	sessionId: string,
	profile: DynamicRouteProfile,
) {
	const deferredTools = deferredToolNames(context.tools);
	const betweenToolsThinking = options?.disableReasoning === true && profile.members.some((member) => member.compat.supportsBetweenToolsThinking === true);
	const planningBody = dynamicRoutePlanningBody(model, context, options, { deferredTools, betweenToolsThinking });
	const estimatedInputTokensByMember = new Map<string, number>();
	for (const member of profile.members) {
		const protocol = resolveDynamicMemberProtocolForRequest(member, planningBody, PIFROST_NATIVE_PROTOCOLS);
		if (!protocol) continue;
		try {
			const candidate = buildPifrostTransportModel(
				createPifrostMemberModelSpec(model, member, protocol),
			);
			const estimate = estimateOmpContextInputTokens(
				context,
				createModelAwareContextTokenizer({
					id: candidate.id,
					api: candidate.api,
					tokenizer: candidate.tokenizer,
					identity: candidate.identity,
				}),
				{
					anchorModelIds: [
						member.reference,
						member.resolvedModelId,
						candidate.id,
					],
				},
			);
			estimatedInputTokensByMember.set(member.reference, estimate);
		} catch {
			// Unknown policy must not make a route unusable. The dependency-free
			// semantic fallback below remains conservative for the candidate.
		}
	}
	const estimatedInputTokens = estimateOmpContextInputTokens(
		context,
		createModelAwareContextTokenizer({ api: model.api, identity: model.identity, id: model.id, tokenizer: model.tokenizer }),
	);
	const plan = planDynamicRouteAttempts(profile, planningBody, {
		estimatedInputTokens,
		estimatedInputTokensByMember,
		outputCapExplicit: rawOptions?.maxTokens !== undefined,
	});
	const underlyingFetch = options?.fetch ?? globalThis.fetch;
	const reasoning = resolvePifrostReasoningEffort(model, options);
	const outer = new AssistantMessageEventStream();

	void runPifrostProtocolPlan(model, plan, outer, (attempt, attemptIndex) => {
		const costCapture: BifrostCostCapture = {};
		const baseFetch = createBifrostCostBridgeFetch(underlyingFetch, costCapture);
		const transportModel = buildPifrostTransportModel(createPifrostAttemptModelSpec(model, attempt));
		const headers = pifrostAttemptHeaders(options?.headers, sessionId, plan, attempt, attemptIndex);
		const maxTokens = pifrostAttemptMaxTokens(attempt, options?.maxTokens ?? model.maxTokens ?? undefined);
		if (attempt.protocol === "openai-responses") {
			const upstreamOnPayload = options?.onPayload;
			const responseOptions: OpenAIResponsesOptions = {
				...options,
				apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
				maxTokens,
				headers,
				reasoning,
				disableReasoning: options?.disableReasoning,
				toolChoice: options?.toolChoice,
				serviceTier: options?.serviceTier,
				openrouterVariant: options?.openrouterVariant,
				maxTokensExplicit: rawOptions?.maxTokens !== undefined,
				promptCache: options?.promptCache,
				// OMP defaults stateful Responses off for third-party proxies.
				// Keep full-context replay through Bifrost: Pifrost cannot prove
				// immutable provider/key affinity plus a common server-side response
				// store across future turns, even for a currently single-member route.
				statefulResponses: false,
				onPayload: async (payload, requestModel, signal) => {
					const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
					return bridgePifrostPayload(upstream, {
						deferredTools,
						enableToolSearch: deferredTools.size > 0,
						betweenToolsThinking,
					});
				},
				extraBody: bifrostAttemptExtraBody(attempt),
				fetch: baseFetch,
			};
			return bridgeBifrostUsageCostStream(
				streamOpenAIResponses(
					transportModel as Model<"openai-responses">,
					context,
					responseOptions,
				),
				costCapture,
				(outcome) => recordBifrostCaptureTrace(sessionId, {
					logicalModel: plan.logicalModel,
					protocol: attempt.protocol,
					attempt: attemptIndex + 1,
					requestedPrimary: attempt.primary,
					outcome,
				}, costCapture),
			);
		}

		const upstreamOnPayload = options?.onPayload;
		const chatOptions: OpenAICompletionsOptions = {
			...options,
			apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
			maxTokens,
			headers,
			reasoning,
			disableReasoning: options?.disableReasoning,
			toolChoice: mapPifrostOpenAIToolChoice(options?.toolChoice),
			serviceTier: options?.serviceTier,
			openrouterVariant: options?.openrouterVariant,
			maxTokensExplicit: rawOptions?.maxTokens !== undefined,
			promptCache: options?.promptCache,
			onPayload: betweenToolsThinking
				? async (payload, requestModel, signal) => {
					const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
					return bridgePifrostPayload(upstream, { betweenToolsThinking: true });
				}
				: upstreamOnPayload,
			fetch: baseFetch,
		};
		return bridgeBifrostUsageCostStream(
			streamOpenAICompletions(
				transportModel as Model<"openai-completions">,
				context,
				chatOptions,
			),
			costCapture,
			(outcome) => recordBifrostCaptureTrace(sessionId, {
				logicalModel: plan.logicalModel,
				protocol: attempt.protocol,
				attempt: attemptIndex + 1,
				requestedPrimary: attempt.primary,
				outcome,
			}, costCapture),
		);
	}).catch((error) => outer.fail(error));

	return outer;
}

/**
 * Custom transport used by Pifrost's logical Bifrost provider.
 *
 * OMP supplies a stable per-conversation sessionId before invoking custom
 * provider transports. Pifrost sends it directly as x-bf-session-id for
 * Bifrost session affinity and also through the x-bf-eh-* escape hatch so
 * OpenCode Go receives x-opencode-session after Bifrost routing.
 */
function streamPifrostOpenAI(
	model: Model,
	context: Context,
	rawOptions?: SimpleStreamOptions,
) {
	const sessionId = nonEmpty(rawOptions?.sessionId);
	if (!sessionId) {
		throw new Error("Pifrost requires OMP to supply an inference session id");
	}
	recordAgentRequest(sessionId, model.id);
	const profile = runtimeDynamicRoutes.get(model.id.toLowerCase());
	const allowBetweenToolsThinking = profile
		? profile.members.some((member) => member.compat.supportsBetweenToolsThinking === true)
		: pifrostSupportsBetweenToolsThinking(model);
	const options = normalizePifrostReasoningOptions(model, rawOptions, allowBetweenToolsThinking);
	if (profile) {
		return streamDynamicPifrostRoute(model, context, options, rawOptions, sessionId, profile);
	}

	// Non-dynamic aliases and physical models retain the long-standing Chat
	// transport. The fetch wrapper is kept as a no-op-compatible guard for
	// callers that install a route profile between model selection and dispatch.
	const transportModel = buildPifrostTransportModel({
		...model,
		api: "openai-completions",
		compat: model.compatConfig,
	} as ModelSpec<"openai-completions">);
	const costCapture: BifrostCostCapture = {};
	const baseFetch = createBifrostCostBridgeFetch(options?.fetch ?? globalThis.fetch, costCapture);
	const upstreamOnPayload = options?.onPayload;
	const betweenToolsThinking = options?.disableReasoning === true && pifrostSupportsBetweenToolsThinking(model);
	const streamOptions: OpenAICompletionsOptions = {
		...options,
		apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
		maxTokens: options?.maxTokens ?? model.maxTokens ?? undefined,
		headers: pifrostSessionHeaders(options?.headers, sessionId),
		reasoning: resolvePifrostReasoningEffort(model, options),
		disableReasoning: options?.disableReasoning,
		toolChoice: mapPifrostOpenAIToolChoice(options?.toolChoice),
		serviceTier: options?.serviceTier,
		openrouterVariant: options?.openrouterVariant,
		maxTokensExplicit: rawOptions?.maxTokens !== undefined,
		promptCache: options?.promptCache,
		onPayload: betweenToolsThinking
			? async (payload, requestModel, signal) => {
				const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
				return bridgePifrostPayload(upstream, { betweenToolsThinking: true });
			}
			: upstreamOnPayload,
		fetch: createDynamicRoutingFetch(baseFetch, runtimeDynamicRoutes, {
			outputCapExplicit: rawOptions?.maxTokens !== undefined,
		}),
	};
	return bridgeBifrostUsageCostStream(
		streamOpenAICompletions(transportModel, context, streamOptions),
		costCapture,
		(outcome) => recordBifrostCaptureTrace(sessionId, {
			logicalModel: model.id,
			protocol: "openai-completions",
			attempt: 1,
			requestedPrimary: model.id,
			outcome,
		}, costCapture),
	);
}

function positiveEnvMilliseconds(name: string, fallback: number): number {
	const raw = nonEmpty(process.env[name]);
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function forceRefreshRequested(): boolean {
	return /^(?:1|true|yes)$/iu.test(nonEmpty(process.env.PIFROST_FORCE_REFRESH) ?? "");
}

async function fetchFreshCatalog(
	config: BifrostConfig,
	aliasSource: ReturnType<typeof loadAliasConfig>,
	resolvedApiKey?: string,
): Promise<PifrostCatalog> {
	const liveConfig: BifrostConfig = {
		url: config.url,
		// In VK-only mode OMP's resolved provider key is the VK itself; do not
		// reinterpret it as a second Bearer credential for discovery.
		apiKey: config.apiKey ? (nonEmpty(resolvedApiKey) ?? config.apiKey) : undefined,
		virtualKey: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? config.virtualKey,
	};
	const hasAliases = Boolean(aliasSource.config && Object.keys(aliasSource.config.aliases ?? {}).length);
	let liveModels: Awaited<ReturnType<typeof fetchBifrostModels>>;
	let datasheets: Awaited<ReturnType<typeof fetchBifrostDatasheets>> | undefined;
	if (hasAliases) {
		[liveModels, datasheets] = await Promise.all([
			fetchBifrostModels(liveConfig, { signal: AbortSignal.timeout(10_000) }),
			fetchBifrostDatasheets({ signal: AbortSignal.timeout(10_000) }),
		]);
	} else {
		liveModels = await fetchBifrostModels(liveConfig, { signal: AbortSignal.timeout(10_000) });
	}

	let catalog: PifrostCatalog;
	if (!hasAliases || !datasheets || !aliasSource.config) {
		catalog = buildPifrostCatalog(liveModels, aliasSource.config);
	} else {
		const routeInventory = augmentLiveInventoryForRoutes(liveModels, aliasSource.config);
		const richRoutes = buildRichRouteCatalog(routeInventory, aliasSource.config, {
			pricing: normalizePricingDatasheet(datasheets.pricing),
			parameters: normalizeModelParametersDatasheet(datasheets.parameters),
		});
		catalog = buildPifrostCatalog(richRoutes.models, aliasSource.config, richRoutes.diagnostics);
		const richById = new Map(richRoutes.models.map((candidate) => [candidate.id.toLowerCase(), candidate]));
		catalog = applyDynamicRouteProfiles(
			catalog,
			richRoutes.models,
			aliasSource.config,
			(reference) => richById.get(reference.trim().toLowerCase()),
		);
	}

	// The no-datasheet path is uncommon for configured aliases, but keep it
	// capability-safe and dynamic when all route members exist in /v1/models.
	if ((!hasAliases || !datasheets) && aliasSource.config) {
		const liveById = new Map(liveModels.map((candidate) => [candidate.id.toLowerCase(), candidate]));
		catalog = applyDynamicRouteProfiles(
			catalog,
			liveModels,
			aliasSource.config,
			(reference) => liveById.get(reference.trim().toLowerCase()),
		);
	}
	installDynamicRouteProfiles(catalog.models);
	writeCatalogCache(catalog, { config: liveConfig, aliasConfig: aliasSource.config });
	return catalog;
}

/**
 * Native OMP 18 extension entry point.
 *
 * Startup is deliberately cache-first: the last-known-good non-secret model catalog is
 * registered synchronously so OMP can select a model immediately. Network-backed Bifrost
 * and datasheet discovery refreshes that cache separately, avoiding the previous no-model
 * period and long interactive startup stalls.
 *
 * Runtime configuration precedence is: OMP CLI flag -> process environment -> the secure
 * configuration written by `pifrost global setup`.
 */
async function installOmpNativeTextTokenCounter(): Promise<void> {
	try {
		const natives = await import("@oh-my-pi/pi-natives");
		const encodings: Record<string, (typeof natives.Encoding)[keyof typeof natives.Encoding]> = {
			"claude-v3": natives.Encoding.ClaudeV3,
			"claude-v47": natives.Encoding.ClaudeV47,
			"claude-v5": natives.Encoding.ClaudeV5,
			"claude-v5-sonnet": natives.Encoding.ClaudeV5Sonnet,
			qwen3: natives.Encoding.Qwen3,
			"deepseek-v3": natives.Encoding.DeepSeekV3,
			"kimi-k2": natives.Encoding.KimiK2,
			glm5: natives.Encoding.Glm5,
		};
		installPifrostTextTokenCounter((value, tokenizer) => {
			const encoding = encodings[tokenizer];
			if (encoding === undefined) throw new Error(`Unknown OMP tokenizer family ${tokenizer}`);
			if (typeof value === "string") return natives.countTokens(value, encoding);
			let total = 0;
			for (const fragment of value) total += natives.countTokens(fragment, encoding);
			return total;
		});
	} catch {
		// Node-based diagnostics and older/partial OMP installs retain the portable
		// byte estimator. Runtime routing remains safe and the compatibility canary
		// reports host drift separately.
		installPifrostTextTokenCounter(undefined);
	}
}

export default async function pifrostProvider(pi: ExtensionAPI): Promise<void> {
	await installOmpNativeTextTokenCounter();
	registerBifrostRichContentBridge(pi);
	pi.registerFlag("bifrost-url", {
		description: "Bifrost OpenAI-compatible base URL (env: BIFROST_URL; fallback: Pifrost config)",
		type: "string",
	});
	pi.registerFlag("bifrost-api-key", {
		description: "Bifrost inference API key (env: BIFROST_API_KEY; fallback: Pifrost secret store)",
		type: "string",
	});
	pi.registerFlag("bifrost-virtual-key", {
		description: "Bifrost inference virtual key (env: BIFROST_VIRTUAL_KEY; fallback: Pifrost secret store)",
		type: "string",
	});
	pi.registerFlag("pifrost-aliases", {
		description: "Path to Pifrost alias manifest (env: PIFROST_ALIASES)",
		type: "string",
	});

	const flag = (name: string): string | undefined => {
		const value = pi.getFlag(name);
		return (typeof value === "string" ? nonEmpty(value) : undefined) ?? flagFromArgv(name);
	};

	const aliasSource = loadAliasConfig(flag("pifrost-aliases"));
	const stored = loadStoredRuntimeConfig();
	const mergedEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		BIFROST_URL: nonEmpty(process.env.BIFROST_URL) ?? stored.url,
		BIFROST_API_KEY: nonEmpty(process.env.BIFROST_API_KEY) ?? stored.apiKey,
		BIFROST_VIRTUAL_KEY: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? stored.virtualKey,
	};
	const config = optionalConfigFromEnvironment(mergedEnvironment, {
		url: flag("bifrost-url"),
		apiKey: flag("bifrost-api-key"),
		virtualKey: flag("bifrost-virtual-key"),
	});

	let diagnostics: AliasDiagnostic[] = [];
	let refreshInFlight: Promise<PifrostCatalog> | undefined;
	const refreshIntervalMs = positiveEnvMilliseconds("PIFROST_REFRESH_INTERVAL_MS", DEFAULT_REFRESH_INTERVAL_MS);

	if (config?.virtualKey) {
		const startupCache = loadCatalogCache({ config, aliasConfig: aliasSource.config });
		if (startupCache) {
			diagnostics = startupCache.diagnostics;
			installDynamicRouteProfiles(startupCache.models);
		}

		const refresh = (resolvedApiKey?: string): Promise<PifrostCatalog> => {
			if (!refreshInFlight) {
				refreshInFlight = fetchFreshCatalog(config, aliasSource, resolvedApiKey).finally(() => {
					refreshInFlight = undefined;
				});
			}
			return refreshInFlight;
		};

		const scheduleBackgroundRefresh = (resolvedApiKey?: string): void => {
			void refresh(resolvedApiKey)
				.then((catalog) => {
					diagnostics = catalog.diagnostics;
				})
				.catch((error) => {
					process.stderr.write(
						`pifrost: background catalog refresh failed: ${error instanceof Error ? error.message : String(error)}\n`,
					);
				});
		};

		const providerApiKey = config.apiKey ?? config.virtualKey;
		const virtualKeyBearerCompatible = /^sk-bf-/u.test(config.virtualKey);
		const usage = createBifrostUsageProvider(config);
		pi.registerProvider(PROVIDER_ID, {
			baseUrl: config.url,
			apiKey: providerApiKey,
			api: PIFROST_API,
			streamSimple: streamPifrostOpenAI,
			// Bifrost 2.x accepts sk-bf-* VKs as OpenAI Bearer credentials.
			// Legacy VK values remain x-bf-vk-only and therefore suppress the
			// generated Authorization header.
			authHeader: Boolean(config.apiKey || virtualKeyBearerCompatible),
			headers: pifrostProviderHeaders(config.virtualKey),
			...(usage ? { usage } : {}),
			...(startupCache ? { models: startupCache.models } : {}),
			async fetchDynamicModels(resolvedApiKey) {
				const cached = loadCatalogCache({ config, aliasConfig: aliasSource.config });
				if (cached && !forceRefreshRequested()) {
					diagnostics = cached.diagnostics;
					installDynamicRouteProfiles(cached.models);
					if (!cacheIsFresh(cached, refreshIntervalMs)) scheduleBackgroundRefresh(resolvedApiKey);
					return cached.models;
				}

				const catalog = await refresh(resolvedApiKey);
				diagnostics = catalog.diagnostics;
				return catalog.models;
			},
		});
	} else {
		process.stderr.write(
			"pifrost: provider not registered; run `pifrost global setup` or set BIFROST_URL and BIFROST_VIRTUAL_KEY (BIFROST_API_KEY is optional on Bifrost 2.x)\n",
		);
	}

	// OMP exposes manual compaction to extension contexts. Schedule the check
	// after a turn (and when a session is opened) instead of awaiting compaction
	// inside an extension event handler: LLM-backed compaction can legitimately
	// exceed OMP's generic 30-second handler budget. The coordinator only runs
	// while the session is idle and fails open to the final-wire skip guard.
	pi.on("agent_end", (_event, ctx) => {
		bindAgentSession(ctx.sessionManager.getSessionId(), ctx.agent);
		scheduleCompactBeforeContextSkip(ctx);
	});
	pi.on("session_start", (_event, ctx) => {
		bindAgentSession(ctx.sessionManager.getSessionId(), ctx.agent);
		scheduleCompactBeforeContextSkip(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		releaseAgentSession(sessionId);
		releasePifrostRouteTraces(sessionId);
	});

	pi.registerCommand("pifrost", {
		description: "Pifrost diagnostics, refresh and approval-aware OMP cfg:// integration",
		handler: async (args, ctx) => {
			const raw = args.trim();
			const command = raw.split(/\s+/u, 1)[0]?.toLowerCase() || "doctor";
			const cfgSession = async () => {
				if (ctx.agent.kind !== "main" || ctx.mode !== "tui" || !ctx.hasUI) {
					throw new Error("Pifrost cfg:// integration is available only in the interactive top-level OMP session");
				}
				return await activePifrostCfgSession({
					cwd: ctx.cwd,
					sessionId: ctx.sessionManager.getSessionId(),
					hasUI: ctx.hasUI,
					settingsApproval: true,
					taskDepth: ctx.agent.depth,
					agentKind: ctx.agent.kind,
				});
			};

			if (command === "trace") {
				ctx.ui.notify(formatPifrostRouteTraces(ctx.sessionManager.getSessionId()), "info");
				return;
			}

			if (command === "config") {
				try {
					const session = await cfgSession();
					const rest = raw.slice("config".length).trim();
					if (!rest || rest.toLowerCase() === "status") {
						ctx.ui.notify(formatPifrostOmpProfile(await readPifrostOmpProfile(session)), "info");
						return;
					}

					const apply = rest.match(/^apply(?:\s+(save))?$/iu);
					if (apply) {
						const save = Boolean(apply[1]);
						const writes = await applyPifrostOmpProfile(session, save);
						ctx.ui.notify(formatPifrostOmpWrites(writes), writes.some((item) => item.outcome === "declined") ? "warning" : "info");
						if (!save && writes.some((item) => item.outcome === "applied")) {
							const persist = await ctx.ui.confirm(
								"Persist Pifrost OMP profile?",
								"Session settings were applied through cfg://. Save the same values to global config.yml? OMP will still request approval for the persistent write.",
							);
							if (persist) {
								const saved = await applyPifrostOmpProfile(session, true);
								ctx.ui.notify(formatPifrostOmpWrites(saved), saved.some((item) => item.outcome === "declined") ? "warning" : "info");
							}
						}
						return;
					}

					const mutation = rest.match(/^(set|save)\s+(\S+)\s+([\s\S]+)$/iu);
					if (!mutation) {
						ctx.ui.notify(
							"Usage: /pifrost config [status] | apply [save] | set <setting> <json> | save <setting> <json>",
							"warning",
						);
						return;
					}
					const [, action, key, value] = mutation;
					const setting = normalizePifrostOmpSetting(key);
					if (!setting) {
						ctx.ui.notify(
							`Pifrost does not own OMP setting "${key}". Use cfg:// directly for non-Pifrost settings.`,
							"warning",
						);
						return;
					}
					const save = action.toLowerCase() === "save";
					const result = await writePifrostOmpSetting(session, setting, value, save);
					ctx.ui.notify(formatPifrostOmpWrites([result]), result.outcome === "declined" ? "warning" : "info");
					if (!save && result.outcome === "applied") {
						const persist = await ctx.ui.confirm(
							`Persist ${setting.id}?`,
							"Save this approved session change to global config.yml? OMP will request approval for the persistent write.",
						);
						if (persist) {
							const saved = await writePifrostOmpSetting(session, setting, value, true);
							ctx.ui.notify(formatPifrostOmpWrites([saved]), saved.outcome === "declined" ? "warning" : "info");
						}
					}
					return;
				} catch (error) {
					ctx.ui.notify(`Pifrost config failed: ${error instanceof Error ? error.message : String(error)}`, "error");
					return;
				}
			}

			if (command !== "doctor" && command !== "refresh") {
				ctx.ui.notify(
					"Usage: /pifrost doctor | /pifrost trace | /pifrost refresh | /pifrost config [status|apply|set|save]",
					"warning",
				);
				return;
			}
			if (!config?.virtualKey) {
				ctx.ui.notify(
					"Pifrost is not configured. Run `pifrost global setup` or set BIFROST_URL and BIFROST_VIRTUAL_KEY (BIFROST_API_KEY is optional on Bifrost 2.x).",
					"warning",
				);
				return;
			}

			try {
				if (command === "refresh") {
					const catalog = await fetchFreshCatalog(config, aliasSource);
					diagnostics = catalog.diagnostics;
					ctx.ui.notify(
						`${formatDoctorReport(diagnostics, aliasSource.path)}\nCatalog cache refreshed; restart OMP to guarantee the refreshed envelope is selected at startup.`,
						diagnostics.some((item) => item.unresolved.length) ? "warning" : "info",
					);
					return;
				}

				const cached = loadCatalogCache({ config, aliasConfig: aliasSource.config });
				if (cached) diagnostics = cached.diagnostics;
				if (!cached && diagnostics.length === 0) {
					const catalog = await fetchFreshCatalog(config, aliasSource);
					diagnostics = catalog.diagnostics;
				}
				bindAgentSession(ctx.sessionManager.getSessionId(), ctx.agent);
				let report = `${formatDoctorReport(diagnostics, aliasSource.path)}\n\n${formatAgentAttributionReport(ctx.sessionManager.getSessionId())}`;
				const storedWarnings = storedRuntimeConfigDiagnostics();
				if (storedWarnings.length) {
					report += `\n\nStored configuration warnings:\n${storedWarnings.map((warning) => `  WARN ${warning}`).join("\n")}`;
				}
				if (ctx.agent.kind === "main" && ctx.mode === "tui" && ctx.hasUI) {
					try {
						report += `\n\n${formatPifrostOmpProfile(await readPifrostOmpProfile(await cfgSession()))}`;
					} catch (error) {
						report += `\n\nOMP Pifrost configuration: unavailable (${error instanceof Error ? error.message : String(error)})`;
					}
				}
				ctx.ui.notify(
					report,
					diagnostics.some((item) => item.unresolved.length) ? "warning" : "info",
				);
			} catch (error) {
				ctx.ui.notify(`Pifrost ${command} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
