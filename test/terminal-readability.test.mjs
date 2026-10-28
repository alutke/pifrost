import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  compactCliHelp, renderHealthOverview, formatCliFailure,
  terminalStatus, terminalNextSteps, humanAge, humanTokenCount,
} from "../terminal-presentation.mjs";

test("issues-first health output is readable without colour or a TTY", () => {
  const text = renderHealthOverview([
    { label:"Routing", status:"ok", detail:"10 rules found" },
    { label:"Model catalogue", status:"fail", detail:"Unresolved model", action:"pifrost models refresh --force" },
    { label:"Management API", status:"warn", detail:"Not reachable", action:"pifrost global setup" },
    { label:"Inference", status:"ok", detail:"Ready" },
  ]);
  assert.match(text, /Action required \(2\/4 checks OK\)/u);
  assert.ok(text.indexOf("[FAIL]") < text.indexOf("[WARN]"));
  assert.ok(text.indexOf("[WARN]") < text.indexOf("[OK]"));
  assert.match(text, /Next steps:/u);
  assert.match(text, /pifrost doctor --verbose/u);
  assert.doesNotMatch(text, /\x1b\[|\r/u);
  assert.match(terminalStatus("unknown","Cache","Not inspected"), /\[UNKNOWN\]/u);
  assert.equal(terminalNextSteps(["a","a","b"]).split("\n").length,3);
  assert.equal(humanAge(90_000),"1 minute");
  assert.equal(humanTokenCount(123456),"123,456");
});

test("quick help prioritises common tasks and contains a full-help escape hatch", () => {
  const text=compactCliHelp("0.21.0");
  assert.match(text,/pifrost doctor/u);
  assert.match(text,/pifrost models enable/u);
  assert.match(text,/pifrost repo init/u);
  assert.match(text,/help --all/u);
  assert.match(text,/pifrost migrate status/u);
  assert.doesNotMatch(text,/\x1b\[/u);
});

test("usage errors do not echo supplied unknown command arguments", () => {
  const text=formatCliFailure(Object.assign(new Error("Unknown command."),{isUsage:true}),{isUsage:true});
  assert.match(text,/Pifrost could not complete/u);
  assert.match(text,/pifrost help/u);
  assert.doesNotMatch(text,/stack|at file:/u);
});

test("public CLI quick help, full help and unknown command are distinct", () => {
  const root=mkdtempSync(resolve(tmpdir(),"pifrost-ui-"));
  const env={...process.env,HOME:root,PIFROST_CONFIG_DIR:resolve(root,"config"),
    PI_CODING_AGENT_DIR:resolve(root,"agent"),BIFROST_URL:"",
    BIFROST_MANAGEMENT_API_KEY:"",BIFROST_VIRTUAL_KEY:""};
  const run=(...args)=>spawnSync(process.execPath,["cli.mjs",...args],{
    cwd:resolve(import.meta.dirname,".."),env,encoding:"utf8",timeout:15000,
  });
  try {
    const quick=run("help");
    assert.equal(quick.status,0,quick.stderr);
    assert.match(quick.stdout,/Start here:/u);
    assert.doesNotMatch(quick.stdout,/Global setup options:/u);
    const full=run("help","--all");
    assert.equal(full.status,0,full.stderr);
    assert.match(full.stdout,/Global setup options:/u);
    assert.match(full.stdout,/pifrost repo skills/u);
    const unknown=run("not-a-command","very-secret-command-argument");
    assert.equal(unknown.status,1);
    assert.match(unknown.stderr,/Unknown command/u);
    assert.doesNotMatch(unknown.stderr,/very-secret-command-argument/u);
    const model=run("models","doctor");
    assert.match(model.stdout,/Model catalogue/u);
    assert.match(model.stdout,/models refresh --force/u);
    assert.doesNotMatch(model.stdout,/\x1b\[/u);
  } finally { rmSync(root,{recursive:true,force:true}); }
});