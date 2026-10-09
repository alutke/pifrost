function normalizedHostname(value) {
  try {
    const url = new URL(value);
    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
    if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
    return hostname;
  } catch {
    return undefined;
  }
}

function loopbackIpv4(hostname) {
  const parts = String(hostname ?? "").split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  return octets.every((value, index) =>
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255 &&
    (index !== 0 || value === 127)
  );
}

function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1") return true;
  if (loopbackIpv4(hostname)) return true;
  const mappedPrefix = "::ffff:";
  return hostname.startsWith(mappedPrefix) && loopbackIpv4(hostname.slice(mappedPrefix.length));
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
