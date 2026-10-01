import assert from "node:assert/strict";
import test from "node:test";
import type { ImageContent, Model } from "@oh-my-pi/pi-ai";
import {
	analyzeRecoveredImages,
	isPifrostBifrostMcpTool,
	recoverBifrostRichContent,
} from "../bifrost-rich-content.ts";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("recovers flattened Bifrost image content and preserves mixed ordering", () => {
	const result = recoverBifrostRichContent([
		{
			type: "text",
			text: `before [Image Response: ${PNG_1PX}, MIME: image/png] after`,
		},
	]);
	assert.equal(result.changed, true);
	assert.equal(result.recoveredImages.length, 1);
	assert.deepEqual(result.content.map((block) => block.type), ["text", "image", "text"]);
	assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "before ");
	assert.equal(result.content[1]?.type === "image" ? result.content[1].mimeType : "", "image/png");
	assert.equal(result.content[2]?.type === "text" ? result.content[2].text : "", " after");
});

test("leaves native images untouched and does not double-decode", () => {
	const image: ImageContent = { type: "image", data: PNG_1PX, mimeType: "image/png" };
	const result = recoverBifrostRichContent([image, { type: "text", text: "ok" }]);
	assert.equal(result.changed, false);
	assert.equal(result.recoveredImages.length, 0);
	assert.equal(result.content[0], image);
});

test("rejects malformed, unsupported and oversized markers without destroying text", () => {
	const unsupported = "[Image Response: AAAA, MIME: image/svg+xml]";
	const malformed = "[Image Response: not base64!, MIME: image/png]";
	const oversized = `[Image Response: ${"A".repeat(4096)}, MIME: image/png]`;
	for (const text of [unsupported, malformed]) {
		const result = recoverBifrostRichContent([{ type: "text", text }]);
		assert.equal(result.changed, false);
		assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", text);
	}
	const limited = recoverBifrostRichContent([{ type: "text", text: oversized }], { maxImageBytes: 8 });
	assert.equal(limited.changed, false);
	assert.equal(limited.rejectedMarkers, 1);
});

test("scopes recovery to the Pifrost-owned Bifrost MCP server", () => {
	assert.equal(isPifrostBifrostMcpTool("mcp__bifrost_executeToolCode"), true);
	assert.equal(isPifrostBifrostMcpTool("mcp__bifrost_hound_mcp_screenshot"), true);
	assert.equal(isPifrostBifrostMcpTool("mcp__hound_mcp_screenshot"), false);
});

test("vision analysis uses @vision for a text-only active model", async () => {
	const textModel = { provider: "bifrost", id: "omp-default", input: ["text"] } as unknown as Model;
	const visionModel = { provider: "bifrost", id: "omp-vision", input: ["text", "image"], api: "test-api" } as unknown as Model;
	let calledModel: Model | undefined;
	const ctx = {
		model: textModel,
		models: {
			current: () => textModel,
			resolve: (spec: string) => spec === "@vision" ? visionModel : undefined,
			list: () => [textModel, visionModel],
			family: () => "test",
		},
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: {
			getApiKey: async () => "key",
			resolver: () => "key",
		},
	} as any;
	const result = await analyzeRecoveredImages(
		ctx,
		[{ type: "image", data: PNG_1PX, mimeType: "image/png" }],
		"mcp__bifrost_hound_mcp_screenshot",
		{
			completeImpl: async (model) => {
				calledModel = model;
				return {
					role: "assistant",
					content: [{ type: "text", text: "Visible checkout error." }],
					stopReason: "stop",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					timestamp: Date.now(),
				} as any;
			},
		},
	);
	assert.equal(calledModel, visionModel);
	assert.equal(result.text, "Visible checkout error.");
	assert.equal(result.model, "bifrost/omp-vision");
});

test("vision analysis is skipped when the active model already accepts images", async () => {
	const active = { provider: "bifrost", id: "vision-default", input: ["text", "image"] } as unknown as Model;
	let called = false;
	const result = await analyzeRecoveredImages(
		{
			model: active,
			models: { current: () => active, resolve: () => active, list: () => [active], family: () => "test" },
		} as any,
		[{ type: "image", data: PNG_1PX, mimeType: "image/png" }],
		"mcp__bifrost_hound_mcp_screenshot",
		{ completeImpl: async () => { called = true; throw new Error("unexpected"); } },
	);
	assert.equal(called, false);
	assert.deepEqual(result, {});
});
