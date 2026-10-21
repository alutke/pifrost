import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAttemptTransition, isGatewayProtocolRejection } from "../attempt-retry-policy.ts";

const physical = "physical-compatibility";
const ingress = "gateway-ingress";
test("R1-01 physical encoder attempts are permitted only after Bifrost verified upstream 502/503", () => {
  for (const status of [502,503]) {
    assert.deepEqual(evaluateAttemptTransition(physical, new Error("upstream down"), {
      httpStatus:status, failureClass:"upstream", failureCode:"UPSTREAM_TRANSIENT",
    }), {permitted:true,reason:"verified-upstream-unavailable"});
  }
  for (const status of [400,401,402,403,408,422,429,500,504]) {
    assert.equal(evaluateAttemptTransition(physical, new Error("unavailable"), {
      httpStatus:status,failureClass:"upstream",failureCode:"UPSTREAM_TRANSIENT",
    }).permitted,false,String(status));
  }
});
test("R1-02 terminal gateway errors and local exceptions never authorise cross-encoder attempts", () => {
  for (const code of ["REASONING_REPLAY_INVALID","OUTPUT_LIMIT_EXCEEDED","MODEL_NOT_PERMITTED","ROUTE_CONTRACT_UNKNOWN"]) {
    assert.equal(evaluateAttemptTransition(physical, new Error("bad history"), {
      httpStatus:502, failureClass:"upstream", failureCode:code,
    }).permitted,false,code);
  }
  assert.equal(evaluateAttemptTransition(physical, new Error("unauthorized"),undefined).permitted,false);
  assert.equal(evaluateAttemptTransition(physical, new Error("timeout"),{httpStatus:503}).permitted,false);
  assert.equal(evaluateAttemptTransition(physical, new Error("late"), {
    httpStatus:503, failureCode:"UPSTREAM_TRANSIENT",failureClass:"upstream",outputStarted:true,
  }).permitted,false);
});
test("R1-03 opaque ingress retains Release F exact protocol evidence and denies all other errors", () => {
  const protocol = new Error("Model does not support this protocol");
  assert.equal(isGatewayProtocolRejection(protocol),true);
  for (const status of [400,422]) assert.equal(evaluateAttemptTransition(ingress,protocol,{
    httpStatus:status,failureClass:"request",failureCode:"PROTOCOL_INCOMPATIBLE",
  }).permitted,true);
  for (const status of [401,403,429,500,502,503,504]) assert.equal(evaluateAttemptTransition(ingress,protocol,{
    httpStatus:status,failureClass:"request",failureCode:"PROTOCOL_INCOMPATIBLE",
  }).permitted,false);
  assert.equal(evaluateAttemptTransition(ingress,protocol,{
    httpStatus:400,failureCode:"REASONING_REPLAY_INVALID",
  }).permitted,false);
});
