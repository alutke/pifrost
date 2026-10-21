import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { postMcpJsonRpc } from "../mcp-rpc.mjs";
import { requestJson } from "../http-client.mjs";

async function runServers(run) {
  const received = [];
  const destination = createServer((request,response)=>{
    received.push({url:request.url,secret:request.headers["x-bf-vk"] ?? request.headers.authorization});
    response.setHeader("content-type","application/json");
    response.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{ok:true}}));
  });
  await new Promise(resolve=>destination.listen(0,"127.0.0.1",resolve));
  const where = destination.address();
  const redirected = createServer((_request,response)=>{
    response.writeHead(307,{Location:`http://127.0.0.1:${where.port}/leak`});
    response.end();
  });
  await new Promise(resolve=>redirected.listen(0,"127.0.0.1",resolve));
  try {
    return await run(`http://127.0.0.1:${redirected.address().port}`,received);
  } finally {
    await Promise.all([new Promise(resolve=>redirected.close(resolve)),new Promise(resolve=>destination.close(resolve))]);
  }
}
test("R3-07 management and MCP Virtual Key requests never follow a 307 cross-host redirect",async()=>{
  await runServers(async(url,received)=>{
    await assert.rejects(requestJson(url,{headers:{Authorization:"Bearer secret"},body:{x:1}}));
    await assert.rejects(postMcpJsonRpc(url,"secret",{jsonrpc:"2.0",id:1,method:"tools/list"}));
    assert.deepEqual(received,[],"no credentials sent to redirect destination");
  });
});
test("R3-08 MCP actual streamed SSE byte count bounded even with dishonest length",async()=>{
  let cancelled = false;
  const chunks = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: '+ "x".repeat(200))); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(postMcpJsonRpc("https://invalid.example/mcp","secret",
    {jsonrpc:"2.0",id:1,method:"tools/list"},
    {maxResponseBytes:64,fetch:async()=>new Response(chunks,{status:200,headers:{"content-type":"text/event-stream","content-length":"1"}})}),
    /response exceeds 64 bytes/u);
  assert.equal(cancelled,true);
});
test("R3-09 MCP responses parse matching JSON-RPC events within bounded stream",async()=>{
  const data=[
    'data: {"jsonrpc":"2.0","method":"notifications/message"}',
    '',
    'data: {"jsonrpc":"2.0","id":14,"result":{"tools":[{"name":"a"}]}}',
    '',
  ].join("\n");
  const result=await postMcpJsonRpc("https://invalid.example/mcp","secret",
    {jsonrpc:"2.0",id:14,method:"tools/list"}, {
      fetch:async(_url,options)=>{
        assert.equal(options.redirect,"error");
        assert.equal(options.headers["x-bf-vk"],"secret");
        return new Response(data,{status:200,headers:{"content-type":"text/event-stream"}});
      }
    });
  assert.equal(result.ok,true);
  assert.deepEqual(result.body.result.tools,[{name:"a"}]);
});
test("R3-10 an oversized declared MCP Content-Length is rejected before parsing",async()=>{
  await assert.rejects(postMcpJsonRpc("https://invalid.example/mcp","secret",
    {id:1,method:"tools/list"},
    {maxResponseBytes:32,fetch:async()=>new Response("{}",{status:200,headers:{"content-length":"99999"}})}),
    /response exceeds 32 bytes/u);
});
