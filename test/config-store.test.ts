import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadStoredRuntimeConfig } from "../config-store.ts";

test("loads inference-only runtime configuration from the Pifrost store", () => {
	const root = join(tmpdir(), `pifrost-store-${process.pid}-${Date.now()}`);
	mkdirSync(root, { recursive: true });
	try {
		writeFileSync(
			join(root, "config.json"),
			JSON.stringify({ schemaVersion: 1, bifrost: { url: "http://bifrost/v1" } }),
		);
		writeFileSync(
			join(root, "secrets.json"),
			JSON.stringify({
				schemaVersion: 1,
				inferenceApiKey: "inference-api",
				inferenceVirtualKey: "inference-vk",
				managementApiKey: "management-must-not-leak",
			}),
		);
		assert.deepEqual(loadStoredRuntimeConfig({ PIFROST_CONFIG_DIR: root }), {
			url: "http://bifrost/v1",
			apiKey: "inference-api",
			virtualKey: "inference-vk",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed stored files fail closed rather than throwing during OMP startup", () => {
	const root = join(tmpdir(), `pifrost-store-bad-${process.pid}-${Date.now()}`);
	mkdirSync(root, { recursive: true });
	try {
		writeFileSync(join(root, "config.json"), "not-json");
		writeFileSync(join(root, "secrets.json"), "also-not-json");
		assert.deepEqual(loadStoredRuntimeConfig({ PIFROST_CONFIG_DIR: root }), {
			url: undefined,
			apiKey: undefined,
			virtualKey: undefined,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
