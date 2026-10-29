import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,join } from "node:path";

const files=["package.json","package-lock.json","README.md","docs/REFERENCE.md",
  "docs/INTEGRATION_SUPPORT.md","CHANGELOG.md","SECURITY.md",
  "CONTRIBUTING.md",".github/CODEOWNERS"];
export function validateDocumentation(contents) {
  const errors=[],get=x=>contents[x]??"";
  for(const path of files)if(!get(path))errors.push(path+" missing");
  if(errors.length)return errors;
  let pkg,lock;
  try{pkg=JSON.parse(get("package.json"));lock=JSON.parse(get("package-lock.json"));}
  catch{return ["Invalid package or lockfile JSON"];}
  const version=pkg.version;
  if(lock.version!==version||lock.packages?.[""]?.version!==version)
    errors.push("Package lock release version disagrees with package.json");
  if(!/^0\.30\.\d+$/u.test(version))errors.push("Unexpected release version: "+version);
  if(!get("CHANGELOG.md").includes("## "+version+" —"))
    errors.push("CHANGELOG.md has no "+version+" release heading");
  if(!get("README.md").includes("Expected for this release:\n\n\`\`\`text\n"+version+"\n"))
    errors.push("README.md has stale expected release");
  if(!get("docs/REFERENCE.md").includes("Expected for this release:\n\n\`\`\`text\n"+version+"\n"))
    errors.push("docs/REFERENCE.md has stale expected release");
  const support=get("docs/INTEGRATION_SUPPORT.md");
  if(!support.startsWith("# Pifrost 0.30 integration support — "+version))
    errors.push("docs/INTEGRATION_SUPPORT.md current version mismatch");
  for(const phrase of ["OMP","Bifrost","MCP","Skills","billable","live","PI_CONFIG_DIR","OMP_PROFILE"])
    if(!support.includes(phrase))errors.push("docs/INTEGRATION_SUPPORT.md missing "+phrase);
  const readme=get("README.md");
  for(const phrase of ["native OhMyPi","/pifrost","pifrost models enable","pifrost migrate status"])
    if(!readme.includes(phrase))errors.push("README.md missing "+phrase);
  if(readme.includes("pifrost routes sync"))errors.push("README.md advertises unsupported runtime routing");
  for(const phrase of ["security","Virtual Key","MCP"])
    if(!get("SECURITY.md").toLowerCase().includes(phrase.toLowerCase()))
      errors.push("SECURITY.md missing "+phrase);
  if(!get(".github/CODEOWNERS").trim())errors.push(".github/CODEOWNERS empty");
  return errors;
}
const root=dirname(dirname(fileURLToPath(import.meta.url)));
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const contents=Object.fromEntries(files.map(path=>{
    try{return [path,readFileSync(join(root,path),"utf8")];}
    catch{return [path,undefined];}
  }));
  const errors=validateDocumentation(contents);
  if(errors.length){for(const e of errors)console.error("DOC: "+e);process.exitCode=1;}
  else console.log("Pifrost 0.30 documentation and release policy: OK");
}
