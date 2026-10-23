import assert from "node:assert/strict";
import test from "node:test";
import { assessExecutionReadiness, formatExecutionReadiness, OMP_EXECUTION_SETTING_IDS } from "../execution-readiness.mjs";

const value = v => ({ status: "ok", value: v });
const full = {
  "compaction.enabled": value(true),
  "compaction.midTurnEnabled": value(true),
  "compaction.autoContinue": value(true),
  "compaction.modelThresholds": value({ "bifrost/omp-default": 120000 }),
  "retry.modelFallback": value(false),
};

test("30A-06 pinned OMP 18.12.5 is reported as documented capability, not observed hook execution", () => {
  const r = assessExecutionReadiness({
    settings: full, hostVersion: "18.12.5", policySnapshotVersion: "18.12.5", stalledMode: "auto",
  });
  assert.equal(r.status, "locally-compatible");
  assert.equal(r.checks.find(x => x.id === "lifecycle-hooks").status, "ok");
  assert.match(r.checks.find(x => x.id === "lifecycle-hooks").message, /live event dispatch is not tested/);
  assert.equal(r.contextWindowTokens, null);
  assert.equal(r.physicalModel, null);
  assert.equal(r.checks.find(x => x.id === "fallback-ownership").status, "ok");
  assert.ok(OMP_EXECUTION_SETTING_IDS.includes("compaction.modelThresholds"));
  assert.match(formatExecutionReadiness(r), /30A, read-only/);
});

test("30A-07 conflicting fallback and disabled compaction are flagged without settings mutation", () => {
  const settings = { ...full, "retry.modelFallback": value(true), "compaction.enabled": value(false),
    "compaction.midTurnEnabled": value(false) };
  const before = JSON.stringify(settings);
  const r = assessExecutionReadiness({ settings, hostVersion: "18.12.5",
    policySnapshotVersion: "18.12.5", stalledMode: "notice" });
  assert.equal(r.status, "attention");
  assert.equal(r.checks.find(x => x.id === "fallback-ownership").status, "warn");
  assert.equal(r.checks.find(x => x.id === "context-maintenance").status, "warn");
  assert.equal(r.checks.find(x => x.id === "mid-turn-continuation").status, "warn");
  assert.equal(JSON.stringify(settings), before);
});

test("30A-08 older/newer or unknown OMP versions cannot be presented as tested event compatibility", () => {
  for (const hostVersion of ["18.12.1", "18.12.6", "development", undefined]) {
    const r = assessExecutionReadiness({
      settings: full, hostVersion, policySnapshotVersion: "18.12.5",
    });
    assert.equal(r.checks.find(x => x.id === "lifecycle-hooks").status, "unknown");
  }
});

test("30A-09 missing settings and absent metadata remain unknown, never invented defaults", () => {
  const r = assessExecutionReadiness({ settings: {} });
  assert.equal(r.status, "unverified");
  assert.equal(r.checks.find(x => x.id === "context-maintenance").status, "unknown");
  assert.equal(r.checks.find(x => x.id === "fallback-ownership").status, "unknown");
  assert.equal(r.checks.find(x => x.id === "context-thresholds").status, "unknown");
  assert.match(formatExecutionReadiness(r, true), /active context window and served physical model cannot be verified/i);
});
