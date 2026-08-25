import assert from "node:assert/strict";

import { buildPifrostCatalog, type BifrostProviderModel, type PifrostAliasConfig } from "../index.ts";
import { buildRichRouteCatalog, fetchBifrostDatasheets } from "../datasheet.ts";
import {
  normalizeModelParametersDatasheet,
  normalizePricingDatasheet,
} from "../pricing-normalize.ts";

// This intentionally tracks the routes currently implemented in the user's
// Bifrost instance, not an aspirational routing table. CI therefore protects
// the exact combinations Pifrost must support today while the generic catalog
// fallback covers other provider/model choices.
const aliasConfig: PifrostAliasConfig = {
  includePhysicalModels: false,
  aliases: {
    "omp-advisor": [
      "CommandCode GOAT/google/gemini-3.7-flash",
      "deepseek/deepseek-v4-pro",
    ],
    "omp-commit": [
      "Xiaomi MIMO/mimo-v2.5",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-default": [
      "opencode-go/deepseek-v4-flash",
      "CommandCode GOAT/zai-org/GLM-5.2",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-designer": [
      "openai/gpt-5.6-terra",
      "opencode-go/mimo-v2.5",
      "Xiaomi MIMO/mimo-v2.5",
    ],
    "omp-plan": [
      "openai/gpt-5.6-terra",
      "CommandCode GOAT/zai-org/GLM-5.2",
      "deepseek/deepseek-v4-pro",
    ],
    "omp-slow": [
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-pro",
    ],
    "omp-smol": [
      "CommandCode GOAT/poolside/laguna-s-2.1-free",
      "Xiaomi MIMO/mimo-v2.5",
    ],
    "omp-task": [
      "CommandCode GOAT/stealth/ox-alpha",
      "opencode-go/ox-alpha-free",
      "deepseek/deepseek-v4-flash",
    ],
    "omp-tiny": [
      "CommandCode GOAT/poolside/laguna-s-2.1-free",
      "Xiaomi MIMO/mimo-v2.5",
    ],
    "omp-vision": [
      "Xiaomi MIMO/mimo-v2.5",
      "deepseek/deepseek-v4-flash-vision-exp",
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
const rich = buildRichRouteCatalog(liveModels, aliasConfig, {
  pricing: normalizePricingDatasheet(sheets.pricing),
  parameters: normalizeModelParametersDatasheet(sheets.parameters),
});
const catalog = buildPifrostCatalog(rich.models, aliasConfig);

for (const diagnostic of rich.diagnostics.filter((item) => item.status === "not-live" || item.status === "missing-pricing")) {
  console.error("route metadata failure", diagnostic);
}

const byId = new Map(catalog.models.map((model) => [model.id, model]));
for (const id of Object.keys(aliasConfig.aliases).sort()) {
  const model = byId.get(id);
  console.log(`${id}: context=${model?.contextWindow ?? "MISSING"} output=${model?.maxTokens ?? "MISSING"} image=${model?.input.includes("image") ?? false} reasoning=${model?.reasoning ?? false} efforts=${model?.thinking?.efforts.map(String).join(",") ?? "none"}`);
}

assert.equal(catalog.models.length, 10, "all ten current OMP aliases must synthesize");
assert.equal(
  rich.diagnostics.filter((item) => item.status === "not-live" || item.status === "missing-pricing").length,
  0,
  "all current route members must have a safe capability source",
);
assert.ok((byId.get("omp-default")?.contextWindow ?? 0) >= 1_000_000, "omp-default should retain a 1M-class context envelope");
assert.ok((byId.get("omp-slow")?.contextWindow ?? 0) >= 1_000_000, "omp-slow should retain a 1M-class context envelope");
assert.ok((byId.get("omp-slow")?.contextWindow ?? 0) < 1_100_000, "context must not add max output on top of the published window");
assert.ok(byId.get("omp-vision")?.input.includes("image"), "omp-vision must advertise image input");
assert.ok(byId.get("omp-designer")?.input.includes("image"), "omp-designer must advertise image input");
assert.ok(byId.get("omp-task"), "omp-task must not be withheld when Ox Alpha aliases are used");
assert.ok((byId.get("omp-task")?.contextWindow ?? 0) >= 1_000_000, "omp-task should retain a 1M-class context envelope");
// The currently implemented OpenCode ox-alpha-free fallback publishes a 32K
// output limit. Preserve that real restriction instead of inheriting the
// 131K paid/base Ox Alpha limit. Replacing this fallback with DeepSeek V4 Flash
// in Bifrost will automatically raise the route envelope without a Pifrost change.
assert.ok((byId.get("omp-task")?.maxTokens ?? 0) >= 32_768, "omp-task should retain the published Ox Alpha Free output envelope");
assert.deepEqual(byId.get("omp-task")?.thinking?.efforts.map(String), ["high", "max"], "omp-task effort envelope should be high/max");
assert.ok(byId.get("omp-advisor")?.reasoning, "omp-advisor must retain reasoning support");
