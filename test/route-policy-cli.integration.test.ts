import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli=resolve(import.meta.dirname,"../cli.mjs");
test("Pifrost 0.30 no longer offers the legacy model-routing CLI control plane",()=>{
  const help=execFileSync(process.execPath,[cli,"help","--all"],{encoding:"utf8"});
  for(const removed of ["routes sync","routes diff","routes verify","routes effective",
    "judge activate","omp context apply","global configure-omp","models refresh"]) {
    assert.ok(!help.includes("pifrost "+removed),removed+" should not appear in supported commands");
    const args=removed.split(" ");
    const result=spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
    assert.equal(result.status,1,removed+" must be rejected");
    assert.match(result.stderr,/(?:Unsupported|Unknown) command/u);
  }
  assert.match(help,/pifrost models enable/u);
  assert.match(help,/pifrost omp commands enable/u);
  assert.match(help,/pifrost repo mcp add/u);
});
