/**
 * Plain-text-first terminal presentation. No ANSI colour, emoji, cursor
 * movement or required TTY. Stable across pipes and screen readers.
 */
const ORDER = { fail: 0, warn: 1, unknown: 2, skip: 3, ok: 4 };
const LABELS = { fail: "FAIL", warn: "WARN", unknown: "UNKNOWN", skip: "SKIP", ok: "OK" };
export function cleanDisplay(value, fallback = "not available") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[\x00-\x1f\x7f]/gu, " ").trim();
  return text || fallback;
}
export function terminalSection(title) {
  const heading = cleanDisplay(title);
  return `\n${heading}\n${"-".repeat(Math.min(72, heading.length))}`;
}
/** Text-only wrapping respects narrow output/pipes and indents continuations.
 * A long single token is split rather than overflowing the terminal. */
export function wrapTerminal(text, width = 88, indent = "    ") {
  const max=Math.max(36,Math.min(160,width));
  const segments=String(text).split(/\s+/u).filter(Boolean);
  const rows=[];let current="";
  for(const word of segments){
    let remaining=word;
    while(remaining.length){
      const prefix=current?current+" ":"";
      const available=max-prefix.length;
      if(remaining.length<=available){
        current=prefix+remaining;remaining="";break;
      }
      if(prefix){rows.push(current);current="";continue;}
      rows.push(remaining.slice(0,max));remaining=remaining.slice(max);
    }
  }
  if(current)rows.push(current);
  return rows.map((line,i)=>i===0?line:indent+line).join("\n");
}
export function terminalField(label, value) {
  return wrapTerminal(`  ${cleanDisplay(label)}: ${cleanDisplay(value)}`);
}
export function terminalStatus(status, label, detail) {
  const code = LABELS[status] ?? "UNKNOWN";
  return wrapTerminal(`  [${code}] ${cleanDisplay(label)}${detail ? " - " + cleanDisplay(detail) : ""}`);
}
export function terminalNextSteps(steps, max = 6) {
  const unique = [...new Set((steps ?? []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim()))].slice(0, max);
  if (!unique.length) return "";
  return ["Next steps:", ...unique.map((item, index) => `  ${index + 1}. ${cleanDisplay(item)}`)].join("\n");
}
export function renderHealthOverview(checks, { details = false, title = "Pifrost health" } = {}) {
  const items = [...checks].sort((a, b) => (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2));
  const issues = items.filter(x => x.status !== "ok");
  const passed = items.filter(x => x.status === "ok").length;
  const label = issues.some(x => x.status === "fail")
    ? "Action required" : issues.length ? "Review recommended" : "All checked services are working";
  const lines = [terminalSection(title), `Result: ${label} (${passed}/${items.length} checks OK)`, ""];
  for (const item of details ? items : [...issues, ...items.filter(x => x.status === "ok")]) {
    lines.push(terminalStatus(item.status, item.label, item.detail));
  }
  const actions = terminalNextSteps(issues.map(item => item.action));
  if (actions) lines.push("", actions);
  if (!details) lines.push("", "For technical details: pifrost doctor --verbose");
  lines.push("Checks show what was verified, not proof that every inference route will work.");
  return lines.join("\n");
}
export function humanTokenCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "unknown";
  const n = Math.round(value);
  return n.toLocaleString("en-GB");
}
export function humanAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return "less than a minute";
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
export function compactCliHelp(version) {
  return [
    `Pifrost ${version} - optional Bifrost resources for native OMP`,
    "",
    "Start here:",
    "  pifrost init                   Bifrost connection and secret setup",
    "  pifrost doctor                 Minimal integration health check",
    "  pifrost migrate status         Preview removal of old Pifrost model mappings",
    "  pifrost migrate apply          Restore native OMP role ownership (backed up)",
    "",
    "Optional Bifrost models:",
    "  pifrost models list            Bifrost model roster (read-only)",
    "  pifrost models status          Native OMP discovery status",
    "  pifrost models enable          Opt in to native Bifrost models.yml provider",
    "  pifrost models disable         Remove only the Pifrost-managed provider",
    "  Select a Bifrost model manually in OMP using /model",
    "",
    "Repository MCPs and Skills:",
    "  pifrost repo init              Dedicated repo MCP Virtual Key and grants",
    "  pifrost repo mcp list          Bifrost MCP client inventory",
    "  pifrost repo vmcp list         Bifrost Virtual MCP bundles",
    "  pifrost repo skills list       Bifrost Skills catalogue",
    "  pifrost repo skills add <name> Install a Skill into .agents/skills",
    "",
    "  pifrost help --all             Full command reference",
    "Pifrost does not load OMP runtime hooks or change modelRoles by default.",
    "",
  ].join("\n");
}

export function formatCliFailure(error, { isUsage = false } = {}) {
  // Avoid echoing arbitrary input arguments (which may contain secrets).
  const message = cleanDisplay(error?.message ?? error)
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/gu, "[redacted]")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/([?&](?:api_key|token|password|virtual_key)=)[^\s&]+/giu, "$1[redacted]");
  const result = ["Pifrost could not complete the command.", `Reason: ${message}`];
  if (isUsage) result.push("Next: run pifrost help or pifrost help --all for syntax.");
  else if (/timeout|timed out/iu.test(message)) result.push("Next: check gateway connectivity with pifrost global status.");
  else if (/not configured|missing.*(key|auth)|configuration is incomplete/iu.test(message)) result.push("Next: run pifrost global setup.");
  else result.push("Next: run pifrost doctor for diagnosis (or pifrost doctor --verbose).");
  return result.join("\n");
}
