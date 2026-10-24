/**
 * Release 30F: progress-gated recovery episodes in the authoritative OMP branch.
 * A recovery attempt is not a verified task milestone. Nothing here executes tools,
 * creates OMP messages, compacts history, or routes a provider request.
 */
import { createHash } from "node:crypto";
import { validExecutionCheckpoint, PIFROST_CHECKPOINT_TYPE } from "./execution-checkpoint.mjs";

export const PIFROST_RECOVERY_EPISODE_TYPE = "dev.pifrost.recovery-episode.v2";
export const LEGACY_RECOVERY_ATTEMPT_TYPE = "dev.pifrost.recovery-attempt.v1";
const hash = value => createHash("sha256").update(String(value)).digest("hex");
const obj = x => x && typeof x === "object" && !Array.isArray(x) ? x : null;
const safeId = x => typeof x==="string" && x.length>0 && x.length<=200 &&
  !/[\x00-\x1f\x7f]/u.test(x);
const hex = x => typeof x==="string" && /^[a-f0-9]{64}$/u.test(x);
const isResult = m => ["toolResult","tool_result","function_call_output"].includes(m?.role);
const isCall = c => ["toolCall","tool_call","function_call"].includes(c?.type);
const stages = ["native","context","model"];
const initialProof = anchor => ({kind:"initial",entryId:anchor,fingerprint:hash("initial:"+anchor)});
const initialEpisode = anchor => hash("pifrost-episode:"+anchor+":initial");
const keyFor = (anchor,proof) => hash("pifrost-episode:"+anchor+":"+proof.entryId+":"+proof.fingerprint);
const signature = call => {
  try {
    // Digest only; no arguments, transcripts or results are persisted.
    return hash(JSON.stringify([call.name??"",call.arguments??call.input??null]));
  } catch { return null; }
};
const toolUncertain = msg => {
  if (msg?.isError !== true) return false;
  const pieces = Array.isArray(msg.content) ? msg.content : [];
  return pieces.some(p=>/(?:timeout|timed out|connection reset|broken pipe|socket hang up|econnreset|etimedout|response lost|uncertain outcome)/iu.test(String(p?.text??"")));
};
/** Pairs are accepted only when both journal entries exist in the same inspected range. */
function pairs(branch,start,end) {
  const pending=new Map(), completed=[], seen=new Set();
  for (let i=start;i<end;i++) {
    const e=obj(branch[i]);if(e?.type!=="message")continue;
    const m=obj(e.message);if(!m)return null;
    if(m.role==="assistant" && Array.isArray(m.content)) {
      for (const part of m.content) {
        const c=obj(part);if(!c||!isCall(c))continue;
        const id=c.id??c.call_id;
        if(!safeId(id) || seen.has(id))return null;
        const fp=signature(c);if(!fp)return null;
        seen.add(id);pending.set(id,{fingerprint:fp,callIndex:i});
      }
    } else if (isResult(m)) {
      const id=m.toolCallId??m.tool_call_id??m.call_id;
      if(!safeId(id)||!pending.has(id))return null;
      const call=pending.get(id);pending.delete(id);
      if(!safeId(e.id))return null;
      completed.push({kind:"paired-tool",entryId:e.id,fingerprint:call.fingerprint,
        resultIndex:i,uncertain:toolUncertain(m),error:m.isError===true});
    }
  }
  if(pending.size)return null;
  return completed;
}
/**
 * Distinct completed tool calls are progression evidence, never evidence that a
 * write succeeded or that the task is done. Repeating an earlier exact tool
 * operation alone cannot continually replenish automatic retries.
 */
function evidenceSince(branch,anchorIndex,attemptIndex,end,scope,sessionId,cwd) {
  if(attemptIndex<anchorIndex || end<=attemptIndex)return null;
  const earlier=pairs(branch,anchorIndex+1,attemptIndex+1);
  const later=pairs(branch,attemptIndex+1,end);
  // Missing, split, duplicate or uncertain tool records cannot authorise a reset.
  if(!earlier || !later || later.some(p=>p.uncertain))return null;
  const signatures=new Set(earlier.map(p=>p.fingerprint));
  const candidates=later.filter(p=>!p.error && !signatures.has(p.fingerprint));
  const baselineCheckpoints=new Set();
  for(let i=anchorIndex;i<=attemptIndex;i++){
    const e=obj(branch[i]);
    if(e?.type==="custom" && e.customType===PIFROST_CHECKPOINT_TYPE &&
       validExecutionCheckpoint(e.data,cwd===undefined?undefined:{sessionId,cwd}))
      for(const step of e.data.steps)if(step.status==="verified")
        baselineCheckpoints.add(hash(JSON.stringify([step.id,step.evidence])));
  }
  for(let i=attemptIndex+1;i<end;i++){
    const e=obj(branch[i]);if(!e||!safeId(e.id))continue;
    if(e.type==="message" && e.message?.role==="user")
      candidates.push({kind:"user-resume",entryId:e.id,
        fingerprint:hash("user:"+e.id),resultIndex:i});
    if(e.type==="custom" && e.customType===PIFROST_CHECKPOINT_TYPE) {
      if(!validExecutionCheckpoint(e.data,cwd===undefined?undefined:{sessionId,cwd}))return null;
      for(const step of e.data.steps) {
        if(step.status!=="verified")continue;
        const fp=hash(JSON.stringify([step.id,step.evidence]));
        if(!baselineCheckpoints.has(fp))
          candidates.push({kind:"verified-step",entryId:e.id,fingerprint:fp,resultIndex:i});
      }
    }
  }
  // An explicit new user request is a stronger boundary than incidental tools
  // subsequently run in that request. It is not an automatic retry grant.
  const manual=candidates.filter(p=>p.kind==="user-resume")
    .sort((a,b)=>b.resultIndex-a.resultIndex)[0];
  const chosen=manual??candidates.sort((a,b)=>b.resultIndex-a.resultIndex)[0];
  return chosen?{kind:chosen.kind,entryId:chosen.entryId,fingerprint:chosen.fingerprint}:null;
}
function equalProof(a,b) {
  return a?.kind===b?.kind && a?.entryId===b?.entryId && a?.fingerprint===b?.fingerprint;
}
/**
 * Validates v1 as immutable legacy evidence and v2 as a chained, evidence-gated
 * episodic journal. Any unknown or malformed record under the active anchor
 * fails closed. Compacting/rewinding cannot import proof from another branch.
 */
export function recoveryEpisodeState(branch,{anchor},sessionId,cwd,limit=3) {
  if(!Array.isArray(branch)||!safeId(anchor)||!safeId(sessionId)||
     (cwd!==undefined && typeof cwd!=="string"))return null;
  const anchorIndex=branch.findIndex(e=>e?.type==="custom" &&
    e.customType===PIFROST_CHECKPOINT_TYPE && e.id===anchor);
  if(anchorIndex<0)return null;
  const records=[];
  let currentEpisode=initialEpisode(anchor),proof=initialProof(anchor),ordinal=0;
  let lastAttemptIndex=anchorIndex,hasV2=false;
  for(let i=anchorIndex+1;i<branch.length;i++) {
    const e=obj(branch[i]),d=obj(e?.data);
    if(e?.type!=="custom")continue;
    // Unknown future or corrupt recovery journal types must not silently
    // replenish capacity by being skipped.
    if(typeof e.customType==="string" && e.customType.startsWith("dev.pifrost.recovery-") &&
       ![LEGACY_RECOVERY_ATTEMPT_TYPE,PIFROST_RECOVERY_EPISODE_TYPE].includes(e.customType))return null;
    if(![LEGACY_RECOVERY_ATTEMPT_TYPE,PIFROST_RECOVERY_EPISODE_TYPE].includes(e.customType))continue;
    if(!d || d.anchor!==anchor || d.sessionKey!==hash(sessionId) ||
       !Number.isSafeInteger(d.ordinal) || d.ordinal<1 || d.ordinal>limit ||
       !safeId(d.assistantEntryId) || !stages.includes(d.stage) ||
       d.stage!==stages[d.ordinal-1] || !["REASONING_ONLY_STOP","EMPTY_STOP","LEAKED_THINKING_STOP"].includes(d.reason))return null;
    if(e.customType===LEGACY_RECOVERY_ATTEMPT_TYPE) {
      if(hasV2 || d.schemaVersion!==1 || d.ordinal!==ordinal+1)return null;
    } else {
      hasV2=true;
      if(d.schemaVersion!==2 || !hex(d.episodeKey) || !obj(d.proof) ||
         !["initial","paired-tool","verified-step","user-resume"].includes(d.proof.kind) ||
         !safeId(d.proof.entryId) || !hex(d.proof.fingerprint))return null;
      if(d.ordinal===1 && ordinal>0) {
        const candidate=evidenceSince(branch,anchorIndex,lastAttemptIndex,i,{anchor},sessionId,cwd);
        if(!candidate || !equalProof(candidate,d.proof) ||
           d.episodeKey!==keyFor(anchor,candidate))return null;
        currentEpisode=d.episodeKey;proof=candidate;ordinal=0;
      }
      if(d.ordinal!==ordinal+1 || d.episodeKey!==currentEpisode ||
         !equalProof(d.proof,proof))return null;
    }
    if(records.some(r=>r.data.assistantEntryId===d.assistantEntryId))return null;
    records.push({data:d,index:i,type:e.customType});
    ordinal=d.ordinal;
    lastAttemptIndex=i;
  }
  // A missing journal call/result pair or uncertain side effect after the last
  // consumed attempt blocks recovery; it cannot be treated as "no progress".
  if(records.length) {
    const tail=pairs(branch,lastAttemptIndex+1,branch.length);
    if(!tail || tail.some(p=>p.uncertain))return null;
  }
  // Initial legacy/v2 episodes share the same budget until genuine progress.
  return {records:records.map(r=>r.data),episodeAttempts:ordinal,
    episodeKey:currentEpisode,proof,lastAttemptIndex,anchorIndex,
    nextProgress:records.length?evidenceSince(branch,anchorIndex,lastAttemptIndex,
      branch.length,{anchor},sessionId,cwd):null};
}
export function nextRecoveryEpisode(state,anchor) {
  const progression=state.nextProgress;
  if(progression && state.records.length) return {
    episodeKey:keyFor(anchor,progression),proof:progression,attempts:0,newEpisode:true,
  };
  return {episodeKey:state.episodeKey,proof:state.proof,attempts:state.episodeAttempts,newEpisode:false};
}
