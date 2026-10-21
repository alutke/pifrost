import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import nativeExtension from "../native.ts";
import { aliasConfigFingerprint } from "../cache.ts";
import { recordBifrostCaptureTrace, releasePifrostRouteTraces } from "../request-provenance.ts";

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
		"PIFROST_FORCE_REFRESH", "PIFROST_NATIVE_JUDGE_MODEL", "PIFROST_AUTO_SYNC", "PIFROST_STALLED_TURN_MODE"
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
        process.env.PIFROST_STALLED_TURN_MODE = "notice"; // explicit manual-mode integration coverage
        let onDemandRuns = 0;
        let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
        const recoveryMessages:string[] = [];
        const handlers = new Map<string, (...args: any[]) => Promise<void>>();
        const followUps: Array<{ message: any; options: any }> = [];
		const registered: Array<{ id: string; config: any }> = [];
		const pi = {
			registerFlag() {},
			getFlag() { return undefined; },
			registerProvider(id: string, config: any) { registered.push({ id, config }); },
			registerCommand(name: string, opts: any) { if (name === "pifrost") commandHandler=opts.handler; },
            on(name: string, handler: (...args: any[]) => Promise<void>) {
                if (name === "before_agent_start" || name === "agent_end") {
                    // Multiple independent OMP extensions/hooks may subscribe to
                    // the same lifecycle event. Preserve their registration order.
                    const previous = handlers.get(name);
                    handlers.set(name, async (...args: any[]) => {
                        if (previous) await previous(...args);
                        await handler(...args);
                    });
                }
            },
            sendMessage(message: any, options: any) { followUps.push({ message, options }); },
            sendUserMessage(message: string) { recoveryMessages.push(message); },
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
            sessionManager: { getSessionId: () => "cold-start-1" },
            setTimeout() { /* compaction runs only on real OMP session timers */ },
            modelRegistry: {
                async refreshProvider(provider: string, strategy: string) {
                    refreshed.push([provider, strategy]);
                },
            },
        };
        await onPrompt({ type: "before_agent_start", prompt: "Please continue this task" }, ctx);
        await onPrompt({ type: "before_agent_start", prompt: "Please continue this task" }, ctx);
        assert.equal(onDemandRuns, 1, "subsequent prompts are throttled without a background service");
        assert.deepEqual(refreshed, [["bifrost", "online"]], "only the Bifrost model registry is refreshed");
        await onPrompt({ type: "before_agent_start", prompt: "Please continue this task" }, { ...ctx, agent: { kind: "task" } });
        assert.equal(onDemandRuns, 1, "subagent prompts never start management checks");
        await onPrompt({ type: "before_agent_start", prompt: "Please continue this task" }, { ...ctx, agent: { kind: "sub", name: "seance" } });
        assert.equal(onDemandRuns, 1, "isolated seance never invokes Bifrost management reconciliation");
        const onEnd = handlers.get("agent_end");
        assert.ok(onEnd, "OMP main agent end hook is registered");
        const simulatedStall = {
            type: "agent_end",
            messages: [
                { role: "user", content: [{ type: "text", text: "Implement fix" }] },
                { role: "toolResult", toolCallId: "tool-1", content: [{ type: "text", text: "done" }] },
                { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Let's patch the remaining files. </thinking></thinking>" }] },
            ],
        };
        await onEnd(simulatedStall, ctx);
        assert.equal(followUps.length, 0, "explicit notice mode must never enqueue automatically");
        await onEnd(simulatedStall, ctx);
        assert.equal(followUps.length, 0, "duplicate terminal observations must not enqueue");
        assert.ok(commandHandler, "OMP /pifrost recovery command registered");
        const failureSession="cold-start-1";
        recordBifrostCaptureTrace(failureSession,{
          logicalModel:"omp-default",routeMode:"bifrost-direct",protocol:"openai-responses",
          attempt:1,requestedPrimary:"omp-default",outcome:"error",
        },{failureCode:"REASONING_REPLAY_INVALID",httpStatus:400,outputStarted:false});
        const notices:string[]=[];
        const sessions:string[]=[];
        const sessionFile=join(temp,"original-session.jsonl");
        const recoveryCtx={
          mode:"tui",hasUI:true,agent:{kind:"main"},
          isIdle:()=>true,hasPendingMessages:()=>false,
          getAsyncJobSnapshot:()=>({running:[]}),
          sessionManager:{
            getSessionId:()=>failureSession,getSessionFile:()=>sessionFile,
          },
          ui:{
            notify:(message:string)=>notices.push(message),
            input:async()=> "Continue this coding task. Inspect workspace and current tests first.",
            confirm:async()=>true,
          },
          newSession:async (opts:{parentSession?:string})=>{
            sessions.push(opts.parentSession??"");
            return {cancelled:false};
          },
        };
        await commandHandler("stalled status",recoveryCtx);
        assert.ok(notices.some(x=>x.includes("possible stalled") || x.includes("possible stalled planning")), "must expose pending observation");
        assert.equal(followUps.length,0);
        await commandHandler("stalled continue",recoveryCtx);
        assert.equal(followUps.length,1,"approval queues exactly one OMP continuation");
        assert.equal(followUps[0]?.message.attribution,"agent","continuation is not impersonated as user input");
        assert.equal(followUps[0]?.options.triggerTurn,true);
        assert.equal(followUps[0]?.options.deliverAs,"followUp");
        await commandHandler("stalled continue",recoveryCtx);
        assert.equal(followUps.length,1,"consumed continuation cannot run twice");
        await commandHandler("recover status",recoveryCtx);
        assert.ok(notices.some(x=>x.includes("REASONING_REPLAY_INVALID")));
        assert.equal(recoveryMessages.length,0,"status never enqueues a user turn");
        await commandHandler("recover fork",recoveryCtx);
        assert.deepEqual(sessions,[sessionFile],"uses OMP native parent-session link");
        assert.equal(recoveryMessages.length,1,"one new user-authored brief, no original transcript");
        assert.match(recoveryMessages[0]!,/Inspect workspace and current tests first/u);
        assert.doesNotMatch(recoveryMessages[0]!,/Let's patch the remaining files|<thinking>/u);
        releasePifrostRouteTraces(failureSession);

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

		// Regression: settings are read per OMP extension instance, not once
		// when native.ts was imported; no daemon or global state survives restart.
		const bootInMode = async (mode: string | undefined) => {
			if (mode === undefined) delete process.env.PIFROST_STALLED_TURN_MODE;
			else process.env.PIFROST_STALLED_TURN_MODE = mode;
			const sent: Array<{message:any,options:any}> = [];
			let end: ((event:any, ctx:any) => void | Promise<void>) | undefined;
			await nativeExtension({
				...pi,
				registerProvider() {},
				registerCommand() {},
				on(name:string, listener:(event:any,ctx:any)=>void|Promise<void>) {
					if (name === "agent_end") end = listener;
				},
				sendMessage(message:any, options:any) { sent.push({message,options}); },
			} as unknown as Parameters<typeof nativeExtension>[0]);
			assert.ok(end);
			await end(simulatedStall,ctx);
			await end(simulatedStall,ctx);
			return sent;
		};
		assert.equal((await bootInMode("off")).length,0, "off mode must suppress native hook follow-ups");
		assert.equal((await bootInMode(undefined)).length,1, "unset mode must default to bounded automatic follow-up");
		assert.equal(requests,1,"restarting extension in each mode must use cached models");
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
