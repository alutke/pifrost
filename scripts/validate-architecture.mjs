import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = [
  "index.ts",
  "native.ts",
  "transport-model.ts",
  "capability-bridge.ts",
  "context-estimator.ts",
  "dynamic-routing.ts",
  "multi-protocol-routing.ts",
  "protocol-capability.ts",
  "route-eligibility.ts",
  "route-inventory.ts",
  "routing-core.ts",
  "model-resolution.ts",
  "omp-context-policy.ts",
  "compact-before-skip.ts",
  "bifrost-cost-bridge.ts",
  "bifrost-rich-content.ts",
  "request-provenance.ts",
  "agent-attribution.ts",
  "cache.ts",
  "cache-schema.ts",
  "catalog-fallback.ts",
  "config-store.ts",
  "datasheet.ts",
  "omp-cfg.ts",
];

const controlOnly = new Set([
  "cli.mjs",
  "cli-lib.mjs",
  "cli-preconditions.mjs",
  "doctor-probes.mjs",
  "skills-bridge.mjs",
  "repo-reset.mjs",
  "route-cli.mjs",
  "model-diagnostics.mjs",
  "routing-discovery.mjs",
  "mcp-rpc.mjs",
  "hound-diagnostics.mjs",
  "security-diagnostics.mjs",
]);

function imports(source) {
  const out = [];
  const pattern = /(?:from\s+|import\s*\()["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) out.push(match[1]);
  return out;
}

function localTarget(from, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const absolute = resolve(root, from, "..", specifier);
  const relative = absolute.slice(root.length).replaceAll("\\", "/");
  return extname(relative) ? relative : undefined;
}

const errors = [];
for (const file of runtime) {
  const source = readFileSync(resolve(root, file), "utf8");
  for (const specifier of imports(source)) {
    const target = localTarget(file, specifier);
    if (target && controlOnly.has(target)) {
      errors.push(`${file} must not depend on control-plane module ${target}`);
    }
    if (
      file !== "native.ts" &&
      (specifier === "@oh-my-pi/pi-catalog" ||
        specifier.startsWith("@oh-my-pi/pi-catalog/") ||
        specifier === "@oh-my-pi/pi-natives" ||
        specifier.startsWith("@oh-my-pi/pi-natives/"))
    ) {
      errors.push(`${file} must not import ${specifier}; OMP snapshot/native imports belong at native.ts boundary`);
    }
  }
}

const configStore = readFileSync(resolve(root, "config-store.ts"), "utf8");
const runtimeLoader = /export function loadStoredRuntimeConfig[\s\S]*?\n\}/u.exec(configStore)?.[0] ?? "";
for (const forbidden of ["managementApiKey", "managementAdminUsername", "managementAdminPassword"]) {
  if (runtimeLoader.includes(forbidden)) {
    errors.push(`config-store runtime loader must not expose ${forbidden} to the OMP extension`);
  }
}

const ompCfg = readFileSync(resolve(root, "omp-cfg.ts"), "utf8");
if (!/definition\(\s*["\']retry\.modelFallback["\']\s*,\s*false/u.test(ompCfg)) {
  errors.push("OMP model fallback must remain disabled; physical fallback is owned by Bifrost");
}

const native = readFileSync(resolve(root, "native.ts"), "utf8");
if (!/statefulResponses\s*:\s*false/u.test(native)) {
  errors.push("Pifrost dynamic Responses must remain stateless across heterogeneous Bifrost fallback routes");
}

if (errors.length) {
  for (const error of errors) console.error(`architecture: ${error}`);
  process.exit(1);
}
console.log(`Architecture boundary checks: OK (${runtime.length} runtime modules)`);
