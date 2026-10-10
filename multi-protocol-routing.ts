import type {
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	ModelSpec,
} from "@oh-my-pi/pi-ai";

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
	const memberCeilings = attempt.members
		.map((member) => member.maxTokens)
		.filter((value) => Number.isFinite(value) && value > 0);
	const routeCeiling = memberCeilings.length ? Math.min(...memberCeilings) : undefined;
	const requested = typeof requestedMaxTokens === "number" && Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
		? Math.ceil(requestedMaxTokens)
		: undefined;
	if (requested !== undefined && routeCeiling !== undefined) return Math.min(requested, routeCeiling);
	return requested ?? routeCeiling;
}

function logicalAssistantMessage(
	message: AssistantMessage,
	logicalModel: Model,
	physicalModel: string,
): AssistantMessage {
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
 * Execute protocol groups in route order. A failed group is retried only until
 * the first model-output event is emitted; once any text/thinking/tool output
 * is committed, replaying the turn on another protocol would duplicate or
 * contradict already-visible output and is therefore forbidden.
 */
export async function runPifrostProtocolPlan(
	logicalModel: Model,
	plan: DynamicRoutePlan,
	outer: PifrostProtocolOutput,
	dispatch: PifrostAttemptDispatcher,
): Promise<void> {
	let lastErrorEvent: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
	const thrown: unknown[] = [];

	for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex++) {
		const attempt = plan.attempts[attemptIndex]!;
		let inner: PifrostAttemptStream;
		try {
			inner = dispatch(attempt, attemptIndex);
		} catch (error) {
			thrown.push(error);
			continue;
		}

		outer.forwardLocalWorkFrom(
			typeof inner.hasPendingLocalWork === "boolean"
				? inner as { readonly hasPendingLocalWork: boolean }
				: undefined,
		);
		let startEvent: AssistantMessageEvent | undefined;
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
					lastErrorEvent = event;
					break;
				}
				if (!committed && event.type === "done") {
					if (startEvent) outer.push(startEvent);
					outer.push(event);
					return;
				}
				if (!committed) {
					committed = true;
					if (startEvent) outer.push(startEvent);
				}
				outer.push(event);
				if (event.type === "done" || event.type === "error") return;
			}
		} catch (error) {
			if (committed) {
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
