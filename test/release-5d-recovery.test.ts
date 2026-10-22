import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createStalledTurnRecoveryCoordinator,detectStalledTurn,uncertainToolOutcome,STALLED_TURN_CONTINUATION} from "../stalled-turn-recovery.ts";

const user={role:"user",content:[{type:"text",text:"Implement changes"}]};
const call={role:"assistant",content:[{type:"toolCall",id:"call-1",name:"bash",arguments:{command:"build"}}]};
const result={role:"toolResult",toolCallId:"call-1",toolName:"bash",content:[{type:"text",text:"tests passed"}]};
const tail={role:"assistant",stopReason:"stop",content:[{type:"text",text:"Let's run the remaining verification. </thinking></thinking>"}]};
const observed={messages:[user,call,result,tail]};

test("R5D-06 a confirmed tool result can permit only one OMP follow-up; unresolved tool result blocks it",()=>{
  assert.equal(uncertainToolOutcome(observed.messages),false);
  assert.equal(detectStalledTurn(observed),"leaked-planning-stop");
  assert.equal(uncertainToolOutcome([user,call,tail]),true);
  assert.equal(detectStalledTurn({messages:[user,call,tail]}),undefined);
  assert.equal(uncertainToolOutcome([user,{role:"toolResult",toolCallId:"call-42"},call,result,tail]),true);
  assert.equal(detectStalledTurn({messages:[user,{role:"toolResult",toolCallId:"call-42"},call,result,tail]}),undefined);
});

test("R5D-07 ambiguous MCP result after a commit is not mistaken for a safe settled agent turn",()=>{
  const ambiguous={
    ...result,isError:true,
    content:[{type:"text",text:"upstream timeout: connection reset by peer after tools/call"}],
  };
  const event={messages:[user,call,ambiguous,tail]};
  assert.equal(uncertainToolOutcome(event.messages),true);
  assert.equal(detectStalledTurn(event),undefined);
  const plainError={...result,isError:true,content:[{type:"text",text:"invalid argument: use valid date"}]};
  assert.equal(uncertainToolOutcome([user,call,plainError,tail]),false);
});

test("R5D-08 cancelled, interrupted, in-progress and rewritten turns never launch follow-up",()=>{
  for(const field of ["cancelled","interrupted","historyRewritePending","hasUncertainToolOutcome"] as const){
    assert.equal(detectStalledTurn({...observed,[field]:true}),undefined,field);
  }
  const coordinator=createStalledTurnRecoveryCoordinator("auto");
  let sends=0;
  const ctx={sessionId:"uncertain-job",isMain:true,hasQueuedMessages:false,isIdle:true,sendContinuation:()=>{sends++}};
  for(const name of ["isCancelled","historyRewritePending","hasUncertainToolOutcome","hasUnknownJobState"] as const){
    assert.equal(coordinator.onAgentEnd(observed,{...ctx,[name]:true}),false,name);
    assert.equal(coordinator.status(ctx.sessionId),"none",name);
  }
  assert.equal(coordinator.onAgentEnd(observed,{...ctx,hasRunningAsyncWork:true}),false);
  assert.equal(coordinator.onAgentEnd({...observed,willContinue:true},ctx),false);
  assert.equal(sends,0);
});

test("R5D-09 one-time approval cannot survive OMP compaction, tree switch or cancellation",()=>{
  const coordinator=createStalledTurnRecoveryCoordinator("notice");
  let sends=0;
  const ctx={sessionId:"rewritten",isMain:true,hasQueuedMessages:false,isIdle:true,sendContinuation:(v:string)=>{
    assert.equal(v,STALLED_TURN_CONTINUATION);sends++;
  }};
  coordinator.onAgentEnd(observed,ctx);
  assert.equal(coordinator.status(ctx.sessionId),"pending");
  coordinator.onSessionInterrupt(ctx.sessionId);
  assert.equal(coordinator.continuePending(ctx),false);
  assert.equal(sends,0);
  coordinator.onAgentEnd(observed,ctx);
  assert.equal(coordinator.continuePending(ctx),true);
  assert.equal(sends,1);
  coordinator.onSessionInterrupt(ctx.sessionId);
  assert.equal(coordinator.status(ctx.sessionId),"consumed","interruption cannot reset one-shot budget");
  assert.equal(coordinator.continuePending(ctx),false);
  coordinator.onPrompt(ctx.sessionId,"A new human request");
  assert.equal(coordinator.onAgentEnd(observed,ctx),false);
  assert.equal(coordinator.continuePending(ctx),true);
  assert.equal(sends,2);
  coordinator.onSessionEnd(ctx.sessionId);
  assert.equal(coordinator.status(ctx.sessionId),"none");
});

test("R5D-10 native OMP lifecycle hooks cancel stale approval against rewritten session history",()=>{
  const source=readFileSync(new URL("../native.ts",import.meta.url),"utf8");
  for(const hook of ["session_compact","session_tree","session_branch","session_switch"]){
    assert.match(source,new RegExp('pi[.]on\\("'+hook+'"'));
  }
  assert.match(source,/stalledTurnRecovery[.]onSessionInterrupt/u);
  assert.match(source,/ctx[.]getAsyncJobSnapshot/u);
  assert.match(source,/deliverAs: "followUp"/u);
});
