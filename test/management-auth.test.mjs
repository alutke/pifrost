import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  managementAuthFromState,
  managementAuthLabel,
  managementHeaders,
} from "../cli-lib.mjs";

test("builds HTTP Basic auth for Bifrost OSS admin credentials", () => {
  const headers = managementHeaders({ mode: "basic", username: "admin", password: "s3cret" });
  assert.deepEqual(headers, {
    Authorization: `Basic ${Buffer.from("admin:s3cret", "utf8").toString("base64")}`,
  });
  assert.equal(managementAuthLabel({ mode: "basic", username: "admin", password: "s3cret" }), "basic (OSS admin credentials)");
});

test("builds Bearer auth for Bifrost Enterprise scoped API keys", () => {
  assert.deepEqual(managementHeaders({ mode: "bearer", apiKey: "ent-key" }), {
    Authorization: "Bearer ent-key",
  });
  assert.equal(managementAuthLabel({ mode: "bearer", apiKey: "ent-key" }), "bearer (Enterprise scoped API key)");
});

test("retains 0.2.0 managementApiKey stores as backward-compatible bearer auth", () => {
  const state = {
    config: { bifrost: {} },
    secrets: { managementApiKey: "legacy-key" },
  };
  assert.deepEqual(managementAuthFromState(state, {}), { mode: "bearer", apiKey: "legacy-key" });
});

test("stored OSS admin credentials resolve as Basic auth", () => {
  const state = {
    config: { bifrost: { managementAuthMode: "basic" } },
    secrets: { managementAdminUsername: "alex", managementAdminPassword: "pw" },
  };
  assert.deepEqual(managementAuthFromState(state, {}), {
    mode: "basic",
    username: "alex",
    password: "pw",
  });
});

test("management environment variables override stored credentials", () => {
  const state = {
    config: { bifrost: { managementAuthMode: "basic" } },
    secrets: { managementAdminUsername: "stored", managementAdminPassword: "stored-pass" },
  };
  assert.deepEqual(
    managementAuthFromState(state, {
      BIFROST_MANAGEMENT_AUTH_MODE: "basic",
      BIFROST_ADMIN_USERNAME: "env-user",
      BIFROST_ADMIN_PASSWORD: "env-pass",
    }),
    { mode: "basic", username: "env-user", password: "env-pass" },
  );
});

test("global setup persists OSS admin management credentials without an API key", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-basic-setup-"));
  try {
    const cli = resolve("cli.mjs");
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "global",
        "setup",
        "--url",
        "http://bifrost.local:8180/v1",
        "--api-key",
        "inference-key",
        "--virtual-key",
        "inference-vk",
        "--management-auth",
        "basic",
        "--management-username",
        "admin-user",
        "--management-password",
        "admin-pass",
        "--skip-test",
        "--skip-omp",
        "--yes",
      ],
      {
        env: { ...process.env, PIFROST_CONFIG_DIR: root },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    const secrets = JSON.parse(readFileSync(join(root, "secrets.json"), "utf8"));
    assert.equal(config.bifrost.managementAuthMode, "basic");
    assert.equal(secrets.managementAdminUsername, "admin-user");
    assert.equal(secrets.managementAdminPassword, "admin-pass");
    assert.equal(secrets.managementApiKey, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("global setup persists Enterprise bearer management credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-bearer-setup-"));
  try {
    const cli = resolve("cli.mjs");
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "global",
        "setup",
        "--url",
        "http://bifrost.local:8180/v1",
        "--api-key",
        "inference-key",
        "--virtual-key",
        "inference-vk",
        "--management-auth",
        "bearer",
        "--management-key",
        "enterprise-key",
        "--skip-test",
        "--skip-omp",
        "--yes",
      ],
      {
        env: { ...process.env, PIFROST_CONFIG_DIR: root },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    const secrets = JSON.parse(readFileSync(join(root, "secrets.json"), "utf8"));
    assert.equal(config.bifrost.managementAuthMode, "bearer");
    assert.equal(secrets.managementApiKey, "enterprise-key");
    assert.equal(secrets.managementAdminUsername, undefined);
    assert.equal(secrets.managementAdminPassword, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
