import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guard the OMP TUI contract: routine route planning and replay hygiene must
// not emit stderr lines for every request. Compatibility safety stays in the
// dynamic route planner and in session-scoped /pifrost trace diagnostics.
test("normal dynamic inference does not spam OMP stderr", () => {
  const native = readFileSync(new URL("../native.ts", import.meta.url), "utf8");
  const start = native.indexOf("function streamDynamicPifrostRoute(");
  const end = native.indexOf("function streamPifrostOpenAI(", start);
  assert.ok(start >= 0 && end > start, "find native dynamic inference boundary");
  const streaming = native.slice(start, end);
  assert.equal(streaming.includes("process.stderr.write"), false);
  assert.ok(streaming.includes("compatibilityBoundaryCount = plan.compatibilityBreaks?.length ?? 0"));
  assert.ok(streaming.includes("recordBifrostCaptureTrace"));
  assert.ok(streaming.includes("...(compatibilityBoundaryCount ? { compatibilityBoundaryCount } : {})"));
  const planner = readFileSync(new URL("../dynamic-routing.ts", import.meta.url), "utf8");
  assert.ok(planner.includes("compatibilityBreaks.push"), "the physical wire safety split remains");
});
