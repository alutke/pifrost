import {
	DEFAULT_CONTEXT_FIXED_HEADROOM,
	DEFAULT_CONTEXT_SAFETY_MARGIN,
	type DynamicRouteProfile,
} from "./dynamic-routing.ts";

export const DEFAULT_COMPACT_BEFORE_CONTEXT_SKIP = true;
export const DEFAULT_COMPACT_RETRY_GROWTH_TOKENS = 32_768;
export const DEFAULT_COMPACT_IDLE_RETRY_MS = 100;
export const DEFAULT_COMPACT_IDLE_RETRIES = 20;

export interface CompactBeforeSkipAttempt {
	logicalModel: string;
	targetReference: string;
	targetContextWindow: number;
	afterContextTokens: number;
}

export interface CompactBeforeSkipPlan {
	shouldCompact: boolean;
	reason: "context-skip" | "no-context-skip" | "cooldown";
	logicalModel: string;
	contextTokens: number;
	estimatedInputTokens: number;
	outputReserveTokens: number;
	requiredContextTokens: number;
	targetReference?: string;
	targetContextWindow?: number;
}

export interface CompactBeforeSkipPlanOptions {
	safetyMargin?: number;
	fixedHeadroom?: number;
	outputReserveTokens?: number;
	retryGrowthTokens?: number;
}

export interface CompactBeforeSkipModelRef {
	provider: string;
	id: string;
}

export interface CompactBeforeSkipContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number;
}

/** Minimal structural surface Pifrost needs from OMP's ExtensionContext. */
export interface CompactBeforeSkipRuntimeContext {
	sessionManager: object;
	model?: CompactBeforeSkipModelRef;
	models: { current(): CompactBeforeSkipModelRef | undefined };
	getContextUsage(): CompactBeforeSkipContextUsage | undefined;
	isIdle(): boolean;
	compact(): Promise<void>;
	setTimeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): unknown;
}

export interface CompactBeforeSkipCoordinatorOptions extends CompactBeforeSkipPlanOptions {
	env?: NodeJS.ProcessEnv;
	providerId?: string;
	idleRetryMs?: number;
	idleRetries?: number;
	onError?: (error: unknown) => void;
}

interface CompactBeforeSkipRuntimeState {
	scheduled: boolean;
	inFlight: boolean;
	lastAttempt?: CompactBeforeSkipAttempt;
}

function finiteNonNegative(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function positiveEnvInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function compactBeforeContextSkipEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.PIFROST_COMPACT_BEFORE_CONTEXT_SKIP?.trim();
	if (!raw) return DEFAULT_COMPACT_BEFORE_CONTEXT_SKIP;
	return !/^(?:0|false|no|off)$/iu.test(raw);
}

/**
 * Convert OMP's model-aware context estimate into the same conservative
 * input-plus-output capacity domain used by Pifrost's final-wire guard.
 *
 * OMP already includes message/tool/system overhead in getContextUsage(). Pifrost
 * therefore does not run the raw JSON bytes/token estimator again here; it adds
 * only a cross-provider safety margin, fixed headroom and the route-wide safe
 * output reserve.
 */
export function requiredContextFromOmpUsage(
	profile: DynamicRouteProfile,
	contextTokens: number,
	options: CompactBeforeSkipPlanOptions = {},
): { estimatedInputTokens: number; outputReserveTokens: number; requiredContextTokens: number } {
	const safetyMargin = finiteNonNegative(options.safetyMargin, DEFAULT_CONTEXT_SAFETY_MARGIN);
	const fixedHeadroom = Math.floor(finiteNonNegative(options.fixedHeadroom, DEFAULT_CONTEXT_FIXED_HEADROOM));
	const outputReserveTokens = positiveInteger(options.outputReserveTokens, profile.maxTokens);
	const safeContextTokens = Math.max(0, Math.ceil(contextTokens));
	const estimatedInputTokens = Math.ceil(safeContextTokens * (1 + safetyMargin)) + fixedHeadroom;
	return {
		estimatedInputTokens,
		outputReserveTokens,
		requiredContextTokens: estimatedInputTokens + outputReserveTokens,
	};
}

/**
 * Decide whether normal OMP compaction is worth attempting before Pifrost's
 * request-time router would remove a smaller-context member.
 *
 * The candidate must be recoverable by reducing input context alone. A member
 * that cannot satisfy the route's output reserve is not a compaction target.
 * Repeated ineffective compactions are suppressed until the session changes
 * materially (default: 32K additional context tokens) or a different threshold
 * becomes the first context-only exclusion.
 */
export function planCompactBeforeContextSkip(
	profile: DynamicRouteProfile,
	contextTokens: number,
	lastAttempt?: CompactBeforeSkipAttempt,
	options: CompactBeforeSkipPlanOptions = {},
): CompactBeforeSkipPlan {
	const capacity = requiredContextFromOmpUsage(profile, contextTokens, options);
	const minimumRequired = capacity.outputReserveTokens + Math.floor(
		finiteNonNegative(options.fixedHeadroom, DEFAULT_CONTEXT_FIXED_HEADROOM),
	);
	const target = profile.members.find((member) =>
		member.contextWindow < capacity.requiredContextTokens &&
		member.maxTokens >= capacity.outputReserveTokens &&
		member.contextWindow > minimumRequired,
	);

	const base: Omit<CompactBeforeSkipPlan, "shouldCompact" | "reason"> = {
		logicalModel: profile.id,
		contextTokens: Math.max(0, Math.ceil(contextTokens)),
		estimatedInputTokens: capacity.estimatedInputTokens,
		outputReserveTokens: capacity.outputReserveTokens,
		requiredContextTokens: capacity.requiredContextTokens,
		...(target ? { targetReference: target.reference, targetContextWindow: target.contextWindow } : {}),
	};
	if (!target) return { ...base, shouldCompact: false, reason: "no-context-skip" };

	const retryGrowthTokens = positiveInteger(options.retryGrowthTokens, DEFAULT_COMPACT_RETRY_GROWTH_TOKENS);
	if (
		lastAttempt?.logicalModel.toLowerCase() === profile.id.toLowerCase() &&
		lastAttempt.targetReference.toLowerCase() === target.reference.toLowerCase() &&
		lastAttempt.targetContextWindow === target.contextWindow
	) {
		const growth = base.contextTokens - lastAttempt.afterContextTokens;
		if (growth >= 0 && growth < retryGrowthTokens) {
			return { ...base, shouldCompact: false, reason: "cooldown" };
		}
	}
	return { ...base, shouldCompact: true, reason: "context-skip" };
}

function currentPifrostRoute(
	ctx: CompactBeforeSkipRuntimeContext,
	getProfile: (logicalModel: string) => DynamicRouteProfile | undefined,
	providerId: string,
): { profile: DynamicRouteProfile; usage: CompactBeforeSkipContextUsage } | undefined {
	const model = ctx.models.current() ?? ctx.model;
	if (!model || model.provider.toLowerCase() !== providerId.toLowerCase()) return undefined;
	const profile = getProfile(model.id.toLowerCase());
	const usage = ctx.getContextUsage();
	if (!profile || !usage || !Number.isFinite(usage.tokens) || usage.tokens < 0) return undefined;
	return { profile, usage };
}

/**
 * Build the session-scoped proactive compaction scheduler used by the native
 * extension. Event handlers call schedule() and return immediately; the actual
 * compaction runs from OMP's session-owned timer only while the session is idle.
 * This deliberately avoids awaiting an LLM-backed compaction inside OMP's
 * 30-second extension-handler timeout.
 */
export function createCompactBeforeSkipCoordinator(
	getProfile: (logicalModel: string) => DynamicRouteProfile | undefined,
	options: CompactBeforeSkipCoordinatorOptions = {},
): (ctx: CompactBeforeSkipRuntimeContext) => void {
	const states = new WeakMap<object, CompactBeforeSkipRuntimeState>();
	const env = options.env ?? process.env;
	const providerId = options.providerId ?? "bifrost";
	const idleRetryMs = positiveInteger(options.idleRetryMs, DEFAULT_COMPACT_IDLE_RETRY_MS);
	const idleRetries = positiveInteger(options.idleRetries, DEFAULT_COMPACT_IDLE_RETRIES);
	const retryGrowthTokens = positiveEnvInteger(
		env,
		"PIFROST_COMPACT_RETRY_GROWTH_TOKENS",
		positiveInteger(options.retryGrowthTokens, DEFAULT_COMPACT_RETRY_GROWTH_TOKENS),
	);

	return (ctx: CompactBeforeSkipRuntimeContext): void => {
		if (!compactBeforeContextSkipEnabled(env)) return;
		let state = states.get(ctx.sessionManager);
		if (!state) {
			state = { scheduled: false, inFlight: false };
			states.set(ctx.sessionManager, state);
		}
		if (state.scheduled || state.inFlight) return;
		state.scheduled = true;

		const run = async (idleAttempt: number): Promise<void> => {
			if (!ctx.isIdle()) {
				if (idleAttempt < idleRetries) {
					ctx.setTimeout(() => {
						void run(idleAttempt + 1).catch(options.onError ?? (() => undefined));
					}, idleRetryMs);
					return;
				}
				state!.scheduled = false;
				return;
			}

			const current = currentPifrostRoute(ctx, getProfile, providerId);
			if (!current) {
				state!.scheduled = false;
				return;
			}
			const plan = planCompactBeforeContextSkip(current.profile, current.usage.tokens, state!.lastAttempt, {
				safetyMargin: options.safetyMargin,
				fixedHeadroom: options.fixedHeadroom,
				outputReserveTokens: options.outputReserveTokens,
				retryGrowthTokens,
			});
			if (!plan.shouldCompact || !plan.targetReference || !plan.targetContextWindow) {
				state!.scheduled = false;
				return;
			}

			state!.scheduled = false;
			state!.inFlight = true;
			try {
				// No mode override: respect the user's normal OMP compaction method
				// order and summarizer configuration rather than duplicating it here.
				await ctx.compact();
			} catch (error) {
				options.onError?.(error);
			} finally {
				const after = ctx.getContextUsage();
				state!.lastAttempt = {
					logicalModel: plan.logicalModel,
					targetReference: plan.targetReference,
					targetContextWindow: plan.targetContextWindow,
					afterContextTokens: after && Number.isFinite(after.tokens)
						? Math.max(0, Math.ceil(after.tokens))
						: plan.contextTokens,
				};
				state!.inFlight = false;
			}
		};

		ctx.setTimeout(() => {
			void run(0).catch((error) => {
				state!.scheduled = false;
				state!.inFlight = false;
				options.onError?.(error);
			});
		}, idleRetryMs);
	};
}
