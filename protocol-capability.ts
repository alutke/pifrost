export const PIFROST_WIRE_PROTOCOL = "openai-completions" as const;

export type PifrostWireProtocol =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages";

function normalize(value: string): string {
	return value.trim().toLowerCase().replace(/_/gu, "-");
}

/**
 * Normalize OMP API ids, Bifrost supported_methods values and endpoint names
 * into the wire protocols Pifrost can reason about.
 */
export function normalizeWireProtocol(value: string): PifrostWireProtocol | undefined {
	const candidate = normalize(value);
	if (
		candidate === "openai-completions" ||
		candidate.includes("/chat/completions") ||
		candidate.includes("chat.completions") ||
		candidate.includes("chat-completion") ||
		candidate === "chat"
	) {
		return "openai-completions";
	}
	if (
		candidate === "openai-responses" ||
		candidate === "openai-codex-responses" ||
		candidate.includes("/responses") ||
		candidate === "responses" ||
		candidate === "response"
	) {
		return "openai-responses";
	}
	if (
		candidate === "anthropic-messages" ||
		candidate.includes("/messages") ||
		candidate === "messages" ||
		candidate.includes("anthropic")
	) {
		return "anthropic-messages";
	}
	return undefined;
}

export function wireProtocolsFrom(values: readonly string[] | undefined): PifrostWireProtocol[] | undefined {
	if (!values?.length) return undefined;
	const protocols = [...new Set(values.map(normalizeWireProtocol).filter((value): value is PifrostWireProtocol => Boolean(value)))];
	return protocols.length ? protocols : undefined;
}

export function supportsPifrostWireProtocol(protocols: readonly PifrostWireProtocol[] | undefined): boolean | undefined {
	if (!protocols?.length) return undefined;
	return protocols.includes(PIFROST_WIRE_PROTOCOL);
}
