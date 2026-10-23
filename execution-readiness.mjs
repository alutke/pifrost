/**
 * Release 30A: read-only host/config capability assessment.
 * No service, model probing, settings writes, provider failover or history access.
 */
export const OMP_EXECUTION_SETTING_IDS = Object.freeze([
  "compaction.enabled",
  "compaction.midTurnEnabled",
  "compaction.autoContinue",
  "compaction.modelThresholds",
  "retry.modelFallback",
]);

const get = (settings, id) => settings?.[id]?.status === "ok" ? settings[id].value : undefined;
const check = (id, status, message, action) =>
  Object.freeze({ id, status, message, ...(action ? { action } : {}) });
const versionTuple = version => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(String(version ?? ""));
  return m ? m.slice(1).map(Number) : null;
};

export function assessExecutionReadiness({ settings = {}, hostVersion, policySnapshotVersion, stalledMode } = {}) {
  const checks = [];
  const host = versionTuple(hostVersion), pinned = versionTuple(policySnapshotVersion);
  const exact = !!host && !!pinned && host.every((x, i) => x === pinned[i]);
  checks.push(check("lifecycle-hooks", exact ? "ok" : "unknown",
    exact ? "Host matches the packaged OMP policy snapshot. session_stop, context, agent_end and session.compacting are documented host interfaces; live event dispatch is not tested."
      : "Host event interfaces require inspection against the installed OMP version; version alone is not proof of hook dispatch.",
    exact ? undefined : "pifrost doctor --verbose"));

  const enabled = get(settings, "compaction.enabled");
  const midTurn = get(settings, "compaction.midTurnEnabled");
  const auto = get(settings, "compaction.autoContinue");
  const thresholds = get(settings, "compaction.modelThresholds");
  const thresholdCount = thresholds && typeof thresholds === "object" && !Array.isArray(thresholds)
    ? Object.keys(thresholds).length : null;
  checks.push(check("context-maintenance", enabled === false ? "warn" : enabled === true ? "ok" : "unknown",
    enabled === false ? "OMP compaction is disabled. Long tasks may retain oversized context."
      : enabled === true ? "OMP compaction is configured on; actual mid-turn operation and threshold effectiveness are unverified."
      : "Cannot read OMP compaction.enabled; do not infer a default.",
    enabled === false ? "omp config get compaction.enabled --json" : undefined));
  checks.push(check("mid-turn-continuation",
    midTurn === false || auto === false ? "warn" : midTurn === true && auto === true ? "ok" : "unknown",
    "Mid-turn compaction: " + (midTurn === undefined ? "unverified" : String(midTurn)) +
      "; compaction auto-continue: " + (auto === undefined ? "unverified" : String(auto)) +
      ". These are read-only settings observations, not executed maintenance."));
  checks.push(check("context-thresholds", thresholdCount === null ? "unknown" : "info",
    thresholdCount === null ? "OMP model-specific threshold settings unavailable or malformed."
      : thresholdCount + " model-specific thresholds configured. Their values and effective physical context window are not certified."));
  const fallback = get(settings, "retry.modelFallback");
  checks.push(check("fallback-ownership", fallback === true ? "warn" : fallback === false ? "ok" : "unknown",
    fallback === true ? "OMP model fallback is enabled while Bifrost may also route/fallback. Verify one owner per recovery boundary."
      : fallback === false ? "OMP model fallback disabled; Bifrost retains physical routing. No live fallback tested."
      : "Cannot establish OMP retry.modelFallback; physical Bifrost fallback is not inferred."));
  const mode = typeof stalledMode === "string" ? stalledMode.toLowerCase().trim() : "auto";
  checks.push(check("pifrost-stalled-observer", ["off","notice","auto"].includes(mode) ? "info" : "unknown",
    "Pifrost stalled-turn mode: " + (["off","notice","auto"].includes(mode) ? mode : "unknown") +
      ". Existing one-shot follow-up and OMP advisor may both request further turns. Release 30A does not add another recovery actor."));
  return Object.freeze({
    schemaVersion: 1,
    phase: "30A",
    status: checks.some(c => c.status === "warn") ? "attention"
      : checks.some(c => c.status === "unknown") ? "unverified" : "locally-compatible",
    checks,
    contextWindowTokens: null,
    physicalModel: null,
    limitations: [
      "Local settings and version are not evidence that host hooks fired.",
      "The active context window and served physical model cannot be verified by the offline CLI.",
      "Pifrost 30A only diagnoses; automatic context reduction and expanded recovery are later phases.",
    ],
  });
}

export function formatExecutionReadiness(value, verbose = false) {
  const lines = ["Execution and context diagnostics (30A, read-only):"];
  for (const c of value.checks) {
    lines.push("  [" + c.status.toUpperCase() + "] " + c.id + ": " + c.message);
    if (c.action && (verbose || c.status === "warn")) lines.push("    Check: " + c.action);
  }
  if (verbose) lines.push(...value.limitations.map(x => "  Note: " + x));
  return lines.join("\n");
}
