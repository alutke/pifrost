/**
 * 30B: OMP-native compaction threshold provisioning. No request interception.
 * All changes are additive and read-before-write; users own explicit settings.
 */
export const CONTEXT_TARGETS = Object.freeze({
  main: Object.freeze({ softTokens: 120_000, minimumWindow: 184_616 }),
  advisor: Object.freeze({ softTokens: 64_000, minimumWindow: 98_462 }),
});
export const PIFROST_CONTEXT_ROUTES = Object.freeze({
  "bifrost/omp-default": "main",
  "bifrost/omp-advisor": "advisor",
  "bifrost/omp-task": "main",
  "bifrost/omp-plan": "main",
  "bifrost/omp-slow": "main",
});
const isRecord = x => x !== null && typeof x === "object" && !Array.isArray(x);
const validWindow = x => Number.isSafeInteger(x) && x > 0;
const simpleBool = (settings,id) => settings?.[id]?.status === "ok" &&
  typeof settings[id].value === "boolean" ? settings[id].value : null;
const globMatches = (glob, selector) => {
  if (typeof glob !== "string" || !glob.endsWith("*") || glob.slice(0,-1).includes("*")) return false;
  return selector.startsWith(glob.slice(0,-1));
};
/** Model window is a local gateway catalogue hint; never assert physical-route permanence. */
export function proposeAdaptiveContextSettings(settings, catalogueModels = [], mode = "adaptive") {
  const original = settings?.["compaction.modelThresholds"];
  const current = original?.status === "ok" ? original.value : null;
  const enabled = simpleBool(settings,"compaction.enabled");
  const midTurn = simpleBool(settings,"compaction.midTurnEnabled");
  const continueAfter = simpleBool(settings,"compaction.autoContinue");
  const modelEnabled = simpleBool(settings,"compaction.modelThresholdsEnabled");
  const reasons = [];
  if (mode !== "adaptive") return { status:"disabled", reasons:["Pifrost context management explicitly disabled."], changes:[], merged:null };
  if (!isRecord(current) || Object.values(current).some(v => typeof v !== "string" && typeof v !== "number")) {
    return { status:"unavailable", reasons:["Cannot safely read compaction.modelThresholds; no writes permitted."], changes:[], merged:null };
  }
  if (enabled !== true || midTurn !== true || continueAfter !== true || modelEnabled === false) {
    return { status:"respect-user", reasons:[
      "OMP compaction, mid-turn maintenance or continuation is disabled/unverified; do not override explicit host policy.",
    ], changes:[], merged:null };
  }
  const merged = Object.assign(Object.create(null), current);
  const hints = Array.isArray(catalogueModels) ? catalogueModels : [];
  const changes = [];
  for (const [selector, kind] of Object.entries(PIFROST_CONTEXT_ROUTES)) {
    if (Object.hasOwn(current,selector) || Object.keys(current).some(k => globMatches(k,selector))) {
      reasons.push(selector + ": preserved existing exact or wildcard user threshold");
      continue;
    }
    const model = hints.find(x => isRecord(x) && x.id === selector.slice("bifrost/".length));
    const window = validWindow(model?.contextWindow) ? model.contextWindow : null;
    const target = CONTEXT_TARGETS[kind];
    const value = window !== null && window >= target.minimumWindow
      ? "f" + String(target.softTokens) : "65%";
    merged[selector] = value;
    changes.push({ selector, value, evidence: window === null ? "window-unverified" : "catalogue-window-hint",
      windowTokens: window });
  }
  return { status: changes.length ? "proposed" : "unchanged", reasons, changes,
    merged: Object.fromEntries(Object.entries(merged)) };
}
export function formatAdaptiveContextPlan(plan) {
  const lines = ["Pifrost 30B · OMP-native context policy (" + plan.status + ")"];
  for (const c of plan.changes) lines.push("  " + c.selector + ": " + c.value + " [" + c.evidence +
    (c.windowTokens ? ", window " + c.windowTokens : "") + "]");
  for (const reason of plan.reasons) lines.push("  " + reason);
  lines.push("Only compaction.modelThresholds may be written; use OMP's existing method order, plan protection and mid-turn continuation.");
  lines.push("Fixed triggers are selected only with sufficient reported alias window. Smaller/unknown windows use 65%.");
  return lines.join("\n");
}
