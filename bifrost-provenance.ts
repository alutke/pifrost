const MAX_PROVENANCE_ROWS = 100;

function nonEmpty(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function header(headers: Headers, name: string): string | undefined {
	return nonEmpty(headers.get(name) ?? undefined);
}

export interface PifrostProvenanceContext {
	sessionId: string;
	logicalModel: string;
	protocol: string;
	attemptIndex: number;
	routePrimary: string;
}

export interface BifrostRoutingProvenance extends PifrostProvenanceContext {
	timestamp: string;
	status: number;
	requestId?: string;
	traceId?: string;
	provider?: string;
	originalModel?: string;
	resolvedModel?: string;
	requestType?: string;
	fallbackIndex?: number;
	routingProvider?: string;
	routingModel?: string;
	isFallback: boolean;
	primaryProvider?: string;
	primaryModel?: string;
	serverSideFallbackModel?: string;
	aliasModelId?: string;
	aliasModelName?: string;
	aliasModelFamily?: string;
	upstreamLatencyMs?: number;
}

const rows: BifrostRoutingProvenance[] = [];

export function captureBifrostRoutingProvenance(
	response: Response,
	context: PifrostProvenanceContext,
): BifrostRoutingProvenance {
	const headers = response.headers;
	const fallbackIndex = positiveInteger(header(headers, "x-bifrost-fallback-index"));
	const explicitFallback = header(headers, "x-bifrost-routing-info-is-fallback")?.toLowerCase() === "true";
	const row: BifrostRoutingProvenance = {
		...context,
		timestamp: new Date().toISOString(),
		status: response.status,
		requestId: header(headers, "x-bifrost-request-id"),
		traceId: header(headers, "x-bifrost-trace-id"),
		provider: header(headers, "x-bifrost-provider"),
		originalModel: header(headers, "x-bifrost-original-model"),
		resolvedModel: header(headers, "x-bifrost-resolved-model"),
		requestType: header(headers, "x-bifrost-request-type"),
		fallbackIndex,
		routingProvider: header(headers, "x-bifrost-routing-info-provider"),
		routingModel: header(headers, "x-bifrost-routing-info-model"),
		isFallback: explicitFallback || fallbackIndex !== undefined,
		primaryProvider: header(headers, "x-bifrost-routing-info-primary-provider"),
		primaryModel: header(headers, "x-bifrost-routing-info-primary-model"),
		serverSideFallbackModel: header(headers, "x-bifrost-routing-info-server-side-fallback-model"),
		aliasModelId: header(headers, "x-bifrost-routing-info-alias-model-id"),
		aliasModelName: header(headers, "x-bifrost-routing-info-alias-model-name"),
		aliasModelFamily: header(headers, "x-bifrost-routing-info-alias-model-family"),
		upstreamLatencyMs: finiteNonNegative(header(headers, "x-bifrost-upstream-latency-ms")),
	};
	rows.push(row);
	if (rows.length > MAX_PROVENANCE_ROWS) rows.splice(0, rows.length - MAX_PROVENANCE_ROWS);
	return row;
}

export function createBifrostProvenanceFetch(
	baseFetch: typeof globalThis.fetch,
	context: PifrostProvenanceContext,
): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const response = await baseFetch(input, init);
		captureBifrostRoutingProvenance(response, context);
		return response;
	}) as typeof globalThis.fetch;
}

export function recentBifrostRoutingProvenance(
	sessionId?: string,
	limit = 10,
): BifrostRoutingProvenance[] {
	const normalizedSession = nonEmpty(sessionId);
	const max = Math.max(1, Math.min(50, Math.floor(limit)));
	return rows
		.filter((row) => !normalizedSession || row.sessionId === normalizedSession)
		.slice(-max)
		.reverse()
		.map((row) => ({ ...row }));
}

function routeLabel(row: BifrostRoutingProvenance): string {
	const provider = row.routingProvider ?? row.provider;
	const model = row.routingModel ?? row.resolvedModel;
	if (provider && model) return `${provider}/${model}`;
	return model ?? provider ?? "unreported";
}

export function formatBifrostRoutingProvenanceReport(
	sessionId?: string,
	limit = 10,
): string {
	const recent = recentBifrostRoutingProvenance(sessionId, limit);
	if (!recent.length) {
		return "Recent Bifrost routing provenance:\n  no requests captured in this Pifrost process";
	}
	const lines = ["Recent Bifrost routing provenance:"];
	for (const row of recent) {
		const fallback = row.isFallback
			? ` fallback${row.fallbackIndex ? `#${row.fallbackIndex}` : ""}`
			: " primary";
		const correlation = row.requestId
			? ` request=${row.requestId}`
			: row.traceId
				? ` trace=${row.traceId}`
				: "";
		const latency = row.upstreamLatencyMs !== undefined
			? ` upstream=${row.upstreamLatencyMs.toFixed(1)}ms`
			: "";
		lines.push(
			`  ${row.logicalModel} attempt=${row.attemptIndex} ${row.protocol} -> ${routeLabel(row)}${fallback} HTTP ${row.status}${latency}${correlation}`,
		);
		if (row.primaryProvider || row.primaryModel || row.serverSideFallbackModel) {
			lines.push(
				`    Bifrost primary=${row.primaryProvider ?? "?"}/${row.primaryModel ?? "?"}${row.serverSideFallbackModel ? ` server-fallback=${row.serverSideFallbackModel}` : ""}`,
			);
		}
	}
	if (!recent.some((row) => row.requestId)) {
		lines.push("  note: Bifrost 2.2.6 exposes routed-identity headers; x-bifrost-request-id is captured automatically when a release provides it.");
	}
	return lines.join("\n");
}

export function resetBifrostRoutingProvenanceForTests(): void {
	rows.length = 0;
}
