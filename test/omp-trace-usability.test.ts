import assert from "node:assert/strict";
import test from "node:test";
import { parsePifrostTraceOptions,formatPifrostRouteTraces,
  recordBifrostCaptureTrace,releasePifrostRouteTraces,
} from "../request-provenance.ts";
test("OMP trace options are bounded, composable and backward compatible",()=>{
  assert.deepEqual(parsePifrostTraceOptions(""),{compact:true});
  assert.deepEqual(parsePifrostTraceOptions("last 5 errors role omp-default verbose"),{
    compact:false,last:5,errorsOnly:true,role:"omp-default",
  });
  assert.throws(()=>parsePifrostTraceOptions("last 100"),/between 1 and 20/u);
  assert.throws(()=>parsePifrostTraceOptions("role"),/requires an OMP role/u);
  assert.throws(()=>parsePifrostTraceOptions("random"),/Usage:/u);
});
test("OMP summary hides sensitive IDs and implementation counters, verbose retains gateway evidence",()=>{
  const id="ux-trace-example";
  recordBifrostCaptureTrace(id,{
    logicalModel:"omp-default",routeMode:"bifrost-native",protocol:"openai-completions",
    attempt:1,requestedPrimary:"omp-default",outcome:"done",
  },{requestId:"trace-private",resolvedModel:"real-model",provider:"actual",total:0.002});
  recordBifrostCaptureTrace(id,{
    logicalModel:"omp-advisor",routeMode:"pifrost-compatibility",protocol:"openai-completions",
    attempt:2,requestedPrimary:"omp-advisor",outcome:"error",
  },{requestId:"gateway-private",failureClass:"timeout",outputStarted:false});
  const filtered=formatPifrostRouteTraces(id,parsePifrostTraceOptions("errors"));
  assert.match(filtered,/omp-advisor - Failed/u);
  assert.doesNotMatch(filtered,/omp-default|gateway-private/u);
  assert.match(filtered,/Issue: timeout/u);
  const summary=formatPifrostRouteTraces(id,parsePifrostTraceOptions("last 1"));
  assert.match(summary,/up to 1 requests/u);
  assert.doesNotMatch(summary,/request-id=|trace-private|gateway-private/u);
  const verbose=formatPifrostRouteTraces(id,parsePifrostTraceOptions("verbose"));
  assert.match(verbose,/request-id=gateway-private/u);
  assert.match(verbose,/route-mode=pifrost-compatibility/u);
  releasePifrostRouteTraces(id);
});
test("Release B: output capping is visible in both trace views without user content",()=>{
  const sid="release-b-capped-trace";
  recordBifrostCaptureTrace(sid, {
    logicalModel:"omp-default", routeMode:"bifrost-direct",
    protocol:"openai-responses", attempt:1, requestedPrimary:"omp-default", outcome:"done",
  },{
    outputBudget:{requestedTokens:712434,effectiveTokens:32768,explicit:true,reduced:true,
      limitingSource:"operational-cap",constraints:[{source:"operational-cap",tokens:32768}],
      memberCount:2,verifiedMemberCount:1,unknownMemberCount:1},
  });
  const compact=formatPifrostRouteTraces(sid,{compact:true});
  assert.match(compact,/Output: capped to 32768 tokens \(requested 712434\)/u);
  const verbose=formatPifrostRouteTraces(sid,{compact:false});
  assert.match(verbose,/output-effective=32768 output-reduced=yes output-explicit=yes/u);
  assert.match(verbose,/output-source=operational-cap/u);
  assert.doesNotMatch(verbose,/secret|api-key|prompt=/iu);
  releasePifrostRouteTraces(sid);
});

test("Release C: trace distinguishes physical service from cached preferred model without inferring affinity",()=>{
  const sid="release-c-affinity-evidence";
  recordBifrostCaptureTrace(sid,{
    logicalModel:"omp-default",routeMode:"bifrost-direct",protocol:"openai-responses",
    attempt:1,requestedPrimary:"omp-default",outcome:"done",
  },{
    resolvedModel:"deepseek/deepseek-v4.1-flash",provider:"commandcode",
    requestId:"request-not-for-summary",
    routeContract:{
      mode:"bifrost-direct",verification:"gateway-owned-unverified",
      possibleMembers:3,unknownMembers:0,mixedProtocols:true,encodersComplete:false,
      gatewaySelectionCause:"unknown",cachedPrimary:"OpenCode Go/deepseek/deepseek-v4.1-flash",
    }
  });
  const compact=formatPifrostRouteTraces(sid,{compact:true});
  assert.match(compact,/differs from cached primary; gateway reason unknown/u);
  assert.doesNotMatch(compact,/request-not-for-summary|session affinity caused/u);
  const verbose=formatPifrostRouteTraces(sid,{compact:false});
  assert.match(verbose,/selection=differs-from-cached-primary selection-cause=unverified/u);
  assert.match(verbose,/contract=bifrost-direct policy=gateway-owned-unverified members=3/u);
  assert.match(verbose,/affinity-scope=all-known-members/u);
  assert.doesNotMatch(verbose,/reason=session-affinity|credential|api-key=/iu);
  releasePifrostRouteTraces(sid);
});
