import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	cacheIsFresh,
	CATALOG_CACHE_SCHEMA_VERSION,
	loadCatalogCache,
	writeCatalogCache,
} from "../cache.ts";
import type {
	AliasDiagnostic,
	BifrostConfig,
	BifrostProviderModel,
	PifrostAliasConfig,
	PifrostCatalog,
} from "../index.ts";

function fixture(): {
	config: BifrostConfig;
	aliasConfig: PifrostAliasConfig;
	catalog: PifrostCatalog;
} {
	const model: BifrostProviderModel = {
		id: "omp-test",
		name: "OMP Test",
		reasoning: true,
		thinking: {
			mode: "effort",
			efforts: ["high", "max"] as NonNullable<BifrostProviderModel["thinking"]>["efforts"],
		},
		input: ["text", "image"],
		cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		supportsTools: true,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
		},
	};
	const diagnostic: AliasDiagnostic = {
		id: "omp-test",
		name: "OMP Test",
		chain: ["provider/model"],
		resolved: ["provider/model -> provider/model"],
		unresolved: [],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		image: true,
		reasoning: true,
		reasoningEfforts: ["high", "max"],
		tools: true,
	};
	return {
		config: {
			url: "http://bifrost.example/v1",
			apiKey: "api-secret-do-not-cache",
			virtualKey: "vk-secret-do-not-cache",
		},
		aliasConfig: {
			includePhysicalModels: false,
			aliases: { "omp-test": ["provider/model"] },
		},
		catalog: { models: [model], diagnostics: [diagnostic] },
	};
}

function withTempCache(run: (path: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "pifrost-cache-test-"));
	try {
		run(join(directory, "catalog.json"));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("last-known-good catalog round-trips without persisting credentials", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		const loaded = loadCatalogCache({ config, aliasConfig, path, now: 11_000 });
		assert.ok(loaded);
		assert.deepEqual(loaded.models, catalog.models);
		assert.deepEqual(loaded.diagnostics, catalog.diagnostics);
		assert.equal(loaded.ageMs, 1_000);

		const raw = readFileSync(path, "utf8");
		assert.doesNotMatch(raw, /api-secret-do-not-cache/);
		assert.doesNotMatch(raw, /vk-secret-do-not-cache/);
		assert.equal(JSON.parse(raw).schemaVersion, CATALOG_CACHE_SCHEMA_VERSION);
	});
});

test("cache is invalidated when the alias manifest changes", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		const changed: PifrostAliasConfig = {
			includePhysicalModels: false,
			aliases: { "omp-test": ["provider/different-model"] },
		};
		assert.equal(loadCatalogCache({ config, aliasConfig: changed, path, now: 11_000 }), undefined);
	});
});

test("cache is scoped to the inference virtual key without storing the key", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		const otherConfig = { ...config, virtualKey: "different-vk" };
		assert.equal(loadCatalogCache({ config: otherConfig, aliasConfig, path, now: 11_000 }), undefined);
	});
});

test("cache older than the safety horizon is ignored", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		assert.equal(
			loadCatalogCache({ config, aliasConfig, path, now: 20_001, maxAgeMs: 10_000 }),
			undefined,
		);
	});
});

test("older cache schemas are rejected after resolver upgrades", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		const raw = JSON.parse(readFileSync(path, "utf8"));
		raw.schemaVersion = CATALOG_CACHE_SCHEMA_VERSION - 1;
		writeFileSync(path, `${JSON.stringify(raw)}\n`);
		assert.equal(loadCatalogCache({ config, aliasConfig, path, now: 11_000 }), undefined);
	});
});

test("PIFROST_FORCE_REFRESH bypasses an otherwise valid startup cache", () => {
	withTempCache((path) => {
		const { config, aliasConfig, catalog } = fixture();
		writeCatalogCache(catalog, { config, aliasConfig, path, now: 10_000 });
		const previous = process.env.PIFROST_FORCE_REFRESH;
		try {
			process.env.PIFROST_FORCE_REFRESH = "1";
			assert.equal(loadCatalogCache({ config, aliasConfig, path, now: 11_000 }), undefined);
		} finally {
			if (previous === undefined) delete process.env.PIFROST_FORCE_REFRESH;
			else process.env.PIFROST_FORCE_REFRESH = previous;
		}
	});
});

test("refresh interval distinguishes fast startup cache from refresh-due cache", () => {
	assert.equal(cacheIsFresh({ ageMs: 999 }, 1_000), true);
	assert.equal(cacheIsFresh({ ageMs: 1_000 }, 1_000), false);
});
