/** OMP lifecycle adapter for Release 30C. No model retries or automatic tool replay. */
import { createExecutionCheckpoint, restoreExecutionCheckpoint,
  transitionExecutionCheckpoint, observeExecutionTurn, checkpointSummary,
  checkpointResumeText, PIFROST_CHECKPOINT_TYPE } from "./execution-checkpoint.mjs";
import { commitExecutionCheckpoint } from "./checkpoint-mirror.mjs";

const identity = ctx => ({sessionId:ctx.sessionManager.getSessionId(),cwd:ctx.cwd});
const history = ctx => {
  const entries=ctx?.sessionManager?.getBranch?.();
  if (!Array.isArray(entries)) throw new Error("OMP branch journal unavailable; checkpoint operation refused");
  return entries;
};
const main = ctx => ctx?.agent?.kind==="main";
const toolResultsAfter = branch => {
  let start=-1;
  for(let i=0;i<branch.length;i++) {
    const e=branch[i];
    if(e?.type==="custom" && e.customType===PIFROST_CHECKPOINT_TYPE) start=i;
  }
  return branch.slice(start+1).filter(e=>e?.type==="message" && e.message?.role==="toolResult")
    .map(()=>({role:"toolResult"}));
};

export function createCheckpointLifecycle({appendEntry,mirror,onMirrorError=()=>{}}) {
  const lastNotice = new Set();
  const read = ctx => main(ctx)?restoreExecutionCheckpoint(history(ctx),identity(ctx)):null;
  const persist = (ctx,state) => commitExecutionCheckpoint(state,{
    appendEntry,mirror,onMirrorError:error=>{
      const id=ctx.sessionManager.getSessionId();
      if(!lastNotice.has(id)){lastNotice.add(id);onMirrorError(error);}
    },
  });
  return {
    read,
    restore(ctx) {
      if (!main(ctx)) return null;
      return read(ctx); // Always reconstruct from current OMP branch, never a global last-session pointer.
    },
    begin(ctx,reference,promptText) {
      if (!main(ctx)) throw new Error("Only main OMP sessions can own a checkpoint");
      history(ctx);
      return persist(ctx,createExecutionCheckpoint({...identity(ctx),
        ...(reference?{planReference:reference}:{}),...(promptText?{promptText}:{})}));
    },
    autoBegin(ctx,prompt) {
      if (!main(ctx) || typeof prompt!=="string") return null;
      const namedRelease=/\bimplement\s+(?:(?:release|phase)\s+[\w-]+|\d+[a-z]|[a-z]\d+[a-z]?)\b/iu.test(prompt);
      if (!(prompt.length>=1500 || namedRelease)) return null;
      const existing=read(ctx);
      if (existing?.status==="active") {
        // Only an explicitly named NEW release can supersede a previous
        // auto-checkpoint. Generic follow-ups and operator plans retain state.
        if (!namedRelease || existing.plan.origin==="operator") return null;
        const next=createExecutionCheckpoint({...identity(ctx),promptText:prompt});
        if (next.plan.sha256===existing.plan.sha256) return null;
      }
      return this.begin(ctx,undefined,prompt);
    },
    transition(ctx,action) {
      if (!main(ctx)) throw new Error("Checkpoint mutations require a main OMP session");
      const current=read(ctx);
      if(!current) throw new Error("No branch checkpoint: run /pifrost checkpoint begin <plan-reference>");
      return persist(ctx,transitionExecutionCheckpoint(current,action));
    },
    afterTurn(ctx) {
      if (!main(ctx)) return null;
      const branch=history(ctx),current=restoreExecutionCheckpoint(branch,identity(ctx));
      if (!current || current.status!=="active") return current;
      const observation=observeExecutionTurn(current,toolResultsAfter(branch));
      if (observation===current) return current;
      return persist(ctx,observation);
    },
    compactionContext(ctx) {
      const current=read(ctx);
      if (!current || current.status!=="active") return null;
      return "Pifrost checkpoint (unverified task metadata, not proof of completed work): "+
        checkpointSummary(current)+". Review the OMP session's original plan and workspace before acting.";
    },
    status(ctx) {return checkpointSummary(read(ctx));},
    resumeText(ctx) {
      const current=read(ctx);
      if (!current) throw new Error("No checkpoint on the active branch");
      return checkpointResumeText(current);
    },
  };
}
