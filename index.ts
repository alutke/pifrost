import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	type ApiKeyCredential,
	createProvider,
	type Model,
	openAICompletionsApi,
	type Provider,
	type ProviderHeaders,
	type RefreshModelsContext,
	type ThinkingLevelMap,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "bifrost";
const PLACEHOLDER_API_KEY = "pifrost-keyless";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;
const UNRESOLVED_BASE_URL = "http://localhost/openai/v1";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type Fetch = typeof globalThis.fetch;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

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
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	supportsTools: boolean;
	compat: {
		supportsDeveloperRole: true;
		supportsReasoningEffort: boolean;
		supportsUsageInStreaming: true;
		supportsStrictMode: true;
		maxTokensField: "max_completion_tokens";
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
		path = /\/openai$/u.test(path) ? `${path}/v1` : `${path}/openai/v1`;
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

function thinkingLevelMap(model: BifrostModel): ThinkingLevelMap | undefined {
	const supported = model.reasoning?.supported_efforts?.map((effort) => effort.toLowerCase());
	if (!supported?.length) return undefined;
	const has = (level: string) => supported.includes(level);
	return {
		off: model.reasoning?.mandatory ? null : "off",
		minimal: has("minimal") ? "minimal" : null,
		low: has("low") ? "low" : null,
		medium: has("medium") ? "medium" : null,
		high: has("high") ? "high" : null,
		xhigh: has("xhigh") ? "xhigh" : null,
		max: has("max") ? "max" : null,
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
	const supportsTools = parameters.some((parameter) => /tool|function/u.test(parameter));
	const inputModalities = model.architecture?.input_modalities?.map((modality) => modality.toLowerCase()) ?? [];
	const inputPrice = pricePerMillion(model.pricing?.prompt) ?? 0;
	const outputPrice = pricePerMillion(model.pricing?.completion) ?? 0;
	return {
		id,
		name: nonEmpty(model.normalized_name) ?? nonEmpty(model.name) ?? id,
		reasoning,
		thinkingLevelMap: reasoning ? thinkingLevelMap(model) : undefined,
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
			supportsDeveloperRole: true,
			supportsReasoningEffort: reasoning && parameters.some((parameter) => parameter.includes("reasoning")),
			supportsUsageInStreaming: true,
			supportsStrictMode: true,
			maxTokensField: "max_completion_tokens",
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
	const models = data.map(toProviderModel).filter((model): model is BifrostProviderModel => model !== undefined);
	const uniqueModels = [...new Map(models.map((model) => [model.id, model])).values()];
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

function intersectThinkingMaps(models: readonly BifrostProviderModel[]): ThinkingLevelMap | undefined {
	if (!models.length || models.some((model) => !model.reasoning || !model.thinkingLevelMap)) return undefined;
	const result: ThinkingLevelMap = {
		off: null,
		minimal: null,
		low: null,
		medium: null,
		high: null,
		xhigh: null,
		max: null,
	};
	for (const level of THINKING_LEVELS) {
		const values = models.map((model) => model.thinkingLevelMap?.[level] ?? null);
		if (values.every((value) => value !== null)) result[level] = level;
	}
	return result;
}

function supportedEfforts(map: ThinkingLevelMap | undefined): string[] {
	if (!map) return [];
	return THINKING_LEVELS.filter((level) => level !== "off" && map[level] !== null);
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
	const unresolved = normalized.chain.filter(
		(reference) => !resolved.some((entry) => entry.reference === reference),
	);
	const members = resolved.map((entry) => entry.model);
	const thinking = intersectThinkingMaps(members);
	const diagnostic: AliasDiagnostic = {
		id,
		name,
		chain: normalized.chain,
		resolved: resolved.map((entry) => `${entry.reference} -> ${entry.model.id}`),
		unresolved,
		contextWindow: members.length ? Math.min(...members.map((model) => model.contextWindow)) : undefined,
		maxTokens: members.length ? Math.min(...members.map((model) => model.maxTokens)) : undefined,
		image: members.length > 0 && members.every((model) => model.input.includes("image")),
		reasoning: members.length > 0 && members.every((model) => model.reasoning),
		reasoningEfforts: supportedEfforts(thinking),
		tools: members.length > 0 && members.every((model) => model.supportsTools),
	};
	if (members.length === 0 || unresolved.length > 0) return { diagnostic };
	const reasoning = diagnostic.reasoning;
	return {
		model: {
			id,
			name,
			reasoning,
			thinkingLevelMap: reasoning ? thinking : undefined,
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
				supportsDeveloperRole: true,
				supportsReasoningEffort:
					reasoning && members.every((model) => model.compat.supportsReasoningEffort) && diagnostic.reasoningEfforts.length > 0,
				supportsUsageInStreaming: true,
				supportsStrictMode: true,
				maxTokensField: "max_completion_tokens",
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
	return parsed;
}

export function findAliasConfigPath(explicitPath?: string, cwd = process.cwd()): string | undefined {
	const candidates = [
		nonEmpty(explicitPath),
		nonEmpty(process.env.PIFROST_ALIASES),
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

type BifrostRuntimeModel = Model<"openai-completions">;

function runtimeModels(models: readonly BifrostProviderModel[], baseUrl: string): BifrostRuntimeModel[] {
	return models.map((model) => ({ ...model, provider: PROVIDER_ID, api: "openai-completions", baseUrl }));
}

function credentialConfig(
	credential: ApiKeyCredential | undefined,
	fallback: BifrostConfig | undefined,
): BifrostConfig | undefined {
	const credentialUrl = nonEmpty(credential?.env?.BIFROST_URL);
	const url = credentialUrl ?? fallback?.url;
	if (!url) return undefined;
	const ownsConfig = credentialUrl !== undefined;
	const key = nonEmpty(credential?.key);
	const apiKey = key && key !== PLACEHOLDER_API_KEY ? key : ownsConfig ? undefined : fallback?.apiKey;
	const credentialVirtualKey = nonEmpty(credential?.env?.BIFROST_VIRTUAL_KEY);
	const virtualKey = ownsConfig ? credentialVirtualKey : (credentialVirtualKey ?? fallback?.virtualKey);
	return { url: normalizeBifrostUrl(url), apiKey, virtualKey };
}

function configCredential(config: BifrostConfig): ApiKeyCredential {
	return {
		type: "api_key",
		key: config.apiKey ?? PLACEHOLDER_API_KEY,
		env: { BIFROST_URL: config.url, BIFROST_VIRTUAL_KEY: config.virtualKey ?? "" },
	};
}

export interface CreateBifrostProviderOptions {
	config?: BifrostConfig;
	aliasConfig?: PifrostAliasConfig;
	models?: readonly BifrostProviderModel[];
	fetch?: Fetch;
	onDiagnostics?: (diagnostics: AliasDiagnostic[]) => void;
}

export function createBifrostProvider(options: CreateBifrostProviderOptions = {}): Provider<"openai-completions"> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	let ambientConfig = options.config;
	const initial = buildPifrostCatalog(options.models ?? [], options.aliasConfig);
	options.onDiagnostics?.(initial.diagnostics);
	const catalog = runtimeModels(initial.models, ambientConfig?.url ?? UNRESOLVED_BASE_URL);
	let pendingModels = catalog.length > 0 ? [...catalog] : undefined;
	const replaceCatalog = (models: readonly BifrostRuntimeModel[]): void => {
		catalog.splice(0, catalog.length, ...models);
	};
	const discoverRuntime = async (config: BifrostConfig, signal?: AbortSignal): Promise<BifrostRuntimeModel[]> => {
		const physical = await fetchBifrostModels(config, { fetch: fetchImpl, signal });
		const built = buildPifrostCatalog(physical, options.aliasConfig);
		options.onDiagnostics?.(built.diagnostics);
		return runtimeModels(built.models, config.url);
	};
	const refreshModels = async (context: RefreshModelsContext): Promise<void> => {
		if (pendingModels) {
			const models = pendingModels;
			if (await context.publish({ persist: { models, checkedAt: Date.now() }, update: () => replaceCatalog(models) })) {
				pendingModels = undefined;
			}
			return;
		}
		if (context.stored) {
			const restored = context.stored.models.filter(
				(model): model is BifrostRuntimeModel => model.provider === PROVIDER_ID && model.api === "openai-completions",
			);
			if (!(await context.publish({ update: () => replaceCatalog(restored) }))) return;
		}
		if (!context.allowNetwork || context.signal.aborted) return;
		const config = credentialConfig(
			context.credential?.type === "api_key" ? context.credential : undefined,
			ambientConfig,
		);
		if (!config) return;
		const discovered = await discoverRuntime(config, context.signal);
		await context.publish({ persist: { models: discovered, checkedAt: Date.now() }, update: () => replaceCatalog(discovered) });
	};
	const base = createProvider({
		id: PROVIDER_ID,
		name: "Pifrost / Bifrost AI Gateway",
		baseUrl: ambientConfig?.url,
		auth: {
			apiKey: {
				name: "Bifrost connection",
				async login(interaction) {
					interaction.notify({ type: "info", message: "Configure the Bifrost gateway for Pifrost." });
					const url = normalizeBifrostUrl(
						await interaction.prompt({ type: "text", message: "Bifrost URL", placeholder: "http://localhost:8080" }),
					);
					const apiKey = nonEmpty(
						await interaction.prompt({ type: "secret", message: "API key (optional; Enter to skip)" }),
					);
					const virtualKey = nonEmpty(
						await interaction.prompt({ type: "secret", message: "Virtual key (optional; Enter to skip)" }),
					);
					const config = { url, apiKey, virtualKey };
					interaction.notify({ type: "progress", message: "Discovering Bifrost models and deriving aliases..." });
					const discovered = await discoverRuntime(config, interaction.signal);
					ambientConfig = config;
					pendingModels = discovered;
					replaceCatalog(discovered);
					return configCredential(config);
				},
				async resolve({ ctx, credential }) {
					const envConfig = optionalConfigFromEnvironment({
						BIFROST_URL: await ctx.env("BIFROST_URL"),
						BIFROST_API_KEY: await ctx.env("BIFROST_API_KEY"),
						BIFROST_VIRTUAL_KEY: await ctx.env("BIFROST_VIRTUAL_KEY"),
					});
					const config = credentialConfig(credential, ambientConfig ?? envConfig);
					if (!config) return undefined;
					return {
						auth: {
							apiKey: config.apiKey ?? PLACEHOLDER_API_KEY,
							baseUrl: config.url,
							headers: bifrostHeaders(config),
						},
						env: { BIFROST_URL: config.url, BIFROST_VIRTUAL_KEY: config.virtualKey ?? "" },
						source: credential ? "stored Bifrost connection" : "BIFROST_URL",
					};
				},
			},
		},
		models: catalog,
		api: openAICompletionsApi(),
	});
	return { ...base, refreshModels };
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

export default async function pifrostProvider(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("bifrost-url", {
		description: "Bifrost instance or OpenAI-compatible base URL (env: BIFROST_URL)",
		type: "string",
	});
	pi.registerFlag("bifrost-api-key", {
		description: "Bifrost API/auth key (env: BIFROST_API_KEY)",
		type: "string",
	});
	pi.registerFlag("bifrost-virtual-key", {
		description: "Bifrost virtual key (env: BIFROST_VIRTUAL_KEY)",
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
	let models: BifrostProviderModel[] | undefined;
	if (config) {
		try {
			models = await fetchBifrostModels(config, { signal: AbortSignal.timeout(15_000) });
		} catch (error) {
			process.stderr.write(
				`pifrost: startup model discovery failed; provider will retry later: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}
	pi.registerProvider(
		createBifrostProvider({
			config,
			aliasConfig: aliasSource.config,
			models,
			onDiagnostics: (next) => {
				diagnostics = next;
			},
		}),
	);
	pi.registerCommand("pifrost", {
		description: "Pifrost diagnostics; use /pifrost doctor",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command && command !== "doctor") {
				ctx.ui.notify("Usage: /pifrost doctor", "warning");
				return;
			}
			ctx.ui.notify(formatDoctorReport(diagnostics, aliasSource.path), diagnostics.some((item) => item.unresolved.length) ? "warning" : "info");
		},
	});
}
