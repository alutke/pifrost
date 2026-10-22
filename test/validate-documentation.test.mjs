import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDocumentation } from "../scripts/validate-documentation.mjs";

const files=[
  "package.json","package-lock.json","README.md","docs/REFERENCE.md",
  "docs/INTEGRATION_SUPPORT.md","docs/OMP_COMPATIBILITY.md",
  "CHANGELOG.md","docs/OUTPUT_BUDGET.md",
  "docs/RELEASE_4_BUDGET_GOVERNANCE.md","docs/RELEASE_5A_CONTRACT_FOUNDATION.md","docs/RELEASE_5B_INFERENCE_HARDENING.md","docs/RELEASE_5C_CONTEXT_DISCOVERY.md","docs/RELEASE_5D_LIFECYCLE_MCP_SAFETY.md","docs/RELEASE_5E_GATEWAY_MCP_INTEGRATION.md","docs/RELEASE_5F_CERTIFICATION.md","SECURITY.md",
  "CONTRIBUTING.md",".github/CODEOWNERS",
];
function fixture() {
  return Object.fromEntries(files.map(path=>[path,readFileSync(resolve(import.meta.dirname,"..",path),"utf8")]));
}
test("R4-06 living release documentation matches current package and policy snapshot",()=>{
  assert.deepEqual(validateDocumentation(fixture()),[]);
});
test("R4-07 stale host-support/compatibility headings fail CI",()=>{
  for(const path of ["docs/INTEGRATION_SUPPORT.md","docs/OMP_COMPATIBILITY.md","docs/OUTPUT_BUDGET.md"]) {
    const contents=fixture();
    const version=JSON.parse(contents["package.json"]).version;
    contents[path]=contents[path].replace(version,"0.29.0");
    assert.ok(validateDocumentation(contents).some(x=>x.includes(path)),path);
  }
});
test("R4-08 missing private security, contribution or code ownership policy fails CI",()=>{
  for(const file of ["SECURITY.md","CONTRIBUTING.md",".github/CODEOWNERS"]) {
    const contents=fixture();
    delete contents[file];
    assert.ok(validateDocumentation(contents).some(x=>x.includes(file)),file);
  }
});
test("R4-09 unpinned OMP package or incompatible policy snapshot fails CI",()=>{
  const contents=fixture(),pkg=JSON.parse(contents["package.json"]);
  pkg.dependencies["@oh-my-pi/pi-catalog"]="18.10.4";
  contents["package.json"]=JSON.stringify(pkg);
  assert.ok(validateDocumentation(contents).some(x=>x.includes("OMP policy snapshot dependency mismatch")));
});
