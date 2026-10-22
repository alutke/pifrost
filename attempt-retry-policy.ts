/**
 * A single, evidence-bound policy for crossing an OMP/Bifrost compatibility
 * attempt boundary. No provider selection or retries are performed here.
 * Unknown status / local exceptions always fail closed.
 */
export type AttemptTransitionKind = "gateway-ingress" | "physical-compatibility";
export interface AttemptFailureEvidence {
  readonly httpStatus?: number;
  readonly failureCode?: string;
  readonly failureClass?: string;
  readonly outputStarted?: boolean;
}
export interface AttemptTransitionDecision {
  readonly permitted: boolean;
  readonly reason: "verified-protocol-rejection" | "verified-upstream-unavailable" |
    "missing-http-evidence" | "output-committed" | "terminal-error" | "unverified-transition";
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "errorMessage" in value) {
    return String(value.errorMessage ?? "");
  }
  return "";
}

export function isGatewayProtocolRejection(value: unknown): boolean {
  return /model does not support (?:this |the )?protocol|unsupported (?:wire )?protocol|protocol (?:is )?not supported/iu.test(errorText(value));
}

/**
 * Ingress negotiation is only an HTTP 400/422 unsupported-protocol rejection.
 * A physical encoder-boundary transition is different: it is allowed only for
 * a verified upstream 502/503 from Bifrost, not a request/auth/quota error.
 * Timeouts (including 504) are deliberately terminal: the upstream may
 * already have processed the request.
 */
export function evaluateAttemptTransition(
  kind: AttemptTransitionKind,
  error: unknown,
  evidence: AttemptFailureEvidence | undefined,
): AttemptTransitionDecision {
  const reject = (reason: AttemptTransitionDecision["reason"]): AttemptTransitionDecision =>
    ({ permitted: false, reason });
  if (evidence?.outputStarted === true) return reject("output-committed");
  const status = evidence?.httpStatus;
  if (!Number.isInteger(status) || status! < 400 || status! > 599) return reject("missing-http-evidence");
  const code = evidence?.failureCode;
  if (status === 401 || status === 403 || status === 402 || status === 429 ||
      status === 408 || status === 413 || status === 504 ||
      code === "REASONING_REPLAY_INVALID" || code === "OUTPUT_LIMIT_EXCEEDED" ||
      code === "REQUEST_TOO_LARGE" ||
      code === "MODEL_NOT_PERMITTED" || code === "ROUTE_CONTRACT_UNKNOWN") {
    return reject("terminal-error");
  }
  if (kind === "gateway-ingress") {
    if ((status === 400 || status === 422) &&
        (!evidence?.failureClass || evidence.failureClass === "request") &&
        (!code || code === "PROTOCOL_INCOMPATIBLE" || code === "OTHER_REQUEST" || code === "UNKNOWN") &&
        isGatewayProtocolRejection(error)) {
      return { permitted: true, reason: "verified-protocol-rejection" };
    }
    return reject("unverified-transition");
  }
  if ((status === 502 || status === 503) &&
      evidence?.failureClass === "upstream" &&
      code === "UPSTREAM_TRANSIENT") {
    return { permitted: true, reason: "verified-upstream-unavailable" };
  }
  return reject("unverified-transition");
}
