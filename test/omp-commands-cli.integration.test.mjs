import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli=resolve(import.meta.dirname,"../cli.mjs");
test("real CLI installs and disables only optional /pifrost extension with clear status",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-ui-cli-"));
  const env={...process.env,PI_CODING_AGENT_DIR:join(root,"omp"),
    PIFROST_CONFIG_DIR:join(root,"pifrost")};
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{env,encoding:"utf8"});
  try {
    const target=join(root,"omp","extensions","pifrost-commands.js");
    const first=run("omp","commands","status");
    assert.equal(first.status,0,first.stderr);
    assert.match(first.stdout,/disabled/u);
    const preview=run("omp","commands","enable","--dry-run");
    assert.equal(preview.status,0,preview.stderr);
    assert.match(preview.stdout,/no changes made/u);
    assert.equal(existsSync(target),false);
    const enabled=run("omp","commands","enable");
    assert.equal(enabled.status,0,enabled.stderr);
    assert.equal(existsSync(target),true);
    assert.match(run("omp","commands","status").stdout,/enabled/u);
    assert.equal(run("omp","commands","enable").status,0);
    const disabled=run("omp","commands","disable");
    assert.equal(disabled.status,0,disabled.stderr);
    assert.equal(existsSync(target),false);
    assert.match(run("omp","commands","status").stdout,/disabled/u);
  } finally {rmSync(root,{recursive:true,force:true});}
});
