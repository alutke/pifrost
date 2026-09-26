import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { requestJson } from "../http-client.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("requestJson rejects oversized responses before unbounded buffering", async () => {
  await withServer((_request, response) => {
    const body = JSON.stringify({ payload: "x".repeat(256) });
    response.setHeader("content-type", "application/json");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
  }, async (base) => {
    await assert.rejects(
      () => requestJson(`${base}/large`, { maxResponseBytes: 64 }),
      /response exceeds 64 bytes/,
    );
  });
});

test("requestJson distinguishes caller cancellation from timeouts", async () => {
  await withServer((_request, response) => {
    setTimeout(() => response.end(JSON.stringify({ ok: true })), 200);
  }, async (base) => {
    const controller = new AbortController();
    const request = requestJson(`${base}/slow`, { signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await assert.rejects(request, /Request aborted:/);
  });
});
