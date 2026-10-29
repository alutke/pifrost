import { existsSync,lstatSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { managedBifrostSkillIntegrity,readBifrostSkillMarker } from "./skills-bridge.mjs";

/** Validate all local cleanup targets before any irreversible remote VK delete. */
export function preflightLocalRepoReset(repo, repoConfig) {
  const rows=Array.isArray(repoConfig?.bifrostSkills)?repoConfig.bifrostSkills:[];
  for(const skill of rows){
    const name=typeof skill==="string"?skill:skill?.name;
    if(!name)throw Error("Reset blocked: invalid configured Skill identity.");
    const target=join(repo.root,".agents/skills",name);
    if(!existsSync(target))continue;
    if(!readBifrostSkillMarker(repo.root,name))
      throw new Error("Reset blocked: Skill "+name+" has no Pifrost ownership marker.");
    const integrity=managedBifrostSkillIntegrity(repo.root,name);
    if(integrity.status!=="clean")
      throw new Error("Reset blocked: Skill "+name+" integrity is "+integrity.status+"; review it first.");
  }
  const path=join(repo.root,".omp/mcp.json");
  if(!existsSync(path))return;
  if(!lstatSync(path).isFile())throw new Error("Reset blocked: MCP config is not a regular file.");
  let parsed;
  try{parsed=JSON.parse(readFileSync(path,"utf8"));}
  catch{throw new Error("Reset blocked: repository .omp/mcp.json is invalid JSON.");}
  const server=parsed?.mcpServers?.bifrost;
  if(server && (typeof server!=="object" ||
    server.headers?.["x-bf-vk"]!=="!pifrost secret repo-mcp --id "+repo.id))
    throw new Error("Reset blocked: 'bifrost' MCP entry is not owned by this repository.");
}
