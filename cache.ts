import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
	AliasDiagnostic,
	BifrostConfig,
	BifrostProviderModel,
	PifrostAliasConfig,
	PifrostCatalog,
} from "./index.ts";

const CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
export const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

interface CatalogCacheFile {
	schemaVersion: number;
	generatedAt: string;
	url: string;
	virtualKeyFingerprint: string;
	aliasFingerprint: string;
	models: BifrostProviderModel[];
	diagnostics: AliasDiagnostic[];
}

export interface LoadedCatalogCache extends PifrostCatalog {
	path: string;
	generatedAt: number;
	ageMs: number;
}

export interface CatalogCacheOptions {
	config: BifrostConfig;
	aliasConfig?: PifrostAliasConfig;
	path?: string;
	now?: number;
	maxAgeMs?: number;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function agentDir(env: NodeJS.ProcessEnv = process.env): string {
	return nonEmpty(env.PI_CODING_AGENT_DIR) ?? join(homedir(), ".omp", "agent");
}

export function catalogCachePath(env: NodeJS.ProcessEnv = process.env): string {
	return nonEmpty(env.PIFROST_CACHE_FILE) ?? join(agentDir(env), "pifrost.catalog.json");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, nested]) => [key, canonical(nested)]),
		);
	}
	return value;
}

export function aliasConfigFingerprint(aliasConfig?: PifrostAliasConfig): string {
	return sha256(JSON.stringify(canonical(aliasConfig ?? null)));
}

export function virtualKeyFingerprint(virtualKey?: string): string {
	return sha256(nonEmpty(virtualKey) ?? "");
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validModel(value: unknown): value is BifrostProviderModel {
	if (!value || typeof value !== "object") return false;
	const model = value as Partial<BifrostProviderModel>;
	if (typeof model.id !== "string" || !model.id) return false;
	if (typeof model.name !== "string" || !model.name) return false;
	if (!positiveInteger(model.contextWindow) || !positiveInteger(model.maxTokens)) return false;
	if (!Array.isArray(model.input) || !model.input.includes("text")) return false;
	if (typeof model.reasoning !== "boolean" || typeof model.supportsTools !== "boolean") return false;
	if (!model.cost || !Object.values(model.cost).every(finiteNonNegative)) return false;
	if (!model.compat || typeof model.compat !== "object") return false;
	if (typeof model.compat.supportsDeveloperRole !== "boolean") return false;
	if (typeof model.compat.supportsReasoningEffort !== "boolean") return false;
	if (typeof model.compat.supportsUsageInStreaming !== "boolean") return false;
	return true;
}

function validDiagnostics(value: unknown): value is AliasDiagnostic[] {
	return Array.isArray(value) && value.every((item) => {
		if (!item || typeof item !== "object") return false;
		const diagnostic = item as Partial<AliasDiagnostic>;
		return (
			typeof diagnostic.id === "string" &&
			typeof diagnostic.name === "string" &&
			Array.isArray(diagnostic.chain) &&
			Array.isArray(diagnostic.resolved) &&
			Array.isArray(diagnostic.unresolved)
		);
	});
}

export function loadCatalogCache(options: CatalogCacheOptions): LoadedCatalogCache | undefined {
	const path = options.path ?? catalogCachePath();
	if (!existsSync(path)) return undefined;

	let parsed: CatalogCacheFile;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8")) as CatalogCacheFile;
	} catch {
		return undefined;
	}

	if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return undefined;
	if (parsed.url !== options.config.url) return undefined;
	if (parsed.virtualKeyFingerprint !== virtualKeyFingerprint(options.config.virtualKey)) return undefined;
	if (parsed.aliasFingerprint !== aliasConfigFingerprint(options.aliasConfig)) return undefined;
	if (!Array.isArray(parsed.models) || parsed.models.length === 0 || !parsed.models.every(validModel)) return undefined;
	if (!validDiagnostics(parsed.diagnostics)) return undefined;

	const generatedAt = Date.parse(parsed.generatedAt);
	if (!Number.isFinite(generatedAt)) return undefined;
	const now = options.now ?? Date.now();
	const ageMs = Math.max(0, now - generatedAt);
	if (ageMs > (options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS)) return undefined;

	return {
		path,
		generatedAt,
		ageMs,
		models: parsed.models,
		diagnostics: parsed.diagnostics,
	};
}

export function writeCatalogCache(
	catalog: PifrostCatalog,
	options: CatalogCacheOptions,
): string {
	if (!catalog.models.length) throw new Error("Refusing to cache an empty Pifrost catalog");
	const path = options.path ?? catalogCachePath();
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

	const payload: CatalogCacheFile = {
		schemaVersion: CACHE_SCHEMA_VERSION,
		generatedAt: new Date(options.now ?? Date.now()).toISOString(),
		url: options.config.url,
		virtualKeyFingerprint: virtualKeyFingerprint(options.config.virtualKey),
		aliasFingerprint: aliasConfigFingerprint(options.aliasConfig),
		models: catalog.models,
		diagnostics: catalog.diagnostics,
	};

	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try {
			if (existsSync(temporary)) unlinkSync(temporary);
		} catch {
			// Best-effort cleanup only.
		}
	}
	return path;
}

export function cacheIsFresh(
	cache: Pick<LoadedCatalogCache, "ageMs">,
	refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
): boolean {
	return cache.ageMs < refreshIntervalMs;
}
