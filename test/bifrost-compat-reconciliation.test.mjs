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
  assert.match(conversion?.detail ?? "", /not available before Bifrost 2\.3\.0/u);
});

test("Bifrost 2.3 TTFT and reasoning adapter are gateway-owned, never enabled by Pifrost", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1", version: "2.3.0",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    probes: healthyProbes({ convert_chat_to_responses: true, force_reasoning_only_models_to_responses: true }),
  });
  assert.equal(results.find(item => item.id === "bifrost-route-ttft-timeout")?.status, "supported");
  assert.match(results.find(item => item.id === "bifrost-route-ttft-timeout")?.detail ?? "", /per-rule enablement.*not verified/u);
  assert.match(results.find(item => item.id === "bifrost-chat-responses-conversion")?.detail ?? "", /reasoning-with-tools adapter=enabled/u);
});

test("Bifrost 2.3 gateway rotation grace is read-only and never exposes credentials", async () => {
  const probes = healthyProbes({ convert_chat_to_responses: true });
  probes.gateway.value.client_config.vk_rotation_cooldown = "5m";
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1", version: "2.3.0",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test", probes,
  });
  const rotation = results.find(item => item.id === "bifrost-vk-rotation");
  assert.equal(rotation?.status, "supported");
  assert.match(rotation?.detail ?? "", /rotation grace=5m/u);
  assert.doesNotMatch(JSON.stringify(rotation), /sk-bf-test|secret/u);
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
