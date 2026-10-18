import { existsSync } from "node:fs";
import { PIFROST_WORKAROUNDS, RETIREMENT_STATES, inspectPifrostWorkarounds } from "../workaround-register.mjs";
const ids=new Set();
for(const w of PIFROST_WORKAROUNDS){
 if(ids.has(w.id))throw Error("duplicate workaround "+w.id);
 ids.add(w.id);
 if(!w.upstream||!w.retirement||!w.owner||!w.tests?.length)throw Error("missing exception evidence metadata "+w.id);
 for(const f of w.tests){
  if(!/^[a-z0-9.-]+\.(ts|mjs)$/i.test(f)||!existsSync(new URL("../test/"+f,import.meta.url)))
   throw Error("missing referenced regression "+w.id+": "+f);
 }
}
const result=inspectPifrostWorkarounds({hostVersion:"18.12.1"});
if(result.workarounds.some(x=>!RETIREMENT_STATES.includes(x.state)||x.state!=="retained"||
  x.liveGatewayEvidence!==null || x.approvedBy!==null)||result.autoRetired!==0)
 throw Error("cannot mark workaround retired without approved evidence");
console.log("Validated "+ids.size+" retained compatibility exceptions and all test references.");
