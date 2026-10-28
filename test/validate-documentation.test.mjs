import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDocumentation } from "../scripts/validate-documentation.mjs";
const paths=["package.json","package-lock.json","README.md","docs/REFERENCE.md",
  "docs/INTEGRATION_SUPPORT.md","CHANGELOG.md","SECURITY.md","CONTRIBUTING.md",".github/CODEOWNERS"];
const fixture=()=>Object.fromEntries(paths.map(path=>[path,
  readFileSync(resolve(import.meta.dirname,"..",path),"utf8")]));
test("0.30 release documentation matches package version and current native OMP ownership",()=>{
 assert.deepEqual(validateDocumentation(fixture()),[]);
});
test("stale version, missing documentation and unsupported routing guidance fail validation",()=>{
 const original=fixture(),version=JSON.parse(original["package.json"]).version;
 for(const path of ["README.md","docs/REFERENCE.md","docs/INTEGRATION_SUPPORT.md"]){
  const copy={...original,[path]:path==="README.md"||path==="docs/REFERENCE.md"
   ? original[path].replace("Expected for this release:\n\n```text\n"+version,
     "Expected for this release:\n\n```text\n0.29.27")
   : original[path].replace("# Pifrost 0.30 integration support — "+version,
     "# Pifrost 0.30 integration support — 0.29.27")};
  assert.ok(validateDocumentation(copy).some(e=>e.includes(path)),path);
 }
 const missing={...original};delete missing["SECURITY.md"];
 assert.ok(validateDocumentation(missing).some(e=>e.includes("SECURITY.md")));
 assert.ok(validateDocumentation({...original,["README.md"]:original["README.md"]+"\npifrost routes sync"})
   .some(e=>e.includes("unsupported runtime routing")));
});
test("lockfile root version must match package",()=>{
 const contents=fixture(),lock=JSON.parse(contents["package-lock.json"]);
 lock.version="0.29.27";contents["package-lock.json"]=JSON.stringify(lock);
 assert.ok(validateDocumentation(contents).some(e=>e.includes("Package lock")));
});
