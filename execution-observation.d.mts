/** Read-only diagnostics; intentionally no retry or history mutations. */
export type StopDiagnostic = "REASONING_ONLY_STOP" | "EMPTY_STOP" | "LEAKED_THINKING_STOP" | "NONE";
export interface OutputObservation {
  readonly reason: StopDiagnostic;
  readonly stopReason: string | null;
  readonly hasAction: boolean;
  readonly visibleText: boolean;
  readonly reasoningBlocks: number;
  readonly toolCallCount: number;
  readonly isNonproductive: boolean;
}
export interface ContextObservation {
  readonly inputTokens: number | null;
  readonly contextWindowTokens: number | null;
  readonly fraction: number | null;
  readonly severity: "unknown" | "pressure" | "large-absolute" | "normal";
  readonly interpretation: "model-window-unverified" | "window-reported-not-physically-verified";
}
export interface AgentEndObservation {
  readonly schemaVersion: 1;
  readonly output: OutputObservation;
  readonly toolActivity: boolean;
  readonly safeBoundary: boolean;
  readonly diagnostic: "SUSPECT_NONPRODUCTIVE_SETTLEMENT" | "NONE";
  readonly workRemaining: "unverified";
  readonly recoveryPermitted: "not-assessed";
}
export function inspectOutput(items: unknown, stopReason?: unknown): OutputObservation;
export function inspectContextUsage(inputTokens: unknown, windowTokens?: unknown): ContextObservation;
export function inspectBifrostLog(raw: unknown): Readonly<{
  schemaVersion: 1;
  status: string;
  provider: string | null;
  routeModel: string | null;
  gatewayServedModel: string | null;
  attribution: "gateway-reported-not-physical-proof";
  output: OutputObservation;
  context: ContextObservation;
  completionTokens: number | null;
  reasoningTokens: number | null;
  retries: number | null;
  taskCompleted: "unknown";
}>;
export function inspectAgentEnd(event: unknown): AgentEndObservation;
