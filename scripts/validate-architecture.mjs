import { checkImportBoundaries } from "./architecture-boundary-ast.mjs";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = [
  "index.ts",
  "native.ts",
  "runtime-route-state.ts",
  "transport-model.ts",
  "capability-bridge.ts",
  "context-estimator.ts",
  "dynamic-routing.ts",
  "route-compatibility.ts",
  "multi-protocol-routing.ts",
  "attempt-retry-policy.ts",
  "protocol-capability.ts",
  "route-eligibility.ts",
  "route-inventory.ts",
  "routing-core.ts",
  "model-resolution.ts",
  "endpoint-contracts.ts",
  "request-compatibility.ts",
  "reasoning-replay.ts",
  "reasoning-integrity.ts",
  "controlled-recovery.ts",
  "recovery-command.ts",
  "reasoning-stream.ts",
  "intelligent-stall-recovery.mjs",
  "recovery-episodes.mjs",
  "execution-checkpoint.mjs",
  "checkpoint-lifecycle.mjs",
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

const errors = checkImportBoundaries(
  Object.fromEntries(runtime.map(file => [file, readFileSync(resolve(root, file), "utf8")])),
  controlOnly,
);

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
const runtimeRouteState = readFileSync(resolve(root, "runtime-route-state.ts"), "utf8");
if (!native.includes("const runtimeRouteState = createRuntimeRouteState()") ||
    !native.includes("runtimeRouteState.capture()") ||
    !native.includes("runtimeRouteState.publish(") ||
    !runtimeRouteState.includes("current = next") ||
    /let runtime(?:DynamicRoutes|GatewayProtocols|AliasDiagnostics|OpaqueReplayPolicies|OutputMembers)\b/u.test(native)) {
  errors.push("Release 3 requires isolated, atomically published, request-scoped route generations");
}
const mcpRpc = readFileSync(resolve(root, "mcp-rpc.mjs"), "utf8");
const httpClient = readFileSync(resolve(root, "http-client.mjs"), "utf8");
if (!mcpRpc.includes("readTextLimited(response") ||
    !mcpRpc.includes('redirect: "error"') ||
    !httpClient.includes('redirect: "error"')) {
  errors.push("Release 3 must bound MCP responses and disallow credential-bearing redirects");
}
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
if (!native.includes("isVerifiedGatewayProtocolRejection(error, gatewayProtocolAttempt)") ||
    !multiProtocol.includes('evaluateAttemptTransition("gateway-ingress"') ||
    !readFileSync(resolve(root,"attempt-retry-policy.ts"),"utf8").includes("status === 400 || status === 422")) {
  errors.push("Release F requires shared evidence-bound, pre-output HTTP protocol fallback for opaque Bifrost routes");
}
const transitionPolicy=readFileSync(resolve(root,"attempt-retry-policy.ts"),"utf8");
const reconcile=readFileSync(resolve(root,"route-reconcile.mjs"),"utf8");
if (!native.includes('evaluateAttemptTransition("physical-compatibility"') ||
    !multiProtocol.includes("!options.retryPreOutputError?.(error)") ||
    !native.includes("await verifyLiveRoute(profile)") ||
    !native.includes('["routes", "attest", profile.id, "--json"]') ||
    !routeCompatibility.includes("assertLiveCompatibilityAttestation(") ||
    !reconcile.includes("attestCompatibilityRoute(") ||
    !transitionPolicy.includes('status === 502 || status === 503')) {
  errors.push("Release 1 physical attempts need a shared fail-closed retry contract and live policy/member attestation");
}
const recoveryPolicy=readFileSync(resolve(root,"controlled-recovery.ts"),"utf8");
const recoveryCommand=readFileSync(resolve(root,"recovery-command.ts"),"utf8");
if (!native.includes('handleRecoveryCommand(raw.slice("recover".length)') ||
    !native.includes("latestPifrostRouteTrace(sessionId)") ||
    !recoveryCommand.includes("host.newSession({ parentSession: host.parentSessionFile })") ||
    !recoveryCommand.includes("host.sendUserMessage(recoveryContinuationPrompt(cleaned))") ||
    !recoveryCommand.includes("host.hasRunningAsyncJobs()") ||
    !recoveryPolicy.includes('trace.outcome === "done"') ||
    recoveryCommand.includes("appendMessage(")) {
  errors.push("Release E must use explicit, idle-safe, OMP-owned session recovery with no history or tool replay");
}
const stalledPolicy=readFileSync(resolve(root,"stalled-turn-recovery.ts"),"utf8");
if (!stalledPolicy.includes('export type StalledTurnMode = "auto" | "notice" | "off"') ||
    !stalledPolicy.includes('createStalledTurnRecoveryCoordinator(mode: StalledTurnMode = "auto")') ||
    !stalledPolicy.includes('if (mode === "off") return false;') ||
    !native.includes('createStalledTurnRecoveryCoordinator(stalledTurnMode(process.env.PIFROST_STALLED_TURN_MODE))') ||
    !stalledPolicy.includes('mode === "auto" ? continuePending(ctx) : false') ||
    !native.includes('if (command === "stalled")') ||
    !native.includes('const confirmed = await ctx.ui.confirm(') ||
    !native.includes("stalledTurnRecovery.continuePending({")) {
  errors.push("Stalled-turn lifecycle requires auto default, explicit off, guarded one-shot continuation and manual approval");
}
const replayGuard=readFileSync(resolve(root,"reasoning-integrity.ts"),"utf8");
if (!replayGuard.includes('validation: "structural-only" | "not-checked"') ||
    !replayGuard.includes('gatewayOutcome: "not-observed" | "completed"') ||
    !replayGuard.includes("emptyNativeReasoningItems") ||
    !readFileSync(resolve(root,"request-provenance.ts"),"utf8").includes('base.outcome === "done"')) {
  errors.push("Release 2 must distinguish replay structure from gateway completion");
}
if(!native.includes("guardPifrostReasoningReplay(capped, transportModel") ||
   !replayGuard.includes("unanimousStrictReasoningRequirement(") ||
   !runtimeRouteState.includes("resolvePifrostReasoningReplayRequirement(") ||
   !native.includes("strictReplayCompatOverrides(")) {
  errors.push("Release D must preserve physical replay guards and OMP-owned strict history serialization");
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

// 30F: AST-backed imports plus explicit forbidden capability checks. The
// recovery policy is pure decision support; only OMP's session_stop owns the
// actual native continuation and pi.appendEntry owns persistence.
const recoveryEngine=readFileSync(resolve(root,"intelligent-stall-recovery.mjs"),"utf8");
const episodeLedger=readFileSync(resolve(root,"recovery-episodes.mjs"),"utf8");
for(const [name,source] of [["intelligent-stall-recovery.mjs",recoveryEngine],["recovery-episodes.mjs",episodeLedger]]) {
  if(/\b(?:fetch|setInterval|setTimeout|spawn|execFile|execSync|sendMessage|appendMessage|replaceMessages|setModel|compact|runTool)\s*\(/u.test(source) ||
     /from\s+["'][^"']*(?:multi-protocol-routing|dynamic-routing|transport-model|http-client|routing-core|mcp-rpc)/u.test(source)) {
    errors.push("30F: "+name+" must not execute tools, rewrite messages, route providers or own transport");
  }
}
if ((native.match(/pi\\.on\("session_stop"/gu)??[]).length!==1 ||
    !native.includes('pi.appendEntry(PIFROST_RECOVERY_EPISODE_TYPE,decision.record)') ||
    !native.includes('recoveryFamilyCandidate(current,resolved,model=>ctx.models.family(model))') ||
    !native.includes('checkpointLedger.read(ctx)?.status === "active"') ||
    !native.includes('return { continue:true, additionalContext:decision.additionalContext }') ||
    !episodeLedger.includes("validExecutionCheckpoint(") ||
    !episodeLedger.includes("PIFROST_RECOVERY_EPISODE_TYPE")) {
  errors.push("30F: single OMP native session_stop owner, opt-in family fallback, journal trust and checkpoint isolation required");
}

if (errors.length) {
  for (const error of errors) console.error(`architecture: ${error}`);
  process.exit(1);
}
console.log(`Architecture boundary checks: OK (${runtime.length} runtime modules)`);
