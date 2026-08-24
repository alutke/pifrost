import assert from "node:assert/strict";

import { buildPifrostCatalog, type BifrostProviderModel, type PifrostAliasConfig } from "../index.ts";
import { buildRichRouteCatalog, fetchBifrostDatasheets } from "../datasheet.ts";

const aliasConfig: PifrostAliasConfig = {
  includePhysicalModels: false,
  aliases: {
    "omp-advisor": [
      "CommandCode GOAT/deepseek/deepseek-v4-flash",
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-commit": [
      "opencode-go/mimo-v2.5",
      "CommandCode GOAT/xiaomi/mimo-v2.5",
      "Xiaomi MIMO/mimo-v2.5",
    ],
    "omp-default": [
      "opencode-go/kimi-k2.7-code",
      "CommandCode GOAT/moonshotai/Kimi-K2.7-Code",
      "openai/gpt-5.6-luna",
      "Xiaomi MIMO/mimo-v2.5-pro",
    ],
    "omp-designer": [
      "openai/gpt-5.6-terra",
      "opencode-go/mimo-v2.5",
      "Xiaomi MIMO/mimo-v2.5",
    ],
    "omp-plan": [
      "openai/gpt-5.6-terra",
      "CommandCode GOAT/zai-org/GLM-5.2",
      "opencode-go/glm-5.2",
      "deepseek/deepseek-v4-pro",
    ],
    "omp-slow": [
      "openai/gpt-5.6-luna",
      "CommandCode GOAT/deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-pro",
    ],
    "omp-smol": [
      "CommandCode GOAT/poolside/laguna-s-2.1-free",
      "CommandCode GOAT/deepseek/deepseek-v4-flash",
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-task": [
      "CommandCode GOAT/deepseek/deepseek-v4-flash",
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-tiny": [
      "Xiaomi MIMO/mimo-v2.5",
      "opencode-go/mimo-v2.5",
      "CommandCode GOAT/xiaomi/mimo-v2.5",
    ],
    "omp-vision": [
      "opencode-go/mimo-v2.5",
      "CommandCode GOAT/xiaomi/mimo-v2.5",
      "Xiaomi MIMO/mimo-v2.5",
    ],
  },
};

const refs = [...new Set(Object.values(aliasConfig.aliases).flatMap((definition) => Array.isArray(definition) ? definition : definition.chain))];
const liveModels: BifrostProviderModel[] = refs.map((id) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
  supportsTools: false,
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true },
}));

const sheets = await fetchBifrostDatasheets({ cacheTtlMs: 0 });
const pricing = { ...sheets.pricing };
for (const [key, value] of Object.entries(sheets.pricing)) {
  if (!key.endsWith("-free") && !(`${key}-free` in pricing)) pricing[`${key}-free`] = value;
}

const rich = buildRichRouteCatalog(liveModels, aliasConfig, { ...sheets, pricing });
const catalog = buildPifrostCatalog(rich.models, aliasConfig);

for (const diagnostic of rich.diagnostics.filter((item) => item.status !== "ok")) {
  console.error("route metadata failure", diagnostic);
}

const byId = new Map(catalog.models.map((model) => [model.id, model]));
for (const id of Object.keys(aliasConfig.aliases).sort()) {
  const model = byId.get(id);
  console.log(`${id}: context=${model?.contextWindow ?? "MISSING"} output=${model?.maxTokens ?? "MISSING"} image=${model?.input.includes("image") ?? false} reasoning=${model?.reasoning ?? false} efforts=${model?.thinking?.efforts.map(String).join(",") ?? "none"}`);
}

assert.equal(catalog.models.length, 10, "all ten current OMP aliases must synthesize");
assert.ok((byId.get("omp-default")?.contextWindow ?? 0) > 128_000, "omp-default must not use generic 128K fallback metadata");
assert.ok((byId.get("omp-slow")?.contextWindow ?? 0) >= 1_000_000, "omp-slow should retain a 1M-class context envelope");
assert.ok(byId.get("omp-vision")?.input.includes("image"), "omp-vision must advertise image input");
assert.ok(byId.get("omp-designer")?.input.includes("image"), "omp-designer must advertise image input");
