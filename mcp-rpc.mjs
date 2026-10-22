import { readTextLimited, requestSignal } from "./http-client.mjs";

/**
 * tools/call can commit a side effect before the network response is lost.
 * Never retry from Pifrost; the caller must verify external state manually.
 */
export class McpAmbiguousToolOutcomeError extends Error {
  constructor() {
    super("MCP tools/call outcome is uncertain after dispatch; the operation may have committed. Inspect upstream state before any explicit repeat.");
    this.name="McpAmbiguousToolOutcomeError";
    this.code="MCP_OUTCOME_UNCERTAIN";
  }
}

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
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const mutatingOrUnknownToolCall = request?.method === "tools/call";
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "x-bf-vk": virtualKey,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: requestSignal(options.signal, options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    // No attempt to classify whether the remote tool committed. Never
    // repeat an uncertain tools/call; report outcome ambiguity without
    // logging endpoint, arguments, or credentials.
    if (mutatingOrUnknownToolCall) throw new McpAmbiguousToolOutcomeError();
    throw error;
  }
  let text;
  try {
    text = await readTextLimited(response, options.maxResponseBytes ?? 8 * 1024 * 1024);
  } catch (error) {
    if (mutatingOrUnknownToolCall) throw new McpAmbiguousToolOutcomeError();
    throw error;
  }
  const body = parseMcpJsonRpcResponse(text, request.id);
  if (!body && response.ok) {
    if (mutatingOrUnknownToolCall) throw new McpAmbiguousToolOutcomeError();
    throw new Error(`MCP response did not contain JSON-RPC id ${String(request.id)}`);
  }
  return { ok: response.ok, status: response.status, body, raw: text };
}
