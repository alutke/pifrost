function finiteNonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function bridgeUsageObject(value: Record<string, unknown>): Record<string, unknown> {
	const cost = value.cost;
	if (!cost || typeof cost !== "object" || Array.isArray(cost)) return value;
	const total = finiteNonNegative((cost as Record<string, unknown>).total_cost);
	if (total === undefined) return value;
	return {
		...value,
		cost: total,
		pifrost_bifrost_cost: cost,
	};
}

function bridgeNode(value: unknown, depth = 0): unknown {
	if (depth > 48 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((item) => {
			const bridged = bridgeNode(item, depth + 1);
			if (bridged !== item) changed = true;
			return bridged;
		});
		return changed ? next : value;
	}

	const record = value as Record<string, unknown>;
	let changed = false;
	let next: Record<string, unknown> | undefined;
	for (const [key, child] of Object.entries(record)) {
		let bridged = child;
		if (key === "usage" && child && typeof child === "object" && !Array.isArray(child)) {
			const usage = bridgeUsageObject(child as Record<string, unknown>);
			bridged = bridgeNode(usage, depth + 1);
		} else {
			bridged = bridgeNode(child, depth + 1);
		}
		if (bridged !== child) {
			next ??= { ...record };
			next[key] = bridged;
			changed = true;
		}
	}
	return changed ? next! : value;
}

/**
 * Bifrost 2.2.x can expose an authoritative nested usage.cost object. OMP's
 * OpenAI-compatible accounting consumes a scalar provider-reported cost, so
 * translate only that wire shape and retain the original breakdown alongside
 * it for diagnostics. Payloads without a nested Bifrost total are untouched.
 */
export function bridgeBifrostUsageCostPayload(value: unknown): unknown {
	return bridgeNode(value);
}

function bridgeSseLine(line: string): string {
	const newline = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
	const body = newline ? line.slice(0, -newline.length) : line;
	const match = body.match(/^(\s*data:\s?)(.*)$/u);
	if (!match) return line;
	const [, prefix, raw] = match;
	if (!raw || raw === "[DONE]") return line;
	try {
		const parsed = JSON.parse(raw);
		const bridged = bridgeBifrostUsageCostPayload(parsed);
		return `${prefix}${JSON.stringify(bridged)}${newline}`;
	} catch {
		return line;
	}
}

function bridgeEventStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			while (true) {
				const newline = pending.indexOf("\n");
				if (newline >= 0) {
					const line = pending.slice(0, newline + 1);
					pending = pending.slice(newline + 1);
					controller.enqueue(encoder.encode(bridgeSseLine(line)));
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					pending += decoder.decode();
					if (pending) controller.enqueue(encoder.encode(bridgeSseLine(pending)));
					controller.close();
					return;
				}
				pending += decoder.decode(value, { stream: true });
			}
		},
		async cancel(reason) {
			await reader.cancel(reason);
		},
	});
}

function bridgedHeaders(headers: Headers): Headers {
	const result = new Headers(headers);
	result.delete("content-length");
	return result;
}

export async function bridgeBifrostUsageCostResponse(response: Response): Promise<Response> {
	if (!response.body) return response;
	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

	if (contentType.includes("text/event-stream")) {
		return new Response(bridgeEventStream(response.body), {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	}

	if (!contentType.includes("application/json")) return response;
	const text = await response.text();
	try {
		const parsed = JSON.parse(text);
		const bridged = bridgeBifrostUsageCostPayload(parsed);
		return new Response(JSON.stringify(bridged), {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	} catch {
		return new Response(text, {
			status: response.status,
			statusText: response.statusText,
			headers: bridgedHeaders(response.headers),
		});
	}
}

export function createBifrostCostBridgeFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
		bridgeBifrostUsageCostResponse(await baseFetch(input, init))) as typeof globalThis.fetch;
}
