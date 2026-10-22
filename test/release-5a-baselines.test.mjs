import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=path=>readFileSync(new URL(path, "file://"+root),"utf8");
const pkg=JSON.parse(read("package.json"));
const lock=JSON.parse(read("package-lock.json"));
const cli=read("cli-lib.mjs");
const omp=read("scripts/validate-omp-contract.mjs");
const bifrost=read("scripts/validate-bifrost-v2-contract.mjs");
const ci=read(".github/workflows/ci.yml");

test("R5A-01 all five OMP packages, root lock and policy snapshot share 18.12.5",()=>{
  const names=["pi-ai","pi-catalog","pi-natives","pi-utils"];
  for(const item of names){
    assert.equal(pkg.dependencies["@oh-my-pi/"+item],"18.12.5");
    assert.equal(lock.packages[""].dependencies["@oh-my-pi/"+item],"18.12.5");
    assert.equal(lock.packages["node_modules/@oh-my-pi/"+item]?.version,"18.12.5");
  }
  assert.equal(pkg.devDependencies["@oh-my-pi/pi-coding-agent"],"18.12.5");
  assert.equal(lock.packages[""].devDependencies["@oh-my-pi/pi-coding-agent"],"18.12.5");
  assert.equal(lock.packages["node_modules/@oh-my-pi/pi-coding-agent"]?.version,"18.12.5");
  assert.match(cli,/PIFROST_OMP_POLICY_SNAPSHOT_VERSION = "18\.12\.5"/u);
  assert.match(cli,/PIFROST_OMP_VALIDATED_VERSION = "18\.12\.5"/u);
});

test("R5A-02 historical compatibility is retained; no host is falsely said to be deployed",()=>{
  assert.match(cli,/PIFROST_OMP_MIN_VERSION = "18\.10\.4"/u);
  assert.match(cli,/PIFROST_BIFROST_MIN_VERSION = "2\.2\.4"/u);
  assert.match(cli,/PIFROST_BIFROST_VALIDATED_VERSION = "2\.3\.2"/u);
  for(const version of ["18.10.4","18.12.1","18.12.5"]){
    assert.ok(ci.includes("omp-"+version),version+" compiled host missing");
  }
  assert.match(omp,/const OMP_VALIDATED_VERSION = "18\.12\.5"/u);
  assert.match(omp,/const OMP_VALIDATED_COMMIT = "d5cd750e41fede277f9eb933455da92a0738915e"/u);
});

test("R5A-03 Bifrost 2.3.2 is immutable-pinned without deleting older route/MCP contracts",()=>{
  assert.match(bifrost,/BIFROST_2_3_2_COMMIT = "a05ea20e68bf116a35e9f05b1a3d749624b3935e"/u);
  for(const v of ["2_0_0","2_2_4","2_2_5","2_2_6","2_3_0"]) assert.ok(bifrost.includes("BIFROST_"+v+"_COMMIT"),v);
  assert.match(bifrost,/Bifrost 2\.3\.1 optional gateway feature contracts/u);
  assert.match(bifrost,/Bifrost 2\.3\.2 security and migration release contract/u);
  assert.match(read("docs/RELEASE_5A_CONTRACT_FOUNDATION.md"),/database migrations/u);
});

test("R5A-04 release sources and operator instructions state mocked/live distinction",()=>{
  assert.match(pkg.version,/^0\\.29\\.(?:14|15)$/u);
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[""].version,pkg.version);
  assert.match(read("docs/INTEGRATION_SUPPORT.md"),/OMP 18\.12\.5/u);
  assert.match(read("docs/INTEGRATION_SUPPORT.md"),/Bifrost 2\.3\.2/u);
  assert.match(read("docs/RELEASE_5A_CONTRACT_FOUNDATION.md"),/not real provider execution/u);
});
