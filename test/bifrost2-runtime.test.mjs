import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  getBifrostHealth,
  getBifrostVersion,
  getVirtualKeyQuota,
  testInference,
} from "../cli-lib.mjs";

test("Bifrost 2.x control-plane probes and VK-only inference use canonical endpoints", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      virtualKey: request.headers["x-bf-vk"],
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/version") {
      response.end(JSON.stringify({ version: "2.0.0" }));
      return;
    }
    if (request.url === "/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "model" }] }));
      return;
    }
    if (request.url === "/api/governance/virtual-keys/quota") {
      response.end(JSON.stringify({ virtual_key_name: "omp", budgets: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;

  try {
    assert.equal(await getBifrostVersion(url), "2.0.0");
    await getBifrostHealth(url);
    const inference = await testInference({ url, virtualKey: "sk-bf-test" });
    assert.equal(inference.authMode, "virtual-key");
    await getVirtualKeyQuota(url, "sk-bf-test");

    const modelRequest = requests.find((entry) => entry.url === "/v1/models");
    assert.equal(modelRequest.authorization, undefined);
    assert.equal(modelRequest.virtualKey, "sk-bf-test");
    const quotaRequest = requests.find((entry) => entry.url === "/api/governance/virtual-keys/quota");
    assert.equal(quotaRequest.virtualKey, "sk-bf-test");
  } finally {
    server.close();
  }
});
