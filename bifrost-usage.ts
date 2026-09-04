import type {
	Provider,
	UsageLimit,
	UsageProvider,
	UsageReport,
} from "@oh-my-pi/pi-ai";

import type { BifrostConfig } from "./index.ts";

type JsonRecord = Record<string, unknown>;

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

function durationMs(value: unknown): number | undefined {
	const raw = text(value);
	if (!raw) return undefined;
	const match = raw.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w)$/u);
	if (!match) return undefined;
	const amount = Number(match[1]);
	const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2] as "s" | "m" | "h" | "d" | "w"];
	return Math.round(amount * factor);
}

function resetsAt(lastReset: unknown, duration: unknown): number | undefined {
	const start = text(lastReset);
	const span = durationMs(duration);
	if (!start || !span) return undefined;
	const parsed = Date.parse(start);
	return Number.isFinite(parsed) ? parsed + span : undefined;
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
): UsageLimit | undefined {
	const max = positive(budget.max_limit);
	if (!max) return undefined;
	const override = positive(budget.override_amount) ?? 0;
	const limit = max + override;
	const used = finite(budget.current_usage) ?? 0;
	const resetDuration = text(budget.reset_duration);
	const id = text(budget.id) ?? `${prefix}:budget:${resetDuration ?? "unknown"}`;
	return {
		id: `${prefix}:budget:${id}`,
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
		notes: override > 0 ? [`Includes active Bifrost budget override of $${override.toFixed(2)}.`] : undefined,
	};
}

function rateLimits(
	rate: JsonRecord | undefined,
	scope: { provider?: string; modelId?: string; shared?: boolean },
	prefix: string,
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
			id: `${prefix}:${kind}:${baseId}`,
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
		});
	}
	return result;
}

function pushGovernance(
	limits: UsageLimit[],
	value: JsonRecord,
	scope: { provider?: string; modelId?: string; shared?: boolean },
	prefix: string,
): void {
	for (const raw of asArray(value.budgets)) {
		const budget = record(raw);
		if (!budget) continue;
		const limit = budgetLimit(budget, scope, prefix);
		if (limit) limits.push(limit);
	}
	limits.push(...rateLimits(record(value.rate_limit), scope, prefix));
	for (const raw of asArray(value.rate_limits)) {
		limits.push(...rateLimits(record(raw), scope, prefix));
	}
}

export function parseBifrostQuota(payload: unknown, fetchedAt = Date.now()): UsageReport | null {
	const root = record(payload);
	if (!root) return null;
	const limits: UsageLimit[] = [];

	pushGovernance(limits, root, { shared: true }, "vk");

	for (const raw of asArray(root.provider_configs)) {
		const cfg = record(raw);
		if (!cfg) continue;
		const provider = text(cfg.provider);
		pushGovernance(limits, cfg, { provider, shared: true }, `provider:${provider ?? "unknown"}`);
	}

	for (const raw of asArray(root.model_configs)) {
		const cfg = record(raw);
		if (!cfg) continue;
		const modelId = text(cfg.model_name) ?? text(cfg.model);
		if (!modelId || modelId === "*") continue;
		const provider = text(cfg.provider);
		pushGovernance(limits, cfg, { provider, modelId, shared: false }, `model:${provider ?? "any"}:${modelId}`);
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
			virtualKeyName: text(root.virtual_key_name),
			isActive: root.is_active !== false,
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
