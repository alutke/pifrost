function matchingEnvelope(value, expectedId) {
  if (Array.isArray(value)) {
    return value.find((item) => item && typeof item === "object" && item.id === expectedId);
  }
  if (value && typeof value === "object" && value.id === expectedId) return value;
  return undefined;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse an MCP Streamable HTTP response and return the JSON-RPC envelope that
 * matches the request id. Notifications and unrelated SSE events are ignored.
 */
export function parseMcpJsonRpcResponse(text, expectedId) {
  if (!text) return undefined;

  const direct = parseJson(text);
  const directMatch = matchingEnvelope(direct, expectedId);
  if (directMatch) return directMatch;

  const events = String(text).split(/\r?\n\r?\n/u);
  for (const event of events) {
    const payload = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") continue;
    const parsed = parseJson(payload);
    const match = matchingEnvelope(parsed, expectedId);
    if (match) return match;
  }

  return undefined;
}

export async function postMcpJsonRpc(endpoint, virtualKey, request, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "x-bf-vk": virtualKey,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = parseMcpJsonRpcResponse(text, request.id);
    if (!body && response.ok) {
      throw new Error(`MCP response did not contain JSON-RPC id ${String(request.id)}`);
    }
    return { ok: response.ok, status: response.status, body, raw: text };
  } finally {
    clearTimeout(timer);
  }
}
