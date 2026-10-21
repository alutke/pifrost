import type {
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	ModelSpec,
} from "@oh-my-pi/pi-ai";

import { isCommittedModelOutput, isUncommittedBlockEvent } from "./output-commitment.ts";
import { evaluateAttemptTransition, isGatewayProtocolRejection, type AttemptFailureEvidence } from "./attempt-retry-policy.ts";

import type { AliasDiagnostic } from "./index.ts";
import type { PifrostWireProtocol } from "./protocol-capability.ts";

import type {
	DynamicRouteAttempt,
	DynamicRouteMemberProfile,
	DynamicRoutePlan,
} from "./dynamic-routing.ts";

function withBifrostFallbacks(
	compat: Model["compatConfig"],
	fallbacks: readonly string[],
): Model["compatConfig"] {
	if (!fallbacks.length) return compat;
	const current = (compat ?? {}) as Record<string, unknown>;
	const currentExtra =
		current.extraBody && typeof current.extraBody === "object" && !Array.isArray(current.extraBody)
			? current.extraBody as Record<string, unknown>
			: {};
	return {
		...current,
		extraBody: { ...currentExtra, fallbacks: [...fallbacks] },
	} as Model["compatConfig"];
}

// Shared by all provider families and Chat/Responses protocol paths.
import { physicalPolicyIdentity } from "./request-compatibility.ts";
import { resolveOutputBudget } from "./output-budget.ts";
export { physicalPolicyIdentity, shouldOmitOpaqueReasoningSummary, normalizePifrostReasoningOptions, pifrostDirectMaxTokens } from "./request-compatibility.ts";

/**
 * Build the sparse OMP model spec for one physical Bifrost member. Keeping
 * this construction independent from dispatch lets prewalk ask OMP's model
 * policy for the exact candidate before the route is filtered.
 */
export function createPifrostMemberModelSpec(
	logicalModel: Model,
	member: DynamicRouteMemberProfile,
	protocol: DynamicRouteAttempt["protocol"],
	fallbacks: readonly string[] = [],
): ModelSpec<"openai-completions" | "openai-responses"> {
	const policyIdentity = physicalPolicyIdentity(member.reference);
	// No logical alias compat inheritance: it is a route intersection, not
	// the selected physical provider's wire contract.
	const physicalCompat: Record<string, unknown> = { supportsDeveloperRole: false };
	for (const [key, value] of Object.entries(member.compat)) {
		if (value !== undefined) physicalCompat[key] = value;
	}
	const base = {
		id: policyIdentity?.id ?? member.reference,
		name: member.reference,
		provider: policyIdentity?.provider ?? logicalModel.provider,
		requestModelId: policyIdentity?.requestModelId ?? member.reference,
		baseUrl: logicalModel.baseUrl,
		// Gateway transport headers are not model compatibility policy. They must
		// survive physical-model materialization for both Chat and Responses.
		// In particular x-bf-vk is required when Bifrost rejects bare Bearer auth.
		...(logicalModel.headers ? { headers: { ...logicalModel.headers } } : {}),
		cost: logicalModel.cost,
		contextWindow: member.contextWindow,
		maxTokens: member.maxTokens,
		input: [...member.input],
		reasoning: member.reasoning,
		supportsTools: member.supportsTools,
		...(member.serviceTiers?.length ? { serviceTiers: [...member.serviceTiers] } : {}),
	};
	if (protocol === "openai-responses") {
		return {
			...base,
			api: "openai-responses",
			compat: physicalCompat,
		} as ModelSpec<"openai-responses">;
	}
	if (protocol === "openai-completions") {
		return {
			...base,
			api: "openai-completions",
			compat: withBifrostFallbacks(physicalCompat as Model["compatConfig"], fallbacks),
		} as ModelSpec<"openai-completions">;
	}
	throw new Error(`Pifrost does not have a native transport for ${protocol}`);
}

/**
 * Build the sparse OMP model spec for one physical Bifrost attempt. Runtime
 * materialization deliberately stays in native.ts so this planning module has
 * no Bun-only OMP runtime imports and remains Node-testable.
 */
export function createPifrostAttemptModelSpec(
	logicalModel: Model,
	attempt: DynamicRouteAttempt,
): ModelSpec<"openai-completions" | "openai-responses"> {
	const primary = attempt.members[0];
	if (!primary) throw new Error(`Pifrost route attempt ${attempt.primary} has no member metadata`);
	return createPifrostMemberModelSpec(logicalModel, primary, attempt.protocol, attempt.fallbacks);
}

/**
 * Preserve the exact first physical model's OMP wire policy, but send the
 * original logical alias to Bifrost. Crucially do NOT include a client-side
 * fallbacks array: Bifrost must execute the live rule, its target/key pins,
 * and its configured fallback chain, rather than our cached copy.
 */
export function createPifrostNativeRouteModelSpec(
	logicalModel: Model,
	attempt: DynamicRouteAttempt,
): ModelSpec<"openai-completions"> {
	if (attempt.protocol !== "openai-completions" || !attempt.members.length) {
		throw new Error("Native Bifrost rule passthrough requires a compatible Chat route");
	}
	return {
		...createPifrostMemberModelSpec(logicalModel, attempt.members[0]!, "openai-completions"),
		requestModelId: logicalModel.id,
	} as ModelSpec<"openai-completions">;
}

export function bifrostAttemptExtraBody(attempt: DynamicRouteAttempt): Record<string, unknown> | undefined {
	return attempt.protocol === "openai-responses" && attempt.fallbacks.length
		? { fallbacks: [...attempt.fallbacks] }
		: undefined;
}

/**
 * Return the output-token ceiling that is safe for every physical member in a
 * Bifrost attempt. The caller's requested max is a ceiling rather than a
 * requirement, so heterogeneous fallback groups are clamped to their weakest
 * member instead of rejecting otherwise-capable models.
 */
export function pifrostAttemptMaxTokens(
	attempt: DynamicRouteAttempt,
	requestedMaxTokens?: number,
): number | undefined {
	if (!attempt.members.length && requestedMaxTokens === undefined) return undefined;
	return resolveOutputBudget({
		logicalModel: "physical-compatibility",
		requestedTokens: requestedMaxTokens,
		members: attempt.members.map(member => ({
			reference: member.reference, maxTokens: member.maxTokens, source: member.maxTokensSource,
		})),
		environment: {}, // Helper is physical-only; OMP role caps apply at dispatch.
	}).effectiveTokens;
}

function logicalAssistantMessage(
	message: AssistantMessage,
	logicalModel: Model,
	physicalModel: string,
): AssistantMessage {
	// The session stays on its logical alias. Preserve independent physical
	// upstreamProvider/upstreamModel fields; do not impersonate the physical
	// provider in OMP history just to enable reasoning portability.
	return {
		...message,
		api: "openai-completions",
		provider: logicalModel.provider,
		model: logicalModel.id,
		upstreamModel:
			message.upstreamModel ??
			(message.model && message.model !== logicalModel.id ? message.model : undefined) ??
			physicalModel,
	};
}

function logicalEvent(
	event: AssistantMessageEvent,
	logicalModel: Model,
	physicalModel: string,
): AssistantMessageEvent {
	switch (event.type) {
		case "done":
			return { ...event, message: logicalAssistantMessage(event.message, logicalModel, physicalModel) };
		case "error":
			return { ...event, error: logicalAssistantMessage(event.error, logicalModel, physicalModel) };
		default:
			return {
				...event,
				partial: logicalAssistantMessage(event.partial, logicalModel, physicalModel),
			} as AssistantMessageEvent;
	}
}

/** Do not implement physical model routing here. This is only ingress protocol selection
 * for a *logical alias* that Bifrost will route using its original live rules.
 */
export type GatewayWireProtocol = Extract<PifrostWireProtocol, "openai-completions" | "openai-responses">;

export function gatewayProtocolOrder(diagnostic: AliasDiagnostic | undefined): readonly GatewayWireProtocol[] | undefined {
	const members = diagnostic?.members?.filter(item => item.status === "resolved");
	if (!members?.length) return undefined;
	const available = members.map(item => item.protocols ?? []);
	if (!available.some(protocols => protocols.includes("openai-responses"))) return undefined;
	const first = available[0]!;
	const firstProtocol: GatewayWireProtocol = first.includes("openai-responses") && !first.includes("openai-completions")
		? "openai-responses" : "openai-completions";
	if (!available.some(protocols => protocols.includes("openai-completions"))) return ["openai-responses"];
	return firstProtocol === "openai-responses"
		? ["openai-responses", "openai-completions"]
		: ["openai-completions", "openai-responses"];
}

/** Require an explicit error from the gateway; never retry generic failures,
 * quota, auth, timeouts, or failures after output was committed.
 */
export type GatewayProtocolRetryEvidence = AttemptFailureEvidence;
/** Backward-compatible export; all transitions use the shared contract. */
export function isVerifiedGatewayProtocolRejection(
  value: unknown, evidence: GatewayProtocolRetryEvidence | undefined,
): boolean {
  return evaluateAttemptTransition("gateway-ingress", value, evidence).permitted;
}
export { isGatewayProtocolRejection };

export interface PifrostAttemptStream extends AsyncIterable<AssistantMessageEvent> {
	readonly hasPendingLocalWork?: boolean;
}

export interface PifrostProtocolOutput {
	push(event: AssistantMessageEvent): void;
	fail(error: unknown): void;
	forwardLocalWorkFrom(source: { readonly hasPendingLocalWork: boolean } | undefined): void;
}

export type PifrostAttemptDispatcher = (
	attempt: DynamicRouteAttempt,
	attemptIndex: number,
) => PifrostAttemptStream;

/**
 * Execute protocol groups in route order. A failed group may transition only when an explicit policy permits and
 * the first model-output event is emitted; once any text/thinking/tool output
 * is committed, replaying the turn on another protocol would duplicate or
 * contradict already-visible output and is therefore forbidden.
 */
export async function runPifrostProtocolPlan(
	logicalModel: Model,
	plan: DynamicRoutePlan,
	outer: PifrostProtocolOutput,
	dispatch: PifrostAttemptDispatcher,
	options: { beforeAttempt?: (attempt: DynamicRouteAttempt, index: number) => Promise<void>; retryPreOutputError?: (error: unknown) => boolean } = {},
): Promise<void> {
	let lastErrorEvent: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
	const thrown: unknown[] = [];

	for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex++) {
		const attempt = plan.attempts[attemptIndex]!;
		// A live-policy check is a dispatch guard, NOT a retryable inference
		// error. Re-attest before every physical attempt, including fallbacks.
		try { await options.beforeAttempt?.(attempt, attemptIndex); }
		catch (error) { outer.fail(error); return; }
		let inner: PifrostAttemptStream;
		try {
			inner = dispatch(attempt, attemptIndex);
		} catch (error) {
			if (!options.retryPreOutputError?.(error)) {
				outer.fail(error);
				return;
			}
			thrown.push(error);
			continue;
		}

		outer.forwardLocalWorkFrom(
			typeof inner.hasPendingLocalWork === "boolean"
				? inner as { readonly hasPendingLocalWork: boolean }
				: undefined,
		);
		let startEvent: AssistantMessageEvent | undefined;
		const pendingBlockEvents: AssistantMessageEvent[] = [];
		let committed = false;
		try {
			for await (const rawEvent of inner) {
				const event = logicalEvent(rawEvent, logicalModel, attempt.primary);
				if (!committed && event.type === "start") {
					startEvent = event;
					continue;
				}
				if (!committed && event.type === "error") {
					if (event.reason === "aborted") {
						if (startEvent) outer.push(startEvent);
						outer.push(event);
						return;
					}
					if (!options.retryPreOutputError?.(event.error)) {
						if (startEvent) outer.push(startEvent);
						for (const pending of pendingBlockEvents) outer.push(pending);
						outer.push(event);
						return;
					}
					lastErrorEvent = event;
					break;
				}
				if (!committed && event.type === "done") {
					if (startEvent) outer.push(startEvent);
					for (const pending of pendingBlockEvents) outer.push(pending);
					outer.push(event);
					return;
				}
				if (!committed && isUncommittedBlockEvent(event) && !isCommittedModelOutput(event)) {
					// Empty block starts/deltas are not generated content. Buffer them
					// until something material is produced, so failure can fall through
					// without exposing a partial logical assistant message.
					pendingBlockEvents.push(event);
					continue;
				}
				if (!committed) {
					committed = true;
					if (startEvent) outer.push(startEvent);
					for (const pending of pendingBlockEvents) outer.push(pending);
				}
				outer.push(event);
				if (event.type === "done" || event.type === "error") return;
			}
		} catch (error) {
			if (committed) {
				outer.fail(error);
				return;
			}
			if (!options.retryPreOutputError?.(error)) {
				outer.fail(error);
				return;
			}
			thrown.push(error);
		} finally {
			outer.forwardLocalWorkFrom(undefined);
		}

		if (committed) {
			outer.fail(new Error(`Pifrost ${attempt.protocol} attempt ended after emitting output without a terminal event`));
			return;
		}
	}

	if (lastErrorEvent) {
		outer.push(lastErrorEvent);
		return;
	}
	const errors = thrown.map((error) => error instanceof Error ? error : new Error(String(error)));
	outer.fail(
		errors.length > 1
			? new AggregateError(errors, `Pifrost route ${plan.logicalModel} failed before producing output`)
			: errors[0] ?? new Error(`Pifrost route ${plan.logicalModel} exhausted without a response`),
	);
}
