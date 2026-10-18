/** Compatibility workarounds are retired by evidence, never by a host-version guess. */
export const PIFROST_WORKAROUNDS = Object.freeze([
  {
    id:"cache-first-startup",owner:"Pifrost",upstream:"OMP extension-model bootstrap",
    tests:["native-cold-start.bun.ts","cache.test.ts"],
    retirement:"Demonstrate first-frame model availability with empty, warm and invalid caches on each supported released OMP binary.",
  },
  {
    id:"route-policy-fingerprint",owner:"Pifrost",upstream:"Bifrost route-change events",
    tests:["route-policy-cli.integration.test.ts"],
    retirement:"Verify native gateway route-change notifications with no polling service, and prove credential/policy invalidation.",
  },
  {
    id:"mixed-wire-preoutput-failover",owner:"Pifrost",upstream:"Bifrost mixed Responses and Chat ingestion",
    tests:["gateway-protocol.bun.ts","transport-model.bun.ts"],
    retirement:"Prove every eligible route can use one native gateway wire without retry after committed output.",
  },
  {
    id:"reasoning-replay-hygiene",owner:"Pifrost",upstream:"OMP signed reasoning replay",
    tests:["reasoning-replay.test.ts"],
    retirement:"Confirm genuine signed reasoning, tool pairing, and placeholder suppression in native replay using representative physical provider traces.",
  },
  {
    id:"context-compatibility-estimation",owner:"Pifrost",upstream:"OMP physical-model context/token estimates",
    tests:["context-estimator.test.ts"],
    retirement:"Validate provider-qualified limits against mixed-route physical member estimates and public catalog policy.",
  },
  {
    id:"native-judgment-bridge",owner:"Pifrost",upstream:"OMP TypeSafe/OpenAI Decisions registration",
    tests:["judge-release-b.test.mjs"],
    retirement:"Prove the native host can use Bifrost VKs and both native decision wires without a Pifrost provider adapter.",
  },
]);
export function inspectPifrostWorkarounds({hostVersion}={}) {
  return {schemaVersion:1,status:"retained-pending-evidence",
    hostVersion:typeof hostVersion==="string"?hostVersion:null,
    autoRetired:0,workarounds:PIFROST_WORKAROUNDS.map(x=>({...x,state:"retained"})),
    note:"No automatic retirement: prove each upstream contract and all associated tests before removing safeguards."};
}
export function formatPifrostWorkarounds(info,verbose=false) {
  const lines=["Pifrost compatibility exceptions (read-only)",
    "  OMP host: "+(info.hostVersion??"unavailable"),
    "  Retained: "+info.workarounds.length+"; auto-retired: "+info.autoRetired];
  for(const x of info.workarounds){
    lines.push("  [RETAINED] "+x.id+" ("+x.owner+")");
    if(verbose)lines.push("    Upstream: "+x.upstream, "    Tests: "+x.tests.join(", "), "    Retirement gate: "+x.retirement);
  }
  lines.push("  No safety mechanism is retired based solely on release notes.");
  return lines.join("\n");
}
