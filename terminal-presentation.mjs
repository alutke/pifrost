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
export function terminalField(label, value) {
  return `  ${cleanDisplay(label)}: ${cleanDisplay(value)}`;
}
export function wrapTerminalText(value, width = 88, indent = "    ") {
  const text = cleanDisplay(value);
  if (text.length <= width) return text;
  const words = text.split(/\s+/u), lines = [], prefix = indent;
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += " " + word;
    else { lines.push(line); line = prefix + word; }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
export function terminalStatus(status, label, detail, issueId) {
  const code = LABELS[status] ?? "UNKNOWN";
  const title = "  [" + code + "] " + cleanDisplay(label)
    + (issueId ? " (" + cleanDisplay(issueId) + ")" : "");
  return wrapTerminalText(title + (detail ? " - " + cleanDisplay(detail) : ""));
}
export function terminalNextSteps(steps, max = 6) {
  const unique = [...new Set((steps ?? []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim()))].slice(0, max);
  if (!unique.length) return "";
  return ["Next steps:", ...unique.map((item, index) => `  ${index + 1}. ${cleanDisplay(item)}`)].join("\n");
}
export function healthExitCode(checks, { strict = false } = {}) {
  return checks.some(item => item.status === "fail" && item.required !== false || strict && item.status !== "ok") ? 2 : 0;
}
export function renderHealthOverview(checks, { details = false, title = "Pifrost health", detailCommand = "pifrost doctor --verbose" } = {}) {
  const items = [...checks].sort((a, b) => (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2));
  const issues = items.filter(x => x.status !== "ok");
  const passed = items.filter(x => x.status === "ok").length;
  const label = issues.some(x => x.status === "fail")
    ? "Action required" : issues.length ? "Review recommended" : "All checked services are working";
  const lines = [terminalSection(title), `Result: ${label} (${passed}/${items.length} checks OK)`, ""];
  const visible = details ? items : [...issues, ...items.filter(x => x.status === "ok").slice(0, 8)];
  for (const item of visible) {
    lines.push(terminalStatus(item.status, item.label, item.detail, item.id));
  }
  const actions = terminalNextSteps(issues.map(item => item.action));
  if (actions) lines.push("", actions);
  if (!details && items.length > visible.length) lines.push("  ... " + (items.length - visible.length) + " other successful checks (see --verbose)");
  if (!details) lines.push("", "For technical details: " + detailCommand);
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
    `Pifrost ${version} - OMP and Bifrost integration`,
    "",
    "Start here:",
    "  pifrost init                  First-time setup",
    "  pifrost doctor                Quick health check and next steps",
    "  pifrost global status         Gateway and authentication status",
    "",
    "Routing and models:",
    "  pifrost routes effective      Which OMP roles use which gateway routes",
    "  pifrost routes explain default  Explain eligibility before a request",
    "  pifrost routes diff           Compare live Bifrost rules with saved rules",
    "  pifrost routes verify         Revalidate an unchanged route policy",
    "  pifrost routes sync           Save current Bifrost routing policy",
    "  pifrost models doctor         Check model capabilities and availability",
    "",
    "Repository tools:",
    "  pifrost repo status           Virtual Key, MCP access and Skills",
    "  pifrost repo mcp list         Available Bifrost MCP clients",
    "  pifrost repo skills suggestions  Suggested matching Skills",
    "",
    "Advanced:",
    "  pifrost judge status          Optional native judge",
    "  pifrost global observability  Read-only gateway intelligence and privacy",
    "  pifrost doctor --verbose      Full technical diagnostics",
    "  pifrost models doctor --verbose  Full model and route provenance",
    "  pifrost help --all            All commands, options and environment variables",
    "",
    "OMP commands: /pifrost doctor, /pifrost trace, /pifrost costs, /pifrost config",
    "All output works in non-colour terminals and when redirected to files.",
    "",
  ].join("\n");
}
export function redactTerminalSecrets(input) {
  return String(input)
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/gu, "[redacted]")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/([?&](?:api_key|token|password|virtual_key)=)[^\s&]+/giu, "$1[redacted]");
}
export function formatCliFailure(error, { isUsage = false } = {}) {
  const message = redactTerminalSecrets(cleanDisplay(error?.message ?? error));
  const result = ["Pifrost could not complete the command.", `Reason: ${message}`];
  if (isUsage) result.push("Next: run pifrost help or pifrost help --all for syntax.");
  else if (/timeout|timed out/iu.test(message)) result.push("Next: check gateway connectivity with pifrost global status.");
  else if (/not configured|missing.*(key|auth)|configuration is incomplete/iu.test(message)) result.push("Next: run pifrost global setup.");
  else result.push("Next: run pifrost doctor for diagnosis (or pifrost doctor --verbose).");
  return result.join("\n");
}
