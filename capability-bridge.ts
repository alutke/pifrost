type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as JsonRecord
		: undefined;
}

export function deferredToolNames(tools: readonly { name: string; deferLoading?: boolean }[] | undefined): Set<string> {
	return new Set(
		(tools ?? [])
			.filter((tool) => tool.deferLoading === true && tool.name.trim())
			.map((tool) => tool.name.trim()),
	);
}

export interface PifrostCapabilityBridgeOptions {
	deferredTools?: ReadonlySet<string>;
	betweenToolsThinking?: boolean;
	enableToolSearch?: boolean;
	/** Gateway-mediated discovery is owned by Bifrost: never inject native tool_search. */
	deferredToolExecution?: "native" | "gateway";
}

/**
 * Restore capability-bearing wire fields that the generic OMP OpenAI adapter
 * cannot infer for Pifrost's logical alias.
 *
 * Tool Search is enabled only on a Responses attempt that Pifrost already
 * capability-gated. This keeps OMP's deferLoading intent intact without
 * pretending ordinary Chat routes can serve the contract.
 */
export function bridgePifrostPayload(
	payload: unknown,
	options: PifrostCapabilityBridgeOptions,
): unknown {
	const body = asRecord(payload);
	if (!body) return payload;
	let changed = false;
	const result: JsonRecord = { ...body };

	if (options.betweenToolsThinking) {
		const existing = asRecord(result.reasoning) ?? {};
		result.reasoning = { ...existing, type: "between_tools" };
		delete result.reasoning_effort;
		changed = true;
	}

	// Bifrost Code Mode and provider-injected search expose their own discovery
	// surfaces. Never duplicate them with Responses-native deferred definitions.
	if (options.enableToolSearch && options.deferredToolExecution !== "gateway" && options.deferredTools?.size && Array.isArray(result.tools)) {
		const counts = new Map<string, number>();
		for (const tool of result.tools) {
			const record = asRecord(tool);
			if (!record) continue;
			const name = typeof record.name === "string" ? record.name :
				typeof asRecord(record.function)?.name === "string" ? String(asRecord(record.function)!.name) : undefined;
			if (name && options.deferredTools.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		// Duplicate deferred tool definitions are ambiguous. Retain the original
		// wire request rather than silently creating a second discovery contract.
		if ([...counts.values()].some((count) => count !== 1)) return changed ? result : payload;
		let matched = 0;
		const rewritten = result.tools.map((tool) => {
			const record = asRecord(tool);
			if (!record) return tool;
			const name = typeof record.name === "string"
				? record.name
				: typeof asRecord(record.function)?.name === "string"
					? String(asRecord(record.function)!.name)
					: undefined;
			if (!name || !options.deferredTools!.has(name)) return tool;
			matched += 1;
			changed = true;
			return { ...record, defer_loading: true };
		});
		if (matched > 0 && !rewritten.some((tool) => asRecord(tool)?.type === "tool_search")) {
			rewritten.push({ type: "tool_search", execution: "server" });
			changed = true;
		}
		result.tools = rewritten;
	}

	return changed ? result : payload;
}
