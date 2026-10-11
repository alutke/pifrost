import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const runner = new URL("../scripts/smoke-transport.mjs", import.meta.url);

function sse(res, events, { provenance = true } = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    ...(provenance ? {
      "x-bifrost-routing-info-provider": "fixture-provider",
      "x-bifrost-routing-info-model": "fixture-model",
    } : {}),
  });
  for (const item of events) res.write("data: " + (typeof item === "string" ? item : JSON.stringify(item)) + "\n\n");
  res.end();
}

async function withGateway(variant, run) {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ path: req.url, key: req.headers["x-bf-vk"], payload });
      if (req.headers["x-bf-vk"] !== "fixture-virtual-key") {
        res.writeHead(401).end("Missing VK");
        return;
      }
      if (req.url === "/v1/chat/completions" && payload.tools) {
        const args = variant.invalidTool ? '{"value":' : '{"value":"ok"}';
        const halfway = Math.floor(args.length / 2);
        sse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "pifrost_probe", arguments: args.slice(0, halfway) } }] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(halfway) } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          "[DONE]",
        ], { provenance: !variant.noProvenance });
      } else if (req.url === "/v1/chat/completions") {
        sse(res, [
          ...(variant.emptyChat ? [] : [{ choices: [{ delta: { content: "READY" }, finish_reason: null }] }]),
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          "[DONE]",
        ], { provenance: !variant.noProvenance });
      } else if (req.url === "/v1/responses") {
        sse(res, [
          { type: "response.output_text.delta", delta: "READY" },
          { type: "response.completed", response: { status: "completed" } },
          ...(variant.truncatedResponses ? [] : ["[DONE]"]),
        ], { provenance: !variant.noProvenance });
      } else {
        res.writeHead(404).end("Not found");
      }
    } catch {
      res.writeHead(500).end("Bad fixture");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await run(server.address().port, requests);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

async function execute(port, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner.pathname], {
      env: {
        ...process.env,
        BIFROST_URL: "http://127.0.0.1:" + port + "/v1",
        BIFROST_VIRTUAL_KEY: "fixture-virtual-key",
        BIFROST_API_KEY: "",
        PIFROST_CONFORMANCE_CHAT_MODEL: "chat-fixture",
        PIFROST_CONFORMANCE_RESPONSES_MODEL: "responses-fixture",
        PIFROST_CONFORMANCE_TOOL_MODEL: "",
        PIFROST_CONFORMANCE_REQUIRE_PROVENANCE: "",
        ...env,
      },
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("live gateway runner enforces VK, Chat/Responses content, physical provenance and streamed tool arguments", async () => {
  await withGateway({}, async (port, requests) => {
    const r = await execute(port, {
      PIFROST_CONFORMANCE_TOOL_MODEL: "tool-fixture",
      PIFROST_CONFORMANCE_REQUIRE_PROVENANCE: "1",
    });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Forced tool: complete streamed arguments/);
    assert.deepEqual(requests.map(v => v.path), ["/v1/chat/completions", "/v1/responses", "/v1/chat/completions"]);
    assert.ok(requests.every(v => v.key === "fixture-virtual-key"));
    assert.equal(requests[2].payload.tool_choice, "required");
  });
});

test("live runner rejects a successful Chat completion containing no actual reply", async () => {
  await withGateway({ emptyChat: true }, async port => {
    const r = await execute(port);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Chat: completed without assistant text/);
  });
});

test("live runner rejects truncated Responses streams", async () => {
  await withGateway({ truncatedResponses: true }, async port => {
    const r = await execute(port);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Responses: missing SSE terminal/);
  });
});

test("live runner enforces provenance when requested without fabricating provider", async () => {
  await withGateway({ noProvenance: true }, async port => {
    const r = await execute(port, { PIFROST_CONFORMANCE_REQUIRE_PROVENANCE: "1" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing Bifrost physical provider\/model provenance/);
  });
});

test("live runner rejects incomplete streamed tool argument JSON", async () => {
  await withGateway({ invalidTool: true }, async port => {
    const r = await execute(port, { PIFROST_CONFORMANCE_TOOL_MODEL: "tool-fixture" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Forced tool: no complete pifrost_probe argument object/);
  });
});
