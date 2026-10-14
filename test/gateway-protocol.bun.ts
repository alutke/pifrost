import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
				chain: ["opencode-go/muse-spark-1.3-contributor", "Xiaomi MIMO/mimo-v2.6-flash"],
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
				{ reference: "Xiaomi MIMO/mimo-v2.6-flash", status: "resolved", protocols: ["openai-completions"] },
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
		const attempts: Array<{ url: string; model?: string; protocol?: string; mode?: string }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			const endpoint = String(input);
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: string } : {};
			const headers = new Headers(init?.headers);
			attempts.push({
				url: endpoint,
				model: body.model,
				protocol: headers.get("x-pifrost-route-protocol") ?? undefined,
				mode: headers.get("x-pifrost-route-mode") ?? undefined,
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
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		rmSync(dir, { recursive: true, force: true });
	}
});
