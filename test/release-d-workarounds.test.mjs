import assert from "node:assert/strict";
import test from "node:test";
import { inspectPifrostWorkarounds, formatPifrostWorkarounds, PIFROST_WORKAROUNDS } from "../workaround-register.mjs";
import { commandCatalog, validateCliInvocation } from "../cli-command-schema.mjs";
import { formatModelDiagnostic } from "../model-diagnostics.mjs";
test("compatibility retirement stays explicitly evidence-gated",()=>{
  const r=inspectPifrostWorkarounds({hostVersion:"18.12.1"});
  assert.equal(r.autoRetired,0);
  assert.equal(r.status,"retained-pending-evidence");
  assert.ok(r.workarounds.length>=5);
  assert.ok(r.workarounds.every(x=>x.state==="retained"&&x.retirement&&x.tests.length));
  assert.equal(PIFROST_WORKAROUNDS.length,new Set(PIFROST_WORKAROUNDS.map(x=>x.id)).size);
  assert.match(formatPifrostWorkarounds(r,true),/Retirement gate/);
  assert.equal(commandCatalog.get("omp workarounds")?.operation,"read-only");
  assert.throws(()=>validateCliInvocation("omp workarounds",[],{json:true,verbose:true}),/separate/);
});

test("image-budget diagnostics are explicit and absent when unknown",()=>{
 const base={id:"omp-test",reasoning:false,input:["text","image"]};
 assert.doesNotMatch(formatModelDiagnostic(base),/image-budget=/);
 assert.match(formatModelDiagnostic({...base,imageCountBudget:4}),/image-budget=4/);
});
