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
import { createOnDemandRouteCheck } from "./route-reconcile.mjs";
import { apiRouteFor } from "@oh-my-pi/pi-catalog/compat/behavior";
import { resolveModelPolicy } from "@oh-my-pi/pi-catalog/compat/resolve";
import { resolveModelTokenizer } from "@oh-my-pi/pi-catalog/model-tokenizer";
import { registerBifrostRichContentBridge } from "./bifrost-rich-content.ts";
import { nativeJudgeGateway } from "./judge-bridge.mjs";
import { installPifrostTextTokenCounter } from "./omp-context-policy.ts";
import {
	applyBifrostAuthoritativeCost,
	applyBifrostResolvedModel,
	clearUnverifiedNativeOrigin,
	createBifrostCostBridgeFetch,
	type BifrostCostCapture,
} from "./bifrost-cost-bridge.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	buildPifrostTransportModel,
	installPifrostModelPolicyResolver,
	installPifrostModelTokenizerResolver,
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
	formatDoctorSummary,
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
import { isCommittedModelOutput } from "./output-commitment.ts";
import {
	applyDynamicRouteProfiles,
	canUseNativeBifrostRoute,
	compatibilityRouteSnapshotError,
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
	createPifrostNativeRouteModelSpec,
	pifrostAttemptMaxTokens,
	pifrostDirectMaxTokens,
	gatewayProtocolOrder,
	isGatewayProtocolRejection,
	type GatewayWireProtocol,
	normalizePifrostReasoningOptions,
	shouldOmitOpaqueReasoningSummary,
	runPifrostProtocolPlan,
} from "./multi-protocol-routing.ts";
import { createCompactBeforeSkipCoordinator } from "./compact-before-skip.ts";
import { physicalRequestContractKey, physicalPolicyIdentity } from "./request-compatibility.ts";
import { bridgePifrostPayload, deferredToolNames } from "./capability-bridge.ts";
import { mayOmitSyntheticReasoning, normalizeCompletionsReplay, normalizeResponsesReplay } from "./reasoning-replay.ts";
import { newReasoningHygieneCounters, observeReasoningSse, ResponsesReasoningPrefixFilter } from "./reasoning-stream.ts";
import type { ReasoningHygieneCounters } from "./reasoning-stream.ts";
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
	parsePifrostTraceOptions,
	formatPifrostSessionCosts,
	recordBifrostCaptureTrace,
	releasePifrostRouteTraces,
} from "./request-provenance.ts";

installPifrostModelPolicyResolver((spec) => resolveModelPolicy(spec));
installPifrostModelTokenizerResolver((modelId, provider) => resolveModelTokenizer(modelId, provider));

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
let runtimeGatewayProtocols = new Map<string, readonly GatewayWireProtocol[]>();

function installDynamicRouteProfiles(
	models: readonly import("./index.ts").BifrostProviderModel[],
	diagnostics: readonly AliasDiagnostic[] = [],
): void {
	runtimeDynamicRoutes = extractDynamicRouteProfiles(models);
	runtimeGatewayProtocols = new Map(
		diagnostics.map(item => [item.id.toLowerCase(), gatewayProtocolOrder(item)] as const)
			.filter((entry): entry is readonly [string, readonly GatewayWireProtocol[]] => entry[1] !== undefined),
	);
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
	logicalAlias?: string,
): AssistantMessage {
	// A native logical rule may serve a different physical model than Pifrost's
	// cached primary. Without gateway-confirmed provenance, the OMP transport's
	// selected encoder is NOT evidence of the upstream provider/model.
	const safeMessage = logicalAlias ? clearUnverifiedNativeOrigin(message, logicalAlias) : message;
	const withIdentity = applyBifrostResolvedModel(safeMessage, capture);
	return {
		...withIdentity,
		usage: applyBifrostAuthoritativeCost(withIdentity.usage, capture),
	};
}

function eventWithBifrostCost(
	event: AssistantMessageEvent,
	capture: BifrostCostCapture,
	logicalAlias?: string,
): AssistantMessageEvent {
	switch (event.type) {
		case "done":
			return { ...event, message: messageWithBifrostCost(event.message, capture, logicalAlias) };
		case "error":
			return { ...event, error: messageWithBifrostCost(event.error, capture, logicalAlias) };
		default:
			return {
				...event,
				partial: messageWithBifrostCost(event.partial, capture, logicalAlias),
			} as AssistantMessageEvent;
	}
}

function bridgeBifrostUsageCostStream(
	source: AssistantMessageEventStream,
	capture: BifrostCostCapture,
	onTerminal?: (outcome: "done" | "error" | "thrown") => void,
	reasoningFilter?: ResponsesReasoningPrefixFilter,
	logicalAlias?: string,
): AssistantMessageEventStream {
	const output = new AssistantMessageEventStream();
	output.forwardLocalWorkFrom(source);
	void (async () => {
		let recorded = false;
		const terminal = (outcome: "done" | "error" | "thrown") => {
			if (recorded) return;
			capture.outputStarted ??= false;
			recorded = true;
			onTerminal?.(outcome);
		};
		try {
			for await (const event of source) {
				// Use real output deltas/completed tool calls, never stream-start or headers.
				// Bifrost/OMP still own retry policy; this is diagnostic-only.
				if (isCommittedModelOutput(event)) {
					capture.outputStarted = true;
				}
				for (const emitted of reasoningFilter ? reasoningFilter.consume(event) : [event]) {
					output.push(eventWithBifrostCost(emitted, capture, logicalAlias));
				}
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


function resolvePifrostReasoningEffort(
	model: Model,
	options: SimpleStreamOptions | undefined,
): OpenAICompletionsOptions["reasoning"] {
	const reasoning = options?.reasoning;
	if (!reasoning || !model.reasoning || !model.thinking || options?.disableReasoning || options?.forceReasoningOff) return undefined;
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
	const compatibilityByMember = new Map<string, string>();
	for (const member of profile.members) {
		const protocol = resolveDynamicMemberProtocolForRequest(member, planningBody, PIFROST_NATIVE_PROTOCOLS);
		if (!protocol) continue;
		try {
			const candidate = buildPifrostTransportModel(
				createPifrostMemberModelSpec(model, member, protocol),
			);
			compatibilityByMember.set(member.reference, physicalRequestContractKey(candidate));
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
		compatibilityByMember,
		outputCapExplicit: rawOptions?.maxTokens !== undefined,
	});
	const nativeGatewayRoute = canUseNativeBifrostRoute(profile, plan);
	if (!nativeGatewayRoute) {
		const stale = compatibilityRouteSnapshotError(profile);
		if (stale) throw new Error(stale);
	}
	const routeMode = nativeGatewayRoute ? "bifrost-native" : "pifrost-compatibility";
	const exceptionReason = nativeGatewayRoute ? undefined
		: plan.excluded.length ? "member-eligibility"
		: plan.attempts.length > 1 ? "wire-protocol-or-encoder-boundary"
		: "request-contract-exception";
	// Native requests keep the logical alias and never send a copied fallback
	// list. The original Bifrost rule and its *live* membership remain authoritative.
	const executionPlan: DynamicRoutePlan = nativeGatewayRoute
		? { ...plan, attempts: [{ ...plan.attempts[0]!, primary: plan.logicalModel, fallbacks: [] }] }
		: plan;
	// Non-actionable compatibility boundaries are reported with each session trace,
	// not written to stderr for every model call (which corrupts OMP's TUI).
	const compatibilityBoundaryCount = plan.compatibilityBreaks?.length ?? 0;
	const underlyingFetch = options?.fetch ?? globalThis.fetch;
	const reasoning = resolvePifrostReasoningEffort(model, options);
	const outer = new AssistantMessageEventStream();

	void runPifrostProtocolPlan(model, executionPlan, outer, (attempt, attemptIndex) => {
		const costCapture: BifrostCostCapture = {};
		const baseFetch = createBifrostCostBridgeFetch(underlyingFetch, costCapture);
		const transportModel = buildPifrostTransportModel(nativeGatewayRoute
			? createPifrostNativeRouteModelSpec(model, attempt)
			: createPifrostAttemptModelSpec(model, attempt));
		const headers = pifrostAttemptHeaders(options?.headers, sessionId, executionPlan, attempt, attemptIndex);
		headers["x-pifrost-route-mode"] = routeMode;
		const maxTokens = pifrostAttemptMaxTokens(attempt, options?.maxTokens ?? model.maxTokens ?? undefined);
		if (attempt.protocol === "openai-responses") {
			const upstreamOnPayload = options?.onPayload;
			const upstreamOnSseEvent = options?.onSseEvent;
			const hygieneCounters = newReasoningHygieneCounters();
			// Every physical Responses model receives the same semantic guard.
			// Only the exact two-marker <think> prefix is transformed, irrespective
			// of provider/model identity or a Bifrost fallback.
			const reasoningFilter = new ResponsesReasoningPrefixFilter(hygieneCounters, true);
			const responseOptions: OpenAIResponsesOptions = {
				...options,
				apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
				maxTokens,
				headers,
				reasoning,
				...(shouldOmitOpaqueReasoningSummary(attempt.primary) ? { reasoningSummary: null } : {}),
				disableReasoning: options?.disableReasoning,
				toolChoice: options?.toolChoice,
				serviceTier: options?.serviceTier,
				openrouterVariant: options?.openrouterVariant,
				maxTokensExplicit: rawOptions?.maxTokens !== undefined,
				promptCache: options?.promptCache,
				statefulResponses: false,
				onPayload: async (payload, requestModel, signal) => {
					const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
					const bridged = bridgePifrostPayload(upstream, {
						deferredTools,
						enableToolSearch: deferredTools.size > 0,
						betweenToolsThinking,
					});
					// Provider-neutral and inert unless OMP replayed both a synthetic
					// reasoning item and redundant visible text in an assistant run.
					// Never strip the structured content required by DeepSeek.
					const hygiene = normalizeResponsesReplay(bridged, {
						allowSyntheticReasoningRemoval: mayOmitSyntheticReasoning(transportModel.compat, attempt.primary),
					});
					hygieneCounters.replayRemoved = hygiene.removedVisiblePlaceholders;
					hygieneCounters.replayMixedRewritten = hygiene.rewrittenMixedMessages;
					hygieneCounters.replayNestedRewritten = hygiene.rewrittenNestedMessages;
					hygieneCounters.replayProseRewritten = hygiene.rewrittenProseMessages;
					hygieneCounters.replayAmbiguousRetained = hygiene.retainedAmbiguousPlaceholders;
					hygieneCounters.replayStructuredRetained = hygiene.retainedReasoningItems;
					// Counters are available in /pifrost trace; do not log routine
					// cleanup to stderr on every streamed model request.
					return hygiene.payload;
				},
				onSseEvent: (event, requestModel) => {
					observeReasoningSse(hygieneCounters, event);
					try { upstreamOnSseEvent?.(event, requestModel); } catch {
						// User diagnostics may not terminate the response stream.
					}
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
					routeMode,
					...(exceptionReason ? { exceptionReason } : {}),
					protocol: attempt.protocol,
					attempt: attemptIndex + 1,
					requestedPrimary: attempt.primary,
					...(compatibilityBoundaryCount ? { compatibilityBoundaryCount } : {}),
					outcome,
				}, costCapture, hygieneCounters),
				reasoningFilter,
			);
		}

		const upstreamOnPayload = options?.onPayload;
		const chatHygieneCounters = newReasoningHygieneCounters();
		const chatReasoningFilter = new ResponsesReasoningPrefixFilter(chatHygieneCounters, true);
		const chatUpstreamOnSseEvent = options?.onSseEvent;
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
			onPayload: async (payload, requestModel, signal) => {
				const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
				const bridged = betweenToolsThinking
					? bridgePifrostPayload(upstream, { betweenToolsThinking: true })
					: upstream;
				const hygiene = normalizeCompletionsReplay(bridged);
				chatHygieneCounters.replayMixedRewritten = hygiene.rewrittenMixedMessages;
				chatHygieneCounters.replayNestedRewritten = hygiene.rewrittenNestedMessages;
				chatHygieneCounters.replayProseRewritten = hygiene.rewrittenProseMessages;
				return hygiene.payload;
			},
			onSseEvent: (event, requestModel) => {
				observeReasoningSse(chatHygieneCounters, event);
				try { chatUpstreamOnSseEvent?.(event, requestModel); } catch {}
			},
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
				routeMode,
				...(exceptionReason ? { exceptionReason } : {}),
				protocol: attempt.protocol,
				attempt: attemptIndex + 1,
				requestedPrimary: attempt.primary,
				...(compatibilityBoundaryCount ? { compatibilityBoundaryCount } : {}),
				outcome,
			}, costCapture, chatHygieneCounters),
			chatReasoningFilter,
			nativeGatewayRoute ? plan.logicalModel : undefined,
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
	const options = normalizePifrostReasoningOptions(model, rawOptions);
	if (profile) {
		return streamDynamicPifrostRoute(model, context, options, rawOptions, sessionId, profile);
	}

	// Unknown or opaque Bifrost rule semantics never authorize copied physical
	// fallback chains. Protocol selection changes only the gateway ingress;
	// each request carries the exact original logical alias to Bifrost.
	const protocolOrder = runtimeGatewayProtocols.get(model.id.toLowerCase());
	const streamChat = (attemptIndex = 0) => {
	const directPhysical = physicalPolicyIdentity(model.id);
		const transportModel = buildPifrostTransportModel({
			...model,
			...(directPhysical ? { id: directPhysical.id, provider: directPhysical.provider, requestModelId: directPhysical.requestModelId } : {}),
			api: "openai-completions",
			compat: model.compatConfig,
		} as ModelSpec<"openai-completions">);
		const costCapture: BifrostCostCapture = {};
		const baseFetch = createBifrostCostBridgeFetch(options?.fetch ?? globalThis.fetch, costCapture);
		const upstreamOnPayload = options?.onPayload;
		const betweenToolsThinking = options?.disableReasoning === true && pifrostSupportsBetweenToolsThinking(model);
		const directHygieneCounters = newReasoningHygieneCounters();
		const directReasoningFilter = new ResponsesReasoningPrefixFilter(directHygieneCounters, true);
		const directUpstreamOnSseEvent = options?.onSseEvent;
		const streamOptions: OpenAICompletionsOptions = {
			...options,
			apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
			maxTokens: pifrostDirectMaxTokens(options?.maxTokens, model.maxTokens),
			headers: {
				...pifrostSessionHeaders(options?.headers, sessionId),
				...(protocolOrder ? {
					"x-pifrost-logical-model": model.id,
					"x-pifrost-route-mode": "bifrost-direct",
					"x-pifrost-route-protocol": "openai-completions",
					"x-pifrost-route-attempt": String(attemptIndex + 1),
				} : {}),
			},
			reasoning: resolvePifrostReasoningEffort(model, options),
			disableReasoning: options?.disableReasoning,
			toolChoice: mapPifrostOpenAIToolChoice(options?.toolChoice),
			serviceTier: options?.serviceTier,
			openrouterVariant: options?.openrouterVariant,
			maxTokensExplicit: rawOptions?.maxTokens !== undefined,
			promptCache: options?.promptCache,
			onPayload: async (payload, requestModel, signal) => {
				const upstream = upstreamOnPayload ? (await upstreamOnPayload(payload, requestModel, signal)) ?? payload : payload;
				const bridged = betweenToolsThinking
					? bridgePifrostPayload(upstream, { betweenToolsThinking: true })
					: upstream;
				const hygiene = normalizeCompletionsReplay(bridged);
				directHygieneCounters.replayMixedRewritten = hygiene.rewrittenMixedMessages;
				directHygieneCounters.replayNestedRewritten = hygiene.rewrittenNestedMessages;
				directHygieneCounters.replayProseRewritten = hygiene.rewrittenProseMessages;
				return hygiene.payload;
			},
			onSseEvent: (event, requestModel) => {
				observeReasoningSse(directHygieneCounters, event);
				try { directUpstreamOnSseEvent?.(event, requestModel); } catch {}
			},
			fetch: baseFetch,
		};
		return bridgeBifrostUsageCostStream(
			streamOpenAICompletions(transportModel, context, streamOptions),
			costCapture,
			(outcome) => recordBifrostCaptureTrace(sessionId, {
				logicalModel: model.id,
				routeMode: "bifrost-direct",
				protocol: "openai-completions",
				attempt: attemptIndex + 1,
				requestedPrimary: model.id,
				outcome,
			}, costCapture, directHygieneCounters),
			directReasoningFilter,
		);
	};

	if (!protocolOrder?.length || (protocolOrder.length === 1 && protocolOrder[0] === "openai-completions")) {
		return streamChat();
	}
	const streamResponses = (attemptIndex: number) => {
		const transportModel = buildPifrostTransportModel({
			...model, api: "openai-responses", compat: model.compatConfig,
		} as ModelSpec<"openai-responses">);
		const capture: BifrostCostCapture = {};
		const fetch = createBifrostCostBridgeFetch(options?.fetch ?? globalThis.fetch, capture);
		const counters = newReasoningHygieneCounters();
		const filter = new ResponsesReasoningPrefixFilter(counters, true);
		const previousPayload = options?.onPayload;
		const previousSse = options?.onSseEvent;
		const deferredTools = deferredToolNames(context.tools);
		const responseOptions: OpenAIResponsesOptions = {
			...options,
			apiKey: typeof options?.apiKey === "string" ? options.apiKey : undefined,
			maxTokens: pifrostDirectMaxTokens(options?.maxTokens, model.maxTokens),
			headers: {
				...pifrostSessionHeaders(options?.headers, sessionId),
				"x-pifrost-logical-model": model.id,
				"x-pifrost-route-mode": "bifrost-direct",
				"x-pifrost-route-protocol": "openai-responses",
				"x-pifrost-route-attempt": String(attemptIndex + 1),
			},
			reasoning: resolvePifrostReasoningEffort(model, options),
			...(shouldOmitOpaqueReasoningSummary(model.id) ? { reasoningSummary: null } : {}),
			disableReasoning: options?.disableReasoning,
			toolChoice: options?.toolChoice,
			serviceTier: options?.serviceTier,
			openrouterVariant: options?.openrouterVariant,
			maxTokensExplicit: rawOptions?.maxTokens !== undefined,
			promptCache: options?.promptCache,
			statefulResponses: false,
			onPayload: async (payload, requestModel, signal) => {
				const upstream = previousPayload ? (await previousPayload(payload, requestModel, signal)) ?? payload : payload;
				const bridged = bridgePifrostPayload(upstream, {
					deferredTools, enableToolSearch: deferredTools.size > 0,
				});
				const hygiene = normalizeResponsesReplay(bridged, {
					allowSyntheticReasoningRemoval: mayOmitSyntheticReasoning(transportModel.compat, model.id),
				});
				counters.replayRemoved = hygiene.removedVisiblePlaceholders;
				counters.replayMixedRewritten = hygiene.rewrittenMixedMessages;
				counters.replayNestedRewritten = hygiene.rewrittenNestedMessages;
				counters.replayProseRewritten = hygiene.rewrittenProseMessages;
				counters.replayAmbiguousRetained = hygiene.retainedAmbiguousPlaceholders;
				counters.replayStructuredRetained = hygiene.retainedReasoningItems;
				return hygiene.payload;
			},
			onSseEvent: (event, requestModel) => {
				observeReasoningSse(counters, event);
				try { previousSse?.(event, requestModel); } catch {}
			},
			fetch,
		};
		return bridgeBifrostUsageCostStream(
			streamOpenAIResponses(transportModel as Model<"openai-responses">, context, responseOptions),
			capture,
			(outcome) => recordBifrostCaptureTrace(sessionId, {
				logicalModel: model.id,
				routeMode: "bifrost-direct",
				protocol: "openai-responses",
				attempt: attemptIndex + 1,
				requestedPrimary: model.id,
				outcome,
			}, capture, counters),
			filter,
		);
	};

	// This is a gateway-ingress plan, NOT a local routing plan. All attempts
	// name model.id; Bifrost owns the physical model, scope and fallback policy.
	const plan: DynamicRoutePlan = {
		logicalModel: model.id,
		estimatedInputTokens: 0,
		outputReserveTokens: 0,
		outputReserveExplicit: false,
		requiredContextTokens: 0,
		attempts: protocolOrder.map(protocol => ({ protocol, primary: model.id, fallbacks: [], members: [] })),
		excluded: [],
	};
	const outer = new AssistantMessageEventStream();
	void runPifrostProtocolPlan(
		model, plan, outer,
		(attempt, index) => attempt.protocol === "openai-responses" ? streamResponses(index) : streamChat(index),
		{ retryPreOutputError: isGatewayProtocolRejection },
	).catch(error => outer.fail(error));
	return outer;
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
	installDynamicRouteProfiles(catalog.models, catalog.diagnostics);
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

	let aliasSource = loadAliasConfig(flag("pifrost-aliases"));
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
			installDynamicRouteProfiles(startupCache.models, startupCache.diagnostics);
		}

		const refresh = (resolvedApiKey?: string): Promise<PifrostCatalog> => {
			if (!refreshInFlight) {
				// A prior OMP prompt may have reconciled a new Bifrost policy.
                aliasSource = loadAliasConfig(flag("pifrost-aliases"));
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

		// On a genuine cache miss, resolve and persist a safe catalogue before
		// registering the provider. Otherwise OMP can evaluate enabledModels
		// against an empty dynamic catalogue on first startup and show no-model;
		// launching it a second time succeeds only because discovery populated
		// the cache. Never serve stale routes/credentials while refreshing.
		let bootstrappedCatalog: PifrostCatalog | undefined;
		if (!startupCache) {
			try {
				bootstrappedCatalog = await refresh();
				diagnostics = bootstrappedCatalog.diagnostics;
			} catch (error) {
				process.stderr.write(
					`pifrost: cold-start model discovery failed; no unverified cached models will be registered: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}

		const providerApiKey = config.apiKey ?? config.virtualKey;
		const virtualKeyBearerCompatible = /^sk-bf-/u.test(config.virtualKey);
		const usage = createBifrostUsageProvider(config);
		// Optional native judgment providers. OMP supplies typed judgment,
		// retries/caching, native image encoding and accounting. Bifrost
		// supplies the physical endpoint and VK governance. Image input is
		// explicitly opted into, never inferred from an unknown jev version.
		try {
			const judge = nativeJudgeGateway(config, mergedEnvironment);
			if (judge) {
				const source = judge.api === "typesafe" ? "typesafe" : "openai";
				const reference = getBundledModels(source).find(item =>
					item.id === (judge.api === "typesafe" ? "jev-latest" : "gpt-6-luna-decisions"));
				pi.registerProvider(judge.provider, {
					baseUrl: judge.baseUrl,
					api: judge.api,
					apiKey: judge.virtualKey,
					models: [{
						id: judge.model,
						...(judge.requestModelId !== judge.model ? { requestModelId: judge.requestModelId } : {}),
						name: "Bifrost native " + source + " judge " + judge.model,
						api: judge.api,
						kind: "judge",
						// Preserve OMP's upstream catalog policy identity (especially
						// Jev image bounds) while the actual credential/URL remains Bifrost.
						providerType: source,
						reasoning: false,
						input: judge.imageEnabled ? ["text", "image"] : ["text"],
						// Native judges are priced by actual Bifrost inference.
						// The OMP catalogue rate is indicative, not a Bifrost invoice.
						cost: reference?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: reference?.contextWindow ?? 8192,
						maxTokens: reference?.maxTokens ?? 256,
					}],
				});
			}
		} catch (error) {
			process.stderr.write("pifrost: optional native judge not registered: " + (error instanceof Error ? error.message : String(error)) + "\n");
		}

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
			...(startupCache || bootstrappedCatalog
				? { models: (startupCache ?? bootstrappedCatalog)!.models }
				: {}),
			async fetchDynamicModels(resolvedApiKey) {
                aliasSource = loadAliasConfig(flag("pifrost-aliases"));
				const cached = loadCatalogCache({ config, aliasConfig: aliasSource.config });
				if (cached && !forceRefreshRequested()) {
					diagnostics = cached.diagnostics;
					installDynamicRouteProfiles(cached.models, cached.diagnostics);
					if (!cacheIsFresh(cached, refreshIntervalMs)) scheduleBackgroundRefresh(resolvedApiKey);
					return cached.models;
				}

				const catalog = await refresh(resolvedApiKey);
				diagnostics = catalog.diagnostics;
				return catalog.models;
			},
		});
        // On-demand checks run only before actual top-level user prompts.
        // No service, scheduled task, timer or background polling process.
        // Management credentials stay in the short-lived Pifrost CLI child.
        if (!/^(0|false|off|no)$/iu.test(process.env.PIFROST_AUTO_SYNC?.trim() ?? "")) {
            const check = createOnDemandRouteCheck({
                run: async () => {
                    const result = await pi.exec("pifrost", ["routes", "reconcile", "--json"], { timeout: 12000 });
                    if (result.code !== 0) throw new Error("reconcile CLI failed");
                    const value: unknown = JSON.parse(result.stdout);
                    if (!value || typeof value !== "object" || !("status" in value)) {
                        throw new Error("invalid reconciliation reply");
                    }
                    const reply = value as { schemaVersion?: number; status: string };
                    if (reply.schemaVersion !== 1 || !["unchanged", "updated", "unavailable"].includes(reply.status)) {
                        throw new Error("invalid reconciliation reply");
                    }
                    return reply;
                },
                refresh: async (ctx) => {
                    await ctx.modelRegistry.refreshProvider(PROVIDER_ID, "online");
                },
                notify: (message, level, ctx) => {
                    if (ctx?.hasUI) ctx.ui.notify(message, level);
                },
            });
            pi.on("before_agent_start", async (_event, ctx) => {
                if (ctx.agent.kind !== "main") return;
                await check(ctx);
            });
        }
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

			if (command === "costs") {
				ctx.ui.notify(formatPifrostSessionCosts(ctx.sessionManager.getSessionId()), "info");
				return;
			}

			if (command === "trace") {
        try {
          const options=parsePifrostTraceOptions(raw.slice("trace".length));
          ctx.ui.notify(formatPifrostRouteTraces(ctx.sessionManager.getSessionId(),options), "info");
        }catch(error){
          ctx.ui.notify(error instanceof Error?error.message:"Invalid trace options", "warning");
        }
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
					"Usage: /pifrost doctor [verbose] | /pifrost trace [last N] [errors] [role alias] [verbose] | /pifrost costs | /pifrost refresh | /pifrost config [status|apply|set|save]",
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
						`${formatDoctorSummary(diagnostics, aliasSource.path)}\nCatalog refreshed. Restart OMP to load the new model capabilities.`,
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
				const verbose = /^doctor\s+verbose$/iu.test(raw.trim());
				let report = verbose
					? `${formatDoctorReport(diagnostics, aliasSource.path)}\n\n${formatAgentAttributionReport(ctx.sessionManager.getSessionId())}`
					: formatDoctorSummary(diagnostics, aliasSource.path);
				const storedWarnings = storedRuntimeConfigDiagnostics();
				if (storedWarnings.length) {
					report += `\n\nStored configuration warnings:\n${storedWarnings.map((warning) => `  WARN ${warning}`).join("\n")}`;
				}
				if (verbose && ctx.agent.kind === "main" && ctx.mode === "tui" && ctx.hasUI) {
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
