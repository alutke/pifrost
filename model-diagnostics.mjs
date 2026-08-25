import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
    return { path, cache: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { path, cache: undefined };
  }
}

export function formatModelDiagnostic(model) {
  const thinking = effectiveThinking(model);
  const effortText = thinking.efforts.length ? thinking.efforts.join(",") : "-";
  const images = Array.isArray(model?.input) && model.input.includes("image") ? "yes" : "no";
  const source = thinking.source === "none" ? "" : ` source=${thinking.source}`;
  return `${String(model?.id ?? "").padEnd(16)} context=${String(model?.contextWindow ?? "-").padEnd(8)} max=${String(model?.maxTokens ?? "-").padEnd(8)} thinking=${effortText.padEnd(24)} images=${images}${source}`;
}

export function printModelDoctor(env = process.env, out = console) {
  const { path, cache } = readCatalog(env);
  out.log("\n## Pifrost model catalog\n");
  if (!cache) {
    out.log(`No valid catalog file found at ${path}`);
    out.log("Run: pifrost models refresh --force");
    return { ok: false, path, unresolved: [] };
  }

  out.log(`Cache: ${path}`);
  out.log(`Generated: ${cache.generatedAt ?? "unknown"}`);
  const models = Array.isArray(cache.models) ? cache.models : [];
  for (const model of models) out.log(formatModelDiagnostic(model));

  const diagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];
  const unresolved = diagnostics.filter((item) => Array.isArray(item?.unresolved) && item.unresolved.length);
  if (unresolved.length) {
    out.log("\nUnresolved route members:");
    for (const item of unresolved) out.log(`  ${item.id}: ${item.unresolved.join(", ")}`);
  }

  return { ok: unresolved.length === 0 && models.length > 0, path, unresolved };
}
