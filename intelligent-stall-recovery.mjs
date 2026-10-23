/**
 * Release 30D: bounded, OMP-owned session_stop continuation.
 * Never injects provider wire messages, replays tools, or infers task completion.
 * A checkpoint plus nonproductive settled output is a necessary (not sufficient) condition.
 */
import { createHash } from "node:crypto";
import { inspectOutput } from "./execution-observation.mjs";
import { PIFROST_CHECKPOINT_TYPE, validExecutionCheckpoint } from "./execution-checkpoint.mjs";

export const PIFROST_RECOVERY_ATTEMPT_TYPE = "dev.pifrost.recovery-attempt.v1";
export const DEFAULT_RECOVERY_CONTINUATIONS = 2;
export const MAX_RECOVERY_CONTINUATIONS = 3;
const digest = input => createHash("sha256").update(String(input)).digest("hex");
const row = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const small = (v,limit=128) => typeof v === "string" && v.length > 0 && v.length <= limit && !/[\x00-\x1f\x7f]/u.test(v);
const toolKind = t => t === "toolCall" || t === "tool_call" || t === "function_call";
const isToolResult = m => m?.role === "toolResult" || m?.role === "tool_result" || m?.role === "function_call_output";

export function intelligentRecoveryMode(explicit, previous) {
  const value = explicit?.trim().toLowerCase();
  if (value === "auto" || value === "notice" || value === "off") return value;
  if (value) return "notice"; // Bad explicit input cannot silently turn on retries.
  const legacy = previous?.trim().toLowerCase();
  if (["off","0","false","no","disabled","disable"].includes(legacy)) return "off";
  if (legacy && !["auto","enabled","enable","on","yes","true","1"].includes(legacy)) return "notice";
  return "auto";
}
export function locateRecoveryScope(branch, sessionId, cwd) {
  if (!Array.isArray(branch) || !small(sessionId,1024) || !small(cwd,4096)) return null;
  let anchor=null, checkpoint=null, index=-1;
  for (let i=0;i<branch.length;i++) {
    const entry=row(branch[i]);
    if (entry?.type !== "custom" || entry.customType !== PIFROST_CHECKPOINT_TYPE) continue;
    if (!validExecutionCheckpoint(entry.data,{sessionId,cwd})) continue;
    if (entry.data.revision===1 && small(entry.id,160)) anchor=entry.id;
    checkpoint=entry.data; index=i;
  }
  if (!anchor || !checkpoint || index<0) return null;
  return {anchor,checkpoint};
}
export function readRecoveryAttempts(branch, scope, sessionId) {
  if (!Array.isArray(branch) || !scope || !small(sessionId,1024)) return [];
  const key=digest(sessionId);
  const matches=[];
  for (const v of branch) {
    const e=row(v), d=row(e?.data);
    if (e?.type!=="custom" || e.customType!==PIFROST_RECOVERY_ATTEMPT_TYPE || !d) continue;
    if (d.schemaVersion!==1 || d.sessionKey!==key || d.anchor!==scope.anchor ||
        !Number.isSafeInteger(d.ordinal) || d.ordinal<1 || d.ordinal>MAX_RECOVERY_CONTINUATIONS ||
        !small(d.assistantEntryId,160) || !["native","context","model"].includes(d.stage)) continue;
    matches.push(d);
  }
  // Only a contiguous, ordered sequence is trusted; a corrupt ledger blocks extra retries.
  for(let i=0;i<matches.length;i++) if(matches[i].ordinal!==i+1) return null;
  return matches;
}
function latestAssistantEntry(branch) {
  if (!Array.isArray(branch)) return null;
  for(let i=branch.length-1;i>=0;i--){
    const e=row(branch[i]);
    if(e?.type==="message" && e.message?.role==="assistant" && small(e.id,160)) return e.id;
  }
  return null;
}
function actionActivity(messages) {
  const list=Array.isArray(messages)?messages:[];
  const latestUser=list.findLastIndex(m=>row(m)?.role==="user");
  if(latestUser<0) return {recentTools:false,uncertain:true};
  const turn=list.slice(latestUser);
  const calls=new Set(), results=new Set();
  let hasTool=false, uncertain=false;
  for(const m of turn){
    const msg=row(m);if(!msg)continue;
    if(msg.role==="assistant" && Array.isArray(msg.content)){
      for(const c of msg.content){
        const part=row(c);
        if(part && toolKind(part.type)){
          const id=part.id ?? part.call_id;
          if(!small(id,200)) uncertain=true;
          else calls.add(id);
        }
      }
    }
    if(isToolResult(msg)){
      hasTool=true;
      const id=msg.toolCallId ?? msg.tool_call_id ?? msg.call_id;
      if(!small(id,200)) uncertain=true;
      else results.add(id);
      if(msg.isError && Array.isArray(msg.content) &&
          msg.content.some(c=>/timeout|connection reset|broken pipe|socket hang up|econnreset|outcome unknown/iu.test(String(c?.text??""))))
        uncertain=true;
    }
  }
  if(calls.size!==results.size || [...calls].some(id=>!results.has(id)) ||
     [...results].some(id=>!calls.has(id))) uncertain=true;
  return {recentTools:hasTool,uncertain};
}
function lastModelText(msg) {
  if(!Array.isArray(msg?.content))return "";
  return msg.content.filter(c=>c?.type==="text"||c?.type==="output_text")
    .map(c=>typeof c.text==="string"?c.text:"").join("\n");
}
/**
 * No unrestricted "task incomplete" inference. Automatic continuance requires:
 * active 30C plan + tool-using current user turn + terminal no-action model stop.
 */
export function planIntelligentRecovery({event,branch,sessionId,cwd,mode="auto",uncertainTools=false,
  queued=false,running=false,interrupted=false,contextTokens=null,contextWindow=null,
  allowModelFallback=false}={}) {
  const reject=(reason,attempts=0)=>({action:"none",reason,attempts});
  if(mode==="off")return reject("disabled");
  if(!event || event.signal?.aborted || interrupted)return reject("user-interrupt");
  if(queued || running)return reject("omp-owns-continuation");
  if(event.session_id!==sessionId)return reject("session-mismatch");
  const scope=locateRecoveryScope(branch,sessionId,cwd);
  if(!scope)return reject("no-branch-checkpoint");
  if(scope.checkpoint.status!=="active")return reject("checkpoint-closed");
  const previous=readRecoveryAttempts(branch,scope,sessionId);
  if(!previous)return reject("corrupt-recovery-journal");
  const attempts=previous.length;
  if(event.stop_hook_active && attempts===0)return reject("other-stop-hook-active");
  const messages=Array.isArray(event.messages)?event.messages:[];
  const last=row(event.last_assistant_message) ?? row(messages.at(-1));
  if(last?.role!=="assistant" || last.stopReason!=="stop")return reject("not-successful-terminal-stop",attempts);
  const assistantEntryId=latestAssistantEntry(branch);
  if(!assistantEntryId)return reject("assistant-journal-unverified",attempts);
  if(previous.at(-1)?.assistantEntryId===assistantEntryId)return reject("duplicate-settle",attempts);
  if(uncertainTools)return reject("uncertain-tool-outcome",attempts);
  const activity=actionActivity(messages);
  if(activity.uncertain)return reject("unpaired-or-uncertain-tools",attempts);
  if(!activity.recentTools)return reject("no-recent-tool-activity",attempts);
  const output=inspectOutput([{type:"message",role:"assistant",content:last.content}],last.stopReason);
  if(!["REASONING_ONLY_STOP","EMPTY_STOP"].includes(output.reason))return reject("productive-or-ambiguous-answer",attempts);
  const work=scope.checkpoint.pendingVerification ||
    scope.checkpoint.steps.some(s=>s.status!=="verified") || activity.recentTools;
  if(!work)return reject("no-outstanding-work-evidence",attempts);
  if(mode!=="auto")return {action:"notice",reason:output.reason,attempts};
  if(attempts>=MAX_RECOVERY_CONTINUATIONS)return {action:"exhausted",reason:"budget-exhausted",attempts};
  const stage=attempts===0?"native":attempts===1?"context":"model";
  if(stage==="model" && !allowModelFallback)
    return {action:"exhausted",reason:"model-fallback-not-authorized",attempts};
  const ordinal=attempts+1;
  const usage=Number.isFinite(contextTokens)&&contextTokens>=0?contextTokens:null;
  const window=Number.isFinite(contextWindow)&&contextWindow>0?contextWindow:null;
  const contextPressure=usage!==null&&(usage>=120_000 || (window!==null && usage/window>=0.65));
  const focus=[
    "Pifrost 30D recovery "+ordinal+"/"+MAX_RECOVERY_CONTINUATIONS+": the model ended with "+
      output.reason+" after paired tool results. This is not proof of task completion.",
    "Continue the EXISTING user request. Re-read the original OMP plan and inspect the CURRENT git tree, tests and TODOs.",
    "Do not repeat tool writes, commits, publishes or other side effects without checking whether they already happened.",
    "30C checkpoint reference: "+scope.checkpoint.plan.reference+"; "+
      scope.checkpoint.steps.filter(s=>s.status==="verified").length+"/"+scope.checkpoint.steps.length+
      " steps operator-verified; pending verification: "+scope.checkpoint.pendingVerification+".",
    "If complete, report only verified results. If blocked, stop and explain instead of looping.",
  ];
  if(stage==="context") focus.push(contextPressure
    ?"OMP context pressure observed; rely on OMP-native compaction policy before the next model request. Preserve active plan and tool-result pairing."
    :"Use a concise reconstruction from the active 30C checkpoint; no bulk history replay.");
  if(stage==="model")focus.push("One explicitly authorized different-family OMP model selection was made; Bifrost remains responsible for its physical routing.");
  const record={schemaVersion:1,sessionKey:digest(sessionId),anchor:scope.anchor,
    ordinal,stage,assistantEntryId,reason:output.reason};
  return {action:"continue",reason:output.reason,stage,attempts:ordinal,
    additionalContext:focus.join("\n"),record,contextPressure};
}
export function formatIntelligentRecoveryStatus({branch,sessionId,cwd,mode}={}){
  const scope=locateRecoveryScope(branch,sessionId,cwd);
  if(!scope)return "Pifrost 30D: no active branch checkpoint; no automatic continuation will occur.";
  const attempts=readRecoveryAttempts(branch,scope,sessionId);
  if(!attempts)return "Pifrost 30D: recovery journal invalid; automatic continuation blocked.";
  return "Pifrost 30D mode "+mode+"; attempt budget "+attempts.length+"/"+MAX_RECOVERY_CONTINUATIONS+
    "; plan "+scope.checkpoint.plan.reference+"; checkpoint "+scope.checkpoint.status+
    ". OMP retains compaction and Bifrost retains physical routing.";
}
