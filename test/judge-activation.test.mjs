import assert from "node:assert/strict";
import test from "node:test";
import {applyJudgeRoleActivation,planJudgeRoleActivation} from "../judge-activation.mjs";
const selector="bifrost-judge/jev-1.14.0";
function mock() {let value={default:"bifrost/omp-default",judge:"old/judge",web:"custom/web"},count=0;
  return {read:()=>({status:"ok",value:structuredClone(value)}),write:(_id,next)=>{count++;value=structuredClone(next)},
    get:()=>value,count:()=>count,mutate:x=>{value=x}};}
test("judge activation writes and verifies only modelRoles",()=>{
 const m=mock();const ids=[];
 const result=applyJudgeRoleActivation({read:m.read,write:(id,v)=>{ids.push(id);m.write(id,v)},selector,backup:()=>"/test-backup"});
 assert.deepEqual(ids,["modelRoles"]);assert.equal(m.get().judge,selector);
 assert.equal(m.get().web,"custom/web");assert.equal(result.changed,true);
});
test("idempotent activation avoids a backup and write",()=>{
 const m=mock();m.mutate({...m.get(),judge:selector});
 const r=applyJudgeRoleActivation({read:m.read,write:m.write,selector,backup:()=>{throw Error("backup called")}});
 assert.equal(r.changed,false);assert.equal(m.count(),0);
});
test("failed second-stage verification rolls back safely",()=>{
 const m=mock();const old=m.get();let writes=0;
 assert.throws(()=>applyJudgeRoleActivation({read:m.read,selector,backup:()=>"/test-backup",
 write:(id,v)=>{writes++;m.write(id,v);if(writes===1)throw Error("injected failure")}}),/previous role restored/);
 assert.deepEqual(m.get(),old);assert.equal(writes,2);
});
test("concurrent changes are not overwritten",()=>{
 const m=mock();
 assert.throws(()=>applyJudgeRoleActivation({read:m.read,selector,backup:()=>"/test-backup",
 write:(id,v)=>{m.write(id,{...v,web:"new/web"});throw Error("injected")}}),/rollback unsafe/);
 assert.equal(m.get().web,"new/web");
});
test("unreadable roles fail closed",()=>{
 assert.throws(()=>planJudgeRoleActivation(()=>({status:"error"}),selector),/read OMP/);
});
