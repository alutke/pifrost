import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,join,posix } from "node:path";
import { spawnSync } from "node:child_process";
import { validateDocumentation } from "./validate-documentation.mjs";

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const load=p=>readFileSync(join(root,p),"utf8");
const pkg=JSON.parse(load("package.json"));
const lock=JSON.parse(load("package-lock.json"));
const fail=message=>{throw new Error("0.30 release check: "+message);};
if(pkg.version!==lock.version||pkg.version!==lock.packages?.[""]?.version)fail("package and lockfile versions differ");
if(!/^0\.30\.\d+$/u.test(pkg.version))fail("Release requires a 0.30 semver");
if(pkg.bin?.pifrost!=="./cli.mjs")fail("Expected CLI executable");
if(pkg.omp?.extensions||pkg.pi?.extensions)fail("No automatic OMP extension permitted");
if(pkg.files.some(x=>/\.ts$|\.d\.mts$|^docs\/RELEASE_/u.test(x)))
  fail("Legacy TypeScript runtime and release-history assets may not be shipped");
for(const path of ["README.md","docs/REFERENCE.md","docs/INTEGRATION_SUPPORT.md",
  "CHANGELOG.md","SECURITY.md","CONTRIBUTING.md",".github/CODEOWNERS"])
  if(!existsSync(join(root,path)))fail("Required document is missing: "+path);
const requiredDocs=["package.json","package-lock.json","README.md","docs/REFERENCE.md",
  "docs/INTEGRATION_SUPPORT.md","CHANGELOG.md","SECURITY.md","CONTRIBUTING.md",".github/CODEOWNERS"];
const docs=Object.fromEntries(requiredDocs.map(p=>[p,load(p)]));
const documentationErrors=validateDocumentation(docs);
if(documentationErrors.length)fail(documentationErrors.join("; "));
const r=spawnSync("npm",["pack","--dry-run","--json","--ignore-scripts"],{
  cwd:root,encoding:"utf8",maxBuffer:8*1024*1024,
  env:{...process.env,npm_config_audit:"false",npm_config_fund:"false"}
});
if(r.error||r.status!==0)fail("npm pack failed: "+(r.error?.message??r.stderr));
let items;
try{items=JSON.parse(r.stdout)?.[0]?.files?.map(x=>x.path);}
catch{fail("npm pack returned invalid JSON");}
if(!Array.isArray(items)||!items.includes("cli.mjs")||!items.includes("omp-commands.js"))
  fail("npm tarball lacks CLI or opt-in slash extension");
const packed=new Set(items);
for(const filename of items){
  if(/\.ts$|\.d\.mts$|^docs\/RELEASE_|^native\.ts$|^index\.ts$/u.test(filename))
    fail("Obsolete runtime source or historical release packaged: "+filename);
}
const forbidden=[
"native.ts","index.ts","stalled-turn-recovery.ts","dynamic-routing.ts",
"reasoning-stream.ts","checkpoint-lifecycle.mjs","intelligent-stall-recovery.mjs",
];
for(const filename of forbidden)if(packed.has(filename))fail("Retired runtime source shipped: "+filename);
const imports=/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']+)["']/gu;
for(const filename of items.filter(x=>/\.(?:js|mjs)$/u.test(x))){
  const source=load(filename);
  for(const match of source.matchAll(imports)){
    const ref=posix.normalize(posix.join(posix.dirname(filename),match[1]));
    if(!packed.has(ref))fail("Missing packed dependency: "+filename+" imports "+ref);
  }
}
console.log("Pifrost "+pkg.version+" release-candidate package: OK ("+items.length+" files)");
