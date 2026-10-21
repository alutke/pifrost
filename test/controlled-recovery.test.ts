import assert from "node:assert/strict";
import test from "node:test";
import { assessRecovery, formatRecoveryStatus, createRecoveryNoticeCoordinator } from "../controlled-recovery.ts";
import { handleRecoveryCommand, recoveryContinuationPrompt, type RecoveryCommandHost } from "../recovery-command.ts";

function trace(code="REASONING_REPLAY_INVALID", extras:Record<string,unknown>={}) {
  return { timestamp: 1, outcome:"error" as const, failureCode:code as any, ...extras };
}
test("E-01: 555-item incident is fork-eligible only before output, never a retry",()=>{
  const c=assessRecovery(trace("REASONING_REPLAY_INVALID",{httpStatus:400,outputStarted:false}));
  assert.equal(c?.mayFork,true);
  assert.match(formatRecoveryStatus(c),/Original OMP session: preserved/u);
  assert.doesNotMatch(formatRecoveryStatus(c),/prompt|tool arguments|API key|SECRET/u);
  assert.equal(assessRecovery(trace("REASONING_REPLAY_INVALID",{outputStarted:true}))?.mayFork,false);
  assert.equal(assessRecovery({...trace("REASONING_REPLAY_INVALID"),outcome:"done"}) ,undefined);
});
test("E-02: permission, output budget and route errors cannot be bypassed by a fork",()=>{
  for(const code of ["MODEL_NOT_PERMITTED","OUTPUT_LIMIT_EXCEEDED","PROTOCOL_INCOMPATIBLE","ROUTE_CONTRACT_UNKNOWN","UPSTREAM_TRANSIENT"]) {
    assert.equal(assessRecovery(trace(code))?.mayFork,false,code);
  }
  assert.equal(assessRecovery(trace("UNKNOWN")),undefined);
  assert.equal(assessRecovery({timestamp:1,outcome:"thrown",replayAudit:{reason:"incompatible-history"}})?.mayFork,true);
});
test("E-03: notices emit once per failure identity and no follow-up messages",()=>{
  const coordinator=createRecoveryNoticeCoordinator();
  const a=trace(),b=trace(); const seen:string[]=[];
  assert.equal(coordinator.notice("session",a,m=>seen.push(m)),true);
  assert.equal(coordinator.notice("session",a,m=>seen.push(m)),false);
  assert.equal(seen.length,1);
  assert.equal(coordinator.notice("session",b,m=>seen.push(m)),true);
  coordinator.release("session");
  assert.equal(coordinator.notice("session",a,m=>seen.push(m)),true);
  assert.equal(coordinator.notice("session",{...a,outcome:"done"},m=>seen.push(m)),false);
});
function mock() {
  const notices:Array<[string,string]>=[];
  const calls:string[]=[];
  let session="original";
  const state={idle:true,pending:false,jobs:false,approved:true,brief:"Continue implementing Release E; 21 tests passed, verify git status first.",cancelled:false};
  const host:RecoveryCommandHost={
    isMain:true,interactive:true,currentSessionId:"session-1",parentSessionFile:"/tmp/original.jsonl",
    isIdle:()=>state.idle,hasPendingMessages:()=>state.pending,hasRunningAsyncJobs:()=>state.jobs,
    notify:(s,l)=>notices.push([s,l]),
    input:async()=>{calls.push("input");return state.brief;},
    confirm:async()=>{calls.push("confirm");return state.approved;},
    newSession:async(opts)=>{calls.push("newSession:"+opts.parentSession);if(!state.cancelled)session="new";return {cancelled:state.cancelled};},
    sendUserMessage:(x)=>{calls.push("userMessage"); assert.equal(session,"new"); assert.match(x,/Release E/); assert.doesNotMatch(x,/SECRET THINKING/u);},
  };
  return {host,notices,calls,state};
}
test("E-04: clean fork is always user-approved and invokes OMP newSession, not session replay",async()=>{
  const {host,calls}=mock();
  assert.equal(await handleRecoveryCommand("fork",trace(),host),"forked");
  assert.deepEqual(calls,["input","confirm","newSession:/tmp/original.jsonl","userMessage"]);
  assert.match(recoveryContinuationPrompt("Fix Release E"),/verify whether they already occurred/u);
});
test("E-05: modal cancellation and OMP cancelled session do not enqueue tool work",async()=>{
  let m=mock();m.state.approved=false;
  assert.equal(await handleRecoveryCommand("fork",trace(),m.host),"cancelled");
  assert.deepEqual(m.calls,["input","confirm"]);
  m=mock();m.state.cancelled=true;
  assert.equal(await handleRecoveryCommand("fork",trace(),m.host),"cancelled");
  assert.equal(m.calls.includes("userMessage"),false);
});
test("E-06: no fork while running, queued, async work or subagent; failure remains inspectable",async()=>{
  for(const key of ["idle","pending","jobs"] as const){
    const m=mock();m.state[key]=key!=="idle";
    assert.equal(await handleRecoveryCommand("fork",trace(),m.host),"blocked");
    assert.equal(m.calls.length,0);
  }
  const m=mock();
  assert.equal(await handleRecoveryCommand("fork",trace("MODEL_NOT_PERMITTED"),m.host),"blocked");
  assert.equal(m.calls.length,0);
});
test("E-07: condition rechecked after input before destructive session transition",async()=>{
  const m=mock();
  const changingHost:RecoveryCommandHost={...m.host,input:async()=>{m.state.pending=true;return m.state.brief;}};
  assert.equal(await handleRecoveryCommand("fork",trace(),changingHost),"blocked");
  assert.equal(m.calls.includes("newSession:/tmp/original.jsonl"),false);
});
test("E-08: status and unknown actions cannot change session",async()=>{
  const m=mock();
  assert.equal(await handleRecoveryCommand("",trace(),m.host),"status");
  assert.equal(await handleRecoveryCommand("DROP_DATABASE",trace(),m.host),"blocked");
  assert.equal(m.calls.length,0);
});
