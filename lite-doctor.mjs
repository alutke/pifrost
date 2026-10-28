/**
 * Lightweight read-only 0.30 health surface. Deliberately no route catalogue,
 * checkpoint, reasoning/stream, modelRole or agent lifecycle inspection.
 */
import { loadState, runtimeConfigFromState, managementAuthFromState,
  getBifrostHealth, testInference, testManagement, commandExists } from "./cli-lib.mjs";
import { nativeModelsStatus } from "./native-models.mjs";
import { reportHealth } from "./cli-health.mjs";
import { renderHealthOverview } from "./terminal-presentation.mjs";

export async function runLiteDoctor(flags={}) {
  const state=loadState();
  const runtime=runtimeConfigFromState(state);
  const management=managementAuthFromState(state);
  const checks=[];
  const add=(id,label,status,detail,required=false)=>checks.push({id,label,status,detail,required});
  add("omp","OMP CLI",commandExists("omp")?"ok":"warn",
    commandExists("omp")?"Installed; native models and agent lifecycle remain OMP-owned":"OMP not found");
  const native=nativeModelsStatus();
  add("models","Native Bifrost models","ok",
    native.enabled?"Opted in to "+native.protocol:"Disabled; native OMP mapping unchanged");
  if(!runtime.url) {
    add("bifrost","Bifrost connection","warn","Not configured; run pifrost init");
  } else {
    try { await getBifrostHealth(runtime.url); add("bifrost","Bifrost connection","ok","Gateway responded"); }
    catch { add("bifrost","Bifrost connection","fail","Gateway unavailable",true); }
    if(runtime.virtualKey) {
      try { const models=await testInference(runtime);add("inference","Inference access","ok",models.models+" models visible"); }
      catch { add("inference","Inference access","warn","Inference Virtual Key could not list models"); }
    } else {
      add("inference","Inference access","ok","Not configured (optional for MCP/Skills-only usage)");
    }
    if(management) {
      try { await testManagement(runtime.url,management); add("management","MCP/Skills management","ok","Management authenticated"); }
      catch { add("management","MCP/Skills management","warn","Management auth unavailable"); }
    } else {
      add("management","MCP/Skills management","warn","Management credentials not configured");
    }
  }
  const result=reportHealth({command:"doctor",json:flags.json===true,strict:flags.strict===true,checks});
  if(!flags.json) {
    console.log(renderHealthOverview(result.checks,{title:"Pifrost 0.30 — CLI integration"}));
    console.log("Models: "+native.path);
    console.log("Repo MCPs/Skills: run pifrost repo status in a repository");
  }
  if(result.exitCode)process.exitCode=result.exitCode;
}
