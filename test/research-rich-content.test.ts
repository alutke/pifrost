import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRepoResearchScreenshotTools } from "../config-store.ts";
import { isPifrostBifrostScreenshotTool, registerBifrostRichContentBridge } from "../bifrost-rich-content.ts";

test("DonSeTch screenshot tool is trusted only with directly attributable Bifrost identity",()=>{
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_donsetch_web_screenshot"),true);
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_web_screenshot"),false);
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_evil_donsetch_web_screenshot"),false);
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_executeToolCode"),false);
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_acme_grabshot",["mcp__bifrost_acme_grabshot"]),true);
 assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_baddie_grabshot",["mcp__bifrost_acme_grabshot"]),false);
});
test("runtime screenshot allow-list comes only from active repo configuration, not global or sibling repos",()=>{
 const home=mkdtempSync(join(tmpdir(),"pifrost-research-"));
 try {
   const project=join(home,"project");mkdirSync(join(project,".omp"),{recursive:true});
   writeFileSync(join(project,".omp","mcp.json"),JSON.stringify({mcpServers:{bifrost:{headers:{"x-bf-vk":"!pifrost secret repo-mcp --id repo-A"}}}}));
   writeFileSync(join(home,"config.json"),JSON.stringify({repos:{"repo-A":{research:{providers:[{id:"g",mcpClient:"acme",profile:"generic",tools:{screenshot:"grabshot"}}]}}},"repo-B":{research:{providers:[{id:"other",mcpClient:"baddie",profile:"generic",tools:{screenshot:"grabshot"}}]}}}}));
   const tools=loadRepoResearchScreenshotTools({PIFROST_CONFIG_DIR:home},join(project,"src"));
   assert.ok(tools.includes("mcp__bifrost_acme_grabshot"));
   assert.ok(!tools.includes("mcp__bifrost_baddie_grabshot"));
 }finally{rmSync(home,{recursive:true,force:true});}
});
test("DonSeTch application-level screenshot failure is never converted to an image",async()=>{
 let handler:any;
 registerBifrostRichContentBridge({on:(name:string,cb:any)=>{if(name==="tool_result")handler=cb;}} as any);
 const result=await handler({toolName:"mcp__bifrost_donsetch_web_screenshot",isError:false,content:[{type:"text",text:'[meta] {"ok":false,"code":"wall.captcha"}\n\n[Image Response: aW52YWxpZA==, MIME: image/png]'}]},{} as any);
 assert.equal(result,undefined);
});
