/**
 * Release E — bounded, session-local recovery classification.
 * This is read-only evidence handling, NOT a provider retry engine.
 *
 * No prompts, historical messages, credentials, thinking text, or tool
 * arguments are captured. No timers, services or persisted recovery state.
 */
import { inferenceFailureAdvice, type InferenceFailureCode } from "./inference-failure.ts";

export type RecoveryFailureCode = Exclude<InferenceFailureCode, "UNKNOWN">;
export interface RecoveryTraceEvidence {
  readonly timestamp: number;
  readonly outcome: "done" | "error" | "thrown";
  readonly failureCode?: InferenceFailureCode;
  readonly httpStatus?: number;
  readonly outputStarted?: boolean;
  readonly replayAudit?: { readonly reason: string };
}
export interface RecoveryAssessment {
  readonly code: RecoveryFailureCode;
  readonly mayFork: boolean;
  readonly reason: string;
  readonly next: string;
  readonly httpStatus?: number;
  readonly outputStarted: boolean;
}

/** Only the *last completed attempt* in a session may trigger recovery UI.
 * A previous provider attempt that later succeeded is not a failure to recover.
 * Strict history errors can be raised locally before an HTTP status exists. */
export function assessRecovery(trace: RecoveryTraceEvidence | undefined): RecoveryAssessment | undefined {
  if (!trace || trace.outcome === "done") return undefined;
  const code: InferenceFailureCode | undefined = trace.failureCode && trace.failureCode !== "UNKNOWN"
    ? trace.failureCode
    : trace.replayAudit?.reason === "incompatible-history" ? "REASONING_REPLAY_INVALID" : undefined;
  if (!code || code === "UNKNOWN") return undefined;

  const mayFork = code === "REASONING_REPLAY_INVALID" && trace.outputStarted !== true;
  const reason = code === "REASONING_REPLAY_INVALID"
    ? trace.outputStarted === true
      ? "Partial model output may already have been produced. Do not assume the turn is safe to repeat."
      : "Historical reasoning replay was rejected; resending the same transcript is unlikely to repair it."
    : code === "OUTPUT_LIMIT_EXCEEDED"
      ? "The selected provider rejected an output-token limit. A new session cannot raise that entitlement."
    : code === "MODEL_NOT_PERMITTED"
      ? "Bifrost virtual-key permissions control this model. A session fork cannot override authorization."
    : code === "PROTOCOL_INCOMPATIBLE" || code === "ROUTE_CONTRACT_UNKNOWN"
      ? "This route or protocol needs verification; starting a new session does not repair it."
      : "This failure does not establish that the session history is incompatible.";
  return {
    code,
    mayFork,
    reason,
    next: mayFork
      ? "Use /pifrost recover fork for an explicitly confirmed clean OMP session, or inspect /pifrost trace verbose first."
      : inferenceFailureAdvice(code),
    ...(trace.httpStatus !== undefined ? { httpStatus: trace.httpStatus } : {}),
    outputStarted: trace.outputStarted === true,
  };
}

export function formatRecoveryStatus(assessment: RecoveryAssessment | undefined): string {
  if (!assessment) return [
    "Pifrost recovery: no actionable classified failure on the latest request.",
    "The previous attempt may have succeeded, or its error may not identify a recoverable condition.",
    "For evidence use /pifrost trace verbose. No recovery or retry was started.",
  ].join("\n");
  return [
    `Pifrost recovery — ${assessment.code}${assessment.httpStatus === undefined ? "" : ` (HTTP ${assessment.httpStatus})`}`,
    assessment.reason,
    `Original OMP session: preserved. Model/tool history: not copied or replayed.`,
    `New session fork: ${assessment.mayFork ? "available by explicit confirmation" : "not recommended for this error"}.`,
    assessment.next,
    "No automatic retries, route changes, background processes, or tool re-execution.",
  ].join("\n");
}

/** Notify once per observed *trace object*, even when OMP fires additional
 * agent-end events. This does not enqueue a continuation. */
export function createRecoveryNoticeCoordinator() {
  const seen = new Map<string, RecoveryTraceEvidence>();
  return {
    notice(sessionId: string, trace: RecoveryTraceEvidence | undefined, notify: (message: string) => void): boolean {
      if (!sessionId || !trace || seen.get(sessionId) === trace) return false;
      const assessment = assessRecovery(trace);
      if (!assessment) return false;
      seen.set(sessionId, trace);
      if (seen.size > 128) {
        const key = seen.keys().next().value;
        if (key) seen.delete(key);
      }
      notify(`Pifrost: ${assessment.code}. ${assessment.reason} Run /pifrost recover for safe options (no automatic retry).`);
      return true;
    },
    release(sessionId: string): void { seen.delete(sessionId); },
  };
}
