import type { Context, Message, Tool, Usage } from "@oh-my-pi/pi-ai";
import {
	estimatePifrostImageTokens,
	estimatePifrostTextTokens,
	type PifrostImageTokenTarget,
} from "./omp-context-policy.ts";

const PROMPT_ESTIMATE_MARGIN_DIVISOR = 10;

export interface PifrostContextTokenizer {
	countTokens(text: string | string[]): number;
	countMessage(message: Message): number;
}

export interface OmpContextEstimateOptions {
	/**
	 * When supplied, provider usage is trusted as a prefix anchor only when the
	 * assistant turn records one of these physical upstream model identities.
	 * This prevents usage from one Bifrost fallback member being reused to size
	 * a different member with different token/image semantics.
	 */
	anchorModelIds?: readonly string[];
}

function calculateContextTokens(usage: Usage): number {
	if (usage.contextTokens !== undefined) return Math.max(0, usage.contextTokens);
	const orchestration = usage.orchestration;
	const orchestrationTotal = orchestration
		? (orchestration.input ?? 0) + (orchestration.output ?? 0) + (orchestration.cacheRead ?? 0)
		: 0;
	const raw = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return Math.max(0, raw - orchestrationTotal);
}

function withMargin(tokens: number): number {
	return tokens + Math.ceil(tokens / PROMPT_ESTIMATE_MARGIN_DIVISOR);
}

function toolFragments(tools: readonly Tool[]): string[] {
	const fragments: string[] = [];
	for (const tool of tools) {
		fragments.push(tool.name, tool.description);
		try {
			fragments.push(JSON.stringify(tool.parameters) ?? "");
		} catch {
			// OMP tool schemas are JSON-compatible. If a third-party extension
			// violates that contract, charge a conservative placeholder instead of
			// letting route planning fail while the provider may still serialize it.
			fragments.push("[unserializable-tool-schema]");
		}
	}
	return fragments;
}

function countFraming(
	items: readonly string[] | readonly Tool[] | undefined,
	tokenizer: PifrostContextTokenizer,
	kind: "system" | "tools",
): number {
	if (!items?.length) return 0;
	return kind === "system"
		? tokenizer.countTokens([...(items as readonly string[])])
		: tokenizer.countTokens(toolFragments(items as readonly Tool[]));
}

interface UsageAnchor {
	index: number;
	tokens: number;
}

function hasContextTokenUsage(usage: Usage): boolean {
	return (
		(usage.contextTokens ?? 0) > 0 ||
		usage.input + usage.cacheRead + usage.cacheWrite > 0 ||
		calculateContextTokens(usage) > usage.output
	);
}

function normalizedModelId(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function validUsageAnchor(
	message: Message,
	anchorModelIds: readonly string[] | undefined,
): message is Extract<Message, { role: "assistant" }> {
	if (message.role !== "assistant") return false;
	if (message.stopReason === "aborted" || message.stopReason === "error") return false;
	if (anchorModelIds?.length) {
		const record = message as unknown as Record<string, unknown>;
		const actual = normalizedModelId(record.upstreamModel) ?? normalizedModelId(record.model);
		const allowed = new Set(anchorModelIds.map(normalizedModelId).filter((value): value is string => Boolean(value)));
		if (!actual || !allowed.has(actual)) return false;
	}
	return hasContextTokenUsage(message.usage);
}

/**
 * Mirrors OMP's request-usage-anchor semantics without serializing internal
 * message metadata. A provider-reported assistant usage value describes the
 * complete prefix through that turn; local counting is needed only for the
 * unreported tail after it.
 */
function findRequestUsageAnchor(
	messages: readonly Message[],
	options: OmpContextEstimateOptions,
): UsageAnchor | undefined {
	let rewriteAt = Number.NEGATIVE_INFINITY;
	let anchor: UsageAnchor | undefined;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.role === "user" && message.historyRewriteAt !== undefined) {
			rewriteAt = Math.max(rewriteAt, message.historyRewriteAt, message.timestamp);
			continue;
		}
		if (message.role === "toolResult" && message.prunedAt !== undefined) {
			rewriteAt = Math.max(rewriteAt, message.prunedAt);
			continue;
		}
		if (validUsageAnchor(message, options.anchorModelIds) && message.timestamp > rewriteAt) {
			anchor = { index, tokens: calculateContextTokens(message.usage) };
		}
	}
	return anchor;
}

/**
 * Estimate the actual provider prompt represented by an OMP Context.
 *
 * This deliberately counts semantic wire content rather than JSON.stringify()
 * of OMP's internal message objects. Internal fields such as usage, timestamps,
 * provider payloads and routing metadata are not prompt tokens and can be
 * orders of magnitude larger than the text sent to the model.
 *
 * The algorithm follows OMP's own output-budget accounting:
 * - prefer the latest trustworthy provider usage anchor;
 * - count only the locally-added message tail after that anchor;
 * - otherwise count system prompt + active/inactive tool schemas + messages;
 * - add OMP's 10% local-tokenizer disagreement margin.
 */
export function estimateOmpContextInputTokens(
	context: Context,
	tokenizer: PifrostContextTokenizer,
	options: OmpContextEstimateOptions = {},
): number {
	const anchor = findRequestUsageAnchor(context.messages, options);
	if (anchor) {
		let tail = 0;
		for (let index = anchor.index + 1; index < context.messages.length; index++) {
			tail += tokenizer.countMessage(context.messages[index]!);
		}
		return Math.max(1, anchor.tokens + withMargin(tail));
	}

	const local =
		countFraming(context.systemPrompt, tokenizer, "system") +
		countFraming(context.tools, tokenizer, "tools") +
		countFraming(context.inactiveTools, tokenizer, "tools") +
		context.messages.reduce((sum, message) => sum + tokenizer.countMessage(message), 0);
	return Math.max(1, withMargin(local));
}

/**
 * Candidate-aware semantic tokenizer used by runtime prewalk. When OMP's model
 * policy resolves a tokenizer family, text is counted through the matching
 * native tokenizer; unknown families fall back to the historical byte estimate.
 * Image blocks use the candidate's OMP-compatible lineage/wire policy.
 */
export function createModelAwareContextTokenizer(
	imageTarget: PifrostImageTokenTarget = { api: "openai-responses" },
): PifrostContextTokenizer {
	const countText = (value: string): number => estimatePifrostTextTokens(value, imageTarget);
	const countContent = (content: unknown): number => {
		if (typeof content === "string") return countText(content);
		if (!Array.isArray(content)) return 0;
		let total = 0;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const record = block as Record<string, unknown>;
			if (record.type === "image") {
				total += estimatePifrostImageTokens(record, imageTarget);
			} else if (record.type === "thinking") {
				if (typeof record.thinking === "string") total += countText(record.thinking);
				// OMP replays opaque provider reasoning/signature payloads and counts
				// them when no trustworthy provider-usage anchor can be used.
				if (typeof record.thinkingSignature === "string") total += countText(record.thinkingSignature);
			} else if (record.type === "redactedThinking") {
				if (typeof record.data === "string") total += countText(record.data);
			} else if (record.type === "anthropicServerTool") {
				try {
					total += countText(JSON.stringify(record.block) ?? "null");
				} catch {
					total += countText("[unserializable-anthropic-server-tool]");
				}
			} else if (record.type === "toolCall") {
				if (typeof record.name === "string") total += countText(record.name);
				try {
					total += countText(JSON.stringify(record.arguments) ?? "null");
				} catch {
					total += countText("[unserializable-tool-arguments]");
				}
			} else if (typeof record.text === "string") {
				total += countText(record.text);
			}
		}
		return total;
	};
	return {
		countTokens(text) {
			return estimatePifrostTextTokens(text, imageTarget);
		},
		countMessage(message) {
			if (message.role === "assistant") return countContent(message.content);
			if (message.role === "toolResult") return countContent(message.content);
			return countContent(message.content);
		},
	};
}

/** Backward-compatible alias retained for tests and non-runtime callers. */
export const createApproximateContextTokenizer = createModelAwareContextTokenizer;
