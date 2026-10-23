import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExecutionCheckpoint, validExecutionCheckpoint, restoreExecutionCheckpoint,
  transitionExecutionCheckpoint, observeExecutionTurn, checkpointResumeText, PIFROST_CHECKPOINT_TYPE,
} from "../execution-checkpoint.mjs";
import { mirrorCheckpoint, commitExecutionCheckpoint } from "../checkpoint-mirror.mjs";
import { createCheckpointLifecycle } from "../checkpoint-lifecycle.mjs";

const identity={sessionId:"test-omp-session",cwd:"/workspace/rugby-manager-online"};
const custom = state => ({type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:state});
function fixture(){
  let entries=[],written=0,played=0;
  const ctx={agent:{kind:"main"},cwd:identity.cwd,sessionManager:{
    getSessionId:()=>identity.sessionId,getBranch:()=>entries,
  }};
  const ledger=createCheckpointLifecycle({
    appendEntry:(type,data)=>{assert.equal(type,PIFROST_CHECKPOINT_TYPE);entries.push(custom(data));written++;},
    mirror:()=>{},
  });
  return {ctx,ledger,get entries(){return entries},set entries(value){entries=value},
    get writes(){return written},get toolReplays(){return played}};
}

test("30C-01: active branch journal alone reconstructs after compaction/restart, not model text",()=>{
  const f=fixture(),first=f.ledger.begin(f.ctx,"docs/release-c.md");
  assert.equal(first.steps.length,0);
  f.ledger.transition(f.ctx,{type:"attempt",step:"C1a"});
  f.ledger.transition(f.ctx,{type:"verify",step:"C1a",evidence:"ci:1234"});
  const restored=createCheckpointLifecycle({appendEntry:()=>{throw Error("must not append")},mirror:()=>{}})
    .restore(f.ctx);
  assert.equal(restored.steps[0].status,"verified");
  assert.equal(restored.steps[0].evidence,"ci:1234");
  assert.match(f.ledger.compactionContext(f.ctx),/unverified task metadata/i);
  assert.equal(f.ledger.status(f.ctx).includes("1\/1 explicitly verified"),true);
});

test("30C-02: branch rewind cannot leak newer evidence or state into older branch",()=>{
  const f=fixture();
  f.ledger.begin(f.ctx,"docs/release-c.md");
  const root=f.entries.slice();
  f.ledger.transition(f.ctx,{type:"attempt",step:"C1a"});
  f.ledger.transition(f.ctx,{type:"verify",step:"C1a",evidence:"ci:123"});
  assert.equal(f.ledger.restore(f.ctx).steps.length,1);
  f.entries=root;
  const restored=f.ledger.restore(f.ctx);
  assert.equal(restored.steps.length,0);
  assert.equal(restored.revision,1);
  assert.equal(restoreExecutionCheckpoint(root,{...identity,sessionId:"different"}),null);
  assert.equal(restoreExecutionCheckpoint(root,{...identity,cwd:"/other/workspace"}),null);
});

test("30C-03: observed tools remain unverified even when they return successfully",()=>{
 const f=fixture();
 f.ledger.begin(f.ctx,"docs/release-c.md");
 f.ledger.transition(f.ctx,{type:"attempt",step:"build"});
 f.entries.push({type:"message",message:{role:"toolResult",isError:false,content:[{type:"text",text:"exit code 0"}]}});
 const observation=f.ledger.afterTurn(f.ctx);
 assert.equal(observation.pendingVerification,true);
 assert.match(f.ledger.status(f.ctx),/unverified activity/);
 assert.throws(()=>f.ledger.transition(f.ctx,{type:"complete"}),/unverified/);
 f.ledger.transition(f.ctx,{type:"verify",step:"build",evidence:"checks:20261023"});
 assert.equal(f.ledger.transition(f.ctx,{type:"complete"}).status,"complete");
 assert.equal(f.toolReplays,0);
 assert.match(f.ledger.resumeText(f.ctx),/Do not automatically replay/);
});

test("30C-04: subsequent tool activity invalidates completion readiness until reverified",()=>{
 const f=fixture();
 f.ledger.begin(f.ctx,"docs/release-c.md");
 f.ledger.transition(f.ctx,{type:"attempt",step:"build"});
 f.ledger.transition(f.ctx,{type:"verify",step:"build",evidence:"ci:pass"});
 f.entries.push({type:"message",message:{role:"toolResult"}});
 f.ledger.afterTurn(f.ctx);
 assert.throws(()=>f.ledger.transition(f.ctx,{type:"complete"}),/unverified/);
 f.ledger.transition(f.ctx,{type:"verify",step:"build",evidence:"ci:rerun"});
 assert.equal(f.ledger.transition(f.ctx,{type:"complete"}).status,"complete");
});

test("30C-05: 118k-character plan prompt is only hashed, never recopied or logged",()=>{
 const f=fixture(),plan="Release C: implement job scope. ".repeat(4000);
 const started=f.ledger.autoBegin(f.ctx,plan);
 assert.equal(started.plan.reference,"omp-session-user-prompt");
 assert.equal(started.plan.sha256.length,64);
 assert.equal(started.plan.characters,plan.length);
 assert.equal(JSON.stringify(started).includes(plan.slice(0,100)),false);
 assert.equal(f.ledger.autoBegin(f.ctx,plan),null);
 assert.equal(f.writes,1);
});

test("30C-06: bounded fields, evidence requirement, and no verification by status text",()=>{
 const state=createExecutionCheckpoint({...identity,planReference:"docs/release-c.md"});
 assert.throws(()=>createExecutionCheckpoint({...identity,planReference:"https://service/?token=x"}),/Plan reference/);
 assert.throws(()=>createExecutionCheckpoint({...identity,planReference:"../secret.txt"}),/Plan reference/);
 assert.throws(()=>transitionExecutionCheckpoint(state,{type:"verify",step:"C1",evidence:"ci:ok"}),/Attempt/);
 const attempted=transitionExecutionCheckpoint(state,{type:"attempt",step:"C1"});
 assert.throws(()=>transitionExecutionCheckpoint(attempted,{type:"verify",step:"C1",evidence:""}),/Verification requires/);
 assert.throws(()=>transitionExecutionCheckpoint(state,{type:"complete"}),/Cannot claim completion/);
 assert.throws(()=>transitionExecutionCheckpoint(state,{type:"attempt",step:"C1\nsecret"}),/identifier/);
 assert.equal(validExecutionCheckpoint({...state,sessionKey:"a".repeat(64)},identity),false);
 assert.equal(restoreExecutionCheckpoint([custom({...state,plan:{reference:"../bad"}})],identity),null);
 assert.equal(observeExecutionTurn(state,[{role:"assistant",content:[{type:"text",text:"Tests passed"}]}]),state);
});

test("30C-07: private atomic mirror survives independent read and has restrictive permissions",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-cp-"));
 try {
   const cp=createExecutionCheckpoint({...identity,planReference:"docs/release-c.md"});
   const path=mirrorCheckpoint(cp,{baseDir:root});
   assert.equal(statSync(path).mode & 0o777,0o600);
   assert.equal(statSync(join(root,cp.sessionKey)).mode & 0o777,0o700);
   assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),cp);
   assert.equal(readdirSync(join(root,cp.sessionKey)).length,1);
   const path2=mirrorCheckpoint(cp,{baseDir:root});
   assert.equal(path2,path);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test("30C-08: mirror failure never authorizes restoration or tool replay; journal append is first",()=>{
 const cp=createExecutionCheckpoint({...identity,planReference:"docs/release-c.md"});
 let appended=0,notice=0;
 const saved=commitExecutionCheckpoint(cp,{appendEntry:()=>{appended++},mirror:()=>{throw Error("disk full")},onMirrorError:()=>{notice++}});
 assert.equal(saved,cp);assert.equal(appended,1);assert.equal(notice,1);
 assert.throws(()=>commitExecutionCheckpoint(cp,{appendEntry:()=>{throw Error("journal failed")},mirror:()=>{appended++}}),/journal failed/);
 assert.equal(appended,1);
});

test("30C-09: subagents cannot create/observe main checkpoint, new plan is explicit",()=>{
 const f=fixture(),child={...f.ctx,agent:{kind:"sub"}};
 assert.throws(()=>f.ledger.begin(child,"docs/plan.md"),/main/);
 assert.equal(f.ledger.autoBegin(child,"Release C ".repeat(300)),null);
 assert.equal(f.ledger.afterTurn(child),null);
 const initial=f.ledger.begin(f.ctx,"docs/plan.md");
 const next=f.ledger.begin(f.ctx,"docs/other.md");
 assert.equal(next.plan.reference,"docs/other.md");
 assert.equal(next.revision,1);
 assert.equal(initial.plan.reference,"docs/plan.md");
});

test("30C-10: unavailable/corrupt OMP branch journal fails closed",()=>{
 const f=fixture();
 const broken={...f.ctx,sessionManager:{getSessionId:()=>identity.sessionId,getBranch:()=>null}};
 assert.throws(()=>f.ledger.begin(broken,"docs/plan.md"),/journal unavailable/);
 assert.throws(()=>f.ledger.status(broken),/journal unavailable/);
});

test("30D: a new named release starts a distinct checkpoint without resetting generic follow-ups",()=>{
 const f=fixture();
 const first=f.ledger.autoBegin(f.ctx,"Implement Release C");
 assert.equal(first.revision,1);
 assert.equal(f.ledger.autoBegin(f.ctx,"Implement Release C"),null);
 assert.equal(f.ledger.autoBegin(f.ctx,"Continue fixing tests"),null);
 const next=f.ledger.autoBegin(f.ctx,"Implement 30D");
 assert.equal(next.revision,1);
 assert.notEqual(next.plan.sha256,first.plan.sha256);
 assert.equal(f.ledger.restore(f.ctx).plan.sha256,next.plan.sha256);
 assert.equal(f.ledger.autoBegin(f.ctx,"Implement 30D"),null);
});
test("30D: explicit operator plan cannot be silently replaced by a new prompt",()=>{
 const f=fixture();
 f.ledger.begin(f.ctx,"docs/approved-release.md");
 assert.equal(f.ledger.autoBegin(f.ctx,"Implement 30E"),null);
 assert.equal(f.ledger.restore(f.ctx).plan.reference,"docs/approved-release.md");
});
