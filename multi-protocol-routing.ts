import type {
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	ModelSpec,
} from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

import type { DynamicRouteAttempt, DynamicRoutePlan } from "./dynamic-routing.ts";

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

/**
 * Materialize one physical Bifrost attempt using OMP's native transport for
 * that member's actual wire protocol. The logical alias remains the caller
 * identity; the transport model carries the physical Bifrost model id.
 */
export function buildPifrostAttemptModel(
	logicalModel: Model,
	attempt: DynamicRouteAttempt,
): Model<"openai-completions" | "openai-responses"> {
	const primary = attempt.members[0];
	if (!primary) throw new Error(`Pifrost route attempt ${attempt.primary} has no member metadata`);
	const base = {
		...logicalModel,
		id: attempt.primary,
		name: attempt.primary,
		contextWindow: primary.contextWindow,
		maxTokens: primary.maxTokens,
		input: [...primary.input],
		reasoning: primary.reasoning,
	};
	if (attempt.protocol === "openai-responses") {
		return buildModel({
			...base,
			api: "openai-responses",
			compat: logicalModel.compatConfig,
		} as ModelSpec<"openai-responses">);
	}
	if (attempt.protocol === "openai-completions") {
		return buildModel({
			...base,
			api: "openai-completions",
			compat: withBifrostFallbacks(logicalModel.compatConfig, attempt.fallbacks),
		} as ModelSpec<"openai-completions">);
	}
	throw new Error(`Pifrost does not have a native transport for ${attempt.protocol}`);
}

export function bifrostAttemptExtraBody(attempt: DynamicRouteAttempt): Record<string, unknown> | undefined {
	return attempt.protocol === "openai-responses" && attempt.fallbacks.length
		? { fallbacks: [...attempt.fallbacks] }
		: undefined;
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
		upstreamModel: message.upstreamModel ?? physicalModel,
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

export type PifrostAttemptDispatcher = (
	attempt: DynamicRouteAttempt,
	transportModel: Model<"openai-completions" | "openai-responses">,
	attemptIndex: number,
) => AssistantMessageEventStream;

/**
 * Execute protocol groups in route order. A failed group is retried only until
 * the first model-output event is emitted; once any text/thinking/tool output
 * is committed, replaying the turn on another protocol would duplicate or
 * contradict already-visible output and is therefore forbidden.
 */
export function streamPifrostProtocolPlan(
	logicalModel: Model,
	plan: DynamicRoutePlan,
	dispatch: PifrostAttemptDispatcher,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	void (async () => {
		let lastErrorEvent: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
		const thrown: unknown[] = [];

		for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex++) {
			const attempt = plan.attempts[attemptIndex]!;
			const transportModel = buildPifrostAttemptModel(logicalModel, attempt);
			let inner: AssistantMessageEventStream;
			try {
				inner = dispatch(attempt, transportModel, attemptIndex);
			} catch (error) {
				thrown.push(error);
				continue;
			}

			outer.forwardLocalWorkFrom(inner);
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
	})();

	return outer;
}
