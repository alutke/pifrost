import * as natives from "@oh-my-pi/pi-natives";

export type PifrostImageDetail = "auto" | "low" | "high" | "original";

export interface PifrostImageTokenTarget {
	id?: string;
	api?: string;
	tokenizer?: string;
	identity?: {
		class: string;
		family?: string;
		revision?: string;
	};
}

interface ImageSize {
	width: number;
	height: number;
}

interface PatchSizing {
	maxEdge: number;
	patchBudget?: number;
}

type ImageTokenization =
	| {
		regime: "openai-patch";
		multiplier: number;
		low: PatchSizing;
		high: PatchSizing;
		original: PatchSizing;
		auto: "high" | "original";
	  }
	| { regime: "anthropic-patch"; maxEdge: number; maxTokens: number }
	| { regime: "fixed"; tokens: number };

const UNKNOWN_IMAGE_SIZE: ImageSize = { width: 65_535, height: 65_535 };
const HEADER_BASE64_CHARS = 4 * Math.ceil((64 * 1024) / 3);
const OPENAI_PATCH_PX = 32;
const ANTHROPIC_PATCH_PX = 28;

const TOKENIZER_ENCODINGS: Readonly<Record<string, natives.Encoding>> = Object.freeze({
	"claude-v3": natives.Encoding.ClaudeV3,
	"claude-v47": natives.Encoding.ClaudeV47,
	"claude-v5": natives.Encoding.ClaudeV5,
	"claude-v5-sonnet": natives.Encoding.ClaudeV5Sonnet,
	qwen3: natives.Encoding.Qwen3,
	"deepseek-v3": natives.Encoding.DeepSeekV3,
	"kimi-k2": natives.Encoding.KimiK2,
	glm5: natives.Encoding.Glm5,
});

function byteEstimate(value: string): number {
	return Math.ceil(new TextEncoder().encode(value).byteLength / 4);
}

/**
 * Use OMP's catalog-resolved tokenizer family when it is available on the
 * candidate model. Unknown tokenizers retain the historical byte estimate so
 * minimum-supported OMP releases remain compatible.
 */
export function estimatePifrostTextTokens(
	value: string | string[],
	target: Pick<PifrostImageTokenTarget, "tokenizer">,
): number {
	const values = Array.isArray(value) ? value : [value];
	const encoding = target.tokenizer ? TOKENIZER_ENCODINGS[target.tokenizer] : undefined;
	if (encoding !== undefined) {
		try {
			return natives.countTokens(values, encoding);
		} catch {
			// A native addon/model mismatch must not make route planning unusable.
		}
	}
	return values.reduce((sum, item) => sum + byteEstimate(item), 0);
}

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Uint8Array.from([0xff, 0xd8, 0xff]);
const GIF87A = new TextEncoder().encode("GIF87a");
const GIF89A = new TextEncoder().encode("GIF89a");
const WEBP_RIFF_MAGIC = new TextEncoder().encode("RIFF");
const WEBP_MAGIC = new TextEncoder().encode("WEBP");
const WEBP_VP8X = new TextEncoder().encode("VP8X");
const WEBP_VP8L = new TextEncoder().encode("VP8L");
const WEBP_VP8 = new TextEncoder().encode("VP8 ");

function magicEquals(header: Uint8Array, offset: number, magic: Uint8Array): boolean {
	if (header.length < offset + magic.length) return false;
	for (let index = 0; index < magic.length; index++) {
		if (header[offset + index] !== magic[index]) return false;
	}
	return true;
}

function parsePngSize(header: Uint8Array): ImageSize | undefined {
	if (!magicEquals(header, 0, PNG_MAGIC) || header.length < 24) return undefined;
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const width = view.getUint32(16, false);
	const height = view.getUint32(20, false);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseGifSize(header: Uint8Array): ImageSize | undefined {
	if ((!magicEquals(header, 0, GIF87A) && !magicEquals(header, 0, GIF89A)) || header.length < 10) {
		return undefined;
	}
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const width = view.getUint16(6, true);
	const height = view.getUint16(8, true);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseJpegSize(header: Uint8Array): ImageSize | undefined {
	if (!magicEquals(header, 0, JPEG_MAGIC) || header.length < 4) return undefined;
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	let offset = 2;
	while (offset + 9 < header.length) {
		if (header[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		let markerOffset = offset + 1;
		while (markerOffset < header.length && header[markerOffset] === 0xff) markerOffset += 1;
		if (markerOffset >= header.length) break;
		const marker = header[markerOffset]!;
		const segmentOffset = markerOffset + 1;
		if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset = segmentOffset;
			continue;
		}
		if (segmentOffset + 1 >= header.length) break;
		const segmentLength = view.getUint16(segmentOffset, false);
		if (segmentLength < 2) break;
		const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isStartOfFrame) {
			if (segmentOffset + 7 >= header.length) break;
			const height = view.getUint16(segmentOffset + 3, false);
			const width = view.getUint16(segmentOffset + 5, false);
			return width > 0 && height > 0 ? { width, height } : undefined;
		}
		offset = segmentOffset + segmentLength;
	}
	return undefined;
}

function parseWebpSize(header: Uint8Array): ImageSize | undefined {
	if (!magicEquals(header, 0, WEBP_RIFF_MAGIC) || !magicEquals(header, 8, WEBP_MAGIC) || header.length < 25) {
		return undefined;
	}
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	if (magicEquals(header, 12, WEBP_VP8X) && header.length >= 30) {
		return {
			width: (header[24]! | (header[25]! << 8) | (header[26]! << 16)) + 1,
			height: (header[27]! | (header[28]! << 8) | (header[29]! << 16)) + 1,
		};
	}
	if (magicEquals(header, 12, WEBP_VP8L)) {
		const bits = view.getUint32(21, true);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
		};
	}
	if (magicEquals(header, 12, WEBP_VP8) && header.length >= 30) {
		const width = view.getUint16(26, true) & 0x3fff;
		const height = view.getUint16(28, true) & 0x3fff;
		return width > 0 && height > 0 ? { width, height } : undefined;
	}
	return undefined;
}

function parseImageSize(header: Uint8Array): ImageSize | undefined {
	return parsePngSize(header) ?? parseJpegSize(header) ?? parseGifSize(header) ?? parseWebpSize(header);
}

const OPENAI_WIRE_FALLBACK: ImageTokenization = {
	regime: "openai-patch",
	multiplier: 1.2,
	auto: "original",
	low: { maxEdge: 512 },
	high: { maxEdge: 2_048, patchBudget: 2_500 },
	original: { maxEdge: 6_000, patchBudget: 10_000 },
};

const OPENAI_56: ImageTokenization = {
	regime: "openai-patch",
	multiplier: 1.2,
	auto: "original",
	low: { maxEdge: 512 },
	high: { maxEdge: 2_048, patchBudget: 2_500 },
	original: { maxEdge: 65_535 },
};

const OPENAI_54: ImageTokenization = {
	regime: "openai-patch",
	multiplier: 1.2,
	auto: "high",
	low: { maxEdge: 2_048, patchBudget: 6_144 },
	high: { maxEdge: 2_048, patchBudget: 2_500 },
	original: { maxEdge: 6_000, patchBudget: 10_000 },
};

const OPENAI_52: ImageTokenization = {
	regime: "openai-patch",
	multiplier: 1.2,
	auto: "high",
	low: { maxEdge: 2_048, patchBudget: 6_144 },
	high: { maxEdge: 2_048, patchBudget: 6_144 },
	original: { maxEdge: 2_048, patchBudget: 6_144 },
};

const OPENAI_ASTRA: ImageTokenization = {
	regime: "openai-patch",
	multiplier: 1.2,
	auto: "original",
	low: { maxEdge: 512 },
	high: { maxEdge: 65_535, patchBudget: 2_500 },
	original: { maxEdge: 65_535 },
};

const ANTHROPIC_HIGH: ImageTokenization = {
	regime: "anthropic-patch",
	maxEdge: 2_576,
	maxTokens: 4_784,
};

const ANTHROPIC_STANDARD: ImageTokenization = {
	regime: "anthropic-patch",
	maxEdge: 1_568,
	maxTokens: 1_568,
};

const GEMINI_3: ImageTokenization = { regime: "fixed", tokens: 1_120 };

function parseRevision(value: string | undefined): [number, number, number] | undefined {
	if (!value) return undefined;
	const out: [number, number, number] = [0, 0, 0];
	const parts = value.split(/[.-]/u);
	if (parts.length > 3 || parts.some((part) => !/^\d+$/u.test(part))) return undefined;
	for (let index = 0; index < parts.length; index++) out[index] = Number(parts[index]);
	return out;
}

function compareRevision(value: string | undefined, floor: string): number | undefined {
	const a = parseRevision(value);
	const b = parseRevision(floor);
	if (!a || !b) return undefined;
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
	}
	return 0;
}

function revisionAtLeast(value: string | undefined, floor: string): boolean {
	return (compareRevision(value, floor) ?? -1) >= 0;
}

function revisionBelow(value: string | undefined, ceiling: string): boolean {
	return (compareRevision(value, ceiling) ?? 1) < 0;
}

function openAiRule(target: PifrostImageTokenTarget): ImageTokenization {
	const id = target.id?.toLowerCase() ?? "";
	if (id.includes("gpt-6-astra")) return OPENAI_ASTRA;
	const revision = target.identity?.revision;
	if (revisionAtLeast(revision, "5.6") && revisionBelow(revision, "10")) return OPENAI_56;
	if (compareRevision(revision, "5.5") === 0) return OPENAI_WIRE_FALLBACK;
	if (compareRevision(revision, "5.4") === 0) return OPENAI_54;
	if (revisionAtLeast(revision, "5.2") && revisionBelow(revision, "5.4")) return OPENAI_52;
	return OPENAI_WIRE_FALLBACK;
}

function anthropicRule(target: PifrostImageTokenTarget): ImageTokenization {
	const family = target.identity?.family;
	const revision = target.identity?.revision;
	const knownStandardFamily = family === "opus" || family === "sonnet" || family === "haiku";
	const pre47 = compareRevision(revision, "4.7");
	const collapsedLegacy = revisionAtLeast(revision, "10") && revisionBelow(revision, "47");
	return knownStandardFamily && ((pre47 !== undefined && pre47 < 0) || collapsedLegacy)
		? ANTHROPIC_STANDARD
		: ANTHROPIC_HIGH;
}

/**
 * Mirrors OMP 18.8.x's pure image-tokenization policy without importing
 * pi-agent-core/pi-natives. Pifrost historically removed that native dependency
 * because clean GitHub plugin installs cannot rely on OMP's native addon graph.
 */
export function resolvePifrostImageTokenization(target: PifrostImageTokenTarget): ImageTokenization {
	switch (target.identity?.class) {
		case "openai":
			return openAiRule(target);
		case "anthropic":
			return anthropicRule(target);
		case "gemini":
			if (revisionAtLeast(target.identity.revision, "3")) return GEMINI_3;
			break;
	}

	switch (target.api) {
		case "google-generative-ai":
		case "google-gemini-cli":
		case "google-vertex":
			return GEMINI_3;
		case "anthropic-messages":
		case "bedrock-converse-stream":
		case "openrouter":
		case "ollama-chat":
		case "cursor-agent":
		case "factory-droid-agent":
		case "gitlab-duo-agent":
		case "devin-agent":
		case "apple-foundation-models":
			return ANTHROPIC_HIGH;
		default:
			return OPENAI_WIRE_FALLBACK;
	}
}

function fitLongEdge(size: ImageSize, maxEdge: number): ImageSize {
	const longest = Math.max(size.width, size.height);
	if (longest <= maxEdge) return size;
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale)),
	};
}

function openAiPatches(size: ImageSize, sizing: PatchSizing): number {
	const { width, height } = fitLongEdge(size, sizing.maxEdge);
	const patches = Math.ceil(width / OPENAI_PATCH_PX) * Math.ceil(height / OPENAI_PATCH_PX);
	if (sizing.patchBudget === undefined || patches <= sizing.patchBudget) return patches;
	const shrink = Math.sqrt((OPENAI_PATCH_PX * OPENAI_PATCH_PX * sizing.patchBudget) / (width * height));
	const scaledW = (width * shrink) / OPENAI_PATCH_PX;
	const scaledH = (height * shrink) / OPENAI_PATCH_PX;
	const adjusted = shrink * Math.min(Math.floor(scaledW) / scaledW, Math.floor(scaledH) / scaledH);
	const resizedW = Math.floor(width * adjusted);
	const resizedH = Math.floor(height * adjusted);
	if (resizedW <= 0 || resizedH <= 0) return sizing.patchBudget;
	return Math.min(
		sizing.patchBudget,
		Math.ceil(resizedW / OPENAI_PATCH_PX) * Math.ceil(resizedH / OPENAI_PATCH_PX),
	);
}

function roundTiesToEven(value: number): number {
	const floor = Math.floor(value);
	if (value - floor !== 0.5) return Math.round(value);
	return floor % 2 === 0 ? floor : floor + 1;
}

function anthropicTokens(size: ImageSize, maxEdge: number, maxTokens: number): number {
	const long = Math.max(size.width, size.height);
	const shortSide = Math.min(size.width, size.height);
	const aspect = long / shortSide;
	const patches = (l: number, s: number) =>
		Math.ceil(l / ANTHROPIC_PATCH_PX) * Math.ceil(s / ANTHROPIC_PATCH_PX);
	const fits = (l: number, s: number) =>
		Math.ceil(l / ANTHROPIC_PATCH_PX) * ANTHROPIC_PATCH_PX <= maxEdge &&
		Math.ceil(s / ANTHROPIC_PATCH_PX) * ANTHROPIC_PATCH_PX <= maxEdge &&
		patches(l, s) <= maxTokens;
	const short = (l: number) => Math.max(roundTiesToEven(l / aspect), 1);
	if (fits(long, shortSide)) return patches(long, shortSide);
	let lo = 1;
	let hi = long;
	while (lo + 1 < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (fits(mid, short(mid))) lo = mid;
		else hi = mid;
	}
	return patches(lo, short(lo));
}

function imageTokens(rule: ImageTokenization, size: ImageSize, detail?: PifrostImageDetail): number {
	switch (rule.regime) {
		case "fixed":
			return rule.tokens;
		case "openai-patch": {
			const level = detail === "low" || detail === "high" || detail === "original" ? detail : rule.auto;
			return Math.ceil(openAiPatches(size, rule[level]) * rule.multiplier);
		}
		case "anthropic-patch":
			return anthropicTokens(size, rule.maxEdge, rule.maxTokens);
	}
}

function base64ImageSize(base64: string): ImageSize | undefined {
	if (!base64) return undefined;
	try {
		const header = Buffer.from(base64.slice(0, HEADER_BASE64_CHARS), "base64");
		return parseImageSize(header);
	} catch {
		return undefined;
	}
}

function imageBlockSize(block: Record<string, unknown>): ImageSize | undefined {
	if (typeof block.data === "string") return base64ImageSize(block.data);
	if (typeof block.url !== "string" || !block.url.startsWith("data:")) return undefined;
	const comma = block.url.indexOf(",");
	if (comma < 0 || !block.url.slice(0, comma).endsWith(";base64")) return undefined;
	return base64ImageSize(block.url.slice(comma + 1));
}

export function estimatePifrostImageTokens(
	block: Record<string, unknown>,
	target: PifrostImageTokenTarget,
): number {
	const detail =
		block.detail === "low" || block.detail === "high" || block.detail === "original" || block.detail === "auto"
			? block.detail
			: undefined;
	const size = imageBlockSize(block);
	const rule = size ? resolvePifrostImageTokenization(target) : OPENAI_WIRE_FALLBACK;
	return imageTokens(rule, size ?? UNKNOWN_IMAGE_SIZE, detail);
}
