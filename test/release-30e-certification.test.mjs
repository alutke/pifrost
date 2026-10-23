import assert from "node:assert/strict";
import test from "node:test";
import { certifyReplayHygiene,formatRedactedIntegrityReport } from "../replay-certification.mjs";
import { diagnoseExecutionBranch,formatExecutionDiagnosis } from "../execution-certification.mjs";
import { createExecutionCheckpoint,transitionExecutionCheckpoint,PIFROST_CHECKPOINT_TYPE } from "../execution-checkpoint.mjs";
import { PIFROST_RECOVERY_ATTEMPT_TYPE,planIntelligentRecovery } from "../intelligent-stall-recovery.mjs";
import { recoveryFamilyCandidate } from "../recovery-fallback.mjs";

const reasoning=()=>({type:"reasoning",summary:[],content:[{type:"reasoning_text",text:"reasoning unavailable"}]});
const synthetic=()=>({type:"message",role:"assistant",content:[{type:"output_text",text:"<think>reasoning unavailable</think>",annotations:[]}]});
const call=id=>({type:"function_call",call_id:id,name:"bash",arguments:"{}"});
const output=id=>({type:"function_call_output",call_id:id,output:"committed"});
test("30E: legitimate unsigned Responses placeholder cleanup preserves structured reasoning/tool graph",()=>{
 const user={role:"user",content:"Implement C"};
 const reason=reasoning(),placeholder=synthetic(),tc=call("id-1"),result=output("id-1");
 const source={input:[user,reason,placeholder,tc,result],tools:[],store:false};
 const target={...source,input:[user,reason,tc,result]};
 const resultCertification=certifyReplayHygiene(source,target,"openai-responses");
 assert.equal(resultCertification.accepted,true);
 assert.equal(resultCertification.payload,target);
 assert.deepEqual(source.input,[user,reason,placeholder,tc,result]);
});
test("30E: preserves unknown native signatures, opaque content, tool IDs and tool results",()=>{
 const safe={input:[reasoning(),synthetic(),call("a"),output("a")]};
 const dangerCases=[
   {...safe,input:[safe.input[0],safe.input[1],call("different"),safe.input[3]]},
   {...safe,input:[safe.input[0],safe.input[1],safe.input[2]]},
   {...safe,input:[safe.input[0],safe.input[1],safe.input[2],output("different")]},
   {input:[safe.input[0],safe.input[1],safe.input[2],safe.input[3]],tools:[{name:"unverified"}]},
 ];
 for(const changed of dangerCases){
  const guard=certifyReplayHygiene(safe,changed,"openai-responses");
  assert.equal(guard.accepted,false);
  assert.equal(guard.payload,safe);
 }
 const native={input:[{...reasoning(),encrypted_content:"opaque"},call("a")]};
 assert.equal(certifyReplayHygiene(native,{input:[call("a")]},"openai-responses").accepted,false);
 const signed={input:[{...synthetic(),id:"msg-signed"},call("a")]};
 assert.equal(certifyReplayHygiene(signed,{input:[call("a")]},"openai-responses").accepted,false);
});
test("30E: allow removal of unsigned synthetic reasoning only on explicitly compatible physical response path",()=>{
 const r=reasoning(),t=call("a"),o=output("a");
 const src={input:[r,t,o]},dest={input:[t,o]};
 assert.equal(certifyReplayHygiene(src,dest,"openai-responses").accepted,false);
 assert.equal(certifyReplayHygiene(src,dest,"openai-responses",{allowSyntheticReasoningRemoval:true}).accepted,true);
});
test("30E: mixed text cleanup must preserve real reasoning and non-text metadata",()=>{
 const p={type:"message",role:"assistant",status:"completed",content:[
  {type:"output_text",text:"<think>reasoning unavailable\n<dy>Actual text",annotations:[]}]};
 const cleaned={...p,content:[{...p.content[0],text:"<think><dy>Actual text"}]};
 const source={input:[reasoning(),p,call("a"),output("a")]};
 assert.equal(certifyReplayHygiene(source,{input:[source.input[0],cleaned,source.input[2],source.input[3]]},"openai-responses").accepted,true);
 const illegitimate={...p,content:[{...p.content[0],text:"<think>misleading replacement"}]};
 assert.equal(certifyReplayHygiene(source,{input:[source.input[0],illegitimate,source.input[2],source.input[3]]},"openai-responses").accepted,false);
});
test("30E: Chat Completions preserves signed, tool and history fields",()=>{
 const source={messages:[{role:"user",content:"Prompt"},{role:"assistant",reasoning_content:"reasoning unavailable",
  content:"<think>reasoning unavailable\n<dy>Actual text"},{role:"tool",tool_call_id:"a",content:"success"}]};
 const updated={...source,messages:[source.messages[0],{...source.messages[1],content:"<think><dy>Actual text"},source.messages[2]]};
 assert.equal(certifyReplayHygiene(source,updated,"openai-completions").accepted,true);
 const forgery={...updated,messages:[source.messages[0],updated.messages[1],{...source.messages[2],content:"fake"}]};
 assert.equal(certifyReplayHygiene(source,forgery,"openai-completions").accepted,false);
 const signed={messages:[{...source.messages[1],signature:"opaque"}]};
 const changed={messages:[{...signed.messages[0],content:"<think><dy>Actual text"}]};
 assert.equal(certifyReplayHygiene(signed,changed,"openai-completions").accepted,false);
});
test("30E: diagnostics are structured and never copy injected paths, credentials or reasoning",()=>{
 const source=formatRedactedIntegrityReport({
  hygiene:{removedVisiblePlaceholders:1,retainedReasoningItems:133,removedSyntheticReasoningItems:0},
  certification:{accepted:false},mode:"openai-responses",decision:{reason:"reasoning unavailable JWT token=top-secret"}
 });
 assert.equal(source.reasoningReplay,"preserved-uncertain");
 assert.equal(source.stopClass,"unverified");
 assert.equal(source.replayItemsRetained,133);
 assert.doesNotMatch(JSON.stringify(source),/secret|JWT|reasoning unavailable/);
});
test("30E: recovery refuses corrupt checkpoint and latest-branch stale response",()=>{
 const sessionId="omp-test",cwd="/workspace/rugby";
 const cp=createExecutionCheckpoint({sessionId,cwd,promptText:"Implement Release C"});
 const started=transitionExecutionCheckpoint(cp,{type:"attempt",step:"C1a"});
 const reasoningStop={role:"assistant",stopReason:"stop",content:[{type:"thinking",thinking:"reasoning unavailable"}]};
 const messages=[{role:"user",content:[{type:"text",text:"Implement C"}]},
  {role:"assistant",content:[{type:"toolCall",id:"x",name:"bash",arguments:{}}]},
  {role:"toolResult",toolCallId:"x",content:[{type:"text",text:"ok"}]},reasoningStop];
 const branch=[
  {type:"custom",id:"anchor",customType:PIFROST_CHECKPOINT_TYPE,data:cp},
  {type:"custom",id:"step",customType:PIFROST_CHECKPOINT_TYPE,data:started},
  {type:"message",id:"last",message:reasoningStop},
 ];
 const event={session_id:sessionId,signal:new AbortController().signal,stop_hook_active:false,
  messages,last_assistant_message:reasoningStop};
 const plan=(b=branch,e=event)=>planIntelligentRecovery({event:e,branch:b,sessionId,cwd});
 assert.equal(plan().action,"continue");
 assert.equal(plan([...branch,{type:"custom",customType:PIFROST_CHECKPOINT_TYPE,
  data:{...started,plan:{reference:"../secret"}}}]).action,"none");
 assert.equal(plan([...branch,{type:"custom",customType:PIFROST_RECOVERY_ATTEMPT_TYPE,
  data:{anchor:"anchor",ordinal:1,sessionKey:"x"}}]).reason,"corrupt-recovery-journal");
 assert.equal(plan([...branch.slice(0,-1),{type:"message",id:"different",
  message:{...reasoningStop,content:[{type:"text",text:"Looks finished"}]}}]).reason,"assistant-journal-unverified");
});
test("30E: duplicate tool IDs and mismatched journal settle never permit auto-continuation",()=>{
 const sessionId="session",cwd="/repo";
 const cp=createExecutionCheckpoint({sessionId,cwd,promptText:"Implement Release D"});
 const arr=[{id:"a",type:"custom",customType:PIFROST_CHECKPOINT_TYPE,data:cp},
  {id:"last",type:"message",message:{role:"assistant",stopReason:"stop",content:[]}}];
 const user={role:"user"}, tool={role:"assistant",content:[{type:"toolCall",id:"same"}]};
 const result={role:"toolResult",toolCallId:"same",content:[]},last=arr.at(-1).message;
 const event={session_id:sessionId,messages:[user,tool,tool,result,result,last],last_assistant_message:last};
 assert.equal(planIntelligentRecovery({event,branch:arr,sessionId,cwd}).reason,"unpaired-or-uncertain-tools");
});
test("30E: OMP opaque family identity can be non-string and is never persisted",()=>{
 const a={provider:"x",id:"a"},b={provider:"y",id:"b"};
 const families=new Map([["a",{family:"one"}],["b",{family:"two"}]]);
 const tokenMap=new Map([[a,Symbol.for("a")],[b,Symbol.for("b")]]);
 assert.equal(recoveryFamilyCandidate(a,b,m=>tokenMap.get(m)),true);
 assert.equal(recoveryFamilyCandidate(a,b,()=>undefined),false);
 assert.equal(recoveryFamilyCandidate(a,b,()=>null),false);
 assert.equal(recoveryFamilyCandidate(a,b,()=>Symbol.for("same")),false);
});
test("30E: incident-grade diagnosis is branch-scoped, redacted and not proof of completion",()=>{
 const sessionId="sess-A",cwd="/private/workspace/repo";
 const cp=createExecutionCheckpoint({sessionId,cwd,promptText:"User confidential plan with tokens secret"});
 const active=transitionExecutionCheckpoint(cp,{type:"attempt",step:"build"});
 const branch=[{type:"custom",id:"anchor",customType:PIFROST_CHECKPOINT_TYPE,data:cp},
  {type:"custom",id:"step",customType:PIFROST_CHECKPOINT_TYPE,data:active},
  {type:"message",id:"last",message:{role:"assistant",stopReason:"stop",
    content:[{type:"thinking",thinking:"reasoning unavailable"}]}}];
 const report=diagnoseExecutionBranch({branch,sessionId,cwd,contextTokens:614978,contextWindow:1000000,mode:"auto"});
 assert.equal(report.lastAssistantStop,"REASONING_ONLY_STOP");
 assert.equal(report.contextTokens,614978);
 assert.equal(report.contextWindowVerified,false);
 assert.equal(report.pendingVerification,true);
 assert.equal(report.taskCompleted,"unverified");
 const rendered=formatExecutionDiagnosis(report);
 assert.match(rendered,/recovery mode: auto/);
 assert.doesNotMatch(JSON.stringify(report)+rendered,/confidential|secret|\/private\/workspace|sess-A|anchor/);
});
