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
} from "./index.ts";
import { buildRichRouteCatalog, fetchBifrostDatasheets } from "./datasheet.ts";
import { normalizePricingDatasheet } from "./pricing-normalize.ts";

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

async function buildCatalog(
	config: BifrostConfig,
	aliasSource: ReturnType<typeof loadAliasConfig>,
	resolvedApiKey?: string,
) {
	const liveConfig: BifrostConfig = {
		url: config.url,
		apiKey: nonEmpty(resolvedApiKey) ?? config.apiKey,
		virtualKey: nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? config.virtualKey,
	};
	const liveModels = await fetchBifrostModels(liveConfig, { signal: AbortSignal.timeout(20_000) });
	if (!aliasSource.config || Object.keys(aliasSource.config.aliases ?? {}).length === 0) {
		return buildPifrostCatalog(liveModels, aliasSource.config);
	}

	const datasheets = await fetchBifrostDatasheets({ signal: AbortSignal.timeout(30_000) });
	const richRoutes = buildRichRouteCatalog(
		liveModels,
		aliasSource.config,
		{ ...datasheets, pricing: normalizePricingDatasheet(datasheets.pricing) },
	);
	return buildPifrostCatalog(richRoutes.models, aliasSource.config);
}

/**
 * Native OMP 18 extension entry point.
 *
 * Runtime credentials are only the global inference Bearer credential and inference VK.
 * Rich capability metadata comes from Bifrost's public datasheets, the same upstream source
 * Bifrost uses for its management model catalog. No Bifrost admin credential is persisted.
 */
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
		pi.registerProvider(PROVIDER_ID, {
			baseUrl: config.url,
			apiKey: config.apiKey,
			api: "openai-completions",
			authHeader: true,
			headers: { "x-bf-vk": config.virtualKey },
			async fetchDynamicModels(resolvedApiKey) {
				const catalog = await buildCatalog(config, aliasSource, resolvedApiKey);
				diagnostics = catalog.diagnostics;
				return catalog.models;
			},
		});
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
				const catalog = await buildCatalog(config, aliasSource);
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
