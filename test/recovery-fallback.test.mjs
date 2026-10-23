import assert from "node:assert/strict";
import test from "node:test";
import { configuredRecoveryFallbackRole,recoveryFamilyCandidate } from "../recovery-fallback.mjs";
test("30D: no implicit model fallback and no arbitrary provider selectors",()=>{
 for(const val of [undefined,"","bifrost/omp-slow","@bad/other","@slow;cmd","@"])assert.equal(configuredRecoveryFallbackRole(val),null);
 assert.equal(configuredRecoveryFallbackRole("@slow"),"@slow");
 assert.equal(configuredRecoveryFallbackRole(" @reviewer "),"@reviewer");
});
test("30D: fallback only with a verified different OMP lineage",()=>{
 const current={provider:"bifrost",id:"omp-default"};
 const same={provider:"bifrost",id:"omp-default"};
 const target={provider:"openai",id:"gpt"};
 const family=m=>m.provider==="bifrost"?"family-deepseek":"family-gpt";
 assert.equal(recoveryFamilyCandidate(current,same,family),false);
 assert.equal(recoveryFamilyCandidate(current,target,family),true);
 assert.equal(recoveryFamilyCandidate(current,target,()=>""),false);
 assert.equal(recoveryFamilyCandidate(current,target,()=>{throw Error("unavailable")}),false);
 assert.equal(recoveryFamilyCandidate(undefined,target,family),false);
});
