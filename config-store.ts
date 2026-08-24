import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BifrostConfig } from "./index.ts";

export interface PifrostStoredConfig {
	schemaVersion?: number;
	bifrost?: {
		url?: string;
		/**
		 * Management authentication used only by the standalone Pifrost CLI.
		 * `basic` is the Bifrost OSS admin username/password flow; `bearer` is
		 * the scoped API-key flow available to Bifrost Enterprise.
		 */
		managementAuthMode?: "basic" | "bearer";
	};
	repos?: Record<
		string,
		{
			name?: string;
			identity?: string;
			virtualKeyId?: string;
			virtualKeyName?: string;
			mcpClients?: Array<{ name: string; tools: string[] }>;
		}
	>;
}

export interface PifrostStoredSecrets {
	schemaVersion?: number;
	inferenceApiKey?: string;
	inferenceVirtualKey?: string;
	/** Bifrost Enterprise scoped management API key. */
	managementApiKey?: string;
	/** Bifrost OSS dashboard/admin username for HTTP Basic management auth. */
	managementAdminUsername?: string;
	/** Bifrost OSS dashboard/admin password for HTTP Basic management auth. */
	managementAdminPassword?: string;
	repos?: Record<string, { mcpVirtualKey?: string }>;
}

function nonEmpty(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function pifrostConfigDir(env: NodeJS.ProcessEnv = process.env): string {
	return nonEmpty(env.PIFROST_CONFIG_DIR) ?? resolve(homedir(), ".config/pifrost");
}

function readJson<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
	} catch {
		return undefined;
	}
}

export function loadStoredConfig(env: NodeJS.ProcessEnv = process.env): PifrostStoredConfig | undefined {
	return readJson<PifrostStoredConfig>(resolve(pifrostConfigDir(env), "config.json"));
}

export function loadStoredSecrets(env: NodeJS.ProcessEnv = process.env): PifrostStoredSecrets | undefined {
	return readJson<PifrostStoredSecrets>(resolve(pifrostConfigDir(env), "secrets.json"));
}

/**
 * Load the runtime inference connection written by the standalone `pifrost` CLI.
 * This is intentionally inference-only. Neither OSS admin credentials nor an
 * Enterprise management API key are exposed to the OMP extension runtime.
 */
export function loadStoredRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Partial<BifrostConfig> {
	const config = loadStoredConfig(env);
	const secrets = loadStoredSecrets(env);
	return {
		url: nonEmpty(config?.bifrost?.url),
		apiKey: nonEmpty(secrets?.inferenceApiKey),
		virtualKey: nonEmpty(secrets?.inferenceVirtualKey),
	};
}
