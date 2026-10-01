import { completeSimple, type AssistantMessage, type ImageContent, type Model, type TextContent } from "@oh-my-pi/pi-ai";
import { sendsImageInputOnWire } from "@oh-my-pi/pi-ai/providers/vision-guard";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const BIFROST_IMAGE_PREFIX = "[Image Response:";
const BIFROST_IMAGE_MIME_SEPARATOR = ", MIME:";
const DEFAULT_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_VISION_TIMEOUT_MS = 20_000;
const DEFAULT_VISION_MAX_TOKENS = 1_200;
const MAX_VISION_IMAGES = 4;

const ALLOWED_IMAGE_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

type ToolContent = TextContent | ImageContent;

export interface RichContentRecovery {
	content: ToolContent[];
	recoveredImages: ImageContent[];
	changed: boolean;
	rejectedMarkers: number;
}

export interface VisionAnalysis {
	text?: string;
	model?: string;
	error?: string;
}

export interface RichContentBridgeOptions {
	maxImageBytes?: number;
	visionTimeoutMs?: number;
	visionMaxTokens?: number;
	completeImpl?: typeof completeSimple;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function appendText(blocks: ToolContent[], text: string): void {
	if (!text) return;
	const previous = blocks.at(-1);
	if (previous?.type === "text") {
		previous.text += text;
		return;
	}
	blocks.push({ type: "text", text });
}

function decodeBase64Image(value: string, mimeType: string, maxBytes: number): ImageContent | undefined {
	const mime = mimeType.trim().toLowerCase();
	if (!ALLOWED_IMAGE_MIME.has(mime)) return undefined;

	const compact = value.replace(/\s+/gu, "");
	if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) return undefined;
	if (compact.length > Math.ceil(maxBytes / 3) * 4 + 4) return undefined;

	const unpadded = compact.replace(/=+$/u, "");
	const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
	let bytes: Buffer;
	try {
		bytes = Buffer.from(padded, "base64");
	} catch {
		return undefined;
	}
	if (bytes.length === 0 || bytes.length > maxBytes) return undefined;
	if (bytes.toString("base64").replace(/=+$/u, "") !== unpadded) return undefined;

	return { type: "image", data: bytes.toString("base64"), mimeType: mime };
}

function recoverTextBlock(text: string, maxBytes: number): RichContentRecovery {
	const content: ToolContent[] = [];
	const recoveredImages: ImageContent[] = [];
	let rejectedMarkers = 0;
	let cursor = 0;

	while (cursor < text.length) {
		const start = text.indexOf(BIFROST_IMAGE_PREFIX, cursor);
		if (start < 0) {
			appendText(content, text.slice(cursor));
			break;
		}

		appendText(content, text.slice(cursor, start));
		const payloadStart = start + BIFROST_IMAGE_PREFIX.length;
		const separator = text.indexOf(BIFROST_IMAGE_MIME_SEPARATOR, payloadStart);
		if (separator < 0) {
			appendText(content, text.slice(start));
			break;
		}
		const close = text.indexOf("]", separator + BIFROST_IMAGE_MIME_SEPARATOR.length);
		if (close < 0) {
			appendText(content, text.slice(start));
			break;
		}

		const rawMarker = text.slice(start, close + 1);
		const encoded = text.slice(payloadStart, separator).trim();
		const mime = text.slice(separator + BIFROST_IMAGE_MIME_SEPARATOR.length, close).trim();
		const image = decodeBase64Image(encoded, mime, maxBytes);
		if (image) {
			content.push(image);
			recoveredImages.push(image);
		} else {
			rejectedMarkers++;
			appendText(content, rawMarker);
		}
		cursor = close + 1;
	}

	return {
		content: content.length ? content : [{ type: "text", text }],
		recoveredImages,
		changed: recoveredImages.length > 0,
		rejectedMarkers,
	};
}

/**
 * Restore image blocks that current Bifrost releases flatten into:
 *   [Image Response: <base64>, MIME: image/png]
 *
 * Existing native image blocks pass through untouched. Invalid/oversized markers
 * are left byte-for-byte as text, so the compatibility layer fails open.
 */
export function recoverBifrostRichContent(
	content: readonly ToolContent[],
	options: Pick<RichContentBridgeOptions, "maxImageBytes"> = {},
): RichContentRecovery {
	const maxBytes = positiveInteger(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES);
	const output: ToolContent[] = [];
	const recoveredImages: ImageContent[] = [];
	let rejectedMarkers = 0;

	for (const block of content) {
		if (block.type === "image") {
			output.push(block);
			continue;
		}
		const recovered = recoverTextBlock(block.text, maxBytes);
		output.push(...recovered.content);
		recoveredImages.push(...recovered.recoveredImages);
		rejectedMarkers += recovered.rejectedMarkers;
	}

	return {
		content: output,
		recoveredImages,
		changed: recoveredImages.length > 0,
		rejectedMarkers,
	};
}

/** Pifrost owns only the repo MCP server named "bifrost". */
export function isPifrostBifrostMcpTool(toolName: string): boolean {
	return toolName.toLowerCase().startsWith("mcp__bifrost_");
}

function visionModelFor(ctx: ExtensionContext): Model | undefined {
	const candidates = [
		ctx.models.resolve("@vision"),
		ctx.models.resolve("@default"),
		...ctx.models.list(),
	];
	const seen = new Set<string>();
	for (const model of candidates) {
		if (!model) continue;
		const key = `${model.provider}/${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (sendsImageInputOnWire(model)) return model;
	}
	return undefined;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function combineAbortSignals(timeoutMs: number): AbortSignal {
	return AbortSignal.timeout(timeoutMs);
}

/**
 * Ask OMP's configured @vision role to interpret recovered screenshots only
 * when the active agent model cannot consume images itself.
 */
export async function analyzeRecoveredImages(
	ctx: ExtensionContext,
	images: readonly ImageContent[],
	toolName: string,
	options: RichContentBridgeOptions = {},
): Promise<VisionAnalysis> {
	const active = ctx.model ?? ctx.models.current();
	if (active && sendsImageInputOnWire(active)) return {};
	if (!images.length) return {};

	const visionModel = visionModelFor(ctx);
	if (!visionModel) {
		return { error: "No image-capable OMP @vision/default model is available." };
	}

	const timeoutMs = positiveInteger(options.visionTimeoutMs, DEFAULT_VISION_TIMEOUT_MS);
	const signal = combineAbortSignals(timeoutMs);
	const sessionId = ctx.sessionManager.getSessionId();
	let availableKey: string | undefined;
	try {
		availableKey = await ctx.modelRegistry.getApiKey(visionModel, sessionId, { signal });
	} catch (error) {
		return { error: `Vision credential lookup failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (availableKey === undefined) {
		return { error: `No credential is available for ${visionModel.provider}/${visionModel.id}.` };
	}

	const selected = images.slice(0, MAX_VISION_IMAGES);
	const userContent: ToolContent[] = [];
	selected.forEach((image, index) => {
		userContent.push({ type: "text", text: `Screenshot ${index + 1} of ${selected.length} from ${toolName}.` });
		userContent.push(image);
	});
	userContent.push({
		type: "text",
		text:
			"Analyze the screenshot(s) for the parent coding/research agent. Report visible page content, important text, UI state, errors or warnings, controls, and visual relationships relevant to likely web research or debugging. Do not infer anything that is not visible. Be concise but specific.",
	});

	try {
		const response = await (options.completeImpl ?? completeSimple)(
			visionModel,
			{
				systemPrompt: [
					"You are the OMP vision role. Analyze browser screenshots supplied by a tool and return factual visual observations for another agent.",
				],
				messages: [{
					role: "user",
					content: userContent,
					timestamp: Date.now(),
				}],
			},
			{
				apiKey: ctx.modelRegistry.resolver(visionModel, sessionId),
				sessionId,
				signal,
				maxTokens: positiveInteger(options.visionMaxTokens, DEFAULT_VISION_MAX_TOKENS),
			},
		);
		if (response.stopReason === "error") {
			return { error: response.errorMessage ?? "Vision analysis failed." };
		}
		if (response.stopReason === "aborted") {
			return { error: `Vision analysis timed out after ${timeoutMs}ms.` };
		}
		const text = assistantText(response);
		if (!text) return { error: "Vision model returned no usable text." };
		return {
			text,
			model: `${visionModel.provider}/${visionModel.id}`,
		};
	} catch (error) {
		return { error: `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/**
 * Runtime compatibility layer for Bifrost MCP rich content.
 *
 * It never calls Hound directly and never alters native image blocks. When the
 * current agent is text-only, recovered screenshots are retained in the tool
 * result while a bounded one-shot @vision analysis is appended as text.
 */
export function registerBifrostRichContentBridge(
	pi: ExtensionAPI,
	options: RichContentBridgeOptions = {},
): void {
	pi.on("tool_result", async (event, ctx) => {
		if (!isPifrostBifrostMcpTool(event.toolName)) return undefined;
		const recovered = recoverBifrostRichContent(event.content, options);
		if (!recovered.changed) return undefined;

		let content = recovered.content;
		if (!event.isError) {
			const analysis = await analyzeRecoveredImages(ctx, recovered.recoveredImages, event.toolName, options);
			if (analysis.text) {
				content = [
					...content,
					{
						type: "text",
						text: `[Pifrost visual analysis via ${analysis.model}]\n${analysis.text}`,
					},
				];
			} else if (analysis.error && !(ctx.model && sendsImageInputOnWire(ctx.model))) {
				content = [
					...content,
					{
						type: "text",
						text: `[Pifrost recovered the screenshot as an image, but automatic OMP vision analysis was unavailable: ${analysis.error}]`,
					},
				];
			}
		}
		return { content };
	});
}
