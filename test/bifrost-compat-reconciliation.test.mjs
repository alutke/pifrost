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

test("Bifrost 2.2.6 compatibility matrix reports released Chat-to-Responses setting", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    apiKey: undefined,
    probes: healthyProbes({ convert_chat_to_responses: true }),
  });
  const conversion = results.find((item) => item.id === "bifrost-chat-responses-conversion");
  assert.equal(conversion?.status, "supported");
  assert.match(conversion?.detail ?? "", /convert_chat_to_responses=enabled/u);
  assert.match(conversion?.detail ?? "", /not released by Bifrost 2\.2\.6/u);

  const execution = results.find((item) => item.id === "bifrost-code-mode-execution-policy");
  assert.equal(execution?.status, "supported");
  const provenance = results.find((item) => item.id === "bifrost-routed-identity-headers");
  assert.equal(provenance?.status, "supported");
});

test("newer reasoning-to-Responses flag is reported when Bifrost exposes it", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    apiKey: undefined,
    probes: healthyProbes({
      convert_chat_to_responses: true,
      force_reasoning_only_models_to_responses: true,
    }),
  });
  const conversion = results.find((item) => item.id === "bifrost-chat-responses-conversion");
  assert.match(conversion?.detail ?? "", /reasoning-with-tools adapter=enabled/u);
});
