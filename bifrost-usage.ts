import type {
	Provider,
	UsageLimit,
	UsageProvider,
	UsageReport,
} from "@oh-my-pi/pi-ai";

import type { BifrostConfig } from "./index.ts";

type JsonRecord = Record<string, unknown>;

export interface BifrostQuotaProvenance {
	kind: "virtual_key" | "virtual_key_effective" | "provider_config" | "model_config" | "external";
	direct: boolean;
	virtualKeyName?: string;
	provider?: string;
	modelId?: string;
	sourceType?: string;
	sourceId?: string;
	sourceName?: string;
	legacySource?: string;
}

function record(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(n) ? n : undefined;
}

function positive(value: unknown): number | undefined {
	const n = finite(value);
	return n !== undefined && n > 0 ? n : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function sourceRef(value: JsonRecord | undefined): Pick<BifrostQuotaProvenance, "sourceType" | "sourceId" | "sourceName" | "legacySource"> {
	if (!value) return {};
	return {
		...(text(value.source_type) ? { sourceType: text(value.source_type) } : {}),
		...(text(value.source_id) ? { sourceId: text(value.source_id) } : {}),
		...(text(value.source_name) ? { sourceName: text(value.source_name) } : {}),
		...(text(value.source) ? { legacySource: text(value.source) } : {}),
	};
}

function hasSourceRef(value: JsonRecord | undefined): boolean {
	const source = sourceRef(value);
	return Boolean(source.sourceType || source.sourceId || source.sourceName || source.legacySource);
}

function withRowSource(base: BifrostQuotaProvenance, value: JsonRecord | undefined): BifrostQuotaProvenance {
	const source = sourceRef(value);
	if (!(source.sourceType || source.sourceId || source.sourceName || source.legacySource)) return base;
	return {
		...base,
		kind: "external",
		direct: false,
		...source,
	};
}

function humanSourceType(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value
		.split(/[_-]+/u)
		.filter(Boolean)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function provenanceNote(source: BifrostQuotaProvenance): string {
	if (source.kind === "external") {
		const type = humanSourceType(source.sourceType) ?? "External governance";
		const name = source.sourceName ?? source.legacySource;
		const id = source.sourceId;
		return `Governance source: ${type}${name ? ` "${name}"` : ""}${id ? ` (id ${id})` : ""}.`;
	}
	if (source.kind === "provider_config") {
		return `Governance source: direct Virtual Key provider config${source.provider ? ` "${source.provider}"` : ""}.`;
	}
	if (source.kind === "model_config") {
		return `Governance source: direct Virtual Key model config${source.modelId ? ` "${source.modelId}"` : ""}${source.provider ? ` via ${source.provider}` : ""}.`;
	}
	if (source.kind === "virtual_key_effective") {
		return "Governance source: effective Virtual Key rate limit merged from externally governed sources.";
	}
	return `Governance source: direct Virtual Key${source.virtualKeyName ? ` "${source.virtualKeyName}"` : ""}.`;
}

function sourceIdentity(source: BifrostQuotaProvenance): string | undefined {
	if (source.kind !== "external") return undefined;
	const type = source.sourceType ?? "external";
	const identity = source.sourceId ?? source.sourceName ?? source.legacySource;
	return identity ? `${type}:${identity}` : type;
}

function provenanceLimitId(baseId: string, source: BifrostQuotaProvenance): string {
	const identity = sourceIdentity(source);
	return identity ? `${baseId}:source:${encodeURIComponent(identity)}` : baseId;
}

function managementBase(url: string): string {
	const parsed = new URL(url);
	parsed.pathname = parsed.pathname.replace(/\/v1\/?$/u, "") || "/";
	return parsed.toString().replace(/\/$/u, "");
}

function statusFor(used: number | undefined, limit: number | undefined): "ok" | "warning" | "exhausted" | "unknown" {
	if (used === undefined || limit === undefined || limit <= 0) return "unknown";
	if (used >= limit) return "exhausted";
	if (used / limit >= 0.8) return "warning";
	return "ok";
}

function parseWindow(value: unknown): { amount: number; unit: "s" | "m" | "h" | "d" | "w" | "M" | "Q" | "Y" } | undefined {
	const raw = text(value);
	if (!raw) return undefined;
	const match = raw.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w|M|Q|Y)$/u);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	return { amount, unit: match[2] as "s" | "m" | "h" | "d" | "w" | "M" | "Q" | "Y" };
}

function durationMs(value: unknown): number | undefined {
	const parsed = parseWindow(value);
	if (!parsed || ["M", "Q", "Y"].includes(parsed.unit)) return undefined;
	const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
		parsed.unit as "s" | "m" | "h" | "d" | "w"
	];
	return Math.round(parsed.amount * factor);
}

function resetsAt(lastReset: unknown, duration: unknown): number | undefined {
	const start = text(lastReset);
	const window = parseWindow(duration);
	if (!start || !window) return undefined;
	const parsed = Date.parse(start);
	if (!Number.isFinite(parsed)) return undefined;

	const fixed = durationMs(duration);
	if (fixed !== undefined) return parsed + fixed;

	// Bifrost's variable budget windows are calendar arithmetic, not fixed day
	// approximations. LastReset is the actual start of the current rolling or
	// calendar-aligned cycle, so advancing it by months/quarters/years yields
	// the correct next boundary without needing the owner's alignment flag.
	const date = new Date(parsed);
	if (!Number.isInteger(window.amount)) return undefined;
	if (window.unit === "M") date.setUTCMonth(date.getUTCMonth() + window.amount);
	else if (window.unit === "Q") date.setUTCMonth(date.getUTCMonth() + (window.amount * 3));
	else if (window.unit === "Y") date.setUTCFullYear(date.getUTCFullYear() + window.amount);
	else return undefined;
	return date.getTime();
}

function amount(used: number | undefined, limit: number | undefined, unit: "usd" | "tokens" | "requests") {
	const safeUsed = used ?? 0;
	const remaining = limit === undefined ? undefined : Math.max(0, limit - safeUsed);
	return {
		used: safeUsed,
		...(limit !== undefined ? { limit } : {}),
		...(remaining !== undefined ? { remaining } : {}),
		...(limit && limit > 0 ? {
			usedFraction: safeUsed / limit,
			remainingFraction: Math.max(0, 1 - safeUsed / limit),
		} : {}),
		unit,
	} as const;
}

function budgetLimit(
	budget: JsonRecord,
	scope: { provider?: string; modelId?: string; tier?: string; shared?: boolean },
	prefix: string,
	provenance: BifrostQuotaProvenance,
): UsageLimit | undefined {
	const max = positive(budget.max_limit);
	if (!max) return undefined;
	const override = positive(budget.override_amount) ?? 0;
	const limit = max + override;
	const used = finite(budget.current_usage) ?? 0;
	const resetDuration = text(budget.reset_duration);
	const id = text(budget.id) ?? `${prefix}:budget:${resetDuration ?? "unknown"}`;
	const limitId = provenanceLimitId(`${prefix}:budget:${id}`, provenance);
	const notes = [
		...(override > 0 ? [`Includes active Bifrost budget override of ${override.toFixed(2)}.`] : []),
		provenanceNote(provenance),
	];
	return {
		id: limitId,
		label: `Bifrost budget${scope.modelId ? ` · ${scope.modelId}` : scope.provider ? ` · ${scope.provider}` : ""}`,
		scope: {
			provider: "bifrost" as Provider,
			...(scope.provider ? { tier: `provider:${scope.provider}` } : {}),
			...(scope.modelId ? { modelId: scope.modelId } : {}),
			...(scope.shared !== undefined ? { shared: scope.shared } : {}),
			...(resetDuration ? { windowId: resetDuration } : {}),
		},
		window: resetDuration ? {
			id: resetDuration,
			label: resetDuration,
			...(durationMs(resetDuration) ? { durationMs: durationMs(resetDuration) } : {}),
			...(resetsAt(budget.last_reset, resetDuration) ? { resetsAt: resetsAt(budget.last_reset, resetDuration) } : {}),
		} : undefined,
		amount: amount(used, limit, "usd"),
		status: statusFor(used, limit),
		notes,
	};
}

function rateLimits(
	rate: JsonRecord | undefined,
	scope: { provider?: string; modelId?: string; shared?: boolean },
	prefix: string,
	provenance: BifrostQuotaProvenance,
): UsageLimit[] {
	if (!rate) return [];
	const result: UsageLimit[] = [];
	const baseId = text(rate.id) ?? prefix;

	for (const kind of ["token", "request"] as const) {
		const max = positive(rate[`${kind}_max_limit`]);
		if (!max) continue;
		const used = finite(rate[`${kind}_current_usage`]) ?? 0;
		const resetDuration = text(rate[`${kind}_reset_duration`]);
		const lastReset = rate[`${kind}_last_reset`];
		const unit = kind === "token" ? "tokens" : "requests";
		result.push({
			id: provenanceLimitId(`${prefix}:${kind}:${baseId}`, provenance),
			label: `Bifrost ${kind} rate limit${scope.modelId ? ` · ${scope.modelId}` : scope.provider ? ` · ${scope.provider}` : ""}`,
			scope: {
				provider: "bifrost" as Provider,
				...(scope.provider ? { tier: `provider:${scope.provider}` } : {}),
				...(scope.modelId ? { modelId: scope.modelId } : {}),
				...(scope.shared !== undefined ? { shared: scope.shared } : {}),
				...(resetDuration ? { windowId: resetDuration } : {}),
			},
			window: resetDuration ? {
				id: resetDuration,
				label: resetDuration,
				...(durationMs(resetDuration) ? { durationMs: durationMs(resetDuration) } : {}),
				...(resetsAt(lastReset, resetDuration) ? { resetsAt: resetsAt(lastReset, resetDuration) } : {}),
			} : undefined,
			amount: amount(used, max, unit),
			status: statusFor(used, max),
			notes: [provenanceNote(provenance)],
		});
	}
	return result;
}

function pushGovernance(
	limits: UsageLimit[],
	provenanceByLimit: Record<string, BifrostQuotaProvenance>,
	value: JsonRecord,
	scope: { provider?: string; modelId?: string; shared?: boolean },
	prefix: string,
	baseProvenance: BifrostQuotaProvenance,
	rateProvenance: BifrostQuotaProvenance = baseProvenance,
): void {
	for (const raw of asArray(value.budgets)) {
		const budget = record(raw);
		if (!budget) continue;
		const provenance = withRowSource(baseProvenance, budget);
		const limit = budgetLimit(budget, scope, prefix, provenance);
		if (limit) {
			limits.push(limit);
			provenanceByLimit[limit.id] = provenance;
		}
	}
	for (const limit of rateLimits(
		record(value.rate_limit),
		scope,
		prefix,
		withRowSource(rateProvenance, record(value.rate_limit)),
	)) {
		limits.push(limit);
		provenanceByLimit[limit.id] = withRowSource(rateProvenance, record(value.rate_limit));
	}
	for (const raw of asArray(value.rate_limits)) {
		const rate = record(raw);
		const provenance = withRowSource(baseProvenance, rate);
		for (const limit of rateLimits(rate, scope, prefix, provenance)) {
			limits.push(limit);
			provenanceByLimit[limit.id] = provenance;
		}
	}
}

export function parseBifrostQuota(payload: unknown, fetchedAt = Date.now()): UsageReport | null {
	const root = record(payload);
	if (!root) return null;
	const limits: UsageLimit[] = [];
	const provenanceByLimit: Record<string, BifrostQuotaProvenance> = {};
	const virtualKeyName = text(root.virtual_key_name);
	const directVirtualKey: BifrostQuotaProvenance = {
		kind: "virtual_key",
		direct: true,
		...(virtualKeyName ? { virtualKeyName } : {}),
	};
	const hasExternalRateSources = asArray(root.rate_limits)
		.map(record)
		.some(hasSourceRef);
	const effectiveRateSource: BifrostQuotaProvenance = hasExternalRateSources
		? {
			kind: "virtual_key_effective",
			direct: false,
			...(virtualKeyName ? { virtualKeyName } : {}),
		}
		: directVirtualKey;

	pushGovernance(
		limits,
		provenanceByLimit,
		root,
		{ shared: true },
		"vk",
		directVirtualKey,
		effectiveRateSource,
	);

	for (const raw of asArray(root.provider_configs)) {
		const cfg = record(raw);
		if (!cfg) continue;
		const provider = text(cfg.provider);
		pushGovernance(
			limits,
			provenanceByLimit,
			cfg,
			{ provider, shared: true },
			`provider:${provider ?? "unknown"}`,
			{
				kind: "provider_config",
				direct: true,
				...(virtualKeyName ? { virtualKeyName } : {}),
				...(provider ? { provider } : {}),
			},
		);
	}

	for (const raw of asArray(root.model_configs)) {
		const cfg = record(raw);
		if (!cfg) continue;
		const modelId = text(cfg.model_name) ?? text(cfg.model);
		if (!modelId || modelId === "*") continue;
		const provider = text(cfg.provider);
		pushGovernance(
			limits,
			provenanceByLimit,
			cfg,
			{ provider, modelId, shared: false },
			`model:${provider ?? "any"}:${modelId}`,
			{
				kind: "model_config",
				direct: true,
				...(virtualKeyName ? { virtualKeyName } : {}),
				...(provider ? { provider } : {}),
				modelId,
			},
		);
	}

	const deduped = [...new Map(limits.map((limit) => [limit.id, limit])).values()];
	return {
		provider: "bifrost" as Provider,
		fetchedAt,
		limits: deduped,
		notes: [
			"Bifrost Virtual Key governance is authoritative; usage counters can lag live inference briefly because Bifrost persists counters asynchronously.",
			...(root.is_active === false ? ["This Bifrost Virtual Key is inactive."] : []),
		],
		metadata: {
			virtualKeyName,
			isActive: root.is_active !== false,
			governanceSources: provenanceByLimit,
		},
	};
}

export function createBifrostUsageProvider(config: BifrostConfig): UsageProvider | undefined {
	const virtualKey = text(config.virtualKey);
	if (!virtualKey) return undefined;
	const endpoint = `${managementBase(config.url)}/api/governance/virtual-keys/quota`;

	return {
		id: "bifrost" as Provider,
		// Quota auth validates the provider credential only in VK-only mode. With
		// a separate inference API key configured, quota health proves the VK but
		// says nothing about that distinct Bearer credential.
		validatesCredentials: !config.apiKey,
		retainLastGoodOnFailure: true,
		supports: () => true,
		async fetchUsage(_params, ctx) {
			const response = await ctx.fetch(endpoint, {
				method: "GET",
				headers: {
					Accept: "application/json",
					"x-bf-vk": virtualKey,
				},
			});
			if (!response.ok) {
				if (response.status === 404) return null;
				const detail = (await response.text()).slice(0, 500);
				throw new Error(`Bifrost quota request failed (${response.status})${detail ? `: ${detail}` : ""}`);
			}
			return parseBifrostQuota(await response.json());
		},
	};
}
