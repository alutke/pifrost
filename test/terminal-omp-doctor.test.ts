import assert from "node:assert/strict";
import test from "node:test";
import { formatDoctorSummary, type AliasDiagnostic } from "../index.ts";

test("OMP default doctor shows just readiness, key issues and next steps", () => {
  const result=formatDoctorSummary([
    {id:"omp-default",unresolved:[]} as unknown as AliasDiagnostic,
    {id:"omp-advisor",unresolved:["No eligible chat protocol","Model not present"]} as unknown as AliasDiagnostic,
  ],"/sensitive/absolute/path/aliases.json");
  assert.match(result,/Pifrost model health/u);
  assert.match(result,/1 ready, 1 need attention/u);
  assert.match(result,/\[WARN\] omp-advisor/u);
  assert.match(result,/\/pifrost refresh/u);
  assert.match(result,/\/pifrost doctor verbose/u);
  assert.doesNotMatch(result,/\/sensitive\/absolute\/path/u);
  assert.doesNotMatch(result,/\x1b\[/u);
});

test("OMP doctor gives concise healthy and empty states", () => {
  const healthy=formatDoctorSummary([{id:"omp-default",unresolved:[]} as unknown as AliasDiagnostic]);
  assert.match(healthy,/1 ready, 0 need attention/u);
  assert.match(healthy,/individual model details/u);
  assert.match(formatDoctorSummary([]),/No logical aliases configured/u);
});