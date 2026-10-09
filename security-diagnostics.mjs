function normalizedHostname(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^\\[|\\]$/gu, "").replace(/\\.$/u, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1") return true;
  if (/^127(?:\\.\\d{1,3}){3}$/u.test(hostname)) return true;
  if (/^::ffff:127(?:\\.\\d{1,3}){3}$/u.test(hostname)) return true;
  return false;
}

/**
 * Doctor-only transport warning. This is deliberately advisory: Pifrost does
 * not block, rewrite, or require an override for non-loopback HTTP Bifrost
 * endpoints.
 */
export function bifrostCredentialTransportWarnings(runtime, managementAuth) {
  const raw = typeof runtime?.url === "string" ? runtime.url.trim() : "";
  if (!raw) return [];
  let url;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" || isLoopbackHostname(normalizedHostname(raw))) return [];
  const hasCredentials = Boolean(
    runtime?.apiKey ||
    runtime?.virtualKey ||
    managementAuth?.apiKey ||
    managementAuth?.username ||
    managementAuth?.password ||
    managementAuth?.setupToken
  );
  if (!hasCredentials) return [];
  return [
    `Bifrost uses plaintext HTTP on non-loopback host ${url.host}; inference or management credentials can be exposed in transit. Prefer HTTPS or a trusted private transport.`,
  ];
}
