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