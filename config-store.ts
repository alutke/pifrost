import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
export interface PifrostRuntimeConfig {
	url: string;
	apiKey?: string;
	virtualKey?: string;
}

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
			virtualMcps?: string[];
			mcpInstructions?: boolean;
			bifrostSkills?: Array<{ name: string; version?: string; id?: string }>;
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

export interface StoredFileResult<T> {
	value?: T;
	error?: string;
}

function readJsonResult<T>(path: string): StoredFileResult<T> {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { error: `Expected JSON object: ${path}` };
		}
		return { value: parsed as T };
	} catch (error) {
		return {
			error: `${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
		};
	}
}

export function loadStoredConfigResult(env: NodeJS.ProcessEnv = process.env): StoredFileResult<PifrostStoredConfig> {
	return readJsonResult<PifrostStoredConfig>(resolve(pifrostConfigDir(env), "config.json"));
}

export function loadStoredSecretsResult(env: NodeJS.ProcessEnv = process.env): StoredFileResult<PifrostStoredSecrets> {
	return readJsonResult<PifrostStoredSecrets>(resolve(pifrostConfigDir(env), "secrets.json"));
}

export function loadStoredConfig(env: NodeJS.ProcessEnv = process.env): PifrostStoredConfig | undefined {
	return loadStoredConfigResult(env).value;
}

export function loadStoredSecrets(env: NodeJS.ProcessEnv = process.env): PifrostStoredSecrets | undefined {
	return loadStoredSecretsResult(env).value;
}

/**
 * Load the runtime inference connection written by the standalone `pifrost` CLI.
 * This is intentionally inference-only. Neither OSS admin credentials nor an
 * Enterprise management API key are exposed to the OMP extension runtime.
 */
export function storedRuntimeConfigDiagnostics(env: NodeJS.ProcessEnv = process.env): string[] {
	const config = loadStoredConfigResult(env);
	const secrets = loadStoredSecretsResult(env);
	return [config.error, secrets.error].filter((value): value is string => Boolean(value));
}

export function loadStoredRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Partial<PifrostRuntimeConfig> {
	const config = loadStoredConfig(env);
	const secrets = loadStoredSecrets(env);
	return {
		url: nonEmpty(config?.bifrost?.url),
		apiKey: nonEmpty(secrets?.inferenceApiKey),
		virtualKey: nonEmpty(secrets?.inferenceVirtualKey),
	};
}
