import { OMP_EXECUTION_SETTING_IDS, assessExecutionReadiness, formatExecutionReadiness } from "./execution-readiness.mjs";
/**
 * Release C read-only diagnostics. OMP owns classification, /seance,
 * advisor lifecycle and model handoffs. Pifrost never accesses session files.
 */
export const OMP_ORCHESTRATION_SETTING_IDS = Object.freeze([
  "prewalk.enabled", "prewalk.auto", "prewalk.autoTarget", "modelRoles",
  "enabledModels", "advisor.continueSeverity", "advisor.reviewMode",
  ...OMP_EXECUTION_SETTING_IDS,
]);
function value(settings, id) {
  return settings?.[id]?.status === "ok" ? settings[id].value : undefined;
}
function asRecord(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : undefined;
}
function check(id, status, message, action) {
  return { id, status, message, ...(action ? {action} : {}) };
}
// Thinking levels are OMP selector metadata, not part of the logical model ID.
// Preserve the original selector for diagnostics and runtime; normalize only for
// conservative read-only scope/cache comparisons.
function modelIdentity(selector) {
  return selector.replace(/:(off|minimal|low|medium|high|xhigh|max|auto)$/i,"");
}
function allowed(model, models) {
  if (!Array.isArray(models) || !models.every(x=>typeof x==="string")) return undefined;
  if (!models.length) return true;
  const identity=modelIdentity(model);
  if (!identity || !identity.includes("/") || identity.includes(":")) return undefined;
  let unknown=false;
  for (let pattern of models) {
    pattern=modelIdentity(pattern);
    if (/[{}[\]!\\]/.test(pattern) || pattern.includes("**") || !/^[a-z\d/_.*?+-]+$/i.test(pattern)) {
      unknown=true; continue;
    }
    const quoted=pattern.replace(/[.+^$|()]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".");
    const regex=new RegExp("^"+quoted+"$","i");
    if(regex.test(identity) || regex.test(identity.slice(identity.indexOf("/")+1)))return true;
  }
  return unknown?undefined:false;
}

function targetFor(pattern, roles) {
  if (typeof pattern!=="string"||!pattern.trim()) return undefined;
  if (!pattern.startsWith("@")) return pattern.trim();
  const role=pattern.slice(1);
  const selected=roles?.[role];
  return typeof selected==="string" && selected.trim()?selected.trim():undefined;
}
function versionTuple(x) {
  const m=/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(x??"").trim());
  return m?m.slice(1).map(Number):undefined;
}
export function ompVersionAtLeast(version,min) {
  const a=versionTuple(version),b=versionTuple(min);
  if(!a||!b)return undefined;
  for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}
  return true;
}
export function assessOmpOrchestration({settings={},catalog,stale=false,hostVersion,selectedJudge,policySnapshotVersion,stalledMode}={}) {
  const checks=[];
  if (typeof policySnapshotVersion === "string" && policySnapshotVersion.trim()) {
    const host = versionTuple(hostVersion);
    const policy = versionTuple(policySnapshotVersion);
    const comparable = host && policy;
    const same = comparable && host.every((n,i) => n === policy[i]);
    const newer = comparable && ompVersionAtLeast(hostVersion,policySnapshotVersion) === true && !same;
    checks.push(check("omp-host-policy",same ? "ok" : newer ? "unknown" : comparable ? "warn" : "unknown",
      "Host "+(hostVersion || "unavailable")+"; packaged OMP policy "+policySnapshotVersion+
      (same ? " matches validated snapshot." : newer ? " is older than this host; newer host needs separate compatibility validation." :
       comparable ? " is newer than this host; historical host installation is not complete feature conformance." :
       " cannot be compared until a valid host version is available."),
      same ? undefined : "pifrost doctor --verbose"));
  }
  const roles=asRecord(value(settings,"modelRoles"));
  const enabled=value(settings,"enabledModels");
  const auto=value(settings,"prewalk.auto");
  const unconditional=value(settings,"prewalk.enabled");
  const rawTarget=value(settings,"prewalk.autoTarget") ?? "@smol";
  const target=targetFor(rawTarget,roles);
  const judgeRole=roles?.judge;
  const selectedMatches=typeof judgeRole==="string" && selectedJudge?.selector===judgeRole;
  // Native non-chat judge roles are not filtered by OMP enabledModels.
  if(!["off","suggest","on"].includes(auto)){
    checks.push(check("auto-prewalk","unknown","Cannot read an OMP-supported prewalk.auto value.","omp config get prewalk.auto --json"));
  }else if(auto==="off"){
    checks.push(check("auto-prewalk","info","Off. No task classifier is run."));
  }else if(!selectedMatches){
    checks.push(check("auto-prewalk","unknown","Matching Pifrost native judge not confirmed. Local configuration cannot prove native inference.","pifrost judge status"));
  }else{
    checks.push(check("auto-prewalk","ok",auto==="suggest"?
      "Locally configured: suggest classifies without switching; judgment execution is unverified.":
      "Locally configured: handoff may occur at 0.70 confidence; judgment execution is unverified."));
  }
  checks.push(unconditional===true?
    check("unconditional-prewalk","warn","prewalk.enabled is true: unconditional handoff is independent of prewalk.auto.","omp config get prewalk.enabled --json"):
    unconditional===false?
    check("unconditional-prewalk","ok","Unconditional handoff disabled."):
    check("unconditional-prewalk","unknown","Cannot read prewalk.enabled; do not assume it is disabled."));
  if(auto==="off"){
    checks.push(check("handoff-target","info","Automatic target not in use."));
  }else if(!target){
    checks.push(check("handoff-target","unknown","Target role has no single local selector; OMP may resolve fallback roles at runtime.","omp config get modelRoles --json"));
  }else if(allowed(target,enabled)===false){
    checks.push(check("handoff-target","warn","Target "+target+" is excluded by enabledModels.","omp config get enabledModels --json"));
  }else if(allowed(target,enabled)===undefined){
    checks.push(check("handoff-target","unknown","Unknown or complex OMP chat scope; cannot establish target eligibility locally."));
  }else{
    const m=/^bifrost\/(omp-[a-z0-9_.-]+)$/i.exec(modelIdentity(target));
    const cached=Array.isArray(catalog?.models)?catalog.models:undefined;
    if(m && cached && !cached.some(x=>String(x?.id).toLowerCase()===m[1].toLowerCase())){
      checks.push(check("handoff-target","warn","Target "+target+" is absent from the local model cache; live OMP registry may differ.","pifrost models refresh --force"));
    }else if(m&&cached){
      checks.push(check("handoff-target",stale?"warn":"ok","Target "+target+" appears in the "+(stale?"stale ":"")+"cache. Credentials and physical Bifrost model are not verified.",stale?"pifrost models refresh --force":undefined));
    }else{
      checks.push(check("handoff-target","unknown","Target "+target+" cannot be verified against Pifrost's local model cache; OMP retains model selection."));
    }
  }
  const seance=ompVersionAtLeast(hostVersion,"18.11.3");
  checks.push(seance===true?check("seance","ok",
    "Host version supports OMP /seance; OMP isolates extensions/MCP and resolves through its model registry. No historical session was opened."):
    seance===false?check("seance","warn","OMP host predates /seance 18.11.3.","Upgrade OMP to >=18.11.3"):
    check("seance","unknown","Host version unavailable; no /seance support claimed."));
  const severity=value(settings,"advisor.continueSeverity");
  const review=value(settings,"advisor.reviewMode");
  if(["nit","concern","blocker"].includes(severity)){
    const consequence=severity==="blocker"?"Only blockers":
      severity==="concern"?"Concerns and blockers":"All advisor notes";
    checks.push(check("advisor","ok",severity+": "+consequence+
      " can resume a completed turn. Review cadence: "+
      (["turn","agent-end"].includes(review)?review:"unverified")+
      ". Extra turns may add model requests and Bifrost cost."));
  }else checks.push(check("advisor","unknown","Cannot read advisor.continueSeverity; do not infer a default.","omp config get advisor.continueSeverity --json"));
  const execution = assessExecutionReadiness({settings,hostVersion,policySnapshotVersion,stalledMode});
  return {
    schemaVersion:1,
    execution,
    status: checks.some(c=>c.status==="warn")?"attention":checks.some(c=>c.status==="unknown")?"unverified":"locally-compatible",
    hostVersion:typeof hostVersion==="string"?hostVersion:null,
    policySnapshotVersion:typeof policySnapshotVersion==="string"?policySnapshotVersion:null,
    auto:typeof auto==="string"?auto:null,target:target??null,
    judgeSelector:typeof judgeRole==="string"?judgeRole:null,
    checks,
    notes:[
      "Read-only local assessment. No settings, route, session or MCP permissions changed.",
      "OMP owns auto-prewalk classification, session isolation, model switching and advisor continuation.",
      "Bifrost owns physical routing and cost attribution; local aliases do not prove a gateway rule matched.",
      "Locally compatible does not mean successful live judgment, handoff, or historical consultation.",
      "Readiness does not query the live gateway version; use pifrost doctor --verbose to inspect Bifrost version evidence."
    ]
  };
}
export function formatOmpOrchestration(result,verbose=false) {
  const lines=["OMP orchestration readiness (local, read-only)",
    "  Host: "+(result.hostVersion??"unavailable")+"; packaged OMP policy: "+(result.policySnapshotVersion??"not supplied")+"; summary: "+result.status];
  for(const item of result.checks){
    lines.push("  ["+item.status.toUpperCase()+"] "+item.id+": "+item.message);
    if(item.action&&(verbose||item.status==="warn"))lines.push("    Check: "+item.action);
  }
  if(verbose)lines.push("",...result.notes);
  else lines.push("  Details: pifrost omp readiness --verbose");
  lines.push("",formatExecutionReadiness(result.execution,verbose));
  return lines.join("\n");
}
