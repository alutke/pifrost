/** Diagnostic-only gateway reliability classification.
 * Never interpret provider response text or request credentials, and never
 * decide whether to retry: OMP/Bifrost own retry and key rotation.
 */
export type GatewayFailureClass = "credential" | "authorization" | "quota-or-rate-limit" | "timeout" | "upstream" | "request" | "unknown";
export function classifyGatewayHttpStatus(status: number): GatewayFailureClass | undefined {
  if (!Number.isInteger(status) || status < 400 || status > 599) return undefined;
  if (status === 401) return "credential";
  if (status === 403) return "authorization";
  if (status === 402 || status === 429) return "quota-or-rate-limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream";
  return "request";
}
export function parseGatewayRetryAfter(raw: string | null, now = Date.now()): number | undefined {
  if (!raw || raw.length > 120) return undefined;
  const value = raw.trim();
  if (/^\d{1,6}$/u.test(value)) {
    const seconds = Number(value);
    return seconds <= 86_400 ? seconds : undefined;
  }
  if (!/^[A-Za-z]{3},\s/u.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const seconds = Math.max(0, Math.ceil((parsed - now) / 1_000));
  return seconds <= 86_400 ? seconds : undefined;
}
export function gatewayFailureAdvice(reason: GatewayFailureClass | undefined): string | undefined {
  switch (reason) {
    case "credential": return "check inference VK authentication or key rotation; do not expose keys";
    case "authorization": return "check VK provider/model permissions and policy";
    case "quota-or-rate-limit": return "check Bifrost quota, upstream allowance and rate limits";
    case "timeout": return "check Bifrost TTFT/idle timeout and upstream latency";
    case "upstream": return "check Bifrost request log and provider availability";
    case "request": return "check request size, wire protocol and model capabilities; HTTP 413 must not be retried unchanged";
    default: return undefined;
  }
}
/** Sanitized bounded non-secret metadata only; never include raw provider errors. */
export function safeGatewayHeaderToken(value: string | null, max = 96): string | undefined {
  if (!value) return undefined;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= max && /^[A-Za-z0-9_.:/-]+$/u.test(clean) ? clean : undefined;
}
