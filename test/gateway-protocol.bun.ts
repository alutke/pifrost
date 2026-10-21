import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore -- bun:test is supplied by the Bun CI/runtime, not Node typechecking.
import { test } from "bun:test";

import nativeExtension from "../native.ts";
import { writeCatalogCache } from "../cache.ts";
import type { AliasDiagnostic, BifrostProviderModel, PifrostAliasConfig } from "../index.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

test("OMP Advisor dispatches Responses then Chat using the same Bifrost alias on protocol rejection", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pifrost-gateway-protocol-"));
	const keys = [
		"BIFROST_URL", "BIFROST_VIRTUAL_KEY", "BIFROST_API_KEY",
		"PIFROST_CACHE_FILE", "PIFROST_ALIASES", "PIFROST_CONFIG_DIR",
		"PIFROST_NATIVE_JUDGE_MODEL", "PIFROST_FORCE_REFRESH"
	] as const;
	const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
	try {
		const agent = join(dir, "agent");
		mkdirSync(agent);
		const url = "http://127.0.0.1:8180/v1";
		const vk = "sk-bf-mixed-protocol-test";
		const aliasPath = join(agent, "pifrost.aliases.json");
		const cachePath = join(agent, "pifrost.catalog.json");
		const aliasConfig: PifrostAliasConfig = {
			includePhysicalModels: false,
			aliases: { "omp-advisor": {
				name: "omp-advisor",
				chain: ["opencode-go/muse-spark-1.3-contributor", "CommandCode GOAT/deepseek/deepseek-v4.1-flash"],
			} },
		};
		writeFileSync(aliasPath, JSON.stringify(aliasConfig));
		const model: BifrostProviderModel = {
			id: "omp-advisor", name: "OMP Advisor", reasoning: false,
			input: ["text"], cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 },
			contextWindow: 128000, maxTokens: 8192, supportsTools: true,
			compat: {
				supportsDeveloperRole: false, supportsReasoningEffort: false,
				supportsUsageInStreaming: true,
			},
		};
		const diagnostic: AliasDiagnostic = {
			id: "omp-advisor", name: "OMP Advisor",
			chain: aliasConfig.aliases["omp-advisor"] && !Array.isArray(aliasConfig.aliases["omp-advisor"])
				? aliasConfig.aliases["omp-advisor"].chain : [],
			resolved: [], unresolved: [], image: false, reasoning: false,
			reasoningEfforts: [], tools: true,
			members: [
				{ reference: "opencode-go/muse-spark-1.3-contributor", status: "resolved", protocols: ["openai-responses"] },
				{ reference: "CommandCode GOAT/deepseek/deepseek-v4.1-flash", status: "resolved", protocols: ["openai-completions"] },
			],
		};
		writeCatalogCache({ models: [model], diagnostics: [diagnostic] }, {
			config: { url, virtualKey: vk }, aliasConfig, path: cachePath,
		});
		process.env.BIFROST_URL = url;
		process.env.BIFROST_VIRTUAL_KEY = vk;
		process.env.PIFROST_CACHE_FILE = cachePath;
		process.env.PIFROST_ALIASES = aliasPath;
		process.env.PIFROST_CONFIG_DIR = dir;
		delete process.env.BIFROST_API_KEY;
		delete process.env.PIFROST_NATIVE_JUDGE_MODEL;
		delete process.env.PIFROST_FORCE_REFRESH;

		let provider: Record<string, any> | undefined;
		const pi = {
			registerFlag() {}, getFlag() { return undefined; }, registerCommand() {}, on() {},
			registerProvider(id: string, config: Record<string, any>) {
				if (id === "bifrost") provider = config;
			},
		} as unknown as ExtensionAPI;
		await nativeExtension(pi);
		assert.ok(provider, "Bifrost provider must be registered");
		const attempts: Array<{ url: string; model?: string; protocol?: string; mode?: string; maxOutput?: number; maxCompletion?: number; maxTokens?: number }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			const endpoint = String(input);
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: string; max_output_tokens?: number; max_completion_tokens?: number; max_tokens?: number } : {};
			const headers = new Headers(init?.headers);
			attempts.push({
				url: endpoint,
				model: body.model,
				protocol: headers.get("x-pifrost-route-protocol") ?? undefined,
				mode: headers.get("x-pifrost-route-mode") ?? undefined,
				maxOutput: body.max_output_tokens, maxCompletion: body.max_completion_tokens, maxTokens: body.max_tokens,
			});
			return new Response(JSON.stringify({ error: { message: "Model does not support this protocol.", type: "invalid_request_error" } }), {
				status: 400, headers: { "content-type": "application/json" },
			});
		};
		const agentModel = {
			...model, api: "pifrost-openai-completions", provider: "bifrost", baseUrl: url,
			compatConfig: model.compat,
		};
		const stream = provider!.streamSimple(agentModel, {
			messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: Date.now() }],
		}, { sessionId: "test-session-advisor", apiKey: vk, maxTokens: 128, fetch: fakeFetch });
		for await (const _event of stream) { /* Both gateway errors are expected. */ }
		assert.deepEqual(attempts.map(item => new URL(item.url).pathname), [
			"/v1/responses", "/v1/chat/completions",
		]);
		assert.deepEqual(attempts.map(item => item.model), ["omp-advisor", "omp-advisor"]);
		assert.deepEqual(attempts.map(item => item.protocol), ["openai-responses", "openai-completions"]);
		assert.ok(attempts.every(item => item.mode === "bifrost-direct"));

		// Regression: the same opaque logical route must no longer forward OMP's
		// inflated 712434-token default through either Responses or Chat. Even
		// if a custom onPayload hook raises both fields, final-wire capping wins.
		const oversized = provider!.streamSimple({ ...agentModel, maxTokens: 712434 }, {
			messages: [{ role: "user", content: [{ type: "text", text: "test oversize envelope" }], timestamp: Date.now() }],
		}, {
			sessionId: "test-session-budget", apiKey: vk, maxTokens: 712434, fetch: fakeFetch,
			onPayload: async (payload: Record<string, unknown>) => ({
				...payload, max_output_tokens: 712434, max_completion_tokens: 712434,
			}),
		});
		for await (const _event of oversized) { /* Mock protocol errors are expected. */ }
		assert.equal(attempts.length, 4);
		for (const attempt of attempts.slice(2)) {
			assert.equal(attempt.maxOutput, 393216);
			assert.equal(attempt.maxCompletion, 393216);
			if (attempt.maxTokens !== undefined) assert.ok(attempt.maxTokens <= 393216);
		}
		assert.deepEqual(attempts.slice(2).map(a=>a.model), ["omp-advisor", "omp-advisor"]);

		// F: an ingress protocol probe is permitted only for *verified*
		// unsupported-protocol HTTP 400/422; authorization, quota, reasoning
		// and output errors must not replay the request on a second protocol.
		const cases = [
			{ status:400, detail:"Model does not support this protocol.", expected:2 },
			{ status:422, detail:"Model does not support this protocol.", expected:2 },
			{ status:403, detail:"Model does not support this protocol.", expected:1 },
			{ status:400, detail:"reasoning_content in thinking mode must be passed back to the API", expected:1 },
			{ status:400, detail:"max_output_tokens 712434 exceeds maximum 393216", expected:1 },
			{ status:400, detail:"model permission denied; virtual key blocked", expected:1 },
			{ status:400, detail:"an unrelated request error", expected:1 },
		];
		for (const [index, item] of cases.entries()) {
			const actual: Array<{path:string;model:string | undefined;session:string|null}> = [];
			const caseFetch:typeof fetch = async (input,init)=>{
				const body = typeof init?.body === "string" ? JSON.parse(init.body) as {model?:string} : {};
				const headers = new Headers(init?.headers);
				actual.push({path:new URL(String(input)).pathname,model:body.model,
					session:headers.get("x-bf-session-id")});
				return new Response(JSON.stringify({error:{type:"invalid_request_error",message:item.detail}}),{
					status:item.status,headers:{"content-type":"application/json"},
				});
			};
			const sid="release-f-wire-"+index;
			const stream=provider!.streamSimple(agentModel, {
				messages:[{role:"user",content:[{type:"text",text:"test protocol failover"}],timestamp:Date.now()}],
			}, {sessionId:sid,apiKey:vk,maxTokens:128,fetch:caseFetch});
			try { for await(const _event of stream) {} } catch { /* intentional mock HTTP failure */ }
			assert.equal(actual.length,item.expected,`status ${item.status}: ${item.detail}`);
			assert.ok(actual.every(a=>a.model==="omp-advisor" && a.session===sid),
				"Every attempt must retain original gateway alias and session; no physical rerouting");
			assert.deepEqual(actual.map(a=>a.path),item.expected===2
				? ["/v1/responses","/v1/chat/completions"] : ["/v1/responses"]);
		}

	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		rmSync(dir, { recursive: true, force: true });
	}
}, 20000);
