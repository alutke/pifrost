import assert from "node:assert/strict";
import test from "node:test";
import { isLeakedPlanningStop } from "../completion-integrity.mjs";
import { inspectOutput,inspectAgentEnd } from "../execution-observation.mjs";
import { createExecutionCheckpoint,transitionExecutionCheckpoint,PIFROST_CHECKPOINT_TYPE } from "../execution-checkpoint.mjs";
import { planIntelligentRecovery } from "../intelligent-stall-recovery.mjs";
import { PIFROST_RECOVERY_EPISODE_TYPE,recoveryEpisodeState } from "../recovery-episodes.mjs";

const incident="Start with CI edit.\n</thinking>\nDeterminism confirmed: all five seeds distinct. Now CI wiring.\n</thinking>\n</thinking>\n</thinking>\n</thinking>";
const model=text=>({role:"assistant",stopReason:"stop",content:[{type:"text",text}]});
const observed=text=>inspectOutput([{type:"message",role:"assistant",content:model(text).content}],"stop");

test("30G: October 24 five-closer incident is leaked planning, not a normal completion",()=>{
  assert.equal(isLeakedPlanningStop(incident),true);
  assert.equal(observed(incident).reason,"LEAKED_THINKING_STOP");
  assert.equal(observed(incident).toolCallCount,0);
  assert.equal(inspectAgentEnd({messages:[
    {role:"user",content:[{type:"text",text:"Implement Release C.1"}]},
    {role:"toolResult",toolCallId:"test",content:[{type:"text",text:"ok"}]},
    model(incident),
  ]}).diagnostic,"SUSPECT_NONPRODUCTIVE_SETTLEMENT");
});

test("30G: reject ordinary final answers, quoted examples and incomplete plans without markers",()=>{
  for(const text of [
    "The remaining work is CI wiring. Now implement the tests.",
    "Here is the quoted example: <thinking>I'll implement this</thinking>. That is a model bug.",
    "¶think: Let's run tests.\n\n## Final report\nAll work is complete.",
    "Let's patch the code. </thinking></thinking>\n## Final report\nAll work is complete.",
    "The review is complete. No further action is required. </thinking></thinking>",
  ])assert.equal(isLeakedPlanningStop(text),false,text);
  assert.equal(observed("Release complete. Tests green.").reason,"NONE");
  assert.equal(observed("Now CI wiring.").reason,"NONE");
  assert.equal(inspectOutput([{type:"message",role:"assistant",content:[
    {type:"text",text:incident},{type:"toolCall",id:"c",name:"bash"},
  ]}],"stop").reason,"NONE");
  assert.equal(observed("reasoning unavailable</thinking></thinking>").reason,"EMPTY_STOP");
  assert.equal(inspectOutput([{type:"message",role:"assistant",content:model(incident).content}],"error").reason,"NONE");
});

test("30G: previous leaked-planning signatures still classify",()=>{
  for(const text of [
    "Need to finish. Let's patch imports and run tests. </thinking>\n</thinking>",
    "¶think: Previous work passed.\nNow I need to implement the remaining fixtures.",
    "<think>unfinished</think> We should test the implementation.",
  ])assert.equal(observed(text).reason,"LEAKED_THINKING_STOP",text);
});

function fixture(text){
  const sessionId="30g-session",cwd="/workspace/proof";
  const checkpoint=createExecutionCheckpoint({sessionId,cwd,planReference:"plan.md"});
  const attempted=transitionExecutionCheckpoint(checkpoint,{type:"attempt",step:"verification"});
  const user={role:"user",content:[{type:"text",text:"Implement and verify"}]};
  const tool={role:"assistant",content:[{type:"toolCall",id:"check-one",name:"bash",arguments:{command:"npm test"}}]};
  const result={role:"toolResult",toolCallId:"check-one",content:[{type:"text",text:"ok"}]};
  const final=model(text);
  const messages=[user,tool,result,final];
  const branch=[
    {id:"anchor",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:checkpoint},
    {id:"attempt",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:attempted},
    {id:"tool",type:"message",message:tool},
    {id:"result",type:"message",message:result},
    {id:"settle",type:"message",message:final},
  ];
  const event={session_id:sessionId,stop_hook_active:false,signal:new AbortController().signal,
    messages,last_assistant_message:final};
  const decide=options=>planIntelligentRecovery({event,branch,sessionId,cwd,mode:"auto",...options});
  return {branch,sessionId,cwd,decide};
}
test("30G: incident reaches 30F continuation, survives v2 journal and cannot duplicate",()=>{
  const f=fixture(incident);
  const decision=f.decide();
  assert.equal(decision.action,"continue");
  assert.equal(decision.stage,"native");
  assert.equal(decision.reason,"LEAKED_THINKING_STOP");
  assert.equal(decision.record.reason,"LEAKED_THINKING_STOP");
  assert.match(decision.additionalContext,/Continue the EXISTING user request/);
  assert.doesNotMatch(JSON.stringify(decision.record),/CI wiring|Determinism/);
  f.branch.push({id:"journal",type:"custom",customType:PIFROST_RECOVERY_EPISODE_TYPE,data:decision.record});
  assert.equal(recoveryEpisodeState(f.branch,{anchor:"anchor"},f.sessionId,f.cwd).records.length,1);
  assert.equal(f.decide().reason,"duplicate-settle");
});
test("30G: ordinary answers, unknown effects, interruptions, queued work and stale scope stay blocked",()=>{
  const f=fixture("The requested work is complete.");
  assert.equal(f.decide().reason,"productive-or-ambiguous-answer");
  const leaked=fixture(incident);
  assert.equal(leaked.decide({uncertainTools:true}).reason,"uncertain-tool-outcome");
  assert.equal(leaked.decide({queued:true}).reason,"omp-owns-continuation");
  assert.equal(leaked.decide({running:true}).reason,"omp-owns-continuation");
  assert.equal(leaked.decide({mode:"off"}).reason,"disabled");
  assert.equal(leaked.decide({mode:"notice"}).action,"notice");
  assert.equal(leaked.decide({sessionId:"foreign"}).reason,"session-mismatch");
  assert.equal(leaked.decide({branch:leaked.branch.slice(1)}).reason,"no-branch-checkpoint");
});
