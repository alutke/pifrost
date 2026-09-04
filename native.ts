import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import {
	buildPifrostCatalog,
	fetchBifrostModels,
	flagFromArgv,
	formatDoctorReport,
	loadAliasConfig,
	optionalConfigFromEnvironment,
	PROVIDER_ID,
	type AliasDiagnostic,
	type BifrostConfig,
	type PifrostCatalog,
} from "./index.ts";
import { buildRichRouteCatalog, fetchBifrostDatasheets } from "./datasheet.ts";
import {
	cacheIsFresh,
	DEFAULT_REFRESH_INTERVAL_MS,
	loadCatalogCache,
	writeCatalogCache,
} from "./cache.ts";
import { loadStoredRuntimeConfig } from "./config-store.ts";
import {
	normalizeModelParametersDatasheet,
	normalizePricingDatasheet,
} from "./pricing-normalize.ts";
import { augmentLiveInventoryForRoutes } from "./route-inventory.ts";
import { createBifrostUsageProvider } from "./bifrost-usage.ts";

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function positiveEnvMilliseconds(name: string, fallback: number): number {
	const raw = nonEmpty(process.env[name]);
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function forceRefreshRequested(): boolean {
	return /^(?:1|true|yes)$/iu.test(nonEmpty(process.env.PIFROST_FORCE_REFRESH) ?? "");
}

async function fetchFreshCatalog(
	config: BifrostConfig,
	aliasSource: ReturnType<typeof loadAliasConfig>,
	resolvedApiKey?: string,
): Promise<PifrostCatalog> {
	const liveConfig: BifrostConfig = {
		url: config.url,
		// In VK-only mode OMP's resolved provider key is the VK itself; do not
		// reinterpret it as a second Bearer credential for discovery.
		apiKey: config.apiKey ? (nonEmpty(resolvedApiKey) ?? config.apiKey) : undefined,
		virtualKey: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? config.virtualKey,
	};
	const hasAliases = Boolean(aliasSource.config && Object.keys(aliasSource.config.aliases ?? {}).length);
	const modelPromise = fetchBifrostModels(liveConfig, { signal: AbortSignal.timeout(10_000) });
	const datasheetPromise = hasAliases
		? fetchBifrostDatasheets({ signal: AbortSignal.timeout(10_000) })
		: undefined;
	const liveModels = await modelPromise;
	let catalog: PifrostCatalog;
	if (!hasAliases || !datasheetPromise || !aliasSource.config) {
		catalog = buildPifrostCatalog(liveModels, aliasSource.config);
	} else {
		const datasheets = await datasheetPromise;
		const routeInventory = augmentLiveInventoryForRoutes(liveModels, aliasSource.config);
		const richRoutes = buildRichRouteCatalog(routeInventory, aliasSource.config, {
			pricing: normalizePricingDatasheet(datasheets.pricing),
			parameters: normalizeModelParametersDatasheet(datasheets.parameters),
		});
		catalog = buildPifrostCatalog(richRoutes.models, aliasSource.config, richRoutes.diagnostics);
	}

	writeCatalogCache(catalog, { config: liveConfig, aliasConfig: aliasSource.config });
	return catalog;
}

/**
 * Native OMP 18 extension entry point.
 *
 * Startup is deliberately cache-first: the last-known-good non-secret model catalog is
 * registered synchronously so OMP can select a model immediately. Network-backed Bifrost
 * and datasheet discovery refreshes that cache separately, avoiding the previous no-model
 * period and long interactive startup stalls.
 *
 * Runtime configuration precedence is: OMP CLI flag -> process environment -> the secure
 * configuration written by `pifrost global setup`.
 */
export default function pifrostProvider(pi: ExtensionAPI): void {
	pi.registerFlag("bifrost-url", {
		description: "Bifrost OpenAI-compatible base URL (env: BIFROST_URL; fallback: Pifrost config)",
		type: "string",
	});
	pi.registerFlag("bifrost-api-key", {
		description: "Bifrost inference API key (env: BIFROST_API_KEY; fallback: Pifrost secret store)",
		type: "string",
	});
	pi.registerFlag("bifrost-virtual-key", {
		description: "Bifrost inference virtual key (env: BIFROST_VIRTUAL_KEY; fallback: Pifrost secret store)",
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
	const stored = loadStoredRuntimeConfig();
	const mergedEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		BIFROST_URL: nonEmpty(process.env.BIFROST_URL) ?? stored.url,
		BIFROST_API_KEY: nonEmpty(process.env.BIFROST_API_KEY) ?? stored.apiKey,
		BIFROST_VIRTUAL_KEY: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? stored.virtualKey,
	};
	const config = optionalConfigFromEnvironment(mergedEnvironment, {
		url: flag("bifrost-url"),
		apiKey: flag("bifrost-api-key"),
		virtualKey: flag("bifrost-virtual-key"),
	});

	let diagnostics: AliasDiagnostic[] = [];
	let refreshInFlight: Promise<PifrostCatalog> | undefined;
	const refreshIntervalMs = positiveEnvMilliseconds("PIFROST_REFRESH_INTERVAL_MS", DEFAULT_REFRESH_INTERVAL_MS);

	if (config?.virtualKey) {
		const startupCache = loadCatalogCache({ config, aliasConfig: aliasSource.config });
		if (startupCache) diagnostics = startupCache.diagnostics;

		const refresh = (resolvedApiKey?: string): Promise<PifrostCatalog> => {
			if (!refreshInFlight) {
				refreshInFlight = fetchFreshCatalog(config, aliasSource, resolvedApiKey).finally(() => {
					refreshInFlight = undefined;
				});
			}
			return refreshInFlight;
		};

		const scheduleBackgroundRefresh = (resolvedApiKey?: string): void => {
			void refresh(resolvedApiKey)
				.then((catalog) => {
					diagnostics = catalog.diagnostics;
				})
				.catch((error) => {
					process.stderr.write(
						`pifrost: background catalog refresh failed: ${error instanceof Error ? error.message : String(error)}\n`,
					);
				});
		};

		const providerApiKey = config.apiKey ?? config.virtualKey;
		const virtualKeyBearerCompatible = /^sk-bf-/u.test(config.virtualKey);
		const usage = createBifrostUsageProvider(config);
		pi.registerProvider(PROVIDER_ID, {
			baseUrl: config.url,
			apiKey: providerApiKey,
			api: "openai-completions",
			// Bifrost 2.x accepts sk-bf-* VKs as OpenAI Bearer credentials.
			// Legacy VK values remain x-bf-vk-only and therefore suppress the
			// generated Authorization header.
			authHeader: Boolean(config.apiKey || virtualKeyBearerCompatible),
			headers: {
				"x-bf-vk": config.virtualKey,
				"User-Agent": `pifrost/${process.env.npm_package_version ?? "0.3"} OMP`,
			},
			...(usage ? { usage } : {}),
			...(startupCache ? { models: startupCache.models } : {}),
			async fetchDynamicModels(resolvedApiKey) {
				const cached = loadCatalogCache({ config, aliasConfig: aliasSource.config });
				if (cached && !forceRefreshRequested()) {
					diagnostics = cached.diagnostics;
					if (!cacheIsFresh(cached, refreshIntervalMs)) scheduleBackgroundRefresh(resolvedApiKey);
					return cached.models;
				}

				const catalog = await refresh(resolvedApiKey);
				diagnostics = catalog.diagnostics;
				return catalog.models;
			},
		});
	} else {
		process.stderr.write(
			"pifrost: provider not registered; run `pifrost global setup` or set BIFROST_URL and BIFROST_VIRTUAL_KEY (BIFROST_API_KEY is optional on Bifrost 2.x)\n",
		);
	}

	pi.registerCommand("pifrost", {
		description: "Pifrost diagnostics; use /pifrost doctor or /pifrost refresh",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase() || "doctor";
			if (command !== "doctor" && command !== "refresh") {
				ctx.ui.notify("Usage: /pifrost doctor | /pifrost refresh", "warning");
				return;
			}
			if (!config?.virtualKey) {
				ctx.ui.notify(
					"Pifrost is not configured. Run `pifrost global setup` or set BIFROST_URL and BIFROST_VIRTUAL_KEY (BIFROST_API_KEY is optional on Bifrost 2.x).",
					"warning",
				);
				return;
			}

			try {
				if (command === "refresh") {
					const catalog = await fetchFreshCatalog(config, aliasSource);
					diagnostics = catalog.diagnostics;
					ctx.ui.notify(
						`${formatDoctorReport(diagnostics, aliasSource.path)}\nCatalog cache refreshed; restart OMP to guarantee the refreshed envelope is selected at startup.`,
						diagnostics.some((item) => item.unresolved.length) ? "warning" : "info",
					);
					return;
				}

				const cached = loadCatalogCache({ config, aliasConfig: aliasSource.config });
				if (cached) diagnostics = cached.diagnostics;
				if (!cached && diagnostics.length === 0) {
					const catalog = await fetchFreshCatalog(config, aliasSource);
					diagnostics = catalog.diagnostics;
				}
				ctx.ui.notify(
					formatDoctorReport(diagnostics, aliasSource.path),
					diagnostics.some((item) => item.unresolved.length) ? "warning" : "info",
				);
			} catch (error) {
				ctx.ui.notify(`Pifrost ${command} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
