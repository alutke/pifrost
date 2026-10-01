import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@oh-my-pi/pi-ai";
import {
	analyzeRecoveredImages,
	isPifrostBifrostScreenshotTool,
	recoverBifrostRichContent,
	registerBifrostRichContentBridge,
} from "../bifrost-rich-content.ts";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const marker = `[Image Response: ${PNG_1PX}, MIME: image/png]`;

test("rich-content recovery validates image signatures and aggregate limits", () => {
	const spoof = Buffer.from("not really a png").toString("base64");
	const spoofed = recoverBifrostRichContent([{
		type: "text",
		text: `[Image Response: ${spoof}, MIME: image/png]`,
	}]);
	assert.equal(spoofed.changed, false);
	assert.equal(spoofed.rejectedMarkers, 1);

	const limitedCount = recoverBifrostRichContent(
		[{ type: "text", text: [marker, marker, marker].join(" ") }],
		{ maxImages: 2 },
	);
	assert.equal(limitedCount.recoveredImages.length, 2);
	assert.equal(limitedCount.rejectedMarkers, 1);

	const oneImageBytes = Buffer.from(PNG_1PX, "base64").length;
	const limitedBytes = recoverBifrostRichContent(
		[{ type: "text", text: [marker, marker].join(" ") }],
		{ maxTotalImageBytes: oneImageBytes },
	);
	assert.equal(limitedBytes.recoveredImages.length, 1);
	assert.equal(limitedBytes.rejectedMarkers, 1);
});

test("only directly exposed Bifrost Hound screenshot tools are eligible for recovery", () => {
	assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_hound_mcp_screenshot"), true);
	assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_hound-mcp_screenshot"), true);
	assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_mcp_screenshot"), true);
	assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_hound_mcp_smart_fetch"), false);
	assert.equal(isPifrostBifrostScreenshotTool("mcp__bifrost_executeToolCode"), false);
	assert.equal(isPifrostBifrostScreenshotTool("mcp__hound_mcp_screenshot"), false);
});

test("text-only vision analysis does not silently fall back outside @vision", async () => {
	const textModel = { provider: "bifrost", id: "omp-default", input: ["text"] } as unknown as Model;
	const unrelatedVision = { provider: "other", id: "vision-ish", input: ["text", "image"] } as unknown as Model;
	let called = false;
	const result = await analyzeRecoveredImages(
		{
			model: textModel,
			models: {
				current: () => textModel,
				resolve: () => undefined,
				list: () => [unrelatedVision],
				family: () => "test",
			},
			sessionManager: { getSessionId: () => "session-1" },
			modelRegistry: { getApiKey: async () => "key", resolver: () => "key" },
		} as any,
		[{ type: "image", data: PNG_1PX, mimeType: "image/png" }],
		"mcp__bifrost_hound_mcp_screenshot",
		{ completeImpl: async () => { called = true; throw new Error("unexpected"); } },
	);
	assert.equal(called, false);
	assert.match(result.error ?? "", /@vision/u);
});

test("bridge ignores spoofable markers from fetch, Code Mode and error results", async () => {
	let handler: any;
	registerBifrostRichContentBridge({
		on: (name: string, fn: any) => {
			if (name === "tool_result") handler = fn;
		},
	} as any);
	assert.equal(typeof handler, "function");

	const active = { provider: "bifrost", id: "vision-default", input: ["text", "image"] } as unknown as Model;
	const ctx = {
		model: active,
		models: { current: () => active, resolve: () => active, list: () => [active], family: () => "test" },
	} as any;
	for (const toolName of [
		"mcp__bifrost_hound_mcp_smart_fetch",
		"mcp__bifrost_executeToolCode",
	]) {
		assert.equal(await handler({ toolName, content: [{ type: "text", text: marker }], isError: false }, ctx), undefined);
	}
	assert.equal(
		await handler({ toolName: "mcp__bifrost_hound_mcp_screenshot", content: [{ type: "text", text: marker }], isError: true }, ctx),
		undefined,
	);
});

test("classic Hound screenshot survives Bifrost flattening and reaches the configured @vision role", async () => {
	let handler: any;
	let selectedModel: Model | undefined;
	registerBifrostRichContentBridge({
		on: (name: string, fn: any) => {
			if (name === "tool_result") handler = fn;
		},
	} as any, {
		completeImpl: async (model) => {
			selectedModel = model;
			return {
				role: "assistant",
				content: [{ type: "text", text: "Visible login error." }],
				stopReason: "stop",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				timestamp: Date.now(),
			} as any;
		},
	});

	const textModel = { provider: "bifrost", id: "omp-default", input: ["text"] } as unknown as Model;
	const visionModel = { provider: "bifrost", id: "omp-vision", input: ["text", "image"], api: "test-api" } as unknown as Model;
	const ctx = {
		model: textModel,
		models: {
			current: () => textModel,
			resolve: (spec: string) => spec === "@vision" ? visionModel : undefined,
			list: () => [textModel, visionModel],
			family: () => "test",
		},
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: { getApiKey: async () => "key", resolver: () => "key" },
	} as any;

	const result = await handler({
		toolName: "mcp__bifrost_hound_mcp_screenshot",
		content: [{ type: "text", text: marker }],
		isError: false,
	}, ctx);
	assert.equal(selectedModel, visionModel);
	assert.deepEqual(result.content.map((block: any) => block.type), ["image", "text"]);
	assert.match(result.content[1].text, /Visible login error/u);
});
