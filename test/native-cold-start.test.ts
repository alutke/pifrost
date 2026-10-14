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
		"PIFROST_FORCE_REFRESH", "PIFROST_NATIVE_JUDGE_MODEL"
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
		const registered: Array<{ id: string; config: any }> = [];
		const pi = {
			registerFlag() {},
			getFlag() { return undefined; },
			registerProvider(id: string, config: any) { registered.push({ id, config }); },
			registerCommand() {},
			on() {},
		} as Parameters<typeof nativeExtension>[0];
		await nativeExtension(pi);
		const provider = registered.find(value => value.id === "bifrost")?.config;
		assert.ok(provider, "Bifrost provider must register");
		assert.deepEqual(provider.models?.map((item: { id: string }) => item.id), ["omp-cold-start-model"],
			"first interactive launch must have selectable models before registration completes");
		assert.equal(requests, 1);
		const persisted = JSON.parse(readFileSync(cachePath, "utf8"));
		assert.equal(persisted.models.length, 1);
		assert.equal(persisted.aliasFingerprint, aliasConfigFingerprint(JSON.parse(readFileSync(aliasPath, "utf8"))));
		const warmRegistered: Array<{ id: string; config: any }> = [];
		const pi2 = {
			...pi,
			registerProvider(id: string, config: any) { warmRegistered.push({ id, config }); },
		} as Parameters<typeof nativeExtension>[0];
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
