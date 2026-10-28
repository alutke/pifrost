/**
 * Fail-closed legacy runtime collision detector. Only the exact npm plugin
 * can be disabled automatically; all other sources need operator review.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ompAgentDir } from "./cli-lib.mjs";

export function legacyPifrostConflicts(installed, env=process.env, cwd=process.cwd()) {
  if(!installed || !Array.isArray(installed.npm) || !Array.isArray(installed.marketplace))
    throw new Error("Incomplete OMP plugin inventory; refusing to infer a safe state.");
  const found=[];
  for(const p of installed.npm) if(p?.enabled!==false && p?.name==="pifrost")
    found.push({type:"npm",id:"pifrost"});
  for(const p of installed.marketplace){
    const labels=[p?.id,p?.name,...(Array.isArray(p?.entries)?p.entries.map(e=>e?.name):[])].filter(Boolean);
    if(!p?.shadowedBy && labels.some(label=>/(?:^|[/@-])pifrost(?:$|[/@-])/iu.test(label)))
      found.push({type:"marketplace",id:String(p.id||p.name)});
  }
  const roots=[join(ompAgentDir(env),"extensions"),join(cwd,".omp/extensions")];
  for(const root of roots){
    if(!existsSync(root))continue;
    for(const filename of readdirSync(root)){
      if(filename==="pifrost-commands.js"||filename===".pifrost-commands.manifest.json")continue;
      if(/pifrost/iu.test(filename))found.push({type:"extension",id:join(root,filename)});
    }
  }
  for(const settings of [join(ompAgentDir(env),"settings.json"),join(cwd,".omp/settings.json")]){
    if(!existsSync(settings))continue;
    let config;
    try{config=JSON.parse(readFileSync(settings,"utf8"));}
    catch{throw new Error("Cannot validate OMP extensions in "+settings+"; inspect manually.");}
    if((Array.isArray(config.extensions)?config.extensions:[]).some(x=>/pifrost/iu.test(String(x))))
      found.push({type:"settings",id:settings});
  }
  return found;
}
