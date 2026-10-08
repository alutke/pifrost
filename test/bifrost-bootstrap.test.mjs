import assert from "node:assert/strict";
import test from "node:test";

import {
  bifrostCompatibilityMatrix,
  getBifrostAuthStatus,
} from "../cli-lib.mjs";

test("normalizes Bifrost 2.2.6 public setup/auth status", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    is_auth_enabled: false,
    has_valid_token: false,
    auth_type: "none",
    inference_auth_enforced: true,
    setup_required: true,
    setup_token_configured: true,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const status = await getBifrostAuthStatus("http://bifrost:8180/v1");
    assert.equal(status.dashboardAuthEnabled, false);
    assert.equal(status.inferenceAuthEnforced, true);
    assert.equal(status.setupRequired, true);
    assert.equal(status.setupTokenConfigured, true);
    assert.equal(status.authType, "none");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("compatibility matrix flags incomplete Bifrost setup explicitly", async () => {
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: undefined,
    virtualKey: undefined,
    apiKey: undefined,
    probes: {
      authStatus: {
        ok: true,
        value: {
          setupRequired: true,
          setupTokenConfigured: true,
          inferenceAuthEnforced: true,
        },
      },
    },
  });
  const setup = results.find((item) => item.id === "bifrost-setup-lock");
  assert.equal(setup?.status, "inaccessible");
  assert.match(setup?.detail ?? "", /first-time setup is incomplete/u);
});

test("compatibility matrix reads stable and forward-compatible gateway conversion flags", async () => {
  const probes = {
    virtualMcps: { ok: true, value: [] },
    skills: { ok: true, value: [] },
    inference: { ok: true, value: { models: 5 } },
    routing: { ok: true, value: [] },
    quota: {
      ok: true,
      value: { budgets: [], rate_limits: [], provider_configs: [], model_configs: [] },
    },
    authStatus: {
      ok: true,
      value: {
        setupRequired: false,
        setupTokenConfigured: true,
        inferenceAuthEnforced: true,
      },
    },
    gateway: {
      ok: true,
      value: {
        client_config: {
          compat: {
            convert_chat_to_responses: true,
            force_reasoning_only_models_to_responses: true,
          },
        },
      },
    },
  };
  const results = await bifrostCompatibilityMatrix({
    url: "http://bifrost:8180/v1",
    version: "2.2.6",
    managementAuth: { mode: "basic", username: "admin", password: "secret" },
    virtualKey: "sk-bf-test",
    apiKey: undefined,
    probes,
  });
  const conversion = results.find((item) => item.id === "bifrost-chat-responses-conversion");
  assert.equal(conversion?.status, "supported");
  assert.match(conversion?.detail ?? "", /convert_chat_to_responses=enabled/u);
  assert.match(conversion?.detail ?? "", /reasoning-with-tools adapter=enabled/u);
});
