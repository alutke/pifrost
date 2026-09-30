import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	bifrostHeaders,
	buildPifrostCatalog,
	createNativeProviderConfig,
	formatDoctorReport,
	normalizeBifrostUrl,
	PIFROST_API,
	PIFROST_APP_REFERER,
	PIFROST_APP_TITLE,
	PIFROST_VERSION,
	pifrostOpenCodeSessionHeaders,
	pifrostProviderHeaders,
	pifrostSessionHeaders,
	resolveAliasReference,
	synthesizeAlias,
	toProviderModel,
	type BifrostProviderModel,
} from "../index.ts";

function model(
	id: string,
	overrides: Partial<BifrostProviderModel> = {},
): BifrostProviderModel {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsTools: true,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
		},
		...overrides,
	};
}

function effortThinking(...efforts: string[]): NonNullable<BifrostProviderModel["thinking"]> {
	return {
		mode: "effort",
		efforts: efforts as unknown as NonNullable<BifrostProviderModel["thinking"]>["efforts"],
	};
}

test("normalizes Bifrost URLs to the native /v1 mount", () => {
	assert.equal(normalizeBifrostUrl("http://localhost:8180"), "http://localhost:8180/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/v1"), "http://localhost:8180/v1");
	assert.equal(normalizeBifrostUrl("http://localhost:8180/openai/v1/models"), "http://localhost:8180/openai/v1");
});

test("keeps API auth and virtual-key governance independent", () => {
	assert.deepEqual(
		bifrostHeaders({ url: "http://bifrost/v1", apiKey: "api", virtualKey: "sk-bf-vk" }),
		{
			Accept: "application/json",
			Authorization: "Bearer api",
			"x-bf-vk": "sk-bf-vk",
		},
	);
	assert.equal(bifrostHeaders({ url: "http://bifrost/v1" }).Authorization, null);
});

test("maps rich Bifrost model metadata to canonical OMP thinking metadata", () => {
	const mapped = toProviderModel({
		id: "openai/gpt-test",
		context_length: 1_000_000,
		max_output_tokens: 128_000,
		architecture: { input_modalities: ["text", "image"] },
		supported_parameters: ["tools", "reasoning_effort", "defer_loading", "service_tier"],
		service_tiers: ["priority", { id: "ultrafast" }],
		pricing_status: "included",
		reasoning: { supported_efforts: ["low", "high", "max"], default_effort: "high" },
	});
	assert.ok(mapped);
	assert.equal(mapped.contextWindow, 1_000_000);
	assert.equal(mapped.maxTokens, 128_000);
	assert.deepEqual(mapped.input, ["text", "image"]);
	assert.equal(mapped.supportsTools, true);
	assert.equal(mapped.reasoning, true);
	assert.equal(mapped.thinking?.mode, "effort");
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["low", "high", "max"]);
	assert.equal(String(mapped.thinking?.defaultLevel), "high");
	assert.equal(mapped.supportsToolSearch, true);
	assert.equal(mapped.supportsServiceTier, true);
	assert.deepEqual(mapped.serviceTiers, ["priority", "ultrafast"]);
	assert.equal(mapped.pricingStatus, "included");
});

test("maps Bifrost 2.x reasoning effort none onto OMP minimal wire semantics", () => {
	const mapped = toProviderModel({
		id: "provider/reasoning-off",
		context_length: 128_000,
		max_output_tokens: 16_000,
		supported_parameters: ["reasoning_effort"],
		reasoning: { supported_efforts: ["none", "low", "high"], default_effort: "none" },
	});
	assert.ok(mapped);
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["minimal", "low", "high"]);
	assert.equal(mapped.thinking?.effortMap?.minimal, "none");
	assert.equal(String(mapped.thinking?.defaultLevel), "minimal");
});

test("does not conflate distinct none and minimal wire efforts", () => {
	const mapped = toProviderModel({
		id: "provider/both",
		context_length: 128_000,
		max_output_tokens: 16_000,
		reasoning: { supported_efforts: ["none", "minimal", "low"] },
	});
	assert.ok(mapped);
	assert.deepEqual(mapped.thinking?.efforts.map(String), ["minimal", "low"]);
	assert.equal(mapped.thinking?.effortMap?.minimal, "minimal");
});

test("maps Bifrost supported methods to physical wire protocols", () => {
	const responses = toProviderModel({
		id: "opencode-go/muse-spark-1.3-contributor",
		context_length: 1_000_000,
		max_output_tokens: 128_000,
		supported_methods: ["/v1/responses"],
	});
	assert.ok(responses);
	assert.deepEqual(responses.protocols, ["openai-responses"]);
	assert.equal(responses.capabilitySources?.protocol, "live");

	const chat = toProviderModel({
		id: "commandcode/deepseek-v4.1-flash",
		context_length: 1_000_000,
		max_output_tokens: 128_000,
		supported_methods: ["/v1/chat/completions"],
	});
	assert.ok(chat);
	assert.deepEqual(chat.protocols, ["openai-completions"]);
});

test("provider user agent follows package release version", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
	assert.equal(PIFROST_VERSION, pkg.version);
});

test("provider forwards real OMP/pi attribution through Bifrost for agentic OpenRouter endpoints", () => {
	assert.equal(PIFROST_APP_REFERER, "https://pi.dev/");
	assert.equal(PIFROST_APP_TITLE, "pi");
	assert.deepEqual(pifrostProviderHeaders("vk"), {
		"x-bf-vk": "vk",
		"User-Agent": `pifrost/${PIFROST_VERSION} OMP`,
		"x-bf-eh-user-agent": `pifrost/${PIFROST_VERSION} OMP`,
		"x-bf-eh-http-referer": "https://pi.dev/",
		"x-bf-eh-x-title": "pi",
	});
});

test("native provider accepts Bifrost 2.x Virtual-Key-only inference auth", async () => {
	const provider = createNativeProviderConfig({
		config: { url: "http://bifrost/v1", virtualKey: "sk-bf-vk-only" },
		aliasConfig: { includePhysicalModels: false, aliases: {} },
		fetch: async (_input, init) => {
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("authorization"), null);
			assert.equal(headers.get("x-bf-vk"), "sk-bf-vk-only");
			return new Response(JSON.stringify({
				data: [{ id: "model", context_length: 128_000, max_output_tokens: 8192 }],
			}), { status: 200, headers: { "content-type": "application/json" } });
		},
	});
	assert.equal(provider.apiKey, "sk-bf-vk-only");
	assert.equal(provider.authHeader, true);
	const models = await provider.fetchDynamicModels("sk-bf-vk-only");
	assert.equal(models[0]?.id, "model");
});

test("resolves provider-prefixed Bifrost fallback references by physical model id", () => {
	const physical = [model("deepseek/deepseek-v4-pro"), model("mimo-v2.5")];
	assert.equal(
		resolveAliasReference("CommandCode GOAT/deepseek/deepseek-v4-pro", physical)?.id,
		"deepseek/deepseek-v4-pro",
	);
	assert.equal(resolveAliasReference("Xiaomi MIMO/mimo-v2.5", physical)?.id, "mimo-v2.5");
});

test("alias envelope uses the weakest context and output limits", () => {
	const physical = [
		model("kimi-k2.7-code", { contextWindow: 256_000, maxTokens: 32_000 }),
		model("deepseek/deepseek-v4-flash", { contextWindow: 1_000_000, maxTokens: 128_000 }),
	];
	const result = synthesizeAlias(
		"omp-default",
		{ chain: ["opencode-go/kimi-k2.7-code", "deepseek/deepseek-v4-flash"] },
		physical,
	);
	assert.ok(result.model);
	assert.equal(result.model.contextWindow, 256_000);
	assert.equal(result.model.maxTokens, 32_000);
});

test("alias image, tools and reasoning are conservative intersections", () => {
	const physical = [
		model("one", {
			reasoning: true,
			thinking: effortThinking("low", "high", "max"),
			input: ["text", "image"],
			supportsTools: true,
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort: true,
				supportsUsageInStreaming: true,
			},
		}),
		model("two", {
			reasoning: false,
			input: ["text"],
			supportsTools: false,
		}),
	];
	const result = synthesizeAlias("mixed", ["one", "two"], physical);
	assert.ok(result.model);
	assert.equal(result.model.reasoning, false);
	assert.deepEqual(result.model.input, ["text"]);
	assert.equal(result.model.supportsTools, false);
	assert.deepEqual(result.diagnostic.reasoningEfforts, []);
});

test("alias reasoning effort is the intersection of every fallback", () => {
	const physical = [
		model("one", {
			reasoning: true,
			thinking: effortThinking("low", "high", "max"),
			compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, supportsUsageInStreaming: true },
		}),
		model("two", {
			reasoning: true,
			thinking: effortThinking("high", "max"),
			compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, supportsUsageInStreaming: true },
		}),
	];
	const result = synthesizeAlias("reasoning", ["one", "two"], physical);
	assert.ok(result.model);
	assert.deepEqual(result.model.thinking?.efforts.map(String), ["high", "max"]);
	assert.deepEqual(result.diagnostic.reasoningEfforts, ["high", "max"]);
});


test("alias keeps reasoning-with-tools separate from tool-choice reasoning suppression", () => {
	const compat = {
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsToolChoice: true,
		supportsReasoningWithTools: true,
		disableReasoningOnToolChoice: true,
	};
	const result = synthesizeAlias(
		"reasoning-tools",
		["one", "two"],
		[
			model("one", { reasoning: true, thinking: effortThinking("high"), compat }),
			model("two", { reasoning: true, thinking: effortThinking("high"), compat }),
		],
	);
	assert.ok(result.model);
	assert.equal(result.diagnostic.reasoningWithTools, true);
	assert.equal(result.model.compat.supportsReasoningWithTools, true);
	assert.equal(result.model.compat.disableReasoningOnToolChoice, true);
});

test("alias is withheld when any configured fallback cannot be resolved", () => {
	const result = synthesizeAlias("broken", ["known", "missing"], [model("known")]);
	assert.equal(result.model, undefined);
	assert.deepEqual(result.diagnostic.unresolved, ["missing"]);
});

test("alias-only mode hides physical models from OMP while retaining them for derivation", () => {
	const catalog = buildPifrostCatalog([model("one", { contextWindow: 512_000 })], {
		includePhysicalModels: false,
		aliases: { "omp-test": ["one"] },
	});
	assert.deepEqual(catalog.models.map((item) => item.id), ["omp-test"]);
	assert.equal(catalog.models[0]?.contextWindow, 512_000);
});

test("doctor report highlights unresolved chain members", () => {
	const result = synthesizeAlias("omp-test", ["one", "missing"], [model("one")]);
	const report = formatDoctorReport([result.diagnostic], "/tmp/pifrost.aliases.json");
	assert.match(report, /WARN omp-test/);
	assert.match(report, /missing/);
});

test("doctor report shows current per-member pricing band without aggregating route price", () => {
	const result = synthesizeAlias(
		"omp-price",
		["deepseek/deepseek-v4-flash"],
		[model("deepseek/deepseek-v4-flash")],
		[{
			reference: "deepseek/deepseek-v4-flash",
			liveModelId: "deepseek/deepseek-v4-flash",
			status: "ok",
			pricing: {
				pricingKey: "deepseek/deepseek-v4-flash",
				source: "bifrost-datasheet",
				peakCost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
				offPeakCostMultiplier: 0.5,
				peakHours: {
					timezone: "UTC",
					windows: [{ days: [1, 2, 3, 4, 5], start: "01:00", end: "04:00" }],
				},
			},
		}],
	);
	const report = formatDoctorReport(
		[result.diagnostic],
		undefined,
		new Date("2026-08-17T05:00:00Z"),
	);
	assert.match(report, /pricing band=off-peak/);
	assert.match(report, /source=bifrost-datasheet:deepseek\/deepseek-v4-flash/);
	assert.match(report, /multiplier=0.5x/);
	assert.match(report, /current\(input\/output\)=\$0.2200\/\$0.6600 per 1M/);
});

test("native OMP provider uses the Pifrost transport and separate x-bf-vk governance", async () => {
	let capturedHeaders: Headers | undefined;
	const fakeFetch: typeof fetch = async (_input, init) => {
		capturedHeaders = new Headers(init?.headers);
		return new Response(
			JSON.stringify({
				data: [
					{
						id: "deepseek/deepseek-v4-flash",
						context_length: 1_000_000,
						max_output_tokens: 128_000,
						supported_parameters: ["tools", "reasoning_effort"],
						reasoning: { supported_efforts: ["high", "max"] },
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	};

	const provider = createNativeProviderConfig({
		config: { url: "http://bifrost/v1", apiKey: "api", virtualKey: "vk" },
		aliasConfig: { includePhysicalModels: false, aliases: { "omp-task": ["deepseek/deepseek-v4-flash"] } },
		fetch: fakeFetch,
	});

	assert.equal(provider.api, PIFROST_API);
	assert.equal(provider.authHeader, true);
	assert.deepEqual(provider.headers, {
		"x-bf-vk": "vk",
		"User-Agent": `pifrost/${PIFROST_VERSION} OMP`,
		"x-bf-eh-user-agent": `pifrost/${PIFROST_VERSION} OMP`,
		"x-bf-eh-http-referer": PIFROST_APP_REFERER,
		"x-bf-eh-x-title": PIFROST_APP_TITLE,
	});
	const models = await provider.fetchDynamicModels("resolved-api");
	assert.deepEqual(models.map((entry) => entry.id), ["omp-task"]);
	assert.equal(capturedHeaders?.get("authorization"), "Bearer resolved-api");
	assert.equal(capturedHeaders?.get("x-bf-vk"), "vk");
});

test("OMP session identity is authoritative for Bifrost affinity and OpenCode forwarding", () => {
	const original = {
		"X-BF-SESSION-ID": "wrong-bifrost-session",
		"X-BF-EH-X-OPENCODE-SESSION": "wrong-opencode-session",
		"x-test": "preserved",
	};
	const headers = pifrostSessionHeaders(original, "session-123");

	assert.equal(headers["x-bf-session-id"], "session-123");
	assert.equal(headers["X-BF-SESSION-ID"], undefined);
	assert.equal(headers["x-bf-eh-x-opencode-session"], "session-123");
	assert.equal(headers["X-BF-EH-X-OPENCODE-SESSION"], undefined);
	assert.equal(headers["x-test"], "preserved");

	// Request-scoped construction must not mutate shared/caller-owned headers.
	assert.equal(original["X-BF-SESSION-ID"], "wrong-bifrost-session");
	assert.equal(original["X-BF-EH-X-OPENCODE-SESSION"], "wrong-opencode-session");
});

test("session headers remain stable per OMP session and isolated across concurrent sessions", () => {
	const firstTurn = pifrostSessionHeaders({ "x-test": "one" }, "session-a");
	const laterTurn = pifrostSessionHeaders(undefined, "session-a");
	const otherSession = pifrostSessionHeaders({ "x-bf-session-id": "stale" }, "session-b");

	assert.equal(firstTurn["x-bf-session-id"], "session-a");
	assert.equal(laterTurn["x-bf-session-id"], "session-a");
	assert.equal(firstTurn["x-bf-eh-x-opencode-session"], "session-a");
	assert.equal(laterTurn["x-bf-eh-x-opencode-session"], "session-a");
	assert.equal(otherSession["x-bf-session-id"], "session-b");
	assert.equal(otherSession["x-bf-eh-x-opencode-session"], "session-b");
	assert.equal(firstTurn["x-test"], "one");
	assert.equal(laterTurn["x-test"], undefined);
});

test("legacy OpenCode session helper now carries the same Bifrost affinity identity", () => {
	const headers = pifrostOpenCodeSessionHeaders(undefined, "session-compat");
	assert.equal(headers["x-bf-session-id"], "session-compat");
	assert.equal(headers["x-bf-eh-x-opencode-session"], "session-compat");
});


test("doctor report surfaces routing key pins without exposing credentials", () => {
	const result = synthesizeAlias(
		"omp-pinned",
		{
			chain: ["one"],
			routingPins: [
				{ source: "target", reference: "one", keyId: "key-123" },
				{ source: "fallback", reference: "one", providerKeyName: "Provider Primary" },
			],
		},
		[model("one")],
	);
	const report = formatDoctorReport([result.diagnostic]);
	assert.match(report, /pinned-target: one \[key-id=key-123\]/);
	assert.match(report, /pinned-fallback: one \[provider-key=Provider Primary\]/);
});


test("alias intersects Tool Search, between-tools thinking and service tiers conservatively", () => {
	const commonCompat = {
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		supportsUsageInStreaming: true,
		supportsBetweenToolsThinking: true,
	};
	const result = synthesizeAlias(
		"modern-capabilities",
		["one", "two"],
		[
			model("one", {
				reasoning: true,
				supportsToolSearch: true,
				supportsServiceTier: true,
				serviceTiers: ["priority", "ultrafast"],
				pricingStatus: "included",
				compat: commonCompat,
			}),
			model("two", {
				reasoning: true,
				supportsToolSearch: true,
				supportsServiceTier: true,
				serviceTiers: ["priority"],
				pricingStatus: "free",
				compat: commonCompat,
			}),
		],
	);
	assert.ok(result.model);
	assert.equal(result.model.supportsToolSearch, true);
	assert.equal(result.model.supportsServiceTier, true);
	assert.deepEqual(result.model.serviceTiers, ["priority"]);
	assert.equal(result.model.compat.supportsBetweenToolsThinking, true);
	assert.equal(result.model.pricingStatus, "variable");
	assert.equal(result.diagnostic.toolSearch, true);
	assert.equal(result.diagnostic.betweenToolsThinking, true);
	assert.deepEqual(result.diagnostic.serviceTiers, ["priority"]);
	assert.deepEqual(result.diagnostic.members?.[0]?.capabilities, {
		contextWindow: 128000,
		maxTokens: 8192,
		image: false,
		reasoning: true,
		tools: true,
		toolSearch: true,
		toolChoice: undefined,
		forcedToolChoice: undefined,
		namedToolChoice: undefined,
		reasoningWithTools: undefined,
		betweenToolsThinking: true,
		disableReasoningOnToolChoice: undefined,
		serviceTier: true,
		serviceTiers: ["priority", "ultrafast"],
	});
});

test("alias with one incompatible fallback does not advertise Tool Search or between-tools thinking", () => {
	const result = synthesizeAlias(
		"mixed-modern-capabilities",
		["one", "two"],
		[
			model("one", {
				supportsToolSearch: true,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: true,
					supportsUsageInStreaming: true,
					supportsBetweenToolsThinking: true,
				},
			}),
			model("two", {
				supportsToolSearch: false,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: true,
					supportsUsageInStreaming: true,
					supportsBetweenToolsThinking: false,
				},
			}),
		],
	);
	assert.ok(result.model);
	assert.equal(result.model.supportsToolSearch, false);
	assert.equal(result.model.compat.supportsBetweenToolsThinking, false);
});
