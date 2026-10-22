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

/**
 * Read-only MCP / Bifrost Code Mode result-shape diagnostics. No tool execution,
 * recursive object traversal or raw value/credential logging. Bifrost owns
 * structuredContent conversion and nested Code Mode execution semantics.
 */
export function inspectMcpToolResult(result) {
  const record = result && typeof result === "object" && !Array.isArray(result) ? result : undefined;
  if (!record) return { shape: "missing", toolError: false, possibleNestedError: false };
  const blocks = Array.isArray(record.content) ? record.content : [];
  const texts = blocks
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text);
  let decoded;
  // Diagnostic inspection is intentionally bounded and leaves MCP data as-is.
  if (texts.length === 1 && Buffer.byteLength(texts[0], "utf8") <= 131072) {
    try {
      decoded = JSON.parse(texts[0]);
      // Some gateways return JSON serialized *inside* a JSON string. Only
      // unwrap a second time when the value is an object/array representation.
      if (typeof decoded === "string" && /^\s*(?:\{|\[)/u.test(decoded) &&
          Buffer.byteLength(decoded, "utf8") <= 131072) {
        try {
          const second = JSON.parse(decoded);
          if (second && typeof second === "object") decoded = second;
        } catch { /* Literal string, not a nested JSON value. */ }
      }
    } catch { /* Ordinary text is a valid MCP tool result. */ }
  }
  const structured = record.structuredContent;
  const structuredKnown = structured !== undefined;
  const source = structuredKnown ? structured : decoded;
  const object = source && typeof source === "object" && !Array.isArray(source) ? source : undefined;
  return {
    shape: structuredKnown ? "structuredContent" :
      texts.length > 1 ? "multiple-text-blocks" :
      decoded !== undefined ? "json-in-text" :
      texts.length ? "text" : blocks.length ? "non-text-blocks" : "empty",
    toolError: record.isError === true,
    // 'error' inside a successful Code Mode value can be application data.
    // Flag for review, never treat it as proof a nested call failed.
    possibleNestedError: Boolean(object && Object.hasOwn(object, "error")),
    textBlocks: texts.length,
    contentBlocks: blocks.length,
  };
}

/**
 * MCP progress belongs to the requesting host. Pifrost can inspect already
 * bounded SSE bytes on explicit opt-in, but never subscribes, polls or creates
 * a background progress channel. Text/labels from untrusted servers are omitted.
 */
export function summarizeMcpProgress(text, expectedProgressToken, maxEvents = 16) {
  if (expectedProgressToken === undefined || expectedProgressToken === null) return { events: [], truncated: false };
  const bound = Number.isInteger(maxEvents) ? Math.max(0, Math.min(maxEvents, 64)) : 16;
  const events = [];
  let truncated = false;
  for (const raw of String(text ?? "").split(/\r?\n\r?\n/u)) {
    const payload = raw.split(/\r?\n/u).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    const item = parseJson(payload);
    if (item?.method !== "notifications/progress" || !item.params ||
        item.params.progressToken !== expectedProgressToken) continue;
    const progress = item.params.progress;
    const total = item.params.total;
    if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0) continue;
    if (events.length >= bound) { truncated = true; continue; }
    events.push({ progress, ...(typeof total === "number" && Number.isFinite(total) && total >= 0 ? { total } : {}) });
  }
  return { events, truncated };
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
  return { ok: response.ok, status: response.status, body, raw: text,
    ...(options.progressToken === undefined ? {} : { progress: summarizeMcpProgress(text, options.progressToken) }),
    ...(options.inspectResult === true ? { resultShape: inspectMcpToolResult(body?.result) } : {}),
  };
}
