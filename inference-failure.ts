/**
 * Privacy-preserving diagnostic classification of Bifrost inference errors.
 * Request/response message text is examined only in memory, never returned,
 * persisted, logged, or included in trace metadata. This module never retries.
 */
export type InferenceFailureCode =
  | "REASONING_REPLAY_INVALID"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "MODEL_NOT_PERMITTED"
  | "ROUTE_CONTRACT_UNKNOWN"
  | "PROTOCOL_INCOMPATIBLE"
  | "UPSTREAM_TRANSIENT"
  | "OTHER_REQUEST"
  | "UNKNOWN";

export interface InferenceFailureDiagnosis {
  code: InferenceFailureCode;
  advice: string;
}

const ADVICE: Readonly<Record<InferenceFailureCode, string>> = {
  REASONING_REPLAY_INVALID: "Verify physical model reasoning replay and Bifrost protocol conversion; do not blindly retry this history",
  OUTPUT_LIMIT_EXCEEDED: "Compare requested output tokens with the selected physical model and fallback limits",
  MODEL_NOT_PERMITTED: "Check the Bifrost virtual key model allowlist and route fallback members",
  ROUTE_CONTRACT_UNKNOWN: "Verify or synchronize the Bifrost route contract and model metadata",
  PROTOCOL_INCOMPATIBLE: "Check the physical provider Chat/Responses protocol and serialization policy",
  UPSTREAM_TRANSIENT: "Inspect Bifrost request logs and upstream availability; retry policy remains with OMP/Bifrost",
  OTHER_REQUEST: "Inspect model capabilities and the request protocol in Bifrost",
  UNKNOWN: "Use the Bifrost request ID and route trace to investigate",
};

export function inferenceFailureAdvice(code: InferenceFailureCode): string {
  return ADVICE[code];
}

function errorEvidence(value: unknown, depth = 0, budget = { remaining: 12 }): string {
  if (budget.remaining <= 0 || depth > 5 || value == null) return "";
  if (typeof value === "string") {
    budget.remaining--;
    return value.slice(0, 4096);
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  const fragments: string[] = [];
  // Whitelist known error metadata keys only; never traverse arbitrary payloads.
  for (const key of ["type", "code", "message", "error", "detail", "status"]) {
    if (!Object.hasOwn(record, key)) continue;
    const part = errorEvidence(record[key], depth + 1, budget);
    if (part) fragments.push(part);
  }
  return fragments.join(" ").slice(0, 8192);
}

/** Evidence-specific and status-constrained. Neither raw errors nor secrets escape. */
export function classifyInferenceFailure(status: number, errorPayload?: unknown): InferenceFailureDiagnosis {
  const evidence = errorEvidence(errorPayload).toLowerCase();
  let code: InferenceFailureCode = "UNKNOWN";
  if (status === 400 || status === 422) {
    if (/(reasoning_content|reasoning_text).{0,180}(must be passed back|required|missing|empty)|thinking mode.{0,160}(reasoning_content|reasoning_text)/u.test(evidence)) {
      code = "REASONING_REPLAY_INVALID";
    } else if (/(max_(?:output_|completion_)?tokens|output tokens?).{0,120}(exceeds?|above|maximum|limit|too large)|exceeds? (?:the )?(?:maximum|model limit).{0,100}tokens/u.test(evidence)) {
      code = "OUTPUT_LIMIT_EXCEEDED";
    } else if (/(route|routing).{0,100}(stale|unknown|not found|unavailable|invalid)|(unknown|stale).{0,100}(route|routing)/u.test(evidence)) {
      code = "ROUTE_CONTRACT_UNKNOWN";
    } else if (/(unsupported|invalid|incompatible).{0,120}(responses|chat completions|protocol|api version)|(responses|chat completions).{0,120}(unsupported|not supported)/u.test(evidence)) {
      code = "PROTOCOL_INCOMPATIBLE";
    } else {
      code = "OTHER_REQUEST";
    }
  } else if (status === 403 && (/(model_blocked|model.not allowed|model.{0,120}not permitted|virtual.key.{0,100}(allowlist|model))/u.test(evidence))) {
    code = "MODEL_NOT_PERMITTED";
  } else if (status >= 500 && status <= 599) {
    code = "UPSTREAM_TRANSIENT";
  }
  return { code, advice: ADVICE[code] };
}
