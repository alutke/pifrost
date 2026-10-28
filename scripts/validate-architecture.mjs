/**
 * Pifrost 0.30 architecture gate: Pifrost is a CLI and optional command
 * palette, never an inference provider, router or agent lifecycle extension.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,join } from "node:path";
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(join(root,p),"utf8");
const pkg=JSON.parse(read("package.json"));
const schema=read("cli-command-schema.mjs");
const palette=read("omp-commands.js");
const migration=read("omp-legacy-migration.mjs");
const preconditions=read("cli-preconditions.mjs");
const errors=[];
const check=(ok,msg)=>{if(!ok)errors.push(msg);};
check(!pkg.omp?.extensions && !pkg.pi?.extensions,"No mandatory OMP extensions");
check(pkg.bin?.pifrost==="./cli.mjs","Package must expose CLI entrypoint");
check(pkg.files.includes("omp-commands.js"),"Explicit opt-in palette must ship");
check(!pkg.files.some(p=>/^(?:native|index)\.ts$|(?:recovery|routing|reasoning|checkpoint|context|judge|output-budget).*\.(?:ts|d\.mts)$/u.test(p)),
  "The 0.29 runtime routing/recovery/source engine may not ship");
check(!pkg.files.some(p=>p.startsWith("docs/RELEASE_")),"Historical release write-ups may not ship");
const registered=[...palette.matchAll(/pi\.registerCommand\(/gu)].length;
check(registered===1,"Palette must register exactly one /pifrost command");
for(const forbidden of ["pi.on(","pi.registerProvider(","pi.registerTool(",
  'before_agent_start','session_stop','registerMessageRenderer']) {
  check(!palette.includes(forbidden),"Palette cannot intercept OMP runtime: "+forbidden);
}
for(const retired of ["routes sync","judge activate","omp context apply","models refresh","omp readiness",
  "omp workarounds","routes explain","research bind"]) {
  check(!schema.includes('["'+retired+'"'),"Retired command remains supported: "+retired);
}
check(!/function requireManagement[\s\S]*?\{[\s\S]*?const runtime\s*=\s*requireRuntime\(/u.test(preconditions),
  "Repository MCP/Skill management must not depend on inference Virtual Key");
check(!/enabledModels\.filter|modelProviderOrder\.filter/u.test(migration),
  "Migration must not infer ownership of OMP Bifrost model preferences");
if(errors.length){for(const e of errors)console.error("0.30 architecture: "+e);process.exitCode=1;}
else console.log("Pifrost 0.30 CLI-only, optional-model, MCP/Skills architecture: OK");
