/** Evidence-linked, read-only compatibility exception register.
 * CI checks that referenced test files exist. Nothing retires automatically.
 */
export const PIFROST_WORKAROUNDS = Object.freeze([
  {id:"cache-first-startup",owner:"Pifrost",upstream:"OMP extension-model bootstrap",tests:["native-cold-start.bun.ts","cache.test.ts"],retirement:"Prove first-frame model availability on both supported OMP versions with cold, warm and invalid caches."},
  {id:"route-policy-fingerprint",owner:"Pifrost",upstream:"Bifrost route-change events",tests:["route-policy-cli.integration.test.ts"],retirement:"Verify event-safe change notifications and credential/policy invalidation without polling."},
  {id:"mixed-wire-preoutput-failover",owner:"Pifrost",upstream:"Bifrost mixed Responses and Chat ingress",tests:["gateway-protocol.bun.ts","transport-model.bun.ts"],retirement:"Prove compatible wire protocol across all route members without retries after committed output."},
  {id:"reasoning-replay-hygiene",owner:"Pifrost",upstream:"OMP signed reasoning replay",tests:["reasoning-replay.test.ts"],retirement:"Verify signed replay and tool pairing with genuine physical-model traces."},
  {id:"context-compatibility-estimation",owner:"Pifrost",upstream:"OMP physical model limits",tests:["context-estimator.test.ts"],retirement:"Verify provider-qualified context/output limits against mixed physical routes."},
  {id:"native-judgment-bridge",owner:"Pifrost",upstream:"OMP native TypeSafe/OpenAI Decisions",tests:["judge-release-b.test.mjs","judge-activation.test.mjs"],retirement:"Verify both Bifrost native endpoints and host capability without custom registration, including images."},
]);
export const RETIREMENT_STATES=Object.freeze(["retained","candidate","validated","retired"]);
export function inspectPifrostWorkarounds({hostVersion}={}){
 return {schemaVersion:2,status:"retained-pending-evidence",
  hostVersion:typeof hostVersion==="string"?hostVersion:null,
  autoRetired:0,workarounds:PIFROST_WORKAROUNDS.map(x=>({...x,
    state:"retained",verification:"unit-ci-only",liveGatewayEvidence:null,approvedBy:null})),
  note:"No automatic retirement: require executable tests, live gateway evidence where applicable, and explicit review."};
}
export function formatPifrostWorkarounds(info,verbose=false){
 const lines=["Pifrost compatibility exceptions (read-only)",
  "  OMP host: "+(info.hostVersion??"unavailable"),
  "  Retained: "+info.workarounds.length+"; auto-retired: "+info.autoRetired];
 for(const x of info.workarounds){
  lines.push("  [RETAINED] "+x.id+" ("+x.owner+")");
  if(verbose)lines.push("    Upstream: "+x.upstream,"    Tests: "+x.tests.join(", "),
    "    Verification: "+x.verification+", gateway evidence: none",
    "    Retirement gate: "+x.retirement);
 }
 lines.push("  No safety mechanism is retired on release version alone.");
 return lines.join("\\n");
}
