/**
 * Release 30D: bounded, OMP-owned session_stop continuation.
 * Never injects provider wire messages, replays tools, or infers task completion.
 * A checkpoint plus nonproductive settled output is a necessary (not sufficient) condition.
 */
import { createHash } from "node:crypto";
import { inspectOutput } from "./execution-observation.mjs";
import { PIFROST_CHECKPOINT_TYPE, validExecutionCheckpoint } from "./execution-checkpoint.mjs";
import { recoveryEpisodeState, nextRecoveryEpisode, PIFROST_RECOVERY_EPISODE_TYPE } from "./recovery-episodes.mjs";

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
    // A corrupt latest checkpoint cannot silently resurrect an older,
    // otherwise valid state from this very branch.
    if (!validExecutionCheckpoint(entry.data,{sessionId,cwd})) return null;
    if (entry.data.revision===1 && small(entry.id,160)) anchor=entry.id;
    checkpoint=entry.data; index=i;
  }
  if (!anchor || !checkpoint || index<0) return null;
  return {anchor,checkpoint};
}
export function readRecoveryAttempts(branch,scope,sessionId,cwd) {
  return recoveryEpisodeState(branch,scope,sessionId,cwd)?.records ?? null;
}
function latestAssistantEntry(branch, last) {
  if (!Array.isArray(branch)) return null;
  for(let i=branch.length-1;i>=0;i--){
    const e=row(branch[i]);
    if(e?.type==="message" && e.message?.role==="assistant" && small(e.id,160)){
      // The stop-hook response must be the actual latest journal assistant.
      // Otherwise stale or concurrently changed history cannot authorize work.
      // Any later journal message (especially a user resume or tool outcome)
      // invalidates a settlement snapshot; checkpoint metadata may follow.
      if(branch.slice(i+1).some(v=>v?.type==="message"))return null;
      if(e.message.stopReason!==last?.stopReason)return null;
      try {
        if(JSON.stringify(e.message.content)!==JSON.stringify(last.content))return null;
      } catch {return null;}
      return e.id;
    }
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
          else if(calls.has(id))uncertain=true;
          else calls.add(id);
        }
      }
    }
    if(isToolResult(msg)){
      hasTool=true;
      const id=msg.toolCallId ?? msg.tool_call_id ?? msg.call_id;
      if(!small(id,200)) uncertain=true;
      else if(results.has(id))uncertain=true;
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
/**
 * OMP's current journal must corroborate the tool work reported by the stop
 * event. A forged/stale event, lost tool result or duplicate OMP call ID is
 * not authority to issue another continuation.
 */
function journalToolsMatchSettlement(branch,scope,messages) {
  const anchorIndex=branch.findIndex(e=>e?.type==="custom" &&
    e.customType===PIFROST_CHECKPOINT_TYPE && e.id===scope.anchor);
  if(anchorIndex<0 || !Array.isArray(messages))return false;
  const latestUser=messages.findLastIndex(m=>row(m)?.role==="user");
  if(latestUser<0)return false;
  const calls=new Set(),results=new Set();
  const seenCalls=new Set(),seenResults=new Set();
  for(const m of messages.slice(latestUser)) {
    if(m?.role==="assistant" && Array.isArray(m.content))
      for(const c of m.content)if(toolKind(c?.type))calls.add(c.id??c.call_id);
    if(isToolResult(m))results.add(m.toolCallId??m.tool_call_id??m.call_id);
  }
  if(!calls.size || !results.size)return false;
  for(const e of branch.slice(anchorIndex+1)){
    if(e?.type!=="message")continue;
    const m=row(e.message);if(!m)return false;
    if(m.role==="assistant" && Array.isArray(m.content)) {
      for(const c of m.content)if(toolKind(c?.type)) {
        const id=c.id??c.call_id;
        if(!small(id,200) || seenCalls.has(id))return false;
        seenCalls.add(id);
      }
    }
    if(isToolResult(m)){
      const id=m.toolCallId??m.tool_call_id??m.call_id;
      if(!small(id,200) || seenResults.has(id))return false;
      seenResults.add(id);
    }
  }
  return [...calls].every(id=>seenCalls.has(id) && seenResults.has(id)) &&
    [...results].every(id=>seenCalls.has(id) && seenResults.has(id));
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
  const ledger=recoveryEpisodeState(branch,scope,sessionId,cwd,MAX_RECOVERY_CONTINUATIONS);
  if(!ledger)return reject("corrupt-recovery-journal");
  if(event.stop_hook_active && ledger.records.length===0)return reject("other-stop-hook-active");
  const previous=ledger.records;
  const messages=Array.isArray(event.messages)?event.messages:[];
  const last=row(event.last_assistant_message) ?? row(messages.at(-1));
  if(last?.role!=="assistant" || last.stopReason!=="stop")return reject("not-successful-terminal-stop",ledger.episodeAttempts);
  const output=inspectOutput([{type:"message",role:"assistant",content:last.content}],last.stopReason);
  if(!["REASONING_ONLY_STOP","EMPTY_STOP","LEAKED_THINKING_STOP"].includes(output.reason))return reject("productive-or-ambiguous-answer",ledger.episodeAttempts);
  const assistantEntryId=latestAssistantEntry(branch,last);
  if(!assistantEntryId)return reject("assistant-journal-unverified",ledger.episodeAttempts);
  // A hook firing twice must never create two episodes for the same settlement.
  if(previous.at(-1)?.assistantEntryId===assistantEntryId)return reject("duplicate-settle",ledger.episodeAttempts);
  if(uncertainTools)return reject("uncertain-tool-outcome",ledger.episodeAttempts);
  const activity=actionActivity(messages);
  if(activity.uncertain)return reject("unpaired-or-uncertain-tools",ledger.episodeAttempts);
  if(!activity.recentTools)return reject("no-recent-tool-activity",ledger.episodeAttempts);
  if(!journalToolsMatchSettlement(branch,scope,messages))
    return reject("assistant-journal-tools-unverified",ledger.episodeAttempts);
  const work=scope.checkpoint.pendingVerification ||
    scope.checkpoint.steps.some(s=>s.status!=="verified") || activity.recentTools;
  if(!work)return reject("no-outstanding-work-evidence",ledger.episodeAttempts);
  const episode=nextRecoveryEpisode(ledger,scope.anchor);
  const attempts=episode.attempts;
  if(mode!=="auto")return {action:"notice",reason:output.reason,attempts,episodeKey:episode.episodeKey};
  if(attempts>=MAX_RECOVERY_CONTINUATIONS)return {action:"exhausted",reason:"budget-exhausted",attempts,episodeKey:episode.episodeKey};
  const stage=attempts===0?"native":attempts===1?"context":"model";
  if(stage==="model" && !allowModelFallback)
    return {action:"exhausted",reason:"model-fallback-not-authorized",attempts,episodeKey:episode.episodeKey};
  const ordinal=attempts+1;
  const usage=Number.isFinite(contextTokens)&&contextTokens>=0?contextTokens:null;
  const window=Number.isFinite(contextWindow)&&contextWindow>0?contextWindow:null;
  // Existing 30D pressure hint, not an input/output limit or forced compaction.
  const contextPressure=usage!==null&&(usage>=120_000 || (window!==null && usage/window>=0.65));
  const focus=[
    "Pifrost 30F recovery "+ordinal+"/"+MAX_RECOVERY_CONTINUATIONS+
      (episode.newEpisode?" (separate progress-verified episode)":"")+": the model ended with "+
      output.reason+" after paired tool results. This is not proof of task completion.",
    "Continue the EXISTING user request in this OMP session. Consult the original user instruction and OMP plan; reconcile the CURRENT workspace, git state and tests before making changes.",
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
  // V1 journal entries remain immutable. New V2 entries encode their episode
  // and proof without storing any raw prompt, tool output or reasoning.
  const record={schemaVersion:2,sessionKey:digest(sessionId),anchor:scope.anchor,
    episodeKey:episode.episodeKey,proof:episode.proof,
    ordinal,stage,assistantEntryId,reason:output.reason};
  return {action:"continue",reason:output.reason,stage,attempts:ordinal,
    additionalContext:focus.join("\n"),record,contextPressure,episodeKey:episode.episodeKey};
}
export function formatIntelligentRecoveryStatus({branch,sessionId,cwd,mode}={}){
  const scope=locateRecoveryScope(branch,sessionId,cwd);
  if(!scope)return "Pifrost 30F: no active branch checkpoint; no automatic continuation will occur.";
  const state=recoveryEpisodeState(branch,scope,sessionId,cwd,MAX_RECOVERY_CONTINUATIONS);
  if(!state)return "Pifrost 30F: recovery journal invalid; automatic continuation blocked. Inspect /pifrost recovery diagnose.";
  const episode=nextRecoveryEpisode(state,scope.anchor);
  return "Pifrost 30F mode "+mode+"; current episode "+episode.attempts+"/"+MAX_RECOVERY_CONTINUATIONS+
    "; historical attempts "+state.records.length+
    "; checkpoint "+scope.checkpoint.status+"; plan "+scope.checkpoint.plan.reference+
    ". Existing session and checkpoint are preserved. After a safety stop, use /pifrost checkpoint resume "+
    "to insert a reconcile-first prompt without auto-submitting it. OMP owns execution; Bifrost owns provider routing.";
}
