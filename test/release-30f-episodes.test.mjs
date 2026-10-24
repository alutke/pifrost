import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionCheckpoint,transitionExecutionCheckpoint,PIFROST_CHECKPOINT_TYPE } from "../execution-checkpoint.mjs";
import { PIFROST_RECOVERY_EPISODE_TYPE,LEGACY_RECOVERY_ATTEMPT_TYPE,
  recoveryEpisodeState,nextRecoveryEpisode } from "../recovery-episodes.mjs";
import { planIntelligentRecovery,locateRecoveryScope } from "../intelligent-stall-recovery.mjs";

const sessionId="30f-session",cwd="/workspace/fixture";
const user={role:"user",content:[{type:"text",text:"Implement and verify multiple milestones"}]};
const stop=()=>({role:"assistant",stopReason:"stop",content:[{type:"thinking",thinking:"reasoning unavailable"}]});
const tool=(id,cmd)=>({role:"assistant",content:[{type:"toolCall",id,name:"bash",arguments:{command:cmd}}]});
const result=id=>({role:"toolResult",toolCallId:id,content:[{type:"text",text:"ok"}]});
function fixture(){
  const checkpoint=createExecutionCheckpoint({sessionId,cwd,planReference:"plan.md"});
  const attempted=transitionExecutionCheckpoint(checkpoint,{type:"attempt",step:"build"});
  const branch=[{id:"anchor",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:checkpoint},
    {id:"step",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:attempted}];
  const messages=[user];
  let serial=0;
  function append(message) {
    const id="entry-"+(++serial);
    branch.push({id,type:"message",message});messages.push(message);return id;
  }
  function work(name,cmd) { append(tool(name,cmd));append(result(name)); }
  function settle() {const m=stop();append(m);return m;}
  work("first","npm test");let last=settle();
  const evaluate=(opts={})=>planIntelligentRecovery({event:{
    session_id:sessionId,stop_hook_active:false,signal:new AbortController().signal,
    messages,last_assistant_message:last,
  },branch,sessionId,cwd,contextTokens:31242,contextWindow:256000,...opts});
  const consume=decision=> {
    assert.equal(decision.action,"continue");
    branch.push({id:"attempt-"+(++serial),type:"custom",
      customType:PIFROST_RECOVERY_EPISODE_TYPE,data:decision.record});
  };
  return {branch,messages,evaluate,consume,work,settle:()=>{last=settle();},checkpoint};
}
test("30F: 31K context and active plan are not a context-pressure assertion",()=>{
  const f=fixture(),a=f.evaluate();
  assert.equal(a.action,"continue");assert.equal(a.stage,"native");
  assert.equal(a.contextPressure,false);
  assert.equal(a.record.schemaVersion,2);
  assert.equal(a.record.proof.kind,"initial");
  assert.equal(a.record.sessionKey.length,64);
  assert.doesNotMatch(JSON.stringify(a.record),/npm test|reasoning unavailable|workspace/);
});
test("30F: repeated nonproductive stops without journal progression exhaust safely",()=>{
  const f=fixture();const a=f.evaluate();f.consume(a);
  f.settle();const b=f.evaluate();assert.equal(b.stage,"context");f.consume(b);
  f.settle();const noPermission=f.evaluate();
  assert.equal(noPermission.action,"exhausted");
  assert.equal(noPermission.reason,"model-fallback-not-authorized");
  assert.equal(noPermission.attempts,2);
  assert.equal(f.evaluate({allowModelFallback:true}).stage,"model");
  assert.equal(f.evaluate({event:undefined}).action,"none");
});
test("30F: distinct fully paired work establishes a new independently bounded episode",()=>{
  const f=fixture(),a=f.evaluate();f.consume(a);
  f.settle();const b=f.evaluate();f.consume(b);
  f.work("fresh","node --check app.js");f.settle();
  const next=f.evaluate();
  assert.equal(next.stage,"native");assert.equal(next.attempts,1);
  assert.notEqual(next.record.episodeKey,a.record.episodeKey);
  assert.equal(next.record.proof.kind,"paired-tool");
  f.consume(next);
  f.settle();const retry=f.evaluate();assert.equal(retry.stage,"context");
  f.consume(retry);
  f.work("another","npm run check");f.settle();
  const third=f.evaluate();assert.equal(third.stage,"native");
  assert.notEqual(third.record.episodeKey,next.record.episodeKey);
  assert.equal(recoveryEpisodeState(f.branch,locateRecoveryScope(f.branch,sessionId,cwd),sessionId,cwd).records.length,4);
});
test("30F: repeating an identical tool call does not manufacture new retry capacity",()=>{
  const f=fixture();f.consume(f.evaluate());
  f.work("repeat","npm test");f.settle();
  const b=f.evaluate();
  assert.equal(b.stage,"context");
  f.consume(b);
  f.work("repeat-again","npm test");f.settle();
  assert.equal(f.evaluate().reason,"model-fallback-not-authorized");
});
test("30F: v1 records are immutable and a later v2 episode may begin only with evidence",()=>{
  const f=fixture(),first=f.evaluate();
  const {proof,episodeKey,...legacy}=first.record;
  legacy.schemaVersion=1;
  f.branch.push({id:"legacy",type:"custom",customType:LEGACY_RECOVERY_ATTEMPT_TYPE,data:legacy});
  f.settle();
  assert.equal(f.evaluate().stage,"context");
  f.work("fresh","node --check new.js");f.settle();
  const newEpisode=f.evaluate();
  assert.equal(newEpisode.record.ordinal,1);
  assert.equal(newEpisode.record.proof.kind,"paired-tool");
  f.consume(newEpisode);
  assert.equal(recoveryEpisodeState(f.branch,locateRecoveryScope(f.branch,sessionId,cwd),sessionId,cwd).records.length,2);
  const forged={...newEpisode.record,ordinal:1,assistantEntryId:"forged",
    proof:{...newEpisode.record.proof,entryId:"not-in-branch"}};
  f.branch.push({id:"corrupt",type:"custom",customType:PIFROST_RECOVERY_EPISODE_TYPE,data:forged});
  assert.equal(f.evaluate().reason,"corrupt-recovery-journal");
});
test("30F: explicit verified checkpoint transition or user resumption can fence an episode",()=>{
  const f=fixture();f.consume(f.evaluate());
  let attempted=transitionExecutionCheckpoint(f.checkpoint,{type:"attempt",step:"verify"});
  let verified=transitionExecutionCheckpoint(attempted,{type:"verify",step:"verify",evidence:"ci:passed"});
  f.branch.push({id:"cp-attempt",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:attempted});
  f.branch.push({id:"cp-verified",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:verified});
  f.settle();
  assert.equal(f.evaluate().record.proof.kind,"verified-step");
  f.consume(f.evaluate());
  f.branch.push({id:"operator-resume",type:"message",message:user});
  f.work("after-user","npm run release:check");f.settle();
  assert.equal(f.evaluate().record.proof.kind,"user-resume");
});
test("30F: truncated evidence and foreign branch/session cannot renew auto continuation",()=>{
  const f=fixture();const first=f.evaluate();f.consume(first);
  f.work("fresh","node --check index.js");f.settle();
  const fresh=f.evaluate();assert.equal(fresh.record.ordinal,1);f.consume(fresh);
  const partial=f.branch.filter(e=>e.id!=="entry-5");
  assert.equal(f.evaluate({branch:partial}).action,"none");
  assert.equal(f.evaluate({sessionId:"another-session"}).reason,"session-mismatch");
  assert.equal(f.evaluate({cwd:"/different"}).reason,"no-branch-checkpoint");
});
test("30F: journal proof is branch-derived, never copied from a disk mirror",()=>{
  const f=fixture();f.consume(f.evaluate());
  const prior=f.branch.slice(0,-1);
  assert.equal(recoveryEpisodeState(prior,locateRecoveryScope(prior,sessionId,cwd),sessionId,cwd).records.length,0);
  f.work("fresh","npm run check");f.settle();
  const plan=f.evaluate();
  assert.equal(plan.record.proof.kind,"paired-tool");
  const fake={...plan.record,proof:{...plan.record.proof,fingerprint:"0".repeat(64)}};
  f.branch.push({id:"bad-proof",type:"custom",customType:PIFROST_RECOVERY_EPISODE_TYPE,data:fake});
  assert.equal(f.evaluate().reason,"corrupt-recovery-journal");
});

test("30F: many independent stalls retain bounded consecutive retries and measured hook overhead",()=>{
  const f=fixture(),n=40,latencies=[];
  const initialHeap=process.memoryUsage().heapUsed;
  for(let i=0;i<n;i++){
    if(i>0){f.work("progress-"+i,"node --check file-"+i+".js");f.settle();}
    const start=performance.now();
    const decision=f.evaluate();
    latencies.push(performance.now()-start);
    assert.equal(decision.stage,"native","episode "+i);
    assert.equal(decision.attempts,1,"episode "+i);
    f.consume(decision);
  }
  const state=recoveryEpisodeState(f.branch,locateRecoveryScope(f.branch,sessionId,cwd),sessionId,cwd);
  assert.equal(state.records.length,n);
  const sorted=[...latencies].sort((a,b)=>a-b);
  const p95=sorted[Math.ceil(n*0.95)-1];
  const bytes=Buffer.byteLength(JSON.stringify(state.records));
  const heapDelta=process.memoryUsage().heapUsed-initialHeap;
  console.log("# 30F benchmark (CI runner, no provider): episodes="+n+
    " medianStopHookMs="+sorted[Math.floor(n/2)].toFixed(3)+
    " p95StopHookMs="+p95.toFixed(3)+" auditBytes="+bytes+
    " heapDeltaBytes="+heapDelta);
});
