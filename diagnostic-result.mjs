export const DIAGNOSTIC_STATUS = Object.freeze({
  OK: "ok",
  WARN: "warn",
  FAIL: "fail",
  SKIP: "skip",
  UNKNOWN: "unknown",
});

const VALID_STATUSES = new Set(Object.values(DIAGNOSTIC_STATUS));

function optionalText(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

/**
 * Shared, renderer-neutral diagnostic result contract.
 *
 * Phase 0 introduces the shape without changing the current human output.
 * Later CLI UI phases can render the same object as compact text, interactive
 * detail or JSON without re-interpreting domain state.
 */
export function createDiagnosticResult({
  id,
  label,
  status,
  summary,
  detail,
  impact,
  remediation,
  suggestedCommand,
  data,
}) {
  const normalizedId = optionalText(id);
  const normalizedLabel = optionalText(label);
  if (!normalizedId) throw new Error("Diagnostic result id is required");
  if (!normalizedLabel) throw new Error("Diagnostic result label is required");
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid diagnostic status: ${status}`);

  return Object.freeze({
    id: normalizedId,
    label: normalizedLabel,
    status,
    summary: optionalText(summary),
    detail: optionalText(detail),
    impact: optionalText(impact),
    remediation: optionalText(remediation),
    suggestedCommand: optionalText(suggestedCommand),
    data,
  });
}

export function diagnosticsOk(results) {
  return results.every((item) =>
    item?.status === DIAGNOSTIC_STATUS.OK || item?.status === DIAGNOSTIC_STATUS.SKIP
  );
}
