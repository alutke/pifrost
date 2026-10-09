import assert from "node:assert/strict";
import test from "node:test";

import { bifrostCompatibilityMatrix } from "../cli-lib.mjs";

function healthyProbes(compat = { convert_chat_to_responses: true }) {
  return {
    setup: {
      ok: true,
      value: {
        authEnabled: true,
        inferenceAuthEnforced: true,
        setupRequired: false,
        setupTokenConfigured: true,
        authType: "password",
      },
    },
    virtualMcps: { ok: true, value: [] },
    skills: { ok: true, value: [] },
    inference: { ok: true, value: { models: 5 } },
    routing: { ok: true, value: [] },
    quota: {
      ok: true,
      value: { budgets: [], rate_limits: [], provider_configs: [], model_configs: [] },
    },
    gateway: {
      ok: true,
      value: { client_config: { compat } },
    },
  };
}

test("Bifrost 2.2.6 compatibility reports stable Chat-to-Responses configuration", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    probes: healthyProbes({ convert_chat_to_responses: true }),
  });
  const conversion = results.find((item) => item.id === "bifrost-chat-responses-conversion");
  assert.equal(conversion?.status, "supported");
  assert.equal(conversion?.optional, true);
  assert.match(conversion?.detail ?? "", /convert_chat_to_responses=enabled/u);
  assert.match(conversion?.detail ?? "", /not released by Bifrost 2\.2\.6/u);
});

test("newer reasoning-to-Responses compatibility flag is surfaced without Pifrost taking ownership", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    probes: healthyProbes({
      convert_chat_to_responses: true,
      force_reasoning_only_models_to_responses: true,
    }),
  });
  const conversion = results.find((item) => item.id === "bifrost-chat-responses-conversion");
  assert.match(conversion?.detail ?? "", /reasoning-with-tools adapter=enabled/u);
});
