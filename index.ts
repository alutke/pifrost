import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export const PROVIDER_ID = "bifrost";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;
const THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

type Fetch = typeof globalThis.fetch;
type Effort = (typeof THINKING_EFFORTS)[number];
type ProviderHeaders = Record<string, string | null>;

export interface ThinkingConfig {
	mode: "effort";
	efforts: Effort[];
	defaultLevel?: Effort;
	effortMap?: Partial<Record<Effort, string>>;
	requiresEffort?: boolean;
}

export interface BifrostConfig {
	url: string;
	apiKey?: string;
	virtualKey?: string;
}

export interface BifrostModelResponse {
	data?: BifrostModel[];
}

export interface BifrostModel {
	id?: string;
	name?: string;
	normalized_name?: string;
	context_length?: number;
	max_input_tokens?: number;
	max_output_tokens?: number;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
	};
	pricing?: {
		prompt?: string | number;
		completion?: string | number;
		input_cache_read?: string | number;
		input_cache_write?: string | number;
	};
	top_provider?: {
		context_length?: number;
		max_completion_tokens?: number;
	};
	per_request_limits?: {
		prompt_tokens?: number;
		completion_tokens?: number;
	};
	supported_parameters?: string[];
	supported_methods?: string[];
	reasoning?: {
		mandatory?: boolean;
		default_enabled?: boolean;
		supported_efforts?: string[];
		default_effort?: string;
	};
}

export interface BifrostProviderModel {
	id: string;
	name: string;
	reasoning: boolean;
	thinking?: ThinkingConfig;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	/** Diagnostic capability. OMP defaults to normal tool support when this field is absent upstream. */
	supportsTools: boolean;
	compat: {
		supportsDeveloperRole: boolean;
		supportsReasoningEffort: boolean;
		supportsUsageInStreaming: boolean;
	};
}

export interface PifrostAliasDefinition {
	name?: string;
	chain: string[];
}

export interface PifrostAliasConfig {
	includePhysicalModels?: boolean;
	aliases: Record<string, PifrostAliasDefinition | string[]>;
}

export interface AliasDiagnostic {
	id: string;
	name: string;
	chain: string[];
	resolved: string[];
	unresolved: string[];
	contextWindow?: number;
	maxTokens?: number;
	image: boolean;
	reasoning: boolean;
	reasoningEfforts: string[];
	tools: boolean;
}

export interface PifrostCatalog {
	models: BifrostProviderModel[];
	diagnostics: AliasDiagnostic[];
}

export interface NativeProviderConfig {
	baseUrl: string;
	apiKey: string;
	api: "openai-completions";
	authHeader: true;
	headers: Record<string, string>;
	fetchDynamicModels(apiKey: string | undefined): Promise<readonly BifrostProviderModel[]>;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function flagFromArgv(name: string, argv: readonly string[] = process.argv.slice(2)): string | undefined {
	const flag = `--${name}`;
	let result: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument.startsWith(`${flag}=`)) {
			result = nonEmpty(argument.slice(flag.length + 1));
		} else if (argument === flag) {
			const next = argv[index + 1];
			if (next && !next.startsWith("--")) result = nonEmpty(next);
		}
	}
	return result;
}

/** Normalize a Bifrost instance URL to the OpenAI-compatible /v1 mount used by OMP. */
export function normalizeBifrostUrl(value: string): string {
	const input = value.trim();
	if (!input) throw new Error("BIFROST_URL is required");

	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw new Error(`Invalid BIFROST_URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("BIFROST_URL must use http:// or https://");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("BIFROST_URL must not contain a query string or fragment");
	}

	let path = parsed.pathname.replace(/\/+$/u, "");
	path = path.replace(/\/(?:chat\/completions|models)$/u, "");
	if (!/\/v1$/u.test(path)) {
		path = /\/openai$/u.test(path) ? `${path}/v1` : `${path}/v1`;
	}
	parsed.pathname = path;
	return parsed.toString().replace(/\/$/u, "");
}

export function optionalConfigFromEnvironment(
	env: NodeJS.ProcessEnv = process.env,
	overrides: Partial<BifrostConfig> = {},
): BifrostConfig | undefined {
	const rawUrl = nonEmpty(overrides.url) ?? nonEmpty(env.BIFROST_URL);
	if (!rawUrl) return undefined;
	return {
		url: normalizeBifrostUrl(rawUrl),
		apiKey: nonEmpty(overrides.apiKey) ?? nonEmpty(env.BIFROST_API_KEY),
		virtualKey: nonEmpty(overrides.virtualKey) ?? nonEmpty(env.BIFROST_VIRTUAL_KEY),
	};
}

export function configFromEnvironment(
	env: NodeJS.ProcessEnv = process.env,
	overrides: Partial<BifrostConfig> = {},
): BifrostConfig {
	const config = optionalConfigFromEnvironment(env, overrides);
	if (!config) throw new Error("Pifrost requires BIFROST_URL or --bifrost-url");
	return config;
}

function setHeader(headers: ProviderHeaders, name: string, value: string | null): void {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
	}
	headers[name] = value;
}

/** Headers used for Pifrost's own discovery probes. */
export function bifrostHeaders(config: BifrostConfig, overrides?: ProviderHeaders): ProviderHeaders {
	const headers: ProviderHeaders = { Accept: "application/json" };
	setHeader(headers, "Authorization", config.apiKey ? `Bearer ${config.apiKey}` : null);
	if (config.virtualKey) setHeader(headers, "x-bf-vk", config.virtualKey);
	for (const [name, value] of Object.entries(overrides ?? {})) setHeader(headers, name, value);
	return headers;
}

function positiveInteger(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	}
	return undefined;
}

function pricePerMillion(value: string | number | undefined): number | undefined {
	if (value === undefined || value === "") return undefined;
	const parsed = typeof value === "number" ? value : Number.parseFloat(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return parsed <= 0.01 ? parsed * 1_000_000 : parsed;
}

function isChatModel(model: BifrostModel): boolean {
	const methods = model.supported_methods?.map((method) => method.toLowerCase()) ?? [];
	if (methods.length === 0) return true;
	return methods.some((method) => /chat|message|generate|completion/u.test(method));
}

function modelThinking(model: BifrostModel): ThinkingConfig | undefined {
	const supported = new Set(model.reasoning?.supported_efforts?.map((effort) => effort.toLowerCase()) ?? []);
	const efforts = THINKING_EFFORTS.filter((effort) => supported.has(effort));
	if (efforts.length === 0) return undefined;

	const rawDefault = model.reasoning?.default_effort?.toLowerCase();
	const defaultLevel = THINKING_EFFORTS.find((effort) => effort === rawDefault && efforts.includes(effort));
	const effortMap = Object.fromEntries(efforts.map((effort) => [effort, effort])) as Partial<Record<Effort, string>>;

	return {
		mode: "effort",
		efforts: [...efforts],
		...(defaultLevel ? { defaultLevel } : {}),
		effortMap,
		...(model.reasoning?.mandatory ? { requiresEffort: true } : {}),
	};
}

export function toProviderModel(model: BifrostModel): BifrostProviderModel | undefined {
	const id = nonEmpty(model.id);
	if (!id || !isChatModel(model)) return undefined;

	const contextWindow =
		positiveInteger(
			model.context_length,
			model.top_provider?.context_length,
			model.max_input_tokens && model.max_output_tokens ? model.max_input_tokens + model.max_output_tokens : undefined,
			model.per_request_limits?.prompt_tokens,
		) ?? DEFAULT_CONTEXT_WINDOW;
	const maxTokens = Math.min(
		contextWindow,
		positiveInteger(
			model.max_output_tokens,
			model.top_provider?.max_completion_tokens,
			model.per_request_limits?.completion_tokens,
		) ?? DEFAULT_MAX_TOKENS,
	);

	const parameters = model.supported_parameters?.map((parameter) => parameter.toLowerCase()) ?? [];
	const reasoning = model.reasoning !== undefined || parameters.some((parameter) => parameter.includes("reasoning"));
	const thinking = reasoning ? modelThinking(model) : undefined;
	const supportsTools = parameters.some((parameter) => /tool|function/u.test(parameter));
	const inputModalities = model.architecture?.input_modalities?.map((modality) => modality.toLowerCase()) ?? [];
	const inputPrice = pricePerMillion(model.pricing?.prompt) ?? 0;
	const outputPrice = pricePerMillion(model.pricing?.completion) ?? 0;

	return {
		id,
		name: nonEmpty(model.normalized_name) ?? nonEmpty(model.name) ?? id,
		reasoning,
		thinking,
		input: inputModalities.some((modality) => modality.includes("image")) ? ["text", "image"] : ["text"],
		cost: {
			input: inputPrice,
			output: outputPrice,
			cacheRead: pricePerMillion(model.pricing?.input_cache_read) ?? inputPrice,
			cacheWrite: pricePerMillion(model.pricing?.input_cache_write) ?? inputPrice,
		},
		contextWindow,
		maxTokens,
		supportsTools,
		compat: {
			// Mixed Bifrost chains must remain safe for models that only accept system messages.
			supportsDeveloperRole: false,
			supportsReasoningEffort: Boolean(thinking),
			supportsUsageInStreaming: true,
		},
	};
}

function errorMessage(body: unknown): string | undefined {
	if (!body || typeof body !== "object") return undefined;
	const candidate = body as { message?: unknown; error?: { message?: unknown } | string };
	if (typeof candidate.error === "string") return candidate.error;
	if (typeof candidate.error?.message === "string") return candidate.error.message;
	if (typeof candidate.message === "string") return candidate.message;
	return undefined;
}

export async function fetchBifrostModels(
	config: BifrostConfig,
	options: { fetch?: Fetch; signal?: AbortSignal } = {},
): Promise<BifrostProviderModel[]> {
	if (!config.apiKey) throw new Error("BIFROST_API_KEY is required for model discovery");
	if (!config.virtualKey) throw new Error("BIFROST_VIRTUAL_KEY is required for model discovery");

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const requestHeaders = Object.fromEntries(
		Object.entries(bifrostHeaders(config)).filter((entry): entry is [string, string] => entry[1] !== null),
	);
	const response = await fetchImpl(`${config.url}/models`, { headers: requestHeaders, signal: options.signal });

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		const detail = errorMessage(body);
		throw new Error(`Bifrost model discovery failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	const data = (body as BifrostModelResponse | undefined)?.data;
	if (!Array.isArray(data)) throw new Error("Bifrost model discovery returned an invalid response (expected data[])");
	const models = data.map(toProviderModel).filter((entry): entry is BifrostProviderModel => entry !== undefined);
	const uniqueModels = [...new Map(models.map((entry) => [entry.id, entry])).values()];
	if (uniqueModels.length === 0) throw new Error("Bifrost did not return any chat-completion models");
	return uniqueModels;
}

function normalizedReferenceCandidates(reference: string): string[] {
	const value = reference.trim().toLowerCase();
	const slash = value.indexOf("/");
	return slash > 0 ? [value, value.slice(slash + 1)] : [value];
}

export function resolveAliasReference(
	reference: string,
	models: readonly BifrostProviderModel[],
): BifrostProviderModel | undefined {
	const candidates = normalizedReferenceCandidates(reference);
	return models.find((model) => {
		const id = model.id.toLowerCase();
		return candidates.some(
			(candidate) => id === candidate || id.endsWith(`/${candidate}`) || candidate.endsWith(`/${id}`),
		);
	});
}

function intersectThinking(models: readonly BifrostProviderModel[]): ThinkingConfig | undefined {
	if (!models.length || models.some((model) => !model.reasoning || !model.thinking)) return undefined;
	const efforts = THINKING_EFFORTS.filter((effort) => models.every((model) => model.thinking?.efforts.includes(effort)));
	if (efforts.length === 0) return undefined;
	return {
		mode: "effort",
		efforts: [...efforts],
		effortMap: Object.fromEntries(efforts.map((effort) => [effort, effort])) as Partial<Record<Effort, string>>,
		...(models.some((model) => model.thinking?.requiresEffort) ? { requiresEffort: true } : {}),
	};
}

export function synthesizeAlias(
	id: string,
	definition: PifrostAliasDefinition | string[],
	physicalModels: readonly BifrostProviderModel[],
): { model?: BifrostProviderModel; diagnostic: AliasDiagnostic } {
	const normalized: PifrostAliasDefinition = Array.isArray(definition) ? { chain: definition } : definition;
	const name = normalized.name ?? id;
	const resolved = normalized.chain
		.map((reference) => ({ reference, model: resolveAliasReference(reference, physicalModels) }))
		.filter((entry): entry is { reference: string; model: BifrostProviderModel } => entry.model !== undefined);
	const unresolved = normalized.chain.filter((reference) => !resolved.some((entry) => entry.reference === reference));
	const members = resolved.map((entry) => entry.model);
	const thinking = intersectThinking(members);
	const reasoning = members.length > 0 && members.every((model) => model.reasoning);
	const reasoningEfforts = thinking?.efforts ?? [];

	const diagnostic: AliasDiagnostic = {
		id,
		name,
		chain: normalized.chain,
		resolved: resolved.map((entry) => `${entry.reference} -> ${entry.model.id}`),
		unresolved,
		contextWindow: members.length ? Math.min(...members.map((model) => model.contextWindow)) : undefined,
		maxTokens: members.length ? Math.min(...members.map((model) => model.maxTokens)) : undefined,
		image: members.length > 0 && members.every((model) => model.input.includes("image")),
		reasoning,
		reasoningEfforts: [...reasoningEfforts],
		tools: members.length > 0 && members.every((model) => model.supportsTools),
	};

	if (members.length === 0 || unresolved.length > 0) return { diagnostic };

	return {
		model: {
			id,
			name,
			reasoning,
			thinking: reasoning ? thinking : undefined,
			input: diagnostic.image ? ["text", "image"] : ["text"],
			cost: {
				input: Math.max(...members.map((model) => model.cost.input)),
				output: Math.max(...members.map((model) => model.cost.output)),
				cacheRead: Math.max(...members.map((model) => model.cost.cacheRead)),
				cacheWrite: Math.max(...members.map((model) => model.cost.cacheWrite)),
			},
			contextWindow: diagnostic.contextWindow!,
			maxTokens: diagnostic.maxTokens!,
			supportsTools: diagnostic.tools,
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort:
					Boolean(thinking) && members.every((model) => model.compat.supportsReasoningEffort),
				supportsUsageInStreaming: members.every((model) => model.compat.supportsUsageInStreaming),
			},
		},
		diagnostic,
	};
}

export function buildPifrostCatalog(
	physicalModels: readonly BifrostProviderModel[],
	aliasConfig?: PifrostAliasConfig,
): PifrostCatalog {
	if (!aliasConfig || Object.keys(aliasConfig.aliases ?? {}).length === 0) {
		return { models: [...physicalModels], diagnostics: [] };
	}

	const diagnostics: AliasDiagnostic[] = [];
	const aliases: BifrostProviderModel[] = [];
	for (const [id, definition] of Object.entries(aliasConfig.aliases)) {
		const synthesized = synthesizeAlias(id, definition, physicalModels);
		diagnostics.push(synthesized.diagnostic);
		if (synthesized.model) aliases.push(synthesized.model);
	}
	return {
		models: aliasConfig.includePhysicalModels ? [...physicalModels, ...aliases] : aliases,
		diagnostics,
	};
}

function parseAliasFile(path: string): PifrostAliasConfig {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as PifrostAliasConfig;
	if (!parsed || typeof parsed !== "object" || !parsed.aliases || typeof parsed.aliases !== "object") {
		throw new Error(`Invalid Pifrost alias file: ${path}`);
	}
	for (const [id, definition] of Object.entries(parsed.aliases)) {
		const chain = Array.isArray(definition) ? definition : definition.chain;
		if (!Array.isArray(chain) || chain.length === 0 || chain.some((item) => typeof item !== "string" || !item.trim())) {
			throw new Error(`Invalid Pifrost alias ${id}: chain must contain at least one non-empty model reference`);
		}
	}
	return parsed;
}

export function findAliasConfigPath(explicitPath?: string, cwd = process.cwd()): string | undefined {
	const candidates = [
		nonEmpty(explicitPath),
		nonEmpty(process.env.PIFROST_ALIASES),
		nonEmpty(process.env.PIFROST_ALIASES_FILE),
		resolve(cwd, ".omp/pifrost.aliases.json"),
		resolve(cwd, "pifrost.aliases.json"),
		resolve(homedir(), ".omp/agent/pifrost.aliases.json"),
	].filter((value): value is string => Boolean(value));
	return candidates.find((path) => existsSync(path));
}

export function loadAliasConfig(explicitPath?: string, cwd = process.cwd()): {
	path?: string;
	config?: PifrostAliasConfig;
} {
	const path = findAliasConfigPath(explicitPath, cwd);
	return path ? { path, config: parseAliasFile(path) } : {};
}

export interface CreateNativeProviderOptions {
	config: BifrostConfig;
	aliasConfig?: PifrostAliasConfig;
	fetch?: Fetch;
	onDiagnostics?: (diagnostics: AliasDiagnostic[]) => void;
}

/** Build the native OMP 18 provider config consumed by pi.registerProvider(). */
export function createNativeProviderConfig(options: CreateNativeProviderOptions): NativeProviderConfig {
	const { config } = options;
	if (!config.apiKey) throw new Error("Pifrost requires BIFROST_API_KEY");
	if (!config.virtualKey) throw new Error("Pifrost requires BIFROST_VIRTUAL_KEY");

	return {
		baseUrl: config.url,
		apiKey: config.apiKey,
		api: "openai-completions",
		authHeader: true,
		headers: { "x-bf-vk": config.virtualKey },
		async fetchDynamicModels(resolvedApiKey) {
			const liveConfig: BifrostConfig = {
				url: config.url,
				apiKey: nonEmpty(resolvedApiKey) ?? config.apiKey,
				virtualKey: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? config.virtualKey,
			};
			const physical = await fetchBifrostModels(liveConfig, {
				fetch: options.fetch,
				signal: AbortSignal.timeout(20_000),
			});
			const catalog = buildPifrostCatalog(physical, options.aliasConfig);
			options.onDiagnostics?.(catalog.diagnostics);
			return catalog.models;
		},
	};
}

function formatNumber(value: number | undefined): string {
	if (value === undefined) return "n/a";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 2)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

export function formatDoctorReport(diagnostics: readonly AliasDiagnostic[], aliasPath?: string): string {
	const lines = [`Pifrost doctor${aliasPath ? ` — ${aliasPath}` : ""}`];
	if (!diagnostics.length) return `${lines[0]}\nNo aliases configured; physical Bifrost models are exposed directly.`;
	for (const item of diagnostics) {
		const status = item.unresolved.length ? "WARN" : "OK";
		lines.push(
			`${status} ${item.id}: context=${formatNumber(item.contextWindow)} output=${formatNumber(item.maxTokens)} image=${item.image ? "yes" : "no"} reasoning=${item.reasoning ? "yes" : "no"} efforts=${item.reasoningEfforts.join(",") || "none"} tools=${item.tools ? "yes" : "no"}`,
		);
		if (item.unresolved.length) lines.push(`  unresolved: ${item.unresolved.join(" | ")}`);
	}
	return lines.join("\n");
}

/** Native OMP 18 extension entry point. No legacy Pi compatibility imports are used at runtime. */
export default function pifrostProvider(pi: ExtensionAPI): void {
	pi.registerFlag("bifrost-url", {
		description: "Bifrost OpenAI-compatible base URL (env: BIFROST_URL)",
		type: "string",
	});
	pi.registerFlag("bifrost-api-key", {
		description: "Bifrost inference API key (env: BIFROST_API_KEY)",
		type: "string",
	});
	pi.registerFlag("bifrost-virtual-key", {
		description: "Bifrost inference virtual key (env: BIFROST_VIRTUAL_KEY)",
		type: "string",
	});
	pi.registerFlag("pifrost-aliases", {
		description: "Path to Pifrost alias manifest (env: PIFROST_ALIASES)",
		type: "string",
	});

	const flag = (name: string): string | undefined => {
		const value = pi.getFlag(name);
		return (typeof value === "string" ? nonEmpty(value) : undefined) ?? flagFromArgv(name);
	};

	const aliasSource = loadAliasConfig(flag("pifrost-aliases"));
	const config = optionalConfigFromEnvironment(process.env, {
		url: flag("bifrost-url"),
		apiKey: flag("bifrost-api-key"),
		virtualKey: flag("bifrost-virtual-key"),
	});

	let diagnostics: AliasDiagnostic[] = [];

	if (config?.apiKey && config.virtualKey) {
		const nativeConfig = createNativeProviderConfig({
			config,
			aliasConfig: aliasSource.config,
			onDiagnostics: (next) => {
				diagnostics = next;
			},
		});
		pi.registerProvider(PROVIDER_ID, nativeConfig);
	} else {
		process.stderr.write(
			"pifrost: provider not registered; set BIFROST_URL, BIFROST_API_KEY and BIFROST_VIRTUAL_KEY\n",
		);
	}

	pi.registerCommand("pifrost", {
		description: "Pifrost diagnostics; use /pifrost doctor",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command && command !== "doctor") {
				ctx.ui.notify("Usage: /pifrost doctor", "warning");
				return;
			}
			if (!config?.apiKey || !config.virtualKey) {
				ctx.ui.notify(
					"Pifrost is not configured. Set BIFROST_URL, BIFROST_API_KEY and BIFROST_VIRTUAL_KEY.",
					"warning",
				);
				return;
			}

			try {
				const physical = await fetchBifrostModels(config, { signal: AbortSignal.timeout(20_000) });
				const catalog = buildPifrostCatalog(physical, aliasSource.config);
				diagnostics = catalog.diagnostics;
				ctx.ui.notify(
					formatDoctorReport(diagnostics, aliasSource.path),
					diagnostics.some((item) => item.unresolved.length) ? "warning" : "info",
				);
			} catch (error) {
				ctx.ui.notify(`Pifrost doctor failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
