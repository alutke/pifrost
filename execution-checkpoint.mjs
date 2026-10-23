/** Release 30C: bounded branch-scoped execution metadata, independent of the model transcript. */
import { createHash } from "node:crypto";

export const PIFROST_CHECKPOINT_TYPE = "dev.pifrost.execution-checkpoint.v1";
const MAX_STEPS = 64, MAX_TEXT = 180, MAX_RECORD_BYTES = 20_000;
const sha = text => createHash("sha256").update(text).digest("hex");
const safe = (text, limit = MAX_TEXT) =>
  typeof text === "string" && text.length > 0 && text.length <= limit &&
  !/[\x00-\x1f\x7f]/u.test(text) && !/\b(?:bearer|token|password|secret|api[_-]?key)\s*[=:]/iu.test(text);
const ref = text => safe(text, 240) && !/(?:^\/|(^|\/)\.\.(?:\/|$)|:\/\/|[?&#=])/u.test(text);
const isoNow = () => new Date().toISOString();
const entry = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;

export function createExecutionCheckpoint({ sessionId, cwd, planReference, promptText } = {}) {
  if (!safe(sessionId,1024) || !safe(cwd,4096)) throw new Error("An active OMP session and workspace are required");
  if (planReference !== undefined && !ref(planReference)) throw new Error("Plan reference must be a safe relative file path or identifier, not a URL or secret");
  if (planReference === undefined && typeof promptText !== "string") throw new Error("Plan reference or user prompt is required");
  const state = {
    schemaVersion:1, sessionKey:sha(sessionId), workspaceKey:sha(cwd),
    revision:1, updatedAt:isoNow(), status:"active",
    plan:{ reference:planReference ?? "omp-session-user-prompt", origin:planReference ? "operator" : "session",
      ...(typeof promptText === "string" ? {sha256:sha(promptText),characters:promptText.length}: {}) },
    steps:[], lastObservation:null, pendingVerification:false,
    // This is a task-tracking record; it cannot establish workspace correctness.
    verificationAuthority:"explicit-evidence-only",
  };
  return Object.freeze(state);
}
export function validExecutionCheckpoint(value, identity) {
  const v=entry(value);
  if (!v || v.schemaVersion!==1 || !safe(v.sessionKey,64) ||
      !/^[a-f0-9]{64}$/u.test(v.sessionKey) || !/^[a-f0-9]{64}$/u.test(v.workspaceKey ?? "") ||
      !Number.isSafeInteger(v.revision) || v.revision<1 || v.revision>100000 ||
      !["active","complete","superseded"].includes(v.status) ||
      !entry(v.plan) || !ref(v.plan.reference) ||
      !Array.isArray(v.steps) || v.steps.length>MAX_STEPS || typeof v.pendingVerification!=="boolean" ||
      v.verificationAuthority!=="explicit-evidence-only" ||
      (identity && (v.sessionKey!==sha(identity.sessionId) || v.workspaceKey!==sha(identity.cwd)))) return false;
  if (v.steps.some(s=>!entry(s)||!safe(s.id,MAX_TEXT)||
      !["attempted","verified","failed"].includes(s.status)||
      (s.status==="verified" && !ref(s.evidence)))) return false;
  try { return Buffer.byteLength(JSON.stringify(v),"utf8")<=MAX_RECORD_BYTES; }
  catch { return false; }
}
export function restoreExecutionCheckpoint(branch, identity) {
  if (!Array.isArray(branch)) return null;
  let found=null;
  for (const raw of branch) {
    const e=entry(raw);
    if (e?.type==="custom" && e.customType===PIFROST_CHECKPOINT_TYPE &&
        validExecutionCheckpoint(e.data,identity)) found=e.data;
  }
  return found;
}
function update(state, changed) {
  if (!validExecutionCheckpoint(state)) throw new Error("Invalid checkpoint; no update applied");
  if (state.revision>=100000) throw new Error("Checkpoint revision limit reached");
  const next={...state,...changed,revision:state.revision+1,updatedAt:isoNow()};
  if (!validExecutionCheckpoint(next)) throw new Error("Checkpoint would exceed bounds");
  return Object.freeze(next);
}
export function transitionExecutionCheckpoint(state, action) {
  const a=entry(action);
  if (!a || !["attempt","verify","fail","complete","supersede"].includes(a.type)) throw new Error("Unsupported checkpoint transition");
  if (state.status==="superseded" || state.status==="complete")
    throw new Error("Checkpoint is closed; begin a new plan for additional work");
  if (a.type==="complete") {
    if (!state.steps.length || state.steps.some(s=>s.status!=="verified") || state.pendingVerification)
      throw new Error("Cannot claim completion: unverified steps or tool activity remain");
    return update(state,{status:"complete"});
  }
  if (a.type==="supersede") return update(state,{status:"superseded"});
  if (!safe(a.step)) throw new Error("Step identifier must be short, non-secret text");
  const existing=state.steps.findIndex(s=>s.id===a.step);
  if (existing<0 && state.steps.length>=MAX_STEPS) throw new Error("Checkpoint step limit reached");
  if (a.type==="verify" && !ref(a.evidence)) throw new Error("Verification requires a bounded evidence reference");
  if (a.type==="verify" && existing<0) throw new Error("Attempt the step before verifying it");
  const steps=state.steps.map(s=>({...s}));
  const row={id:a.step,status:a.type==="verify"?"verified":a.type==="fail"?"failed":"attempted",
    ...(a.type==="verify"?{evidence:a.evidence}:{})};
  if (existing>=0) steps[existing]=row;
  else steps.push(row);
  return update(state,{steps,pendingVerification:a.type==="verify"?
    steps.some(s=>s.status!=="verified"):true});
}
export function observeExecutionTurn(state, messages) {
  if (!validExecutionCheckpoint(state) || state.status!=="active" || !Array.isArray(messages)) return state;
  const tools=messages.filter(m=>entry(m)?.role==="toolResult"||entry(m)?.role==="tool_result").length;
  if (!tools) return state;
  const observation={kind:"tool-results-observed",count:Math.min(1000,tools),at:isoNow(),
    note:"Execution observed, not verified; inspect repository and tests before marking complete"};
  return update(state,{lastObservation:observation,pendingVerification:true,
    steps:state.steps.map(s=>s.status==="verified"?s:{...s})});
}
export function checkpointResumeText(state) {
  if (!validExecutionCheckpoint(state)) throw new Error("No validated checkpoint is available");
  const lines=[
    "Review this Pifrost execution checkpoint against the CURRENT workspace and OMP session before proceeding.",
    "Original plan reference: "+state.plan.reference+(state.plan.sha256?" (SHA256 "+state.plan.sha256+")":""),
    "Checkpoint status: "+state.status+". Metadata is not proof of completion.",
    ...state.steps.map(s=>"Step "+s.id+": "+s.status+(s.evidence?" (evidence reference "+s.evidence+")":"")),
    "A tool result may have committed side effects. Inspect git status, relevant files, tests and outstanding TODOs.",
    "Do not automatically replay commands, writes, releases or tool calls. Resume only once the live state is reconciled.",
  ];
  if (state.pendingVerification) lines.push("There is unverified work or tool activity; do not claim completion.");
  return lines.join("\n");
}
export function checkpointSummary(state) {
  if (!validExecutionCheckpoint(state)) return "No active verified checkpoint in the current OMP branch.";
  const verified=state.steps.filter(s=>s.status==="verified").length;
  return "Checkpoint "+state.status+" · plan "+state.plan.reference+
    " · steps "+verified+"/"+state.steps.length+" explicitly verified"+
    (state.pendingVerification?" · unverified activity":"")+
    " · revision "+state.revision+". OMP branch journal is authoritative.";
}
