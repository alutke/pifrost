import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelReference } from "../model-resolution.ts";

const models = [{ id: "openrouter/google/gemini-3.7-flash" }];

test("aggregator qualifier punctuation and capitalization can drift", () => {
	for (const reference of [
		"CommandCode GOAT/google/gemini-3.7-flash",
		"command-code-goat/Google/GEMINI-3.7-FLASH",
		"COMMAND_CODE_GOAT/google/gemini-3.7-flash",
	]) {
		assert.equal(resolveModelReference(reference, models).model?.id, "openrouter/google/gemini-3.7-flash");
	}
});

test("OpenAI/Codex provider aliases normalize without affecting the model id", () => {
	const openai = [{ id: "openai/gpt-5.6-terra" }];
	assert.equal(resolveModelReference("Codex/gpt-5.6-terra", openai).model?.id, "openai/gpt-5.6-terra");
	assert.equal(resolveModelReference("openai-codex/gpt-5.6-terra", openai).model?.id, "openai/gpt-5.6-terra");
});
