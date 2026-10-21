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
  "route-compatibility.ts",
  "multi-protocol-routing.ts",
  "protocol-capability.ts",
  "route-eligibility.ts",
  "route-inventory.ts",
  "routing-core.ts",
  "model-resolution.ts",
  "endpoint-contracts.ts",
  "request-compatibility.ts",
  "reasoning-replay.ts",
  "reasoning-stream.ts",
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
  "research-repo-config.ts",
  "datasheet.ts",
  "omp-cfg.ts",
  "image-count-budget.ts",
  "judge-bridge.mjs",
  "omp-orchestration-readiness.mjs",
  "model-kind-boundary.mjs",
];

const controlOnly = new Set([
  "cli.mjs",
  "cli-lib.mjs",
  "cli-preconditions.mjs",
  "doctor-probes.mjs",
  "skills-bridge.mjs",
  "mcp-skill-discovery.mjs",
  "repo-reset.mjs",
  "route-cli.mjs",
  "model-diagnostics.mjs",
  "routing-discovery.mjs",
  "mcp-rpc.mjs",
  "hound-diagnostics.mjs",
  "research-providers.mjs",
  "research-results.mjs",
  "security-diagnostics.mjs",
  "judge-control.mjs",
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

const cliLib = readFileSync(resolve(root, "cli-lib.mjs"), "utf8");
const ompCfg = readFileSync(resolve(root, "omp-cfg.ts"), "utf8");
if (!cliLib.includes('reconcilePifrostOmpSetting(id, current.value, desired)') ||
    !ompCfg.includes('reconcilePifrostOmpJson(setting.id, status.value, content)')) {
  errors.push("OMP profile writes must preserve unrelated roles and model namespaces");
}
const toolPolicy = readFileSync(resolve(root, "provider-tool-policy.mjs"), "utf8");
if (toolPolicy.includes("tools/call") || toolPolicy.includes("POST /api/providers") ||
    toolPolicy.includes("ExecuteChatTool")) {
  errors.push("Bifrost injected-tool diagnostics must be read-only and never execute MCP");
}
if (!/definition\(\s*["']retry\.modelFallback["']\s*,\s*false/u.test(ompCfg)) {
  errors.push("OMP model fallback must remain disabled; physical fallback is owned by Bifrost");
}

const budgetPolicy = readFileSync(resolve(root, "image-count-budget.ts"), "utf8");
const registeredWorkarounds = readFileSync(resolve(root, "workaround-register.mjs"), "utf8");
if (!budgetPolicy.includes("conservativeRouteImageCountBudget") ||
    !registeredWorkarounds.includes("retained-pending-evidence") ||
    registeredWorkarounds.includes("setInterval(")) {
  errors.push("Release D must preserve conservative image-count and evidence-gated workaround contracts");
}
const orchestration = readFileSync(resolve(root, "omp-orchestration-readiness.mjs"), "utf8");
if (!orchestration.includes("assessOmpOrchestration") ||
    !orchestration.includes("ompVersionAtLeast") ||
    !orchestration.includes("advisor.continueSeverity") ||
    !orchestration.includes("prewalk.auto") ||
    orchestration.includes("setInterval(") ||
    orchestration.includes("spawnSync(") ||
    orchestration.includes("fetch(")) {
  errors.push("OMP orchestration readiness must remain read-only and host-owned");
}
const judgeBridge = readFileSync(resolve(root, "judge-bridge.mjs"), "utf8");
const judgeControl = readFileSync(resolve(root, "judge-control.mjs"), "utf8");
const modelKinds = readFileSync(resolve(root, "model-kind-boundary.mjs"), "utf8");
const index = readFileSync(resolve(root, "index.ts"), "utf8");
if (!index.includes("isBifrostChatModel(model)") || !modelKinds.includes("NON_CHAT_KINDS")) {
  errors.push("Pifrost chat discovery must preserve non-chat model-kind boundaries");
}
if (!judgeBridge.includes('PIFROST_NATIVE_JUDGE_MODEL') || !judgeBridge.includes('/typesafe') ||
    !judgeControl.includes('canonicalDecisionProbeRequest') ||
    !judgeControl.includes('options.decisions === true')) {
  errors.push("Optional native judge must use versioned Bifrost TypeSafe and explicit canonical Decisions probe contracts");
}
if (judgeControl.includes("judgeBatch(") || judgeControl.includes("queueMicrotask(") ||
    judgeControl.includes("setInterval(")) {
  errors.push("Pifrost must not implement an OMP judgment queue");
}

const native = readFileSync(resolve(root, "native.ts"), "utf8");
if (!native.includes("nativeJudgeGateway(config, mergedEnvironment)") ||
    !native.includes("api: judge.api") || !native.includes('kind: "judge"') ||
    !native.includes("judge.imageEnabled") || !judgeBridge.includes('"/openai/v1"')) {
  errors.push("Release C native judge must register an isolated OMP-owned TypeSafe provider");
}
// Protect the architectural invariant: complete compatible Chat routes must
// use the logical alias at Bifrost, never a client-side copy of the chain.
const dynamicRoutes = readFileSync(resolve(root, "dynamic-routing.ts"), "utf8");
const multiProtocol = readFileSync(resolve(root, "multi-protocol-routing.ts"), "utf8");
if (!dynamicRoutes.includes("export function canUseNativeBifrostRoute(") ||
    !dynamicRoutes.includes("plan.excluded.length > 0") ||
    !native.includes("canUseNativeBifrostRoute(profile, plan)") ||
    !native.includes("createPifrostNativeRouteModelSpec(model, attempt)") ||
    !multiProtocol.includes("requestModelId: logicalModel.id")) {
  errors.push("Complete compatible Chat routes must preserve the Bifrost logical alias");
}
const routeCompatibility = readFileSync(resolve(root, "route-compatibility.ts"), "utf8");
if (!native.includes("compatibilityExecutionError(profile, plan)") ||
    !routeCompatibility.includes("compatibilityRouteSnapshotError(profile)") ||
    !routeCompatibility.includes("plan.encoderContractsComplete !== true") ||
    !multiProtocol.includes("createPifrostMemberModelSpec(logicalModel, attempt.members[0]!, \"openai-completions\")")) {
  errors.push("Physical route exceptions need fresh synchronized provenance and physical wire policy");
}
if (!dynamicRoutes.includes("plan.encoderContractsComplete !== true") ||
    !dynamicRoutes.includes("policyFingerprint") ||
    !native.includes("opaqueRouteContract(") ||
    !routeCompatibility.includes("gatewaySelectionRelativeToPrimary(")) {
  errors.push("Release C must prevent unknown physical encoders from native passthrough and retain gateway route attribution");
}
if (!/statefulResponses\s*:\s*false/u.test(native)) {
  errors.push("Pifrost dynamic Responses must remain stateless across heterogeneous Bifrost fallback routes");
}

// Cross-release hardening invariants: no late client-side rewrite, one
// generated-output commitment contract, and provably exact alias lowering.
const routingCore = readFileSync(resolve(root, "routing-core.ts"), "utf8");
const attemptRunner = readFileSync(resolve(root, "multi-protocol-routing.ts"), "utf8");
if (native.includes("createDynamicRoutingFetch(")) {
  errors.push("Native inference must not install the unsafe late physical request rewrite");
}
if (!routingCore.includes("exactAliasPredicate(rule, aliasId)")) {
  errors.push("Physical route lowering requires an exact alias predicate");
}
if (!native.includes("isCommittedModelOutput(event)") ||
    !attemptRunner.includes("isCommittedModelOutput(event)")) {
  errors.push("Failover commitment and trace output evidence must use the same model-output predicate");
}
if (!readFileSync(resolve(root, "cli.mjs"), "utf8").includes("routePolicyDrift(local.policyFingerprint, policyFingerprint)")) {
  errors.push("Control-plane route drift detection must compare full rule-policy fingerprints");
}

if (errors.length) {
  for (const error of errors) console.error(`architecture: ${error}`);
  process.exit(1);
}
console.log(`Architecture boundary checks: OK (${runtime.length} runtime modules)`);
