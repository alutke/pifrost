/**
 * Pifrost 30B supplementary idle policy.
 * OMP remains authoritative for mid-turn compaction, plan protection and history.
 */
export const ADAPTIVE_CONTEXT_DEFAULTS = Object.freeze({
  softFraction: 0.65, softTokens: 120_000, urgentFraction: 0.80,
  urgentTokens: 160_000, minimumGrowth: 32_768,
});
export function adaptiveContextMode(env = process.env) {
  const raw = env.PIFROST_CONTEXT_MODE?.trim().toLowerCase();
  if (!raw || raw === "adaptive" || raw === "on") return "adaptive";
  if (raw === "native" || raw === "off") return raw;
  return "native"; // Invalid explicit values never activate additional compaction.
}
export function planAdaptiveContextMaintenance(tokens, window, lastAttempt, options = {}) {
  const good = x => typeof x === "number" && Number.isFinite(x) && x >= 0;
  if (!good(tokens) || !good(window) || window <= 0 || tokens >= window)
    return { shouldCompact:false, reason:"unverified-or-overflow", threshold:null };
  const fraction = good(options.softFraction) && options.softFraction > 0 && options.softFraction < 1
    ? options.softFraction : ADAPTIVE_CONTEXT_DEFAULTS.softFraction;
  const cap = good(options.softTokens) && options.softTokens > 0
    ? options.softTokens : ADAPTIVE_CONTEXT_DEFAULTS.softTokens;
  const threshold = Math.floor(Math.min(window * fraction,cap));
  if (tokens < threshold) return { shouldCompact:false, reason:"below-target", threshold };
  const growthFloor = ADAPTIVE_CONTEXT_DEFAULTS.minimumGrowth;
  const sameWindow = lastAttempt?.window === window;
  if (sameWindow && good(lastAttempt.afterTokens) &&
    tokens >= lastAttempt.afterTokens && tokens-lastAttempt.afterTokens < growthFloor)
    return { shouldCompact:false, reason:"cooldown", threshold };
  return { shouldCompact:true, reason:"adaptive-budget", threshold };
}
