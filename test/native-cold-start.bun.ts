import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import nativeExtension from "../native.ts";
import { aliasConfigFingerprint } from "../cache.ts";

test("OMP cold startup registers discoverable models before returning, then reuses cache", async () => {
	const temp = mkdtempSync(join(tmpdir(), "pifrost-omp-cold-start-"));
	const aliasPath = join(temp, "aliases.json");
	const cachePath = join(temp, "catalog.json");
	const configDir = join(temp, "config");
	mkdirSync(configDir);
	writeFileSync(aliasPath, JSON.stringify({ includePhysicalModels: false, aliases: {} }));
	let requests = 0;
	const server = createServer((req, res) => {
		if (req.url !== "/v1/models") { res.writeHead(404); res.end(); return; }
		requests += 1;
		assert.equal(req.headers["x-bf-vk"], "sk-bf-cold-start-fixture");
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ data: [{
			id: "omp-cold-start-model",
			name: "Cold Start Fixture",
			context_length: 128000,
			max_output_tokens: 8192,
			architecture: { input_modalities: ["text"] },
			supported_parameters: ["tools", "tool_choice"],
		}] }));
	});
	const keys = [
		"BIFROST_URL", "BIFROST_API_KEY", "BIFROST_VIRTUAL_KEY",
		"PIFROST_CONFIG_DIR", "PIFROST_ALIASES", "PIFROST_CACHE_FILE",
		"PIFROST_FORCE_REFRESH", "PIFROST_NATIVE_JUDGE_MODEL", "PIFROST_AUTO_SYNC"
	] as const;
	const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Server address missing");
		process.env.BIFROST_URL = `http://127.0.0.1:${address.port}/v1`;
		process.env.BIFROST_VIRTUAL_KEY = "sk-bf-cold-start-fixture";
		process.env.PIFROST_CONFIG_DIR = configDir;
		process.env.PIFROST_ALIASES = aliasPath;
		process.env.PIFROST_CACHE_FILE = cachePath;
		delete process.env.BIFROST_API_KEY;
		delete process.env.PIFROST_FORCE_REFRESH;
		delete process.env.PIFROST_NATIVE_JUDGE_MODEL;
        delete process.env.PIFROST_AUTO_SYNC;
        let onDemandRuns = 0;
        const handlers = new Map<string, (...args: any[]) => Promise<void>>();
		const registered: Array<{ id: string; config: any }> = [];
		const pi = {
			registerFlag() {},
			getFlag() { return undefined; },
			registerProvider(id: string, config: any) { registered.push({ id, config }); },
			registerCommand() {},
            on(name: string, handler: (...args: any[]) => Promise<void>) {
                if (name === "before_agent_start") handlers.set(name, handler);
            },
            async exec(command: string, args: string[]) {
                assert.equal(command, "pifrost");
                assert.deepEqual(args, ["routes", "reconcile", "--json"]);
                onDemandRuns++;
                return { code: 0, stdout: JSON.stringify({ schemaVersion: 1, status: "updated" }), stderr: "" };
            },
		} as unknown as Parameters<typeof nativeExtension>[0];
		await nativeExtension(pi);
		const provider = registered.find(value => value.id === "bifrost")?.config;
		assert.ok(provider, "Bifrost provider must register");
		assert.deepEqual(provider.models?.map((item: { id: string }) => item.id), ["omp-cold-start-model"],
			"first interactive launch must have selectable models before registration completes");
		assert.equal(requests, 1);
        const onPrompt = handlers.get("before_agent_start");
        assert.ok(onPrompt, "OMP registers a prompt-triggered sync handler, not a background timer");
        const refreshed: Array<[string, string]> = [];
        const ctx = {
            agent: { kind: "main" }, hasUI: false,
            modelRegistry: {
                async refreshProvider(provider: string, strategy: string) {
                    refreshed.push([provider, strategy]);
                },
            },
        };
        await onPrompt({ type: "before_agent_start" }, ctx);
        await onPrompt({ type: "before_agent_start" }, ctx);
        assert.equal(onDemandRuns, 1, "subsequent prompts are throttled without a background service");
        assert.deepEqual(refreshed, [["bifrost", "online"]], "only the Bifrost model registry is refreshed");
        await onPrompt({ type: "before_agent_start" }, { ...ctx, agent: { kind: "task" } });
        assert.equal(onDemandRuns, 1, "subagent prompts never start management checks");
        await onPrompt({ type: "before_agent_start" }, { ...ctx, agent: { kind: "sub", name: "seance" } });
        assert.equal(onDemandRuns, 1, "isolated seance never invokes Bifrost management reconciliation");
		const persisted = JSON.parse(readFileSync(cachePath, "utf8"));
		assert.equal(persisted.models.length, 1);
		assert.equal(persisted.aliasFingerprint, aliasConfigFingerprint(JSON.parse(readFileSync(aliasPath, "utf8"))));
		const warmRegistered: Array<{ id: string; config: any }> = [];
		const pi2 = {
			...pi,
			registerProvider(id: string, config: any) { warmRegistered.push({ id, config }); },
		} as unknown as Parameters<typeof nativeExtension>[0];
		await nativeExtension(pi2);
		assert.deepEqual(warmRegistered.find(value => value.id === "bifrost")?.config.models?.map(
			(item: { id: string }) => item.id
		), ["omp-cold-start-model"]);
		assert.equal(requests, 1, "warm startup must remain offline/cache-first");
	} finally {
		for (const key of keys) {
			const value = before[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(temp, { recursive: true, force: true });
	}
});


test("native judgment registrations preserve OMP wire dialects and explicit image opt-in", async()=>{
 const temp=mkdtempSync(join(tmpdir(),"pifrost-judge-integration-"));
 const keys=["BIFROST_URL","BIFROST_VIRTUAL_KEY","BIFROST_API_KEY","PIFROST_NATIVE_JUDGE_MODEL",
 "PIFROST_NATIVE_JUDGE_IMAGES","PIFROST_CONFIG_DIR","PIFROST_ALIASES","PIFROST_CACHE_FILE","PIFROST_AUTO_SYNC"];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const aliasPath=join(temp,"aliases.json"),cachePath=join(temp,"cache.json");
 writeFileSync(aliasPath,JSON.stringify({includePhysicalModels:false,aliases:{}}));
 const server=createServer((req,res)=>{
   res.setHeader("Content-Type","application/json");
   if(req.url==="/v1/models")res.end(JSON.stringify({data:[{
     id:"fixture",kind:"chat",context_length:128000,max_output_tokens:8192,
     architecture:{input_modalities:["text"]},supported_parameters:["tools"]
   }]}));
   else {res.writeHead(404);res.end("{}");}
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const address=server.address();
  if(!address || typeof address==="string")throw Error("Server address missing");
  process.env.BIFROST_URL="http://127.0.0.1:"+address.port+"/v1";
  process.env.BIFROST_VIRTUAL_KEY="sk-bf-test-judge";
  process.env.PIFROST_ALIASES=aliasPath;process.env.PIFROST_CACHE_FILE=cachePath;
  process.env.PIFROST_CONFIG_DIR=temp;process.env.PIFROST_AUTO_SYNC="0";
  delete process.env.BIFROST_API_KEY;
  const cases=[
   {selection:"jev-1.14.0",image:"1",api:"typesafe",path:"/typesafe",wire:"jev-1.14.0"},
   {selection:"openai/gpt-6-luna",image:"1",api:"openai-decisions",path:"/openai/v1",wire:"gpt-6-luna"},
   {selection:"jev-1.14.0",image:"0",api:"typesafe",path:"/typesafe",wire:"jev-1.14.0"},
  ];
  for(const c of cases){
   process.env.PIFROST_NATIVE_JUDGE_MODEL=c.selection;
   process.env.PIFROST_NATIVE_JUDGE_IMAGES=c.image;
   const registered: Array<{id:string,config:any}>=[];
   await nativeExtension({
     registerFlag(){},getFlag(){return undefined;},
     registerProvider(id:string,config:any){registered.push({id,config});},
     registerCommand(){},on(){},
   } as unknown as Parameters<typeof nativeExtension>[0]);
   const judgment=registered.find(x=>x.id==="bifrost-judge")?.config;
   assert.ok(judgment,"native judge must register in the extension");
   assert.equal(judgment.api,c.api);assert.ok(judgment.baseUrl.endsWith(c.path));
   assert.equal(judgment.models[0].requestModelId??judgment.models[0].id,c.wire);
   assert.deepEqual(judgment.models[0].input,c.image==="1"?["text","image"]:["text"]);
   assert.equal(registered.filter(x=>x.id==="bifrost").length,1);
  }
 }finally{
   for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]!;}
   await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   rmSync(temp,{recursive:true,force:true});
 }
});
