import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ROLE_MAP, configureOmp } from "../cli-lib.mjs";

test("configureOmp writes modelRoles as one OMP schema record", () => {
  const root = mkdtempSync(join(tmpdir(), "pifrost-omp-config-"));
  const bin = join(root, "bin");
  const agent = join(root, "agent");
  const log = join(root, "omp.log");
  const oldPath = process.env.PATH;
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const oldConfigDir = process.env.PIFROST_CONFIG_DIR;

  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(agent, { recursive: true });
    const omp = join(bin, "omp");
    writeFileSync(
      omp,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1" = "--version" ]; then echo 'omp 18.0.4'; exit 0; fi\nif [ "$1" = "config" ] && [ "$2" = "path" ]; then echo '${agent}'; exit 0; fi\nif [ "$1" = "config" ] && [ "$2" = "set" ]; then exit 0; fi\nexit 1\n`,
    );
    chmodSync(omp, 0o755);

    process.env.PATH = `${bin}:${oldPath ?? ""}`;
    process.env.PI_CODING_AGENT_DIR = agent;
    process.env.PIFROST_CONFIG_DIR = join(root, "pifrost");

    const result = configureOmp();
    assert.equal(result.settings, 6);

    const lines = readFileSync(log, "utf8").trim().split("\n");
    const roleLines = lines.filter((line) => line.startsWith("config set modelRoles"));
    assert.equal(roleLines.length, 1);
    assert.equal(roleLines[0], `config set modelRoles ${JSON.stringify(ROLE_MAP)}`);
    assert.equal(lines.some((line) => line.includes("modelRoles.default")), false);
    assert.equal(lines.some((line) => line === 'config set modelProviderOrder ["bifrost"]'), true);
    assert.equal(lines.some((line) => line === 'config set enabledModels ["bifrost/*"]'), true);
    assert.equal(lines.some((line) => line === "config set retry.modelFallback false"), true);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgent;
    if (oldConfigDir === undefined) delete process.env.PIFROST_CONFIG_DIR;
    else process.env.PIFROST_CONFIG_DIR = oldConfigDir;
    rmSync(root, { recursive: true, force: true });
  }
});
