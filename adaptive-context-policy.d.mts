export type AdaptiveContextMode = "adaptive" | "native" | "off";
export interface AdaptiveContextAttempt {
  window: number;
  afterTokens: number;
}
export type AdaptiveContextDecision = Readonly<{
  shouldCompact: boolean;
  reason: "adaptive-budget" | "below-target" | "cooldown" | "unverified-or-overflow";
  threshold: number | null;
}>;
export function adaptiveContextMode(env?: NodeJS.ProcessEnv): AdaptiveContextMode;
export function planAdaptiveContextMaintenance(tokens: number, window: number,
  lastAttempt?: AdaptiveContextAttempt, options?: {
    softFraction?: number;
    softTokens?: number;
  }): AdaptiveContextDecision;
