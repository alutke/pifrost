import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionCheckpoint, transitionExecutionCheckpoint, PIFROST_CHECKPOINT_TYPE } from "../execution-checkpoint.mjs";
import { intelligentRecoveryMode, locateRecoveryScope, readRecoveryAttempts,
  planIntelligentRecovery, formatIntelligentRecoveryStatus, PIFROST_RECOVERY_ATTEMPT_TYPE,
} from "../intelligent-stall-recovery.mjs";

const sessionId="stable-session-0001", cwd="/workspace/rugby-manager-online";
const prompt={role:"user",content:[{type:"text",text:"Implement Release C of Rugby Manager Online"}]};
const tool={role:"assistant",content:[{type:"toolCall",id:"call-one",name:"bash",arguments:{command:"npm test"}}]};
const result={role:"toolResult",toolCallId:"call-one",toolName:"bash",
 content:[{type:"text",text:"Build failed. One TypeScript error."}]};
const assistant=(content=[{type:"thinking",thinking:"reasoning unavailable"}])=>
 ({role:"assistant",stopReason:"stop",content});
function fixture(){
  const cp=createExecutionCheckpoint({sessionId,cwd,promptText:"Implement Release C"});
  const attempted=transitionExecutionCheckpoint(cp,{type:"attempt",step:"C1a"});
  const entries=[
    {id:"a1b2c3d4",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:cp},
    {id:"aabbcc11",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:attempted},
    {id:"bb000001",type:"message",message:tool},
    {id:"bb000002",type:"message",message:result},
    {id:"bb000003",type:"message",message:assistant()},
  ];
  const messages=[prompt,tool,result,assistant()];
  const event={type:"session_stop",session_id:sessionId,session_file:"/ignored",turn_id:1,
    stop_hook_active:false,signal:new AbortController().signal,messages,
    last_assistant_message:messages.at(-1)};
  return {cp,entries,event,after:(record,id="bb000004")=>{
    entries.push({id,type:"custom",customType:PIFROST_RECOVERY_ATTEMPT_TYPE,data:record});
  }};
}
const evaluate=(f,overrides={})=>planIntelligentRecovery({
  event:f.event,branch:f.entries,sessionId,cwd,mode:"auto",...overrides,
});
test("30D: 614K-token reasoning-only stop with pending C1a receives ONE native OMP advisory",()=>{
  const f=fixture(),decision=evaluate(f,{contextTokens:614978,contextWindow:1000000});
  assert.equal(decision.action,"continue");
  assert.equal(decision.stage,"native");
  assert.equal(decision.record.ordinal,1);
  assert.equal(decision.reason,"REASONING_ONLY_STOP");
  assert.match(decision.additionalContext,/Do not repeat tool writes/);
  assert.equal(decision.additionalContext.includes("npm test"),false);
  assert.equal(decision.contextPressure,true);
  assert.equal(decision.record.sessionKey.length,64);
  assert.doesNotMatch(JSON.stringify(decision),/ignored|Build failed/);
});
test("30D: after repeat stalls, stage two uses OMP compaction and stage three requires opt-in distinct family",()=>{
  const f=fixture(); const a=evaluate(f);f.after(a.record);
  const identical=evaluate(f);
  assert.equal(identical.reason,"duplicate-settle");
  f.entries.push({id:"bb000005",type:"message",message:assistant()});
  const b=evaluate(f,{event:{...f.event,stop_hook_active:true},contextTokens:614978,contextWindow:1000000});
  assert.equal(b.stage,"context");
  assert.match(b.additionalContext,/OMP-native compaction policy/);
  f.after(b.record,"bb000006");
  f.entries.push({id:"bb000007",type:"message",message:assistant()});
  const blocked=evaluate(f,{event:{...f.event,stop_hook_active:true}});
  assert.equal(blocked.action,"exhausted");
  assert.equal(blocked.reason,"model-fallback-not-authorized");
  const optin=evaluate(f,{event:{...f.event,stop_hook_active:true},allowModelFallback:true});
  assert.equal(optin.stage,"model");
  assert.equal(optin.record.ordinal,3);
  f.after(optin.record,"bb000008");
  f.entries.push({id:"bb000009",type:"message",message:assistant()});
  const exhausted=evaluate(f,{event:{...f.event,stop_hook_active:true},allowModelFallback:true});
  assert.equal(exhausted.action,"exhausted");
  assert.equal(exhausted.attempts,3);
  assert.match(formatIntelligentRecoveryStatus({branch:f.entries,sessionId,cwd,mode:"auto"}),/3\/3/);
});
test("30D: no restart or branch rewind can revive a consumed attempt on the same history",()=>{
  const f=fixture(); const first=evaluate(f);f.after(first.record);
  assert.equal(readRecoveryAttempts(f.entries,locateRecoveryScope(f.entries,sessionId,cwd),sessionId).length,1);
  // Simulated new JS process: state is read from the branch, not module memory.
  assert.equal(evaluate(f).reason,"duplicate-settle");
  const prior=f.entries.slice(0,2);
  assert.equal(readRecoveryAttempts(prior,locateRecoveryScope(prior,sessionId,cwd),sessionId).length,0);
  assert.equal(evaluate({...f,entries:prior}).reason,"assistant-journal-unverified");
  assert.equal(evaluate(f,{sessionId:"a-different-session"}).reason,"session-mismatch");
  assert.equal(evaluate(f,{cwd:"/other/project"}).reason,"no-branch-checkpoint");
});
test("30D: never auto-resume productive final answer or ordinary no-tools inquiry",()=>{
  const f=fixture();
  const answer=assistant([{type:"text",text:"The work is completed; here are tests."}]);
  f.event.last_assistant_message=answer;f.event.messages=[prompt,tool,result,answer];
  assert.equal(evaluate(f).reason,"productive-or-ambiguous-answer");
  const noTools=fixture();noTools.event.messages=[prompt,assistant()];
  assert.equal(evaluate(noTools).reason,"no-recent-tool-activity");
});
test("30D: abort, pending work, provider errors, and uncertain side effects are terminal safety barriers",()=>{
 const f=fixture();
 for(const [label,mod] of [
   ["cancelled",{interrupted:true}],["queued",{queued:true}],["async",{running:true}],
   ["uncertain",{uncertainTools:true}],
 ])assert.equal(evaluate(f,mod).action,"none",label);
 const abort=new AbortController();abort.abort();
 assert.equal(evaluate(f,{event:{...f.event,signal:abort.signal}}).reason,"user-interrupt");
 assert.equal(evaluate(f,{event:{...f.event,session_id:"stale-session"}}).reason,"session-mismatch");
 const error=assistant();error.stopReason="error";
 assert.equal(evaluate(f,{event:{...f.event,last_assistant_message:error}}).reason,"not-successful-terminal-stop");
 f.event.messages=[prompt,tool,assistant()];
 assert.equal(evaluate(f).reason,"unpaired-or-uncertain-tools");
 const stopActive={...f.event,stop_hook_active:true};
 assert.equal(evaluate(f,{event:stopActive}).reason,"other-stop-hook-active");
});
test("30D: complete or superseded task cannot be treated as outstanding work",()=>{
 const f=fixture();
 const closed={...f.entries[1],data:{...f.entries[1].data,status:"complete",pendingVerification:false,
    steps:[{id:"C1a",status:"verified",evidence:"ci:abc"}]}};
 f.entries[1]=closed;
 assert.equal(evaluate(f).reason,"checkpoint-closed");
});
test("30D: opted-out mode is advisory or off, never silently re-enabled by a typo",()=>{
 const f=fixture();
 assert.equal(intelligentRecoveryMode(undefined,undefined),"auto");
 assert.equal(intelligentRecoveryMode(undefined,"off"),"off");
 assert.equal(intelligentRecoveryMode("notice","auto"),"notice");
 assert.equal(intelligentRecoveryMode("typo","auto"),"notice");
 assert.equal(evaluate(f,{mode:"off"}).reason,"disabled");
 assert.equal(evaluate(f,{mode:"notice"}).action,"notice");
});
test("30D: repeated attempts are session-and-anchor bound, not merely adjacent in a mirrored file",()=>{
 const f=fixture();const first=evaluate(f);f.after(first.record);
 const newPlan=createExecutionCheckpoint({sessionId,cwd,planReference:"docs/another-plan.md"});
 f.entries.push({id:"cccc0011",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:newPlan});
 f.entries.push({id:"cccc0012",type:"message",message:assistant()});
 assert.equal(readRecoveryAttempts(f.entries,locateRecoveryScope(f.entries,sessionId,cwd),sessionId).length,0);
 assert.equal(evaluate(f).stage,"native");
 const invalid={...first.record,ordinal:2,sessionKey:"0".repeat(64)};
 f.entries.push({id:"cccc0013",type:"custom",customType:PIFROST_RECOVERY_ATTEMPT_TYPE,data:invalid});
 assert.equal(readRecoveryAttempts(f.entries,locateRecoveryScope(f.entries,sessionId,cwd),sessionId).length,0);
});
