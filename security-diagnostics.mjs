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
  if (!hostname.startsWith(mappedPrefix)) return false;
  const mapped = hostname.slice(mappedPrefix.length);
  if (loopbackIpv4(mapped)) return true;
  // WHATWG URL canonicalizes [::ffff:127.0.0.1] to [::ffff:7f00:1].
  // Only the 127/8 IPv4-mapped range is loopback.
  const groups = mapped.split(":");
  return groups.length === 2 &&
    groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group)) &&
    (Number.parseInt(groups[0], 16) >> 8) === 127;
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
