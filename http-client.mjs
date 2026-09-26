export class PifrostHttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "PifrostHttpError";
    this.status = status;
    this.body = body;
  }
}

export function requestSignal(externalSignal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

export async function readTextLimited(response, maxBytes = 8 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function requestJson(url, options = {}) {
  try {
    const headers = { Accept: "application/json", ...(options.headers ?? {}) };
    let body;
    if (options.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    const response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: requestSignal(options.signal, options.timeoutMs ?? 20_000),
    });
    const text = await readTextLimited(response, options.maxResponseBytes ?? 8 * 1024 * 1024);
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      const detail =
        parsed?.error?.message ?? parsed?.message ?? (typeof parsed === "string" ? parsed.slice(0, 500) : "");
      throw new PifrostHttpError(
        response.status,
        `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        parsed,
      );
    }
    return parsed;
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error(`Request timed out: ${url}`, { cause: error });
    }
    if (error?.name === "AbortError") {
      if (options.signal?.aborted) throw new Error(`Request aborted: ${url}`, { cause: error });
      throw new Error(`Request timed out: ${url}`, { cause: error });
    }
    throw error;
  }
}
