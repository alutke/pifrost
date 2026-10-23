import { inspectOutput, inspectContextUsage } from "./execution-observation.mjs";
import { locateRecoveryScope, readRecoveryAttempts, MAX_RECOVERY_CONTINUATIONS } from "./intelligent-stall-recovery.mjs";
const rec=x=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x:null;
const countStatus=(steps,status)=>Array.isArray(steps)?steps.filter(s=>s?.status===status).length:0;
export function diagnoseExecutionBranch({branch,sessionId,cwd,contextTokens,contextWindow,mode="unknown"}={}){
  const scope=locateRecoveryScope(branch,sessionId,cwd);
  const attempts=scope?readRecoveryAttempts(branch,scope,sessionId):[];
  let latest=null;
  if(Array.isArray(branch)){
    for(let i=branch.length-1;i>=0;i--){
      const entry=rec(branch[i]);
      if(entry?.type==="message"&&entry.message?.role==="assistant"){
        latest=entry.message;break;
      }
    }
  }
  const output=latest?inspectOutput([{type:"message",role:"assistant",content:latest.content}],latest.stopReason):null;
  const context=inspectContextUsage(contextTokens,contextWindow);
  return Object.freeze({
    schemaVersion:1,
    checkpoint:scope?.checkpoint.status??"unavailable",
    stepsVerified:countStatus(scope?.checkpoint.steps,"verified"),
    stepsAttempted:countStatus(scope?.checkpoint.steps,"attempted"),
    stepsFailed:countStatus(scope?.checkpoint.steps,"failed"),
    pendingVerification:scope?.checkpoint.pendingVerification??null,
    recoveryMode:["auto","off","notice"].includes(mode)?mode:"unknown",
    recoveryAttemptCount:attempts?.length??null,
    recoveryAttemptLimit:MAX_RECOVERY_CONTINUATIONS,
    journalTrust:!scope?"no-current-checkpoint":attempts===null?"invalid-recovery-journal":"active-branch",
    lastAssistantStop:output?.reason??"unknown",
    contextTokens:context.inputTokens,
    contextSeverity:context.severity,
    contextWindowVerified:false,
    // Do not disclose session/plan names, request contents, opaque reasoning
    // signatures, physical provider, tool args or file paths.
    taskCompleted:"unverified",
  });
}
export function formatExecutionDiagnosis(report){
  const p=report??{};
  return [
    "Pifrost 30E · redacted execution diagnosis",
    "  checkpoint: "+(p.checkpoint??"unavailable")+"; journal: "+(p.journalTrust??"unknown"),
    "  steps: "+(p.stepsVerified??0)+" verified / "+(p.stepsAttempted??0)+" attempted / "+(p.stepsFailed??0)+" failed",
    "  verification pending: "+(p.pendingVerification===null?"unknown":String(p.pendingVerification)),
    "  recovery mode: "+(p.recoveryMode??"unknown")+"; attempts: "+
      (p.recoveryAttemptCount??"blocked")+"/"+(p.recoveryAttemptLimit??"unknown"),
    "  last assistant: "+(p.lastAssistantStop??"unknown"),
    "  estimated context: "+(p.contextTokens??"unavailable")+" tokens; "+(p.contextSeverity??"unknown"),
    "  task completed: unverified (requires current workspace and explicit evidence)",
  ].join("\n");
}
