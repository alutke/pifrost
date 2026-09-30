import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CATALOG_CACHE_SCHEMA_VERSION } from "./dist/cache-schema.js";
import { createDiagnosticResult, DIAGNOSTIC_STATUS } from "./diagnostic-result.mjs";

export { CATALOG_CACHE_SCHEMA_VERSION as EXPECTED_CACHE_SCHEMA_VERSION } from "./dist/cache-schema.js";

// OMP 18's OpenAI-compatible fallback ladder for a sparse reasoning model.
// Pifrost's provider uses openai-completions, so when a cached model has
// reasoning=true but no explicit thinking.efforts, OMP normalizes it to this
// ladder before displaying it in `omp models`.
export const OMP_OPENAI_COMPAT_DEFAULT_EFFORTS = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
]);

const CAPABILITY_KEYS = Object.freeze([
  "contextWindow",
  "maxTokens",
  "image",
  "reasoning",
  "reasoningEfforts",
  "tools",
  "toolChoice",
  "forcedToolChoice",
  "namedToolChoice",
  "reasoningWithTools",
  "toolSearch",
  "betweenToolsThinking",
  "serviceTier",
  "serviceTiers",
  "pricingStatus",
  "protocol",
]);

function cachePath(env = process.env) {
  const agent = env.PI_CODING_AGENT_DIR || join(env.HOME || homedir(), ".omp", "agent");
  return env.PIFROST_CACHE_FILE || join(agent, "pifrost.catalog.json");
}

export function effectiveThinking(model) {
  if (!model?.reasoning) return { efforts: [], source: "none" };

  const explicit = Array.isArray(model?.thinking?.efforts)
    ? model.thinking.efforts.map(String).filter(Boolean)
    : [];
  if (explicit.length) return { efforts: explicit, source: "explicit" };

  // OMP 18 resolveModelThinking() treats missing/empty thinking metadata as a
  // sparse spec and derives the OpenAI-compatible fallback effort ladder at
  // model-build time. Reporting that effective surface keeps Pifrost doctor
  // consistent with `omp models` while still identifying where it came from.
  return { efforts: [...OMP_OPENAI_COMPAT_DEFAULT_EFFORTS], source: "omp-derived" };
}

export function readCatalog(env = process.env) {
  const path = cachePath(env);
  if (!existsSync(path)) return { path, cache: undefined };
  try {
    const cache = JSON.parse(readFileSync(path, "utf8"));
    if (cache?.schemaVersion !== CATALOG_CACHE_SCHEMA_VERSION) {
      return { path, cache: undefined, staleSchema: cache?.schemaVersion };
    }
    return { path, cache };
  } catch {
    return { path, cache: undefined };
  }
}

export function formatModelDiagnostic(model) {
  const thinking = effectiveThinking(model);
  const effortText = thinking.efforts.length ? thinking.efforts.join(",") : "-";
  const images = Array.isArray(model?.input) && model.input.includes("image") ? "yes" : "no";
  const source = thinking.source === "none" ? "" : ` source=${thinking.source}`;
  const route = model?.pifrostDynamicRoute;
  const dynamic = route?.mode === "context-aware"
    ? ` dynamic-context=${route.staticContextWindow}->${route.advertisedContextWindow}`
    : "";
  const modern = [
    model?.supportsToolSearch === true ? "tool-search" : undefined,
    model?.compat?.supportsBetweenToolsThinking === true ? "between-tools" : undefined,
    model?.supportsServiceTier === true ? `service-tier[${(model.serviceTiers ?? []).join(",")}]` : undefined,
    model?.pricingStatus ? `pricing=${model.pricingStatus}` : undefined,
  ].filter(Boolean);
  return `${String(model?.id ?? "").padEnd(16)} context=${String(model?.contextWindow ?? "-").padEnd(8)} max=${String(model?.maxTokens ?? "-").padEnd(8)} thinking=${effortText.padEnd(24)} images=${images}${source}${dynamic}${modern.length ? ` capabilities=${modern.join(",")}` : ""}`;
}

export function formatCapabilitySources(sources) {
  if (!sources || typeof sources !== "object") return "unknown";
  const parts = CAPABILITY_KEYS
    .filter((key) => typeof sources[key] === "string" && sources[key])
    .map((key) => `${key}=${sources[key]}`);
  return parts.length ? parts.join(" ") : "unknown";
}

export function formatMemberDiagnostic(member) {
  const target = member?.resolvedModelId ? ` -> ${member.resolvedModelId}` : "";
  const resolution = member?.resolution ? ` resolution=${member.resolution}` : "";
  const protocols = Array.isArray(member?.protocols) && member.protocols.length
    ? ` protocols=${member.protocols.join(",")}`
    : " protocols=unknown";
  const sourceText = ` sources=${formatCapabilitySources(member?.sources)}`;
  const reason = member?.reason ? ` reason=${member.reason}` : "";
  return `    ${member?.status ?? "unknown"} ${member?.reference ?? "<unknown>"}${target}${resolution}${protocols}${sourceText}${reason}`;
}

export function printModelDoctor(env = process.env, out = console) {
  const { path, cache, staleSchema } = readCatalog(env);
  out.log("\n## Pifrost model catalog\n");
  if (!cache) {
    const summary = staleSchema !== undefined
      ? `Catalog uses incompatible schema ${staleSchema}; expected ${CATALOG_CACHE_SCHEMA_VERSION}`
      : "No valid model catalog is available";
    if (staleSchema !== undefined) {
      out.log(`Catalog at ${path} uses incompatible schema ${staleSchema}; expected ${CATALOG_CACHE_SCHEMA_VERSION}.`);
    } else {
      out.log(`No valid catalog file found at ${path}`);
    }
    out.log("Run: pifrost models refresh --force");
    const checks = [createDiagnosticResult({
      id: "model-catalog",
      label: "Model catalog",
      status: DIAGNOSTIC_STATUS.FAIL,
      summary,
      impact: "Pifrost cannot validate the OMP-facing alias capability envelope from the local catalog.",
      remediation: "Refresh the Pifrost model catalog.",
      suggestedCommand: "pifrost models refresh --force",
      data: { path, staleSchema, expectedSchema: CATALOG_CACHE_SCHEMA_VERSION },
    })];
    return { ok: false, path, unresolved: [], checks };
  }

  out.log(`Cache: ${path}`);
  out.log(`Generated: ${cache.generatedAt ?? "unknown"}`);
  const models = Array.isArray(cache.models) ? cache.models : [];
  for (const model of models) out.log(formatModelDiagnostic(model));

  const diagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];
  const dynamic = models.filter((model) => model?.pifrostDynamicRoute?.mode === "context-aware");
  if (dynamic.length) {
    out.log("\nDynamic context routing:");
    out.log("  Context bands below are capacity-only; runtime prewalk also filters protocol and other capabilities.");
    for (const model of dynamic) {
      const route = model.pifrostDynamicRoute;
      out.log(`  ${model.id}: static=${route.staticContextWindow} advertised=${route.advertisedContextWindow}`);
      for (const member of route.members ?? []) {
        const protocols = Array.isArray(member?.protocols) && member.protocols.length
          ? member.protocols.join(",")
          : "unknown";
        out.log(`    member ${member.reference}: protocols=${protocols}`);
      }
      for (const band of route.bands ?? []) {
        out.log(`    context<=${band.maxRequiredTokens}: ${(band.members ?? []).join(" -> ")}`);
      }
    }
  }

  const withMembers = diagnostics.filter((item) => Array.isArray(item?.members) && item.members.length);
  if (withMembers.length) {
    out.log("\nCapability provenance:");
    for (const item of withMembers) {
      out.log(`  ${item.id}:`);
      for (const member of item.members) out.log(formatMemberDiagnostic(member));
    }
  }

  const unresolved = diagnostics.filter((item) => Array.isArray(item?.unresolved) && item.unresolved.length);
  if (unresolved.length) {
    out.log("\nUnresolved route members:");
    for (const item of unresolved) {
      out.log(`  ${item.id}: ${item.unresolved.join(", ")}`);
      for (const member of item.members ?? []) {
        if (member?.status === "unresolved") out.log(formatMemberDiagnostic(member));
      }
    }
  }

  const ok = unresolved.length === 0 && models.length > 0;
  const checks = [createDiagnosticResult({
    id: "model-catalog",
    label: "Model catalog",
    status: ok ? DIAGNOSTIC_STATUS.OK : DIAGNOSTIC_STATUS.FAIL,
    summary: ok
      ? `${models.length} OMP-facing aliases are available`
      : unresolved.length
        ? `${unresolved.length} alias(es) contain unresolved route members`
        : "The model catalog contains no OMP-facing aliases",
    impact: ok ? undefined : "Affected aliases may be withheld or exposed with a reduced safe capability envelope.",
    remediation: ok ? undefined : "Refresh the catalog and inspect unresolved route-member diagnostics.",
    suggestedCommand: ok ? undefined : "pifrost models refresh --force",
    data: {
      path,
      schemaVersion: cache.schemaVersion,
      modelCount: models.length,
      unresolvedAliases: unresolved.map((item) => item.id),
    },
  })];

  return { ok, path, unresolved, checks };
}
