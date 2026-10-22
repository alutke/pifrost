import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { postMcpJsonRpc, McpAmbiguousToolOutcomeError } from "../mcp-rpc.mjs";
import { callMcpGatewayTool } from "../cli-lib.mjs";
import { normalizeMcpClientShape, mcpClientExecutionDiagnostics } from "../mcp-client-shape.mjs";

async function withServer(handler, run) {
  const server=createServer(handler);
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  try{
    const address=server.address();
    if(!address || typeof address==="string")throw Error("no ephemeral test port");
    return await run(`http://127.0.0.1:${address.port}/v1/mcp`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
function request() {return {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"append_audit_record",arguments:{record:"fixture"}}}}

test("R5D-01 disposable MCP server commits then drops socket; one Pifrost call cannot replay a mutation",async()=>{
  let commits=0,wireCalls=0;
  await withServer(async(req,res)=>{
    wireCalls++;
    for await(const _chunk of req) {/* Read the whole dispatched RPC body */ }
    commits++;
    res.socket?.destroy();
  },async endpoint=>{
    await assert.rejects(
      postMcpJsonRpc(endpoint,"test-only-vk",request(),{timeoutMs:3_000}),
      error=>error instanceof McpAmbiguousToolOutcomeError &&
        error.code==="MCP_OUTCOME_UNCERTAIN" &&
        !JSON.stringify(error).includes("test-only-vk"),
    );
  });
  assert.equal(commits,1,"remote operation was already committed before response failed");
  assert.equal(wireCalls,1,"Pifrost did not retry even though the tool's result is unknown");
});

test("R5D-02 post-commit HTTP 503 is ambiguous even when JSON-RPC body is an error",async()=>{
  let commits=0,wireCalls=0;
  await withServer(async(req,res)=>{
    wireCalls++;
    for await(const _chunk of req){}
    commits++;
    res.writeHead(503,{"content-type":"application/json"});
    res.end(JSON.stringify({jsonrpc:"2.0",id:3,error:{code:-32000,message:"transient transport"}}));
  },async endpoint=>{
    await assert.rejects(
      callMcpGatewayTool(endpoint.replace(/\/v1\/mcp$/u,"/v1"),"test-only-vk","append_audit_record",{}, {timeoutMs:3_000}),
      error=>error instanceof McpAmbiguousToolOutcomeError && /may have committed/u.test(error.message),
    );
  });
  assert.equal(commits,1);
  assert.equal(wireCalls,1);
});

test("R5D-03 read-only MCP discovery still accepts normal results; tool signatures remain untouched",async()=>{
  const received=[];
  await withServer(async(req,res)=>{
    let body="";
    for await(const chunk of req)body+=chunk.toString("utf8");
    const call=JSON.parse(body);received.push(call);
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({jsonrpc:"2.0",id:call.id,result:{tools:[{name:"read_file",annotations:{readOnlyHint:true}}]}}));
  },async endpoint=>{
    const response=await postMcpJsonRpc(endpoint,"test-only-vk",{jsonrpc:"2.0",id:9,method:"tools/list",params:{}},{timeoutMs:3_000});
    assert.equal(response.ok,true);
    assert.deepEqual(response.body.result.tools[0].annotations,{readOnlyHint:true});
  });
  assert.equal(received.length,1);
  assert.equal(received[0].method,"tools/list");
});

test("R5D-04 annotations are advisory; known read-only auto execution is distinguished from unsafe mutation",()=>{
  const client=normalizeMcpClientShape({
    config:{name:"repo-tools",tools_to_execute:["*"],tools_to_auto_execute:["*"]},
    tools:[
      {name:"get_status",annotations:{readOnlyHint:true,idempotentHint:true}},
      {name:"create_ticket",annotations:{readOnlyHint:false,idempotentHint:false,destructiveHint:false}},
      {name:"delete_workspace",annotations:{destructiveHint:true,idempotentHint:false}},
      {name:"unknown_operation"},
      {name:"update_status",annotations:{idempotentHint:true}},
    ],
  });
  const result=mcpClientExecutionDiagnostics(client,["*"]);
  assert.equal(result.unsafeAutoExecuteCount,3);
  assert.equal(result.mutationRiskRows.find(x=>x.tool==="get_status").risk,"annotated-read-only");
  assert.equal(result.mutationRiskRows.find(x=>x.tool==="create_ticket").risk,"non-idempotent");
  assert.equal(result.mutationRiskRows.find(x=>x.tool==="delete_workspace").risk,"non-idempotent");
  assert.equal(result.mutationRiskRows.find(x=>x.tool==="unknown_operation").risk,"unverified");
  assert.equal(result.mutationRiskRows.find(x=>x.tool==="update_status").risk,"annotated-idempotent");
  assert.ok(result.warnings.some(x=>x.includes("#8795")&&x.includes("create_ticket")));
  assert.ok(result.warnings.some(x=>x.includes("auto-execute wildcard")));
  assert.ok(!result.warnings.some(x=>x.includes("auto-execute get_status is")));
  const narrowed=mcpClientExecutionDiagnostics(client,["get_status","create_ticket"]);
  assert.equal(narrowed.unsafeAutoExecuteCount,1);
  assert.equal(narrowed.grantedCount,2);
  assert.equal(client.toolsToAutoExecute[0],"*","Pifrost diagnostics must not change Bifrost's actual grant");
});

test("R5D-05 no auto-execute permission means zero unsafe automatic mutations without disabling explicit tools",()=>{
  const client=normalizeMcpClientShape({
    config:{name:"manual",tools_to_execute:["*"],tools_to_auto_execute:[]},
    tools:[{name:"create_ticket",annotations:{idempotentHint:false}}],
  });
  const result=mcpClientExecutionDiagnostics(client);
  assert.equal(result.executableCount,1);
  assert.equal(result.autoExecutableCount,0);
  assert.equal(result.unsafeAutoExecuteCount,0);
  assert.equal(result.warnings.length,0);
});
