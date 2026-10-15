import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { aliasConfigFingerprint } from "../cache.ts";
const exec = promisify(execFile);

test("actual pifrost routes sync/verify/diff detects condition-only changes without leaking credentials", async () => {
  const home=mkdtempSync(resolve(tmpdir(),"pifrost-route-policy-"));
  let cel="model == 'omp-default'";
  const rule=()=>({id:"a",name:"omp-default",enabled:true,scope:"global",cel_expression:cel,
    targets:[{provider:"upstream",model:"a",weight:1}],fallbacks:["backup/b"]});
  const server=createServer((req,res)=>{
    if(!req.url?.startsWith("/api/routing/rules") && !req.url?.startsWith("/api/governance/routing-rules")){
      res.writeHead(404);res.end();return;
    }
    assert.match(req.headers.authorization??"",/^Basic /u);
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({rules:[rule()],total_count:1,count:1}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const addr=server.address();
    if(!addr||typeof addr==="string") throw new Error("no listener");
    const env={...process.env,PIFROST_CONFIG_DIR:home,PIFROST_ALIASES:resolve(home,"aliases.json"),BIFROST_URL:`http://127.0.0.1:${addr.port}/v1`,
      BIFROST_VIRTUAL_KEY:"sk-bf-test", BIFROST_MANAGEMENT_AUTH_MODE:"basic",
      BIFROST_ADMIN_USERNAME:"test-admin", BIFROST_ADMIN_PASSWORD:"test-password"};
    const run=async(...args:string[])=>exec(process.execPath,["cli.mjs",...args],{
      cwd:process.cwd(),env,timeout:15000,
    });
    const synced=await run("routes","sync","--no-refresh");
    assert.match(synced.stdout,/Wrote 1 aliases/u);
    const manifest=JSON.parse(readFileSync(resolve(home,"aliases.json"),"utf8"));
    assert.match(manifest.policyFingerprint,/^[a-f0-9]{64}$/u);
    const beforeVerification=JSON.parse(readFileSync(resolve(home,"aliases.json"),"utf8"));
    const verified=await run("routes","verify");
    assert.match(verified.stdout,/Verified full Bifrost rule policy unchanged/u);
    const afterVerification=JSON.parse(readFileSync(resolve(home,"aliases.json"),"utf8"));
    assert.notEqual(afterVerification.synchronizedAt,beforeVerification.synchronizedAt);
    assert.equal(aliasConfigFingerprint(afterVerification),aliasConfigFingerprint(beforeVerification),
      "verification-only timestamp must preserve model catalogue identity");
    assert.doesNotMatch(verified.stdout,/test-password|sk-bf-test/u);
    cel="model == 'omp-default' && request_type == 'chat'";
    const diff=await run("routes","diff").then(()=>null,e=>e);
    assert.equal(diff?.code,2);
    assert.match(diff.stdout,/fingerprint: drifted/u);
    const rejected=await run("routes","verify").then(()=>null,e=>e);
    assert.equal(rejected?.code,2);
    assert.match(rejected.stdout,/Policy drifted/u);
    assert.doesNotMatch(rejected.stdout,/test-password|sk-bf-test/u);
    const applied=await run("routes","reconcile","--json");
    const result=JSON.parse(applied.stdout);
    assert.equal(result.schemaVersion,1);
    assert.equal(result.status,"updated");
    assert.equal(result.routes,1);
    const next=JSON.parse(readFileSync(resolve(home,"aliases.json"),"utf8"));
    assert.notEqual(next.policyFingerprint,manifest.policyFingerprint);
    const repeated=await run("routes","reconcile","--json");
    assert.equal(JSON.parse(repeated.stdout).status,"unchanged");
    assert.doesNotMatch(applied.stdout+applied.stderr,/test-password|sk-bf-test/u);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    rmSync(home,{recursive:true,force:true});
  }
});
