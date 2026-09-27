import type { Context, Message, Tool, Usage } from "@oh-my-pi/pi-ai";

const PROMPT_ESTIMATE_MARGIN_DIVISOR = 10;
const IMAGE_TOKEN_ESTIMATE = 1_200;

export interface PifrostContextTokenizer {
	countTokens(text: string | string[]): number;
	countMessage(message: Message): number;
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

function validUsageAnchor(message: Message): message is Extract<Message, { role: "assistant" }> {
	if (message.role !== "assistant") return false;
	if (message.stopReason === "aborted" || message.stopReason === "error") return false;
	return hasContextTokenUsage(message.usage);
}

/**
 * Mirrors OMP's request-usage-anchor semantics without serializing internal
 * message metadata. A provider-reported assistant usage value describes the
 * complete prefix through that turn; local counting is needed only for the
 * unreported tail after it.
 */
function findRequestUsageAnchor(messages: readonly Message[]): UsageAnchor | undefined {
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
		if (validUsageAnchor(message) && message.timestamp > rewriteAt) {
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
): number {
	const anchor = findRequestUsageAnchor(context.messages);
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
 * Lightweight semantic tokenizer for unit tests and non-OMP diagnostics.
 * OMP runtime uses its model-aware Tokenizer instead.
 */
export function createApproximateContextTokenizer(): PifrostContextTokenizer {
	const countText = (value: string): number => Math.ceil(new TextEncoder().encode(value).byteLength / 4);
	const countContent = (content: unknown): number => {
		if (typeof content === "string") return countText(content);
		if (!Array.isArray(content)) return 0;
		let total = 0;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const record = block as Record<string, unknown>;
			if (record.type === "image") total += IMAGE_TOKEN_ESTIMATE;
			else if (typeof record.text === "string") total += countText(record.text);
			else if (typeof record.thinking === "string") total += countText(record.thinking);
			else if (record.type === "toolCall") {
				if (typeof record.name === "string") total += countText(record.name);
				try {
					total += countText(JSON.stringify(record.arguments) ?? "");
				} catch {
					total += countText("[unserializable-tool-arguments]");
				}
			}
		}
		return total;
	};
	return {
		countTokens(text) {
			return (Array.isArray(text) ? text : [text]).reduce((sum, item) => sum + countText(item), 0);
		},
		countMessage(message) {
			if (message.role === "assistant") return countContent(message.content);
			if (message.role === "toolResult") return countContent(message.content);
			return countContent(message.content);
		},
	};
}
