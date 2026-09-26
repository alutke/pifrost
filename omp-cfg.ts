import { resolve } from "node:path";

import type { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { CfgProtocolHandler } from "@oh-my-pi/pi-coding-agent/internal-urls/cfg-protocol";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

interface OmpCfgRuntime {
	Settings: typeof import("@oh-my-pi/pi-coding-agent/config/settings").Settings;
	CfgProtocolHandler: typeof import("@oh-my-pi/pi-coding-agent/internal-urls/cfg-protocol").CfgProtocolHandler;
	parseInternalUrl: typeof import("@oh-my-pi/pi-coding-agent/internal-urls/parse").parseInternalUrl;
}

let runtimePromise: Promise<OmpCfgRuntime> | undefined;
let handler: CfgProtocolHandler | undefined;

async function ompCfgRuntime(): Promise<OmpCfgRuntime> {
	runtimePromise ??= Promise.all([
		import("@oh-my-pi/pi-coding-agent/config/settings"),
		import("@oh-my-pi/pi-coding-agent/internal-urls/cfg-protocol"),
		import("@oh-my-pi/pi-coding-agent/internal-urls/parse"),
	]).then(([settings, cfgProtocol, parse]) => ({
		Settings: settings.Settings,
		CfgProtocolHandler: cfgProtocol.CfgProtocolHandler,
		parseInternalUrl: parse.parseInternalUrl,
	}));
	return runtimePromise;
}

async function cfgHandler(): Promise<{ runtime: OmpCfgRuntime; handler: CfgProtocolHandler }> {
	const runtime = await ompCfgRuntime();
	handler ??= new runtime.CfgProtocolHandler();
	return { runtime, handler };
}

export const PIFROST_OMP_MODEL_ROLES = Object.freeze({
	default: "bifrost/omp-default",
	smol: "bifrost/omp-smol",
	task: "bifrost/omp-task",
	advisor: "bifrost/omp-advisor",
	slow: "bifrost/omp-slow",
	plan: "bifrost/omp-plan",
	designer: "bifrost/omp-designer",
	vision: "bifrost/omp-vision",
	commit: "bifrost/omp-commit",
	tiny: "bifrost/omp-tiny",
});

export interface PifrostOmpSettingDefinition {
	id: string;
	url: string;
	value: unknown;
	serialized: string;
	description: string;
}

function definition(id: string, value: unknown, description: string): PifrostOmpSettingDefinition {
	return {
		id,
		url: `cfg://${id.replaceAll(".", "/")}`,
		value,
		serialized: JSON.stringify(value),
		description,
	};
}

export const PIFROST_OMP_SETTINGS = Object.freeze([
	definition("modelProviderOrder", ["bifrost"], "Prefer Bifrost for model resolution"),
	definition("enabledModels", ["bifrost/*"], "Expose the Pifrost/Bifrost model namespace"),
	definition("retry.modelFallback", false, "Keep provider/model fallback authoritative in Bifrost"),
	definition("task.enableEffort", true, "Allow task agents to carry reasoning effort"),
	definition("task.enableLsp", true, "Keep LSP available to task agents"),
	definition("modelRoles", PIFROST_OMP_MODEL_ROLES, "Map OMP roles to Pifrost logical aliases"),
] as const);

export interface PifrostCfgSession {
	settings: Settings;
	cwd: string;
	sessionId: string;
	hasUI: boolean;
	settingsApproval: boolean;
	taskDepth: number;
	agentKind: "main" | "sub";
}

export interface PifrostOmpSettingStatus {
	id: string;
	url: string;
	value: unknown;
	valueText: string;
	type?: string;
	defaultText?: string;
	source?: string;
	expected: unknown;
	matches: boolean;
	content: string;
}

export interface PifrostOmpWriteResult {
	id: string;
	url: string;
	save: boolean;
	outcome?: string;
	text: string;
}

function toolSession(session: PifrostCfgSession): ToolSession {
	return {
		cwd: session.cwd,
		hasUI: session.hasUI,
		canPromptUser: session.hasUI,
		settingsApproval: session.settingsApproval,
		taskDepth: session.taskDepth,
		getSessionFile: () => null,
		getSessionId: () => session.sessionId,
		settings: session.settings,
	} as unknown as ToolSession;
}

function parseValue(valueText: string): unknown {
	try {
		return JSON.parse(valueText);
	} catch {
		return valueText;
	}
}

function expectedMatches(id: string, actual: unknown, expected: unknown): boolean {
	if (id === "modelProviderOrder") {
		return Array.isArray(actual) && actual[0] === "bifrost";
	}
	if (id === "enabledModels") {
		return Array.isArray(actual) && actual.includes("bifrost/*");
	}
	if (id === "modelRoles") {
		if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
		const record = actual as Record<string, unknown>;
		return Object.entries(PIFROST_OMP_MODEL_ROLES).every(([role, model]) => record[role] === model);
	}
	return Object.is(actual, expected);
}

export function normalizePifrostOmpSetting(input: string): PifrostOmpSettingDefinition | undefined {
	const normalized = input.trim().replaceAll("/", ".").toLowerCase();
	return PIFROST_OMP_SETTINGS.find((item) => item.id.toLowerCase() === normalized);
}

export function parsePifrostOmpSettingContent(definition: PifrostOmpSettingDefinition, content: string): PifrostOmpSettingStatus {
	const lines = content.split("\n");
	const prefix = `${definition.id}: `;
	const valueText = lines[0]?.startsWith(prefix) ? lines[0].slice(prefix.length) : "";
	const field = (name: string): string | undefined => {
		const line = lines.find((candidate) => candidate.startsWith(`${name}: `));
		return line?.slice(name.length + 2);
	};
	const value = parseValue(valueText);
	return {
		id: definition.id,
		url: definition.url,
		value,
		valueText,
		type: field("type"),
		defaultText: field("default"),
		source: field("source"),
		expected: definition.value,
		matches: expectedMatches(definition.id, value, definition.value),
		content,
	};
}

export function assertPifrostCfgSession(session: PifrostCfgSession, write = false): void {
	if (session.agentKind !== "main" || session.taskDepth > 0) {
		throw new Error("Pifrost cfg:// integration is available only in the top-level OMP session");
	}
	if (resolve(session.settings.getCwd()) !== resolve(session.cwd)) {
		throw new Error(
			`Pifrost cfg:// settings scope mismatch: active OMP settings are for ${session.settings.getCwd()}, command is running in ${session.cwd}`,
		);
	}
	if (write && (!session.hasUI || !session.settingsApproval)) {
		throw new Error("Pifrost cfg:// writes require the interactive top-level OMP UI and its approval host");
	}
}

export async function activePifrostCfgSession(options: {
	cwd: string;
	sessionId: string;
	hasUI: boolean;
	settingsApproval: boolean;
	taskDepth?: number;
	agentKind?: "main" | "sub";
}): Promise<PifrostCfgSession> {
	const { Settings } = await ompCfgRuntime();
	const settings = Settings.instance;
	const session: PifrostCfgSession = {
		settings,
		cwd: options.cwd,
		sessionId: options.sessionId,
		hasUI: options.hasUI,
		settingsApproval: options.settingsApproval,
		taskDepth: options.taskDepth ?? 0,
		agentKind: options.agentKind ?? "main",
	};
	assertPifrostCfgSession(session);
	return session;
}

export async function readPifrostOmpSetting(
	session: PifrostCfgSession,
	setting: PifrostOmpSettingDefinition,
): Promise<PifrostOmpSettingStatus> {
	assertPifrostCfgSession(session);
	const { runtime, handler } = await cfgHandler();
	const resource = await handler.resolve(runtime.parseInternalUrl(setting.url), {
		cwd: session.cwd,
		sessionId: session.sessionId,
		settings: session.settings,
		session: toolSession(session),
	});
	return parsePifrostOmpSettingContent(setting, resource.content);
}

export async function readPifrostOmpProfile(session: PifrostCfgSession): Promise<PifrostOmpSettingStatus[]> {
	const result: PifrostOmpSettingStatus[] = [];
	for (const setting of PIFROST_OMP_SETTINGS) {
		result.push(await readPifrostOmpSetting(session, setting));
	}
	return result;
}

export async function writePifrostOmpSetting(
	session: PifrostCfgSession,
	setting: PifrostOmpSettingDefinition,
	content: string,
	save = false,
): Promise<PifrostOmpWriteResult> {
	assertPifrostCfgSession(session, true);
	const url = save ? `${setting.url}/save` : setting.url;
	const { runtime, handler } = await cfgHandler();
	const result = await handler.write(runtime.parseInternalUrl(url), content, {
		cwd: session.cwd,
		session: toolSession(session),
	});
	const text = result?.content
		?.map((part) => part.type === "text" ? part.text : "")
		.filter(Boolean)
		.join("\n") ?? "";
	return {
		id: setting.id,
		url,
		save,
		outcome: result?.details?.cfg?.outcome,
		text,
	};
}

export async function applyPifrostOmpProfile(
	session: PifrostCfgSession,
	save = false,
): Promise<PifrostOmpWriteResult[]> {
	const result: PifrostOmpWriteResult[] = [];
	for (const setting of PIFROST_OMP_SETTINGS) {
		result.push(await writePifrostOmpSetting(session, setting, setting.serialized, save));
	}
	return result;
}

export function formatPifrostOmpProfile(statuses: readonly PifrostOmpSettingStatus[]): string {
	const lines = ["OMP Pifrost configuration:"];
	for (const status of statuses) {
		lines.push(
			`  [${status.matches ? "OK" : "DIFF"}] ${status.id} = ${status.valueText || "<unreadable>"} (source: ${status.source ?? "unknown"})`,
		);
	}
	return lines.join("\n");
}

export function formatPifrostOmpWrites(results: readonly PifrostOmpWriteResult[]): string {
	return results
		.map((result) => `${result.id}: ${result.outcome ?? "unknown"}${result.save ? " (saved)" : " (session)"}`)
		.join("\n");
}
