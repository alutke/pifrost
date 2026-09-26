import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { requireManagement, requireRuntime } from "../cli-preconditions.mjs";
import {
  createDiagnosticResult,
  diagnosticsOk,
  DIAGNOSTIC_STATUS,
} from "../diagnostic-result.mjs";

const packageRoot = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const cli = resolve(packageRoot, pkg.bin.pifrost);

test("package exposes cli.mjs as the single pifrost binary", () => {
  assert.equal(pkg.bin.pifrost, "./cli.mjs");
  assert.equal(pkg.files.includes("cli-entry.mjs"), false);
  assert.equal(pkg.files.includes("repo-cli.mjs"), false);
});

test("shared runtime preconditions accept Bifrost 2.x VK-only inference", () => {
  const state = {
    config: {
      bifrost: {
        url: "http://bifrost.example/v1",
        managementAuthMode: "basic",
      },
    },
    secrets: {
      inferenceVirtualKey: "sk-bf-inference",
      managementAdminUsername: "admin",
      managementAdminPassword: "secret",
    },
  };

  assert.deepEqual(requireRuntime(state, {}), {
    url: "http://bifrost.example/v1",
    apiKey: undefined,
    virtualKey: "sk-bf-inference",
  });

  assert.deepEqual(requireManagement(state, {}), {
    url: "http://bifrost.example/v1",
    apiKey: undefined,
    virtualKey: "sk-bf-inference",
    managementKey: {
      mode: "basic",
      username: "admin",
      password: "secret",
    },
  });
});

test("shared runtime preconditions fail closed when the inference VK is absent", () => {
  const state = {
    config: { bifrost: { url: "http://bifrost.example/v1" } },
    secrets: {},
  };
  assert.throws(() => requireRuntime(state, {}), /Bifrost URL and Virtual Key are required/u);
});

test("diagnostic result contract is renderer-neutral and validates status", () => {
  const result = createDiagnosticResult({
    id: "model-catalog",
    label: "Model catalog",
    status: DIAGNOSTIC_STATUS.WARN,
    summary: "One alias is degraded",
    impact: "Capability metadata may be conservative.",
    remediation: "Refresh the catalog.",
    suggestedCommand: "pifrost models refresh --force",
    data: { aliases: 1 },
  });

  assert.deepEqual(result, {
    id: "model-catalog",
    label: "Model catalog",
    status: "warn",
    summary: "One alias is degraded",
    detail: undefined,
    impact: "Capability metadata may be conservative.",
    remediation: "Refresh the catalog.",
    suggestedCommand: "pifrost models refresh --force",
    data: { aliases: 1 },
  });
  assert.equal(diagnosticsOk([result]), false);
  assert.throws(
    () => createDiagnosticResult({ id: "x", label: "X", status: "broken" }),
    /Invalid diagnostic status/u,
  );
});

test("every documented command resolves through the actual package binary", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-command-surface-"));
  const emptyPath = join(root, "bin");
  mkdirSync(emptyPath, { recursive: true });

  const env = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, "xdg"),
    PIFROST_CONFIG_DIR: join(root, "pifrost"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PATH: emptyPath,
    BIFROST_URL: "",
    BIFROST_API_KEY: "",
    BIFROST_VIRTUAL_KEY: "",
    BIFROST_MANAGEMENT_AUTH_MODE: "",
    BIFROST_ADMIN_USERNAME: "",
    BIFROST_ADMIN_PASSWORD: "",
    BIFROST_MANAGEMENT_API_KEY: "",
  };

  const commands = [
    ["init"],
    ["global", "setup", "--yes"],
    ["global", "status"],
    ["global", "configure-omp"],
    ["routes", "list"],
    ["routes", "diff"],
    ["routes", "sync"],
    ["routes", "diagnose"],
    ["models", "refresh", "--force"],
    ["models", "doctor"],
    ["repo", "init", "--clients", "railway", "--tools", "*"],
    ["repo", "status"],
    ["repo", "rotate-key"],
    ["repo", "reset"],
    ["repo", "mcp", "list"],
    ["repo", "mcp", "add", "railway", "--tools", "*"],
    ["repo", "mcp", "remove", "railway"],
    ["repo", "mcp", "instructions", "off"],
    ["repo", "vmcp", "list"],
    ["repo", "vmcp", "add", "Development Tools"],
    ["repo", "vmcp", "remove", "Development Tools"],
    ["repo", "skills", "list"],
    ["repo", "skills", "add", "example"],
    ["repo", "skills", "remove", "example"],
    ["repo", "skills", "sync"],
    ["secret", "repo-mcp", "--id", "repo-test"],
    ["doctor"],
    ["--version"],
  ];

  try {
    for (const args of commands) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(result.error?.code === "ETIMEDOUT", false, `${args.join(" ")} timed out`);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      assert.doesNotMatch(
        output,
        /Unknown command:/u,
        `${args.join(" ")} did not resolve through the canonical registry:\n${output}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
