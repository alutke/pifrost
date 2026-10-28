#!/usr/bin/env node

import { existsSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { planLegacyOmpCleanup } from "./omp-legacy-migration.mjs";
import { nativeModelsStatus, writeNativeModels } from "./native-models.mjs";
import { enableCommands, disableCommands, commandStatus } from "./omp-commands-install.mjs";
import { runLiteDoctor } from "./lite-doctor.mjs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

import { deleteRepoVirtualKeyForReset } from "./repo-reset.mjs";
import { collectDoctorSnapshot } from "./doctor-probes.mjs";
import { bifrostCredentialTransportWarnings } from "./security-diagnostics.mjs";
import { storedRuntimeConfigDiagnostics } from "./dist/config-store.js";
import { requireManagement, requireRuntime } from "./cli-preconditions.mjs";
import {
  explainRouteRequest,
  formatEffectiveRouteReport,
  formatRouteExplanation,
  printModelDoctor,
  readCatalog,
} from "./model-diagnostics.mjs";
import {
  formatCatalogSnapshot,
  routeAliasForInput,
  routeExplanationRequestFromFlags,
} from "./route-cli.mjs";
import { deriveAliasesRobust, discoverRoutingRules } from "./routing-discovery.mjs";
import { routePolicyFingerprint, routePolicyDrift } from "./route-policy-fingerprint.mjs";
import { reconcileRouteSnapshot, attestCompatibilityRoute, RouteReconcileError } from "./route-reconcile.mjs";
import { commandCatalog, flagRequiresValue, isKnownFlag, cliUsageError, validateCliInvocation, commandUsage, operationLabel } from "./cli-command-schema.mjs";
import { reportHealth, listFilter, operationSummary, safeUiText } from "./cli-health.mjs";
import { MAX_COMPATIBILITY_ROUTE_SYNC_AGE_MS } from "./dist/routing-core.js";
import {
  RESEARCH_PROFILES,
  eligibleResearchCodeModeClients,
  normalizeResearchPreference,
  researchProviderDiagnostics,
  probeResearchCodeMode,
} from "./research-providers.mjs";
import { classifyResearchResult } from "./research-results.mjs";
import { nativeJudgeSelection, nativeJudgeGateway } from "./judge-bridge.mjs";
import { bifrostModelKindEvidence, bifrostModelKindSummary } from "./model-kind-boundary.mjs";
import { inspectNativeJudgeModels, probeNativeJudge } from "./judge-control.mjs";
import { decisionProviderInventory, resolvePinnedOmpJudgeCapabilities } from "./judge-certification.mjs";
import { OMP_ORCHESTRATION_SETTING_IDS, assessOmpOrchestration, formatOmpOrchestration } from "./omp-orchestration-readiness.mjs";
import { formatAdaptiveContextPlan } from "./adaptive-context-settings.mjs";
import { inspectPifrostWorkarounds, formatPifrostWorkarounds } from "./workaround-register.mjs";
import { reconcilePifrostOmpSetting } from "./omp-profile-merge.mjs";
import { planJudgeRoleActivation, applyJudgeRoleActivation } from "./judge-activation.mjs";
import { gatewayInjectedToolDiagnostics, formatGatewayInjectedToolDiagnostics } from "./provider-tool-policy.mjs";
import { formatGatewayComplexity, formatGatewayPrivacy, formatGatewayResearchTools } from "./gateway-observability.mjs";
import {
  compactCliHelp, formatCliFailure, renderHealthOverview,
  terminalSection, terminalField, terminalStatus, terminalNextSteps, humanAge,
} from "./terminal-presentation.mjs";

import {
  bifrostSkillCompatibility,
  findOmpSkillCollisions,
  fetchBifrostSkillBundle,
  installBifrostSkillBundle,
  listBifrostSkills,
  normalizeConfiguredBifrostSkills,
  removeManagedBifrostSkill,
  repoBifrostSkillStatus,
  resolveBifrostSkillNames,
} from "./skills-bridge.mjs";

import {
  clientsForVirtualMcps,
  discoverMcpSkillMatches,
  mcpSkillDrift,
  normalizeMcpSkillDiscovery,
  recordMcpSkillLink,
  setMcpSkillAlias,
  setMcpSkillDismissal,
  withoutMcpSkillLinks,
} from "./mcp-skill-discovery.mjs";

import {
  VERSION,
  PIFROST_OMP_MIN_VERSION,
  PIFROST_OMP_POLICY_SNAPSHOT_VERSION,
  PIFROST_OMP_VALIDATED_VERSION,
  PIFROST_BIFROST_MIN_VERSION,
  PIFROST_BIFROST_VALIDATED_VERSION,
  PifrostHttpError,
  aliasManifestPath,
  attachVirtualMcpToVirtualKey,
  buildCompatibilityMatrix,
  buildRepoMcpConfig,
  commandExists,
  configureOmp,
  configureOmpAdaptiveContext,
  planOmpAdaptiveContext,
  backupOmpConfig,
  currentRepoState,
  detachVirtualMcpFromVirtualKey,
  diffAliases,
  effectiveRepoMcpPolicy,
  getRepoRoot,
  getBifrostVersion,
  getBifrostHealth,
  getBifrostSetupState,
  getOmpVersion,
  getBifrostConfig,
  listBifrostProviderInventory,
  getVirtualKeyQuota,
  getComplexityAnalyzerConfig,
  formatQuotaGovernanceSource,
  getVirtualKey,
  installOmpPlugin,
  listMcpClients,
  callMcpGatewayTool,
  listMcpGatewayTools,
  mcpToolSurfaceDiagnostics,
  mcpClientExecutionDiagnostics,
  listVirtualMcps,
  loadAliasManifest,
  loadState,
  managementAuthFromState,
  managementAuthLabel,
  normalizeBifrostUrl,
  quotaGovernanceSources,
  removeRepoState,
  repoIdentity,
  repoMcpInstructions,
  requestJson,
  resolveVirtualMcpNames,
  rotateVirtualKey,
  routingFeatureSummary,
  runCommand,
  runtimeConfigFromState,
  saveState,
  ompWebSearchDiagnostics,
  ompContextPolicyDiagnostics,
  formatOmpContextPolicyDiagnostics,
  readOmpConfigValue,
  readOmpConfigValueResult,
  testInference,
  testManagement,
  syncVirtualMcpAssignments,
  testMcp,
  updateRepoState,
  updateVirtualKey,
  upsertRepoVirtualKey,
  virtualKeyMcpConfigs,
  virtualMcpsForVirtualKey,
  writeAliasManifest,
  writeRepoMcpConfig,
} from "./cli-lib.mjs";

const HELP = `Pifrost ${VERSION} — optional Bifrost models, MCPs and Skills for OMP

Usage: pifrost <command> [options]

Everyday:
  pifrost status                Quick health check (alias: doctor)
  pifrost init                  Configure gateway and credentials; OMP is unchanged
  pifrost models                Native OMP/Bifrost integration status
  pifrost models list           Bifrost model inventory
  pifrost models enable [--api completions|responses]    Optional model discovery
  pifrost models disable        Remove managed model discovery
  pifrost mcp                   MCP clients available to current repository
  pifrost skills                Skills available from Bifrost
  pifrost repo status           Check current repository setup
  pifrost omp commands enable   Enable the optional /pifrost command palette
  pifrost omp commands disable  Disable the command palette
  pifrost omp commands status   Check slash-command installation

Repo MCP:
  pifrost repo init [--clients name] [--tools tool1,tool2] [--virtual-mcps name]
  pifrost repo mcp list
  pifrost repo mcp add <client> --tools <tool1,tool2|*>
  pifrost repo mcp remove <client>
  pifrost repo mcp instructions <on|off|default>
  pifrost repo vmcp list
  pifrost repo vmcp add <bundle>
  pifrost repo vmcp remove <bundle>
  pifrost repo rotate-key [--dry-run]
  pifrost repo reset [--dry-run] [--delete-remote] [--yes]

Repo Skills:
  pifrost repo skills list
  pifrost repo skills add <name> [--force]
  pifrost repo skills sync [name] [--force]
  pifrost repo skills remove <name> [--force]
  pifrost repo skills suggestions
  pifrost repo skills bind <client> <skill>
  pifrost repo skills unbind <client>
  pifrost repo skills dismiss <client>
  pifrost repo skills undismiss <client>

Migration (explicit):
  pifrost migrate status
  pifrost migrate disable-extension [--dry-run]
  pifrost migrate apply
  pifrost migrate rollback

Advanced / internal:
  pifrost global setup [--url URL] [--virtual-key KEY]
  pifrost global status [--json|--verbose]
  pifrost global mcp-policy
  pifrost global observability
  pifrost models kinds
  pifrost secret repo-mcp --id <repo-id>   Internal command: prints secret
  pifrost secret inference                Internal command: prints secret
  pifrost secret inference-vk             Internal command: prints secret

Tip: use pifrost <command> --help for accepted flags and side effects.
Secret flags may be visible in shell history; prefer interactive or environment configuration.
OMP model roles, retries, compaction and execution are always OMP-owned.
`;

function parseArgs(argv) {
  const positional = [], flags = {};
  for (let i=0;i<argv.length;i++) {
    const token=argv[i];
    if(token==="--") { positional.push(...argv.slice(i+1)); break; }
    if(!token.startsWith("--") || token==="--") {positional.push(token);continue;}
    const eq=token.indexOf("=");
    const key=eq>2?token.slice(2,eq):token.slice(2);
    if(!isKnownFlag(key))throw cliUsageError("Unknown option --"+key+". Use the command's --help.");
    if(Object.hasOwn(flags,key))throw cliUsageError("Option --"+key+" was provided more than once.");
    if(flagRequiresValue(key, positional.slice(0,2).join(" "))){
      const value=eq>2?token.slice(eq+1):argv[++i];
      if(!value || value.startsWith("--"))throw cliUsageError("Option --"+key+" requires a value.");
      flags[key]=value;
    }else{
      if(eq>2)throw cliUsageError("Option --"+key+" is a switch and cannot take a value.");
      flags[key]=true;
    }
  }
  return {positional,flags};
}

function flagString(flags, name) {
  const value = flags[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}


function compatibilityMark(status) {
  if (status === "supported") return "OK";
  if (status === "unavailable") return "UNAVAILABLE";
  if (status === "inaccessible") return "INACCESSIBLE";
  if (status === "drifted") return "DRIFT";
  return String(status ?? "UNKNOWN").toUpperCase();
}

function validationMark(status) {
  if (status === "tested-current") return "TESTED CURRENT";
  if (status === "supported") return "SUPPORTED";
  if (status === "newer") return "NEWER THAN VALIDATED";
  if (status === "unsupported") return "UNSUPPORTED";
  return "UNKNOWN";
}

function compatibilityNeedsAttention(item) {
  return item.status === "drifted" || (item.id === "omp-baseline" && item.status !== "supported");
}

async function commandCompatibilityDoctor(snapshot) {
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const managementAuth = managementAuthFromState(state);
  const matrix = await buildCompatibilityMatrix({
    url: runtime.url,
    managementAuth,
    virtualKey: runtime.virtualKey,
    apiKey: runtime.apiKey,
    ompVersion: getOmpVersion(),
    bifrostVersion: snapshot?.version?.ok ? snapshot.version.value : undefined,
    probes: snapshot,
  });

  printHeader("Upstream compatibility");
  console.log(`OMP version:             ${matrix.ompVersion ?? "unavailable"} (minimum ${PIFROST_OMP_MIN_VERSION}; validated through ${PIFROST_OMP_VALIDATED_VERSION})`);
  console.log(`OMP policy snapshot:     ${PIFROST_OMP_POLICY_SNAPSHOT_VERSION} + Pifrost compatibility patches`);
  console.log(`  [${validationMark(matrix.ompValidation.status)}] ${matrix.ompValidation.detail}`);
  for (const item of matrix.omp) {
    console.log(`  [${compatibilityMark(item.status)}] ${item.label} >=${item.minimum} — ${item.detail}`);
    if (item.status !== "supported" && item.impact) console.log(`    impact: ${item.impact}`);
  }
  console.log(`Bifrost version:         ${matrix.bifrostVersion ?? "unavailable"} (minimum ${PIFROST_BIFROST_MIN_VERSION}; validated through ${PIFROST_BIFROST_VALIDATED_VERSION})`);
  console.log(`  [${validationMark(matrix.bifrostValidation.status)}] ${matrix.bifrostValidation.detail}`);
  for (const item of matrix.bifrost) {
    console.log(`  [${compatibilityMark(item.status)}] ${item.label} >=${item.minimum} — ${item.detail}`);
    if (item.status !== "supported" && item.impact) console.log(`    impact: ${item.impact}`);
  }

  const issues = [...matrix.omp, ...matrix.bifrost].filter(
    (item) => item.status !== "supported" && item.optional !== true,
  );
  const drift = issues.filter((item) => item.status === "drifted").length;
  const inaccessible = issues.filter((item) => item.status === "inaccessible").length;
  const unavailable = issues.filter((item) => item.status === "unavailable").length;
  console.log(
    `Compatibility summary:  ${issues.length ? `degraded (unavailable=${unavailable}, inaccessible=${inaccessible}, drift=${drift})` : "OK"}`,
  );
  if ([...matrix.omp, ...matrix.bifrost].some(compatibilityNeedsAttention)) process.exitCode = 2;
}

function formatError(error) {
  if (error instanceof PifrostHttpError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function printHeader(title) {
  console.log(terminalSection(title));
}

function boolMark(value) {
  return value ? "OK" : "FAIL";
}

function parseSelection(value, max) {
  const indexes = splitCsv(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= max);
  return [...new Set(indexes)];
}

async function withPrompter(callback) {
  const rl = createInterface({ input, output });
  try {
    return await callback(rl);
  } finally {
    rl.close();
  }
}

async function ask(rl, prompt, fallback) {
  const suffix = fallback !== undefined && fallback !== "" ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback || "";
}

async function confirm(rl, prompt, fallback = true) {
  const suffix = fallback ? " [Y/n]" : " [y/N]";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim().toLowerCase();
  if (!answer) return fallback;
  return ["y", "yes", "1", "true"].includes(answer);
}

async function askSecret(rl, prompt, existing) {
  if (existing) {
    const keep = await confirm(rl, `${prompt} is already configured. Keep it?`, true);
    if (keep) return existing;
  }
  if(process.platform==="win32" && process.stdin.isTTY){
    // PowerShell Read-Host masks TTY input; plaintext remains in private
    // subprocess stdout pipe, never terminal output or command arguments.
    rl.pause();
    try{
      console.log(prompt+":");
      const script="$sec=Read-Host -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";
      const read=spawnSync("powershell.exe",["-NoProfile","-Command",script],{
        stdio:["inherit","pipe","inherit"],encoding:"utf8",
      });
      if(read.status!==0)throw new Error("Secure Windows prompt unavailable. Supply the secret via a protected environment variable.");
      return (read.stdout??"").trim();
    }finally{rl.resume();}
  }
  let echoDisabled = false;
  try {
    if (process.platform !== "win32" && process.stdin.isTTY) {
      const result = spawnSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
      echoDisabled = result.status === 0;
    }
    const value = (await rl.question(`${prompt}: `)).trim();
    if (echoDisabled) process.stdout.write("\n");
    return value;
  } finally {
    if (echoDisabled) spawnSync("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] });
  }
}

function normalizeManagementMode(value) {
  if (!value) return undefined;
  const mode = String(value).trim().toLowerCase();
  if (["basic", "oss", "admin"].includes(mode)) return "basic";
  if (["bearer", "enterprise", "api-key", "apikey"].includes(mode)) return "bearer";
  if (["setup", "setup-token", "bootstrap"].includes(mode)) return "setup";
  throw new Error("Management auth mode must be `basic` (Bifrost OSS), `bearer` (Bifrost Enterprise), or `setup` (ephemeral first-time setup token)");
}

function buildManagementAuth(mode, username, password, apiKey) {
  if (!mode) return undefined;
  if (mode === "basic") {
    if (!username || !password) {
      throw new Error("Bifrost OSS management auth requires both --management-username and --management-password");
    }
    return { mode: "basic", username, password };
  }
  if (mode === "setup") {
    if (!apiKey) throw new Error("Bifrost setup-token auth requires --setup-token or BIFROST_SETUP_TOKEN");
    return { mode: "setup", setupToken: apiKey };
  }
  if (!apiKey) throw new Error("Bifrost Enterprise management auth requires --management-key");
  return { mode: "bearer", apiKey };
}

async function commandGlobalSetup(flags) {
  const state = loadState();
  const current = runtimeConfigFromState(state);
  const existingManagement = managementAuthFromState(state);
  let url = flagString(flags, "url") ?? current.url ?? state.config.bifrost?.url;
  let apiKey = flagString(flags, "api-key") ?? current.apiKey;
  let virtualKey = flagString(flags, "virtual-key") ?? current.virtualKey;

  const explicitMode = flagString(flags, "management-auth") ?? process.env.BIFROST_MANAGEMENT_AUTH_MODE;
  let managementMode = normalizeManagementMode(explicitMode) ?? existingManagement?.mode;
  let managementUsername =
    flagString(flags, "management-username") ??
    process.env.BIFROST_ADMIN_USERNAME ??
    (existingManagement?.mode === "basic" ? existingManagement.username : undefined);
  let managementPassword =
    flagString(flags, "management-password") ??
    process.env.BIFROST_ADMIN_PASSWORD ??
    (existingManagement?.mode === "basic" ? existingManagement.password : undefined);
  let managementApiKey =
    flagString(flags, "management-key") ??
    process.env.BIFROST_MANAGEMENT_API_KEY ??
    (existingManagement?.mode === "bearer" ? existingManagement.apiKey : undefined);
  let setupToken =
    flagString(flags, "setup-token") ??
    process.env.BIFROST_SETUP_TOKEN ??
    (existingManagement?.mode === "setup" ? existingManagement.setupToken : undefined);

  if (!explicitMode) {
    const explicitSetupToken = flagString(flags, "setup-token");
    const explicitManagementKey = flagString(flags, "management-key");
    const explicitBasic =
      flagString(flags, "management-username") ||
      flagString(flags, "management-password");
    if (explicitSetupToken) {
      managementMode = "setup";
    } else if (explicitManagementKey || process.env.BIFROST_MANAGEMENT_API_KEY) {
      managementMode = "bearer";
    } else if (explicitBasic || process.env.BIFROST_ADMIN_USERNAME || process.env.BIFROST_ADMIN_PASSWORD) {
      managementMode = "basic";
    } else if (!existingManagement && process.env.BIFROST_SETUP_TOKEN) {
      // An ambient setup token is bootstrap-only. Never let a stale token
      // displace management credentials already saved by a completed setup.
      managementMode = "setup";
    }
  }

  const nonInteractive = Boolean(flags.yes) || !process.stdin.isTTY;
  if (!nonInteractive) {
    await withPrompter(async (rl) => {
      url = await ask(rl, "Bifrost URL", url ?? "http://127.0.0.1:8180/v1");
      apiKey = await askSecret(rl, "Inference API/Bearer key (optional on Bifrost 2.x; leave blank for VK-only)", apiKey);
      virtualKey = await askSecret(rl, "Global inference Virtual Key", virtualKey);
      const wantManagement = await confirm(
        rl,
        "Configure management auth for route sync and repo MCP automation?",
        true,
      );
      if (wantManagement) {
        const selected = await ask(
          rl,
          "Management auth mode (basic=OSS admin credentials, bearer=Enterprise API key, setup=ephemeral first-time setup token)",
          managementMode ?? "basic",
        );
        managementMode = normalizeManagementMode(selected);
        if (managementMode === "basic") {
          managementUsername = await ask(rl, "Bifrost admin username", managementUsername);
          managementPassword = await askSecret(rl, "Bifrost admin password", managementPassword);
          managementApiKey = undefined;
          setupToken = undefined;
        } else if (managementMode === "setup") {
          setupToken = await askSecret(rl, "Bifrost first-time setup token (ephemeral; never stored by Pifrost)", setupToken);
          managementUsername = undefined;
          managementPassword = undefined;
          managementApiKey = undefined;
        } else {
          managementApiKey = await askSecret(rl, "Enterprise scoped management API key", managementApiKey);
          managementUsername = undefined;
          managementPassword = undefined;
          setupToken = undefined;
        }
      } else {
        managementMode = undefined;
        managementUsername = undefined;
        managementPassword = undefined;
        managementApiKey = undefined;
        setupToken = undefined;
      }
    });
  }

  if (!url && !flags["dry-run"]) {
    throw new Error("Bifrost URL is required");
  }
  if (url) url = normalizeBifrostUrl(url);
  let setupState;
  try {
    setupState = url ? await getBifrostSetupState(url) : undefined;
  } catch {
    setupState = undefined;
  }
  if (setupState?.setupRequired && !setupToken && managementMode !== "setup" && !flags["skip-test"]) {
    throw new Error(
      "Bifrost first-time setup is incomplete. Complete the Bifrost setup-token flow first, or rerun with --setup-token / BIFROST_SETUP_TOKEN for an ephemeral bootstrap check. Pifrost will not store the setup token.",
    );
  }
  if (setupToken && !managementMode) managementMode = "setup";
  const managementAuth = buildManagementAuth(
    managementMode,
    managementUsername,
    managementPassword,
    managementMode === "setup" ? setupToken : managementApiKey,
  );

  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Would save Bifrost connection configuration and protected credentials",
      "Would test inference/management access unless --skip-test",
      "Would leave all OMP model roles, defaults and settings unchanged",
      "Secret values will not be printed"
    ]));return;
  }
  if (!flags["skip-test"]) {
    process.stdout.write("Testing inference connection... ");
    if (virtualKey) {
      const inference = await testInference({ url, apiKey, virtualKey });
      console.log(`OK (${inference.models} models visible)`);
    } else {
      console.log("SKIPPED (no inference Virtual Key; repo MCP/Skills setup remains available)");
    }
    if (managementAuth) {
      process.stdout.write(`Testing management API via ${managementAuthLabel(managementAuth)}... `);
      await testManagement(url, managementAuth);
      console.log("OK");
    }
  }

  state.config.bifrost = { ...(state.config.bifrost ?? {}), url };
  if (apiKey) state.secrets.inferenceApiKey = apiKey;
  else delete state.secrets.inferenceApiKey;
  if (virtualKey) state.secrets.inferenceVirtualKey = virtualKey;
  else delete state.secrets.inferenceVirtualKey;

  delete state.secrets.managementApiKey;
  delete state.secrets.managementAdminUsername;
  delete state.secrets.managementAdminPassword;
  if (managementAuth?.mode === "basic") {
    state.config.bifrost.managementAuthMode = "basic";
    state.secrets.managementAdminUsername = managementAuth.username;
    state.secrets.managementAdminPassword = managementAuth.password;
  } else if (managementAuth?.mode === "bearer") {
    state.config.bifrost.managementAuthMode = "bearer";
    state.secrets.managementApiKey = managementAuth.apiKey;
  } else {
    // Setup-token auth is intentionally ephemeral and is never persisted.
    delete state.config.bifrost.managementAuthMode;
  }

  if(["api-key","virtual-key","management-key","management-password","setup-token"].some(k=>
    Object.hasOwn(flags,k))) console.log("Security note: CLI secret flags can appear in shell history/process listings; prefer protected environment variables or interactive prompts.");
  const paths = saveState(state.config, state.secrets);
  console.log(`Saved config:  ${paths.config}`);
  console.log(`Saved secrets: ${paths.secrets} (0600)`);

  console.log("Setup completed. OMP model roles are unchanged.");
  console.log("Use pifrost models enable for optional native Bifrost model discovery; repo init for MCPs.");
}

function snapshotCheck(id, label, snapshot, action, required = false) {
  const item = snapshot?.[id];
  if (item?.ok) {
    const detail = id === "inference" && Number.isFinite(item.value?.models)
      ? `${item.value.models} models visible`
      : id === "routing" && Array.isArray(item.value) ? `${item.value.length} routing rules`
      : "Connection verified";
    return { id,label, status:"ok", detail,required };
  }
  return {
    id,label,required,
    status: item?.skipped ? "unknown" : required ? "fail" : "warn",
    detail: item?.skipped ? "Not configured or not checked" : "Could not verify",
    action,
  };
}

async function commandGlobalStatus(snapshot, options = {}) {
  if (!options.verbose) {
    const state = loadState();
    const runtime = runtimeConfigFromState(state);
    const management = managementAuthFromState(state);
    const live = snapshot ?? await collectDoctorSnapshot({ runtime, managementAuth: management });
    const checks = [
      snapshotCheck("health", "Bifrost gateway", live, "pifrost global setup", true),
      snapshotCheck("inference", "Inference access", live, "pifrost global setup", true),
      snapshotCheck("management", "Management access", live, "pifrost global setup", false),
      snapshotCheck("routing", "Routing policy", live, "pifrost routes diagnose", false),
    ];
    const result=reportHealth({command:"global status",checks,strict:options.strict,json:options.json});
    if(!options.json){
      console.log(renderHealthOverview(result.checks, {title:"Pifrost global status"}));
      console.log(terminalField("Gateway", runtime.url ?? "not configured"));
      console.log("For full gateway, quota and MCP details: pifrost global status --verbose");
    }
    if(result.exitCode) process.exitCode=result.exitCode;
    return;
  }
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const managementAuth = managementAuthFromState(state);
  const probes = snapshot ?? await collectDoctorSnapshot({ runtime, managementAuth });

  const value = (key) => probes?.[key]?.ok ? probes[key].value : undefined;
  const errorText = (key) => probes?.[key]?.error ? formatError(probes[key].error) : "not probed";

  printHeader("Global Pifrost status");
  console.log(`Config directory:       ${state.paths.root}`);
  console.log(`Bifrost URL:            ${runtime.url ?? "missing"}`);
  console.log(`Inference API key:      ${runtime.apiKey ? "set" : "not used"}`);
  console.log(`Inference Virtual Key:  ${runtime.virtualKey ? "set" : "missing"}`);
  console.log(`Inference auth mode:    ${runtime.virtualKey ? (runtime.apiKey ? "Bearer + Virtual Key" : "Bifrost 2.x Virtual Key") : "missing"}`);
  console.log(`Management auth:        ${managementAuthLabel(managementAuth)}`);
  if (managementAuth?.mode === "basic") {
    console.log(`Admin username:         ${managementAuth.username ? "set" : "missing"}`);
    console.log(`Admin password:         ${managementAuth.password ? "set" : "missing"}`);
  } else if (managementAuth?.mode === "bearer") {
    console.log(`Management API key:     ${managementAuth.apiKey ? "set" : "missing"}`);
  }
  console.log(`OMP installed:          ${boolMark(commandExists("omp"))}`);
  console.log(`OMP version:            ${getOmpVersion() ?? "unavailable"}`);

  if (runtime.url) {
    console.log(
      probes.version.ok
        ? `Bifrost version:        ${value("version") ?? "unknown"}`
        : `Bifrost version:        unavailable (${errorText("version")})`,
    );
    console.log(
      probes.health.ok
        ? "Bifrost health:         OK"
        : `Bifrost health:         FAIL (${errorText("health")})`,
    );
  }

  if (runtime.url) {
    if (probes.setup.ok) {
      const setup = value("setup");
      console.log(`Bifrost setup:          ${setup.setupRequired ? "INCOMPLETE" : "complete"} (dashboard-auth=${setup.authEnabled ? "enabled" : "disabled"}, inference-auth=${setup.inferenceAuthEnforced ? "enforced" : "not enforced"}, setup-token=${setup.setupTokenConfigured ? "configured" : "not configured"})`);
    } else {
      console.log(`Bifrost setup/auth:     unavailable (${errorText("setup")})`);
    }
  }

  if (runtime.url && runtime.virtualKey) {
    const inference = value("inference");
    console.log(
      probes.inference.ok
        ? `Inference connection:   OK (${inference.models} models)`
        : `Inference connection:   FAIL (${errorText("inference")})`,
    );

    if (probes.quota.ok) {
      const quota = value("quota");
      const budgets = Array.isArray(quota?.budgets) ? quota.budgets.length : 0;
      const modelConfigs = Array.isArray(quota?.model_configs) ? quota.model_configs.length : 0;
      const providerConfigs = Array.isArray(quota?.provider_configs) ? quota.provider_configs.length : 0;
      const rateLimits = (quota?.rate_limit ? 1 : 0) + (Array.isArray(quota?.rate_limits) ? quota.rate_limits.length : 0);
      console.log(`VK governance/quota:    OK (budgets=${budgets}, rate-limits=${rateLimits}, providers=${providerConfigs}, models=${modelConfigs})`);
      const sources = quotaGovernanceSources(quota);
      if (sources.length) {
        console.log("Governance sources:");
        for (const source of sources) console.log(`  ${formatQuotaGovernanceSource(source)}`);
      }
    } else {
      console.log(`VK governance/quota:    unavailable (${errorText("quota")})`);
    }
  }

  if (runtime.url && managementAuth) {
    console.log(
      probes.management.ok
        ? "Management connection:  OK"
        : `Management connection:  FAIL (${errorText("management")})`,
    );

    if (probes.routing.ok) {
      const features = routingFeatureSummary(value("routing"));
      console.log(`Bifrost routing 2.x:    OK (rules=${features.enabledRules}, scopes=${features.scopes.join(",") || "global"}, chained=${features.chainRules}, weighted=${features.weightedRules}, complexity-rules=${features.complexityRules}, pinned=${features.pinnedRules ?? 0})`);
    } else {
      console.log(`Bifrost routing 2.x:    FAIL (${errorText("routing")})`);
    }

    if (probes.gateway.ok) {
      const gateway = value("gateway");
      const client = gateway?.client_config ?? gateway?.clientConfig ?? gateway?.data?.client_config ?? {};
      const mcpAuthMode = client?.mcp_server_auth_mode ?? "headers";
      const chainDepth = client?.routing_chain_max_depth ?? "default";
      const requiredHeaders = Array.isArray(client?.required_headers) ? client.required_headers : [];
      const compat = client?.compat && typeof client.compat === "object" && !Array.isArray(client.compat)
        ? client.compat
        : {};
      const chatToResponses = typeof compat.convert_chat_to_responses === "boolean"
        ? compat.convert_chat_to_responses
        : undefined;
      const reasoningToResponses = typeof compat.force_reasoning_only_models_to_responses === "boolean"
        ? compat.force_reasoning_only_models_to_responses
        : undefined;
      console.log(`Gateway config 2.x:     MCP-auth=${mcpAuthMode}, chain-depth=${chainDepth}, required-headers=${requiredHeaders.length}`);
      console.log(`  Chat→Responses:       ${chatToResponses === undefined ? "not reported" : chatToResponses ? "enabled" : "disabled"}`);
      if (reasoningToResponses !== undefined) {
        console.log(`  Reasoning→Responses:  ${reasoningToResponses ? "enabled" : "disabled"}`);
      }
      if (mcpAuthMode === "oauth") {
        console.log("  WARN repo MCP configs use x-bf-vk; OAuth-only MCP gateway mode requires OMP OAuth instead of VK/header auth.");
      }
      if (requiredHeaders.length) {
        console.log(`  WARN Bifrost requires request headers not managed by Pifrost: ${requiredHeaders.join(", ")}`);
      }
    } else {
      console.log(`Gateway config 2.x:     unavailable (${errorText("gateway")})`);
    }

    if (probes.complexity.ok) {
      const complexity = value("complexity");
      if (!complexity) {
        console.log("Complexity analyzer:    not exposed by this Bifrost version");
      } else {
        const mechanisms = [
          complexity?.semantic ? "semantic" : undefined,
          complexity?.llm ? "llm" : undefined,
          complexity?.session?.enabled ? "session" : undefined,
        ].filter(Boolean);
        console.log(`Complexity analyzer:    available (${mechanisms.join(",") || "keywords/configured"})`);
        if (complexity?.session?.enabled) {
          console.log("  OK Pifrost sends OMP's per-request sessionId as x-bf-session-id, enabling Bifrost session-persistent complexity routing and provider/key affinity without mutating shared provider headers.");
        }
      }
    } else {
      console.log(`Complexity analyzer:    unavailable (${errorText("complexity")})`);
    }

    if (probes.mcpClients.ok) {
      const clients = value("mcpClients");
      const codeMode = clients.filter((client) => client.isCodeModeClient).length;
      const agentMode = clients.filter((client) => client.toolsToAutoExecute?.length).length;
      const perUser = clients.filter((client) => ["per_user_oauth", "per_user_headers", "token_exchange"].includes(client.authType)).length;
      console.log(`MCP gateway 2.x:        OK (clients=${clients.length}, code-mode=${codeMode}, agent-mode=${agentMode}, per-user-auth=${perUser})`);
    } else {
      console.log(`MCP gateway 2.x:        unavailable (${errorText("mcpClients")})`);
    }
  }
  console.log("Service-tier aliases:   delegated (OMP family tiers cannot be mapped safely onto heterogeneous Bifrost logical routes)");
  console.log(`Alias manifest:         ${aliasManifestPath()}${existsSync(aliasManifestPath()) ? "" : " (missing)"}`);
}

async function commandInit(flags) {
  printHeader("Pifrost 0.30 — Bifrost connections and repo tools only");
  // The default must NEVER install a provider, remap OMP roles or refresh
  // Pifrost aliases. Existing native OMP settings remain authoritative.
  await commandGlobalSetup({ ...flags, "skip-omp": true });
  if (flags["dry-run"]) console.log("Dry-run: no changes made.");
  console.log("OMP model selection is unchanged. To opt in: pifrost models enable");
  console.log("For a repository: pifrost repo init; pifrost repo skills list");
}

async function routingSnapshot() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const discovered = await discoverRoutingRules(url, managementKey);
  return {
    ...discovered,
    manifest: deriveAliasesRobust(discovered.rules),
    policyFingerprint: routePolicyFingerprint(discovered.rules),
  };
}

async function commandRoutesList(flags = {}) {
  const { manifest } = await routingSnapshot();
  printHeader(`Bifrost OMP routes (${Object.keys(manifest.aliases).length})`);
  const aliases=Object.entries(manifest.aliases).sort(([a],[b])=>a.localeCompare(b))
    .map(([name,definition])=>({name,definition}));
  const shown=listFilter(aliases,flags);
  console.log("Showing "+shown.items.length+" of "+shown.total+" matching routes");
  for (const {name:id,definition} of shown.items) {
    console.log(id);
    const pins = Array.isArray(definition.routingPins) ? definition.routingPins : [];
    definition.chain.forEach((member, index) => {
      const memberPins = pins.filter((pin) => pin.reference === member);
      const suffix = memberPins.length
        ? ` [${memberPins.map((pin) => pin.providerKeyName ? `provider-key=${pin.providerKeyName}` : `key-id=${pin.keyId}`).join(", ")}]`
        : "";
      console.log(`  ${index + 1}. ${member}${suffix}`);
    });
  }
}

async function commandRoutesDiagnose() {
  const { rules, diagnostics, manifest } = await routingSnapshot();
  printHeader("Bifrost routing discovery");
  for (const item of diagnostics) {
    if (item.ok) console.log(`${item.path}: OK rules=${item.count} ${item.shape}`);
    else console.log(`${item.path}: FAIL${item.status ? ` HTTP ${item.status}` : ""} ${item.error}`);
  }
  console.log(`\nUnique raw rules: ${rules.length}`);
  console.log(`Derived omp-* aliases: ${Object.keys(manifest.aliases).length}`);

  const unmatched = rules.filter((rule) => {
    const one = deriveAliasesRobust([rule]);
    return Object.keys(one.aliases).length === 0;
  });
  if (unmatched.length) {
    console.log("\nRules not recognized as Pifrost aliases:");
    for (const rule of unmatched.slice(0, 30)) {
      console.log(`  - ${rule?.name ?? rule?.id ?? "<unnamed>"}`);
    }
    if (unmatched.length > 30) console.log(`  ... ${unmatched.length - 30} more`);
  }
}

async function commandRoutesDiff() {
  const { manifest: remote, policyFingerprint } = await routingSnapshot();
  const local = loadAliasManifest();
  const differences = diffAliases(local, remote);
  const drift = routePolicyDrift(local.policyFingerprint, policyFingerprint);
  if (drift !== "verified-match") {
    console.log(`Bifrost policy fingerprint: ${drift}; model chains alone do not establish routing-policy parity.`);
  }
  if (!differences.length && drift === "verified-match") {
    console.log("Routes are in sync (full gateway rule-policy fingerprint matches).");
    return;
  }
  if (!differences.length) {
    console.log("Route members match, but routing conditions/pins/metadata may have changed. Run `pifrost routes sync` after review.");
    process.exitCode = 2;
    return;
  }
  printHeader(`Route differences (${differences.length})`);
  for (const item of differences) {
    console.log(item.id);
    console.log(`  local:  ${item.local ? item.local.join(" -> ") : "missing"}`);
    console.log(`  remote: ${item.remote ? item.remote.join(" -> ") : "missing"}`);
    if (item.localPins?.length || item.remotePins?.length) {
      console.log(`  local pins:  ${item.localPins?.length ? JSON.stringify(item.localPins) : "none"}`);
      console.log(`  remote pins: ${item.remotePins?.length ? JSON.stringify(item.remotePins) : "none"}`);
    }
  }
  process.exitCode = 2;
}

async function commandRoutesVerify(flags = {}) {
  const { policyFingerprint, manifest } = await routingSnapshot();
  const local = loadAliasManifest();
  const status = routePolicyDrift(local.policyFingerprint, policyFingerprint);
  printHeader("Bifrost live rule-policy verification");
  if (status !== "verified-match") {
    console.log(`Policy ${status}: local and gateway rule configurations are not verified equal. Run pifrost routes diff, then pifrost routes sync and restart OMP.`);
    process.exitCode = 2;
    return;
  }
  if (diffAliases(local, manifest).length > 0) {
    console.log("Alias membership drift despite matching policy digest; refusing to refresh.");
    process.exitCode = 2;
    return;
  }
  if(flags["dry-run"]){console.log(operationSummary("Read-only preview",[
    "Rule fingerprints match; verification timestamp would be refreshed",
    "Restart OMP after applying verification"
  ]));return;}
  const stamp = new Date().toISOString();
  const result = writeAliasManifest({ ...local, synchronizedAt: stamp, policyFingerprint });
  console.log(`Verified full Bifrost rule policy unchanged; refreshed local verification at ${stamp}.`);
  console.log(`Manifest: ${result.path}; restart OMP to refresh active compatibility profiles.`);
}

async function commandRoutesAttest(alias, flags = {}) {
  try {
    const attestation = await attestCompatibilityRoute({ alias });
    if (flags.json) console.log(JSON.stringify(attestation));
    else console.log(`Bifrost live route attested: ${attestation.alias} policy=${attestation.policyFingerprint.slice(0,12)} members=${attestation.memberDigest.slice(0,12)}`);
  } catch (error) {
    const code = error instanceof RouteReconcileError ? error.code : "gateway-check-failed";
    if (flags.json) console.log(JSON.stringify({ schemaVersion:1, status:"unverified", reason:code }));
    else console.error("Bifrost compatibility route attestation failed: "+code);
    process.exitCode = 2;
  }
}

async function commandRoutesSync(flags = {}) {
  const { manifest, rules, diagnostics, policyFingerprint } = await routingSnapshot();
  const count = Object.keys(manifest.aliases).length;
  if (!count) {
    const sourceSummary = diagnostics
      .map((item) => `${item.path}=${item.ok ? item.count : `HTTP-${item.status ?? "error"}`}`)
      .join(", ");
    throw new Error(
      `Bifrost returned ${rules.length} routing rule(s), but none could be derived as omp-* aliases (${sourceSummary}). Run \`pifrost routes diagnose\` for details.`,
    );
  }
  // A local exception route must carry provenance of an actual management API
  // read. Model-catalog refresh alone does not refresh Bifrost rule membership.
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Would save "+count+" logical route aliases and the complete Bifrost rule-policy fingerprint",
      flags["no-refresh"]?"Model refresh would be skipped":"Would refresh the OMP model catalogue",
      "Restart OMP after applying"
    ]));return;
  }
  const result = writeAliasManifest({ ...manifest, synchronizedAt: new Date().toISOString(), policyFingerprint });
  console.log(`Wrote ${count} aliases to ${result.path}`);
  if (result.backup) console.log(`Previous manifest backed up to ${result.backup}`);
  if (!flags["no-refresh"]) await commandModelsRefresh({ force: true });
}

async function commandRoutesReconcile(flags = {}) {
  try {
    const result = await reconcileRouteSnapshot();
    if (flags.json) {
      console.log(JSON.stringify({ schemaVersion: 1, ...result }));
    } else {
      console.log(result.status === "updated"
        ? `Bifrost routing changed; synchronized ${result.routes} aliases. Refresh OMP models to apply.`
        : "Bifrost routes unchanged; no refresh required.");
    }
  } catch (error) {
    const code = error instanceof RouteReconcileError ? error.code : "check-failed";
    if (flags.json) {
      // This machine-readable result never includes Bifrost credentials or
      // raw CEL expressions; the OMP hook fails open without blocking work.
      console.log(JSON.stringify({ schemaVersion: 1, status: "unavailable", code }));
    } else {
      console.log(`Route check unavailable (${code}); local routes unchanged.`);
    }
  }
}

async function commandModelsRefresh(flags = {}) {
  if (!commandExists("omp")) throw new Error("`omp` is not installed or not on PATH");
  const env = { ...process.env };
  if (flags.force) env.PIFROST_FORCE_REFRESH = "1";
  runCommand("omp", ["models", "refresh"], { env, inherit: true });
}

async function commandModelsDoctor(options = {}) {
  if (!options.verbose) {
    const result = printModelDoctor(process.env, { log() {} });
    const check = result.checks?.[0];
    const issues = (result.unresolved ?? []).length;
    const checks=[{id:"model-catalogue",label:"Model readiness",status:result.ok?"ok":"fail",
      required:true,detail:check?.summary ?? (result.ok?"Available":"Needs attention"),
      action:"pifrost models refresh --force"}];
    const health=reportHealth({command:"models doctor",checks,strict:options.strict,json:options.json});
    if(options.json){if(health.exitCode)process.exitCode=health.exitCode;return result;}
    console.log(terminalSection("Model catalogue"));
    console.log(terminalStatus(result.ok ? "ok" : "fail", "Model readiness",
      check?.summary ?? (result.ok ? "Available" : "Needs attention")));
    if (!result.ok) {
      for (const item of result.unresolved.slice(0, 8)) {
        console.log(`  - ${item.id}: ${item.unresolved.join(", ")}`);
      }
      if (issues > 8) console.log(`  ... and ${issues - 8} more affected routes.`);
      console.log(terminalNextSteps(["pifrost models refresh --force", "pifrost models doctor --verbose"]));
    } else {
      console.log("For capability, provenance and context-band details: pifrost models doctor --verbose");
    }
    if (health.exitCode) process.exitCode = health.exitCode;
    return result;
  }
  const result = printModelDoctor();
  if (!result.ok) process.exitCode = 2;
  return result;
}

function currentOmpModelRoles() {
  const value = readOmpConfigValue("modelRoles");
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function commandRoutesEffective() {
  const { path, cache, staleSchema, ageMs, stale } = readCatalog();
  printHeader("Effective OMP → Pifrost → Bifrost routes");
  if (!cache) {
    console.log(`Model catalog unavailable at ${path}${staleSchema !== undefined ? ` (schema ${staleSchema} is stale)` : ""}.`);
    console.log("Run: pifrost models refresh --force");
    process.exitCode = 2;
    return;
  }
  if (Number.isFinite(ageMs)) {
    const minutes = Math.floor(ageMs / 60_000);
    console.log(formatCatalogSnapshot(cache, ageMs, stale));
    if (stale) console.log("WARN route membership may have changed in Bifrost; run `pifrost models refresh --force` for a fresh effective view.");
  }
  const manifest = loadAliasManifest();
  const hasCompatibilityRoutes = Object.values(manifest.aliases ?? {}).some(
    definition => definition && !Array.isArray(definition) && definition.dynamicRouting?.source === "bifrost-simple-rule",
  );
  if (hasCompatibilityRoutes) {
    const syncedAt = typeof manifest.synchronizedAt === "string" ? Date.parse(manifest.synchronizedAt) : NaN;
    const age = Date.now() - syncedAt;
    if (!Number.isFinite(syncedAt) || age < -60_000 || age > MAX_COMPATIBILITY_ROUTE_SYNC_AGE_MS) {
      console.log("WARN local compatibility routes need a recent rule sync: run `pifrost routes sync` and restart OMP. Model metadata refresh does not update Bifrost routing rules.");
    } else {
      console.log(`Bifrost rule sync: ${manifest.synchronizedAt} (fingerprint=${typeof manifest.policyFingerprint === "string" ? manifest.policyFingerprint.slice(0, 12) : "legacy-unverified"}; verify with pifrost routes verify)`);
    }
  }
  console.log(formatEffectiveRouteReport(currentOmpModelRoles(), cache.diagnostics));
}


function commandRoutesExplain(input, flags = {}) {
  if (!input) throw new Error("Usage: pifrost routes explain <role|alias> [request flags]");
  const { cache, path } = readCatalog();
  if (!cache) throw new Error(`Model catalog unavailable at ${path}; run pifrost models refresh --force`);
  const roles = currentOmpModelRoles() ?? {};
  const alias = routeAliasForInput(input, roles);
  const diagnostic = cache.diagnostics.find((item) => String(item.id).toLowerCase() === alias);
  if (!diagnostic) throw new Error(`No Pifrost alias diagnostic found for ${input} (resolved alias: ${alias})`);
  const explanation = explainRouteRequest(diagnostic, routeExplanationRequestFromFlags(flags));
  printHeader(`Route request: ${input}`);
  console.log(formatRouteExplanation(explanation));
  const members = diagnostic.members ?? [];
  const protocols = [...new Set(members.flatMap(item => item.protocols ?? []))];
  if (protocols.includes("openai-responses")) {
    const gatewayOwned = !cache.models.find(item => String(item.id).toLowerCase() === alias)?.pifrostDynamicRoute;
    if (gatewayOwned) {
      console.log("Runtime: Bifrost owns the original logical routing rule.");
      console.log("  Ingress protocol is selected using the model catalog; only a definite");
      console.log("  pre-output protocol error permits retry through another gateway ingress.");
      console.log("  Pifrost never copies or executes Bifrost CEL, target weights, key pins or fallbacks.");
      if (protocols.includes("openai-completions")) {
        console.log("  WARN: mixed Chat/Responses members still need Bifrost conversion or");
        console.log("  compatible fallback models for successful gateway-managed fallback.");
      }
    } else {
      console.log("Runtime: verified Pifrost compatibility profile; ordered pre-output protocol groups.");
    }
  }
  console.log("Request simulation only: this does not invoke a Bifrost rule or establish route-counter attribution.");
  console.log("After an actual inference, inspect /pifrost trace and correlate its gateway request/trace ID with Bifrost Logs and Routes.");
}

async function chooseClientsInteractively(clients) {
  if (!clients.length) throw new Error("Bifrost returned no MCP clients");
  return withPrompter(async (rl) => {
    console.log("\nAvailable Bifrost MCP clients:");
    clients.forEach((client, index) => {
      const tools = client.tools.length ? `${client.tools.length} tools` : "tools not reported";
      console.log(`  [${index + 1}] ${client.name} (${client.state ?? "unknown"}; ${tools})`);
    });
    let indexes = [];
    while (!indexes.length) {
      indexes = parseSelection(await rl.question("Select clients (comma separated): "), clients.length);
      if (!indexes.length) console.log("Select at least one valid client number.");
    }
    const result = [];
    for (const index of indexes) {
      const client = clients[index - 1];
      let answer="";
      while(!answer){
        answer=(await rl.question(`Allowed tools for ${client.name} (comma-separated, or type * for all): `)).trim();
        if(!answer)console.log("Explicit selection required; wildcard access is never assumed.");
      }
      result.push({ name:client.name, tools:splitCsv(answer) });
    }
    return result;
  });
}

function resolveNamedClients(allClients, names, commonTools) {
  const lookup = new Map(allClients.map((client) => [client.name.toLowerCase(), client]));
  return names.map((name) => {
    const found = lookup.get(name.toLowerCase());
    if (!found) throw new Error(`Unknown Bifrost MCP client: ${name}`);
    return { name: found.name, tools: commonTools.length ? commonTools : ["*"] };
  });
}

async function commandRepoInit(flags) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const repo = repoIdentity();
  const clientFlagPresent = Object.prototype.hasOwnProperty.call(flags, "clients");
  const virtualMcpFlagPresent = Object.prototype.hasOwnProperty.call(flags, "virtual-mcps");
  const available = await listMcpClients(url, managementKey);
  const names = splitCsv(flagString(flags, "clients"));
  const commonTools = splitCsv(flagString(flags, "tools"));
  if(!process.stdin.isTTY && !clientFlagPresent && !virtualMcpFlagPresent){
    throw cliUsageError("Non-interactive repository setup requires --clients and --tools, or --virtual-mcps.");
  }
  const clients = clientFlagPresent
    ? resolveNamedClients(available, names, commonTools)
    : virtualMcpFlagPresent
      ? undefined
      : await chooseClientsInteractively(available);

  let availableVirtualMcps = [];
  let desiredVirtualMcps;
  if (virtualMcpFlagPresent) {
    availableVirtualMcps = await listVirtualMcps(url, managementKey);
    desiredVirtualMcps = resolveVirtualMcpNames(
      availableVirtualMcps,
      splitCsv(flagString(flags, "virtual-mcps")),
    );
  }

  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Repository: "+repo.name,
      "Direct clients: "+(clients?.map(c=>c.name+" ["+c.tools.join(", ")+"]").join("; ")??"unchanged"),
      "Virtual MCP bundles: "+(desiredVirtualMcps?.map(c=>c.name).join(", ")??"unchanged"),
      "Would configure repository Virtual Key, OMP MCP configuration and optionally matching Skills",
    ]));return;
  }
  console.log("Operation: May change Bifrost Virtual Key grants and repository MCP settings");
  const vk = await upsertRepoVirtualKey({
    state,
    repo,
    clients,
    url,
    managementKey,
    rotateExisting: flags["rotate-existing"] === true,
  });
  if (flags["no-mcp-instructions"]) {
    updateRepoState(state, repo.id, { mcpInstructions: false });
  }
  if (virtualMcpFlagPresent) {
    await syncVirtualMcpAssignments({
      url,
      managementAuth: managementKey,
      virtualKeyId: vk.id,
      desired: desiredVirtualMcps,
      available: availableVirtualMcps,
    });
    updateRepoState(state, repo.id, { virtualMcps: desiredVirtualMcps.map((item) => item.name) });
  }

  const instructionSetting = state.config.repos?.[repo.id]?.mcpInstructions;
  const file = writeRepoMcpConfig(
    repo.root,
    url,
    repo.id,
    typeof instructionSetting === "boolean" ? { instructions: instructionSetting } : {},
  );
  const refreshed = loadState();
  const secret = refreshed.secrets.repos?.[repo.id]?.mcpVirtualKey;
  if (!secret) throw new Error("Repo MCP Virtual Key was not persisted");
  const test = await testMcp(url, secret);
  const configuredClients = refreshed.config.repos?.[repo.id]?.mcpClients ?? [];
  const configuredVirtualMcps = refreshed.config.repos?.[repo.id]?.virtualMcps ?? [];

  printHeader(`Repo configured: ${repo.name}`);
  console.log(`Repo id:          ${repo.id}`);
  console.log(`Virtual Key:      ${vk.name ?? refreshed.config.repos?.[repo.id]?.virtualKeyName}`);
  console.log(`Virtual Key id:   ${vk.id}`);
  console.log(`MCP clients:      ${configuredClients.map((client) => `${client.name}[${client.tools.join(",")}]`).join(", ") || "none"}`);
  console.log(`Virtual MCPs:     ${configuredVirtualMcps.join(", ") || "none"}`);
  console.log(`OMP MCP config:   ${file.path}`);
  const instructions = repoMcpInstructions(repo.root);
  console.log(`MCP instructions: ${instructions === false ? "disabled" : instructions === true ? "enabled (explicit)" : "enabled (OMP default)"}`);
  console.log(`MCP initialize:   HTTP ${test.status}${test.ok ? " OK" : " FAIL"}`);
  if (!test.ok) {
    console.log(JSON.stringify(test.body));
    process.exitCode = 2;
  } else {
    // Explicit selection means the user is choosing this MCP, even if its
    // Virtual Key grant existed before Pifrost supported Skill discovery.
    // offerMatchingMcpSkills skips installed, dismissed and incompatible Skills.
    const selectedDirect = clients
      ? available.filter((item) =>
          clients.some((selected) => selected.name.toLowerCase() === item.name.toLowerCase()) &&
          configuredClients.some((assigned) => assigned.name.toLowerCase() === item.name.toLowerCase()))
      : [];
    const selectedVirtual = clientsForVirtualMcps(desiredVirtualMcps ?? [], available);
    await offerMatchingMcpSkills([...selectedDirect, ...selectedVirtual], flags);
  }
}

async function commandRepoStatus(snapshot, options = {}) {
  const state = loadState();
  const runtime = requireRuntime(state);
  const repoState = currentRepoState(state);
  if (!options.verbose) {
    const mcpPath = join(repoState.repo.root, ".omp/mcp.json");
    const grants = repoState.config?.mcpClients ?? [];
    const bundles = repoState.config?.virtualMcps ?? [];
    const skills = configuredSkillRows(repoState);
    if(!options.json) printHeader(`Repository: ${repoState.repo.name}`);
    const checks = [
      {status:repoState.config?.virtualKeyId && repoState.secret?.mcpVirtualKey ? "ok" : "warn",
       label:"Repository Virtual Key", detail:repoState.secret?.mcpVirtualKey ? "Saved locally (value hidden)" : "Missing"},
      {status:existsSync(mcpPath) ? "ok" : "warn", label:"OMP MCP configuration",
       detail:existsSync(mcpPath) ? "File present" : "Missing"},
    ];
    const result=reportHealth({command:"repo status",checks:checks.map((check,i)=>({
      id:i===0?"repo-key":"omp-mcp-config",...check,required:false,
      action:"pifrost repo init"
    })),strict:options.strict,json:options.json});
    if(options.json){if(result.exitCode)process.exitCode=result.exitCode;return;}
    for (const item of result.checks) console.log(terminalStatus(item.status, item.label, item.detail));
    console.log(terminalField("Direct MCP clients configured", grants.length));
    console.log(terminalField("Virtual MCP bundles configured", bundles.length));
    console.log(terminalField("Bifrost Skills configured", skills.length));
    console.log("These are saved settings, not live permission or tool-execution checks.");
    const actions = [];
    if (!repoState.config?.virtualKeyId || !repoState.secret?.mcpVirtualKey || !existsSync(mcpPath)) {
      actions.push("pifrost repo init");
      if(options.strict)process.exitCode=2;
    }
    actions.push("pifrost repo status --verbose");
    console.log(terminalNextSteps(actions));
    return;
  }
  printHeader(`Repo Pifrost status: ${repoState.repo.name}`);
  console.log(`Repo id:          ${repoState.repo.id}`);
  console.log(`Virtual Key id:   ${repoState.config?.virtualKeyId ?? "missing"}`);
  console.log(`Virtual Key name: ${repoState.config?.virtualKeyName ?? "missing"}`);
  console.log(`Repo secret:      ${repoState.secret?.mcpVirtualKey ? "set" : "missing"}`);
  console.log(`MCP config:       ${join(repoState.repo.root, ".omp/mcp.json")}${existsSync(join(repoState.repo.root, ".omp/mcp.json")) ? "" : " (missing)"}`);
  const instructions = repoMcpInstructions(repoState.repo.root);
  console.log(`MCP instructions: ${instructions === false ? "disabled" : instructions === true ? "enabled (explicit)" : "enabled (OMP default)"}`);
  if (
    typeof repoState.config?.mcpInstructions === "boolean" &&
    instructions !== undefined &&
    repoState.config.mcpInstructions !== instructions
  ) {
    console.log(`  WARN stored MCP-instructions policy (${repoState.config.mcpInstructions ? "on" : "off"}) differs from .omp/mcp.json`);
  }
  if (repoState.secret?.mcpVirtualKey) {
    try {
      const test = await testMcp(runtime.url, repoState.secret.mcpVirtualKey);
      console.log(`MCP initialize:   HTTP ${test.status}${test.ok ? " OK" : " FAIL"}`);
      if (!test.ok) console.log(`MCP response:     ${JSON.stringify(test.body)}`);
    } catch (error) {
      console.log(`MCP initialize:   FAIL (${formatError(error)})`);
    }
  }
  console.log(
    `Direct MCP grants: ${(repoState.config?.mcpClients ?? []).map((client) => `${client.name}[${client.tools.join(",")}]`).join(", ") || "none"}`,
  );
  console.log(`Virtual MCPs:     ${(repoState.config?.virtualMcps ?? []).join(", ") || "none"}`);
  const configuredSkills = configuredSkillRows(repoState);
  const skillStatus = repoBifrostSkillStatus(repoState.repo.root, configuredSkills);
  console.log(`Bifrost Skills:   ${configuredSkills.map((item) => item.name).join(", ") || "none"}`);
  for (const skill of skillStatus) {
    const version = skill.installedVersion ?? skill.version ?? "unknown";
    console.log(`  ${skill.name}@${version}: ${skill.state} integrity=${skill.integrity} source=Bifrost -> .agents/skills`);
  }

  const managementAuth = managementAuthFromState(state);
  if (runtime.url && managementAuth && repoState.config?.virtualKeyId) {
    try {
      const [vk, virtualMcps, clients] = await Promise.all([
        getVirtualKey(runtime.url, managementAuth, repoState.config.virtualKeyId),
        snapshot?.virtualMcps?.ok
          ? Promise.resolve(snapshot.virtualMcps.value)
          : listVirtualMcps(runtime.url, managementAuth),
        snapshot?.mcpClients?.ok
          ? Promise.resolve(snapshot.mcpClients.value)
          : listMcpClients(runtime.url, managementAuth),
      ]);
      const policy = effectiveRepoMcpPolicy(vk, virtualMcps, clients);
      const active = clients.filter((item) => policy.effective.some((entry) =>
        entry.client.toLowerCase() === item.name.toLowerCase()));
      const drift = mcpSkillDrift(repoState.config?.mcpSkillDiscovery, active, [],
        skillStatus.filter((item) => item.state === "installed").map((item) => item.name));
      for (const finding of drift) {
        console.log(`  WARN MCP/Skill drift: ${finding.type} client=${finding.clientName} skill=${finding.skillName}`);
      }
      try {
        const skills = snapshot?.skills?.ok ? snapshot.skills.value
          : await listBifrostSkills(runtime.url, managementAuth);
        for (const match of discoverMcpSkillMatches(active, skills,
          repoState.config?.mcpSkillDiscovery)) {
          if (match.status !== "matched") continue;
          const local = repoBifrostSkillStatus(repoState.repo.root, [{ name: match.skill.name }])[0];
          const compatibility = bifrostSkillCompatibility(match.skill.raw);
          if (!compatibility.compatible) {
            console.log(`  WARN MCP Skill ${match.client.name}/${match.skill.name}: ${compatibility.reason}`);
          } else if (local.state !== "installed") {
            console.log(`  AVAILABLE MCP Skill ${match.client.name} -> ${match.skill.name}: not installed (${local.state}); use pifrost repo skills suggestions`);
          } else if (local.installedVersion !== match.skill.version) {
            console.log(`  UPDATE MCP Skill ${match.skill.name}: installed=${local.installedVersion ?? "unknown"} upstream=${match.skill.version}`);
          }
        }
      } catch (error) {
        console.log(`  MCP Skill suggestions: unavailable (${formatError(error)})`);
      }
      let liveTools;
      let liveToolsError;
      if (repoState.secret?.mcpVirtualKey) {
        try {
          liveTools = await listMcpGatewayTools(runtime.url, repoState.secret.mcpVirtualKey);
        } catch (error) {
          liveToolsError = formatError(error);
        }
      }
      const researchConfig = repoState.config?.research ?? {};
      let codeModeProbes;
      const codeClients = eligibleResearchCodeModeClients(policy, clients, researchConfig);
      if (codeClients.length && liveTools && repoState.secret?.mcpVirtualKey) {
        try {
          codeModeProbes = await probeResearchCodeMode(
            (toolName, args) => callMcpGatewayTool(runtime.url, repoState.secret.mcpVirtualKey, toolName, args),
            codeClients,
          );
        } catch (error) {
          codeModeProbes = Object.fromEntries(codeClients.map((client) => [
            client.id ?? client.name, { ok: false, error: formatError(error), tools: [] },
          ]));
        }
      }
      const ompSearch = ompWebSearchDiagnostics();
      const research = researchProviderDiagnostics(policy, clients, {
        research: researchConfig,
        ...(liveTools ? { liveTools } : {}),
        ...(codeModeProbes ? { codeModeProbes } : {}),
        ompSearch,
      });
      const liveVirtual = policy.virtualMcps.map((item) => `${item.name}${item.enabled ? "" : " (disabled)"}`);
      console.log(`Live Virtual MCPs:${liveVirtual.length ? ` ${liveVirtual.join(", ")}` : " none"}`);
      if (policy.effective.length) {
        console.log("Effective MCP tools:");
        for (const grant of policy.effective) {
          console.log(`  ${grant.client}[${grant.tools.join(",")}] via ${grant.sources.join("+")}`);
        }
      } else {
        console.log("Effective MCP tools: none");
      }
      if (policy.effective.length) {
        console.log("Effective MCP authorization:");
        for (const grant of policy.effective) {
          const client = clients.find((candidate) =>
            candidate.name.toLowerCase() === grant.client.toLowerCase() ||
            candidate.id?.toLowerCase() === grant.client.toLowerCase()
          );
          if (!client) {
            console.log(`  ${grant.client}: policy unavailable (management client not resolved)`);
            continue;
          }
          const execution = mcpClientExecutionDiagnostics(client, grant.tools);
          const executableCount = execution.executePolicyKnown ? execution.executableCount : "unknown";
          const autoCount = execution.autoPolicyKnown ? execution.autoExecutableCount : "unknown";
          console.log(
            `  ${client.name}: granted=${execution.grantedCount} executable=${executableCount} auto=${autoCount}` +
              (client.openApiSource ? " source=OpenAPI-MCP (Bifrost-admin)" : "") +
              (client.isCodeModeClient ? " discovery=Code Mode (gateway-owned)" : ""),
          );
          for (const row of execution.rows) {
            const executable = row.executable === undefined ? "unknown" : row.executable ? "yes" : "no";
            const auto = row.autoExecutable === undefined ? "unknown" : row.autoExecutable ? "yes" : "no";
            console.log(
              `    ${row.tool}: granted=yes executable=${executable} auto=${auto}`,
            );
          }
          for (const warning of execution.warnings) console.log(`    WARN ${warning}`);
          if(execution.unsafeAutoExecuteCount) console.log(`    MCP retry safety: ${execution.unsafeAutoExecuteCount} approval-free tool(s) require upstream replay-safety review; Pifrost did not alter grants`);
        }
      }
      for (const item of policy.unresolved) {
        console.log(`  WARN ${item.client}[${item.tools.join(",")}] via ${item.sources.join("+")}: ${item.reason}`);
      }
      console.log("Web research backends:");
      console.log(`  Preferred:        ${research.preferred ?? "none"} (guidance only; OMP selects tools)`);
      for (const provider of research.providers) {
        console.log(`  MCP/${provider.client}: ${provider.status} mode=${provider.mode ?? "unknown"} profile=${provider.profile}`);
        if (provider.capabilities) for (const [name, cap] of Object.entries(provider.capabilities)) {
          if (!cap.tool) continue;
          const visible = cap.visible === undefined ? "unverified" : cap.visible ? "yes" : "no";
          console.log(`    ${name.padEnd(10)} tool=${cap.tool} grant=${cap.granted ? "yes" : "no"} executable=${cap.executable === undefined ? "unknown" : cap.executable ? "yes" : "no"} visible=${visible}${cap.gatewayName ? " gateway=" + cap.gatewayName : cap.visibilityReason ? " reason=" + cap.visibilityReason : ""}`);
        }
        if (provider.statefulHandles) console.log("    NOTE search handles require affinity to the same upstream MCP process; use full URLs across instances.");
        if (provider.screenshotCallable) console.log(`    visual web:     ${provider.visualWebStatus}`);
        if (provider.mode === "code" && codeModeProbes?.[provider.clientId ?? provider.client]?.error) {
          console.log(`    WARN ${codeModeProbes[provider.clientId ?? provider.client].error}`);
        }
        for (const warning of provider.warnings ?? []) console.log(`    WARN ${warning}`);
      }
      console.log(`  OMP native web:   ${ompSearch.available ? ompSearch.source : `${ompSearch.status}: ${ompSearch.source}`}`);
      console.log(`  Search path:      ${research.search.path}`);
      if (liveToolsError) console.log(`    gateway tools/list: unavailable (${liveToolsError})`);
      console.log("    MCP providers execute through Bifrost; preference does not rewrite runtime tool calls.");
      if (liveTools) {
        const surface = mcpToolSurfaceDiagnostics(liveTools);
        console.log("MCP tool presentation:");
        console.log(`  gateway-visible:  ${surface.visibleTools}`);
        console.log(`  OMP default mode: ${surface.ompDefaultLoadMode} (${surface.discoverableTools} MCP tools)`);
        console.log(`  schema footprint: ~${surface.estimatedSchemaTokens} tokens if eagerly serialized (${surface.schemaBytes} bytes)`);
        console.log(`  wire deferral:    ${surface.providerDeferral}; discoverable is not the same as provider defer_loading`);
      }
      const assignedNames = new Set(policy.virtualMcps.map((item) => item.name));
      for (const item of virtualMcps.filter((entry) => assignedNames.has(entry.name))) {
        console.log(`  VMCP instructions: ${item.name} mode=${item.instructionsMode ?? "append"} text=${item.instructions ? "set" : "none"}`);
      }
    } catch (error) {
      console.log(`Effective MCP policy: unavailable (${formatError(error)})`);
    }
  }

  if (runtime.url && managementAuth && configuredSkills.length) {
    try {
      const availableSkills = snapshot?.skills?.ok
        ? snapshot.skills.value
        : await listBifrostSkills(runtime.url, managementAuth);
      const liveByName = new Map(availableSkills.map((item) => [item.name.toLowerCase(), item]));
      for (const link of normalizeMcpSkillDiscovery(repoState.config?.mcpSkillDiscovery).links) {
        const byId = availableSkills.find((item) => item.id === link.skillId);
        if (byId && byId.name.toLowerCase() !== link.skillName.toLowerCase()) {
          console.log(`  WARN Bifrost Skill renamed: ${link.skillName} -> ${byId.name} (id=${link.skillId}); manual review required`);
        } else if (!byId) {
          console.log(`  WARN Bifrost Skill id missing: ${link.skillName} (id=${link.skillId})`);
        }
      }
      console.log("Bifrost Skill provenance:");
      for (const localSkill of skillStatus) {
        const live = liveByName.get(localSkill.name.toLowerCase());
        if (!live) {
          console.log(`  ${localSkill.name}: unavailable upstream installed=${localSkill.installedVersion ?? "missing"}`);
          continue;
        }
        const compatibility = bifrostSkillCompatibility(live.raw);
        const update = localSkill.installedVersion && localSkill.installedVersion !== live.version ? ` update-available=${live.version}` : "";
        const incompatible = compatibility.compatible ? "" : ` incompatible=${compatibility.reason}`;
        const sourceDrift = localSkill.bifrostSkillId && localSkill.bifrostSkillId !== live.id
          ? ` WARN-source-id-changed=${localSkill.bifrostSkillId}->${live.id}` : "";
        console.log(`  ${live.name}: upstream=${live.version} installed=${localSkill.installedVersion ?? "missing"} id=${live.id}${update}${incompatible}${sourceDrift}`);
      }
    } catch (error) {
      console.log(`Bifrost Skill provenance: unavailable (${formatError(error)})`);
    }
  }
}

function configuredSkillRows(current) {
  return normalizeConfiguredBifrostSkills(current.config?.bifrostSkills);
}

function upsertConfiguredSkill(state, repoId, skill) {
  const current = normalizeConfiguredBifrostSkills(state.config.repos?.[repoId]?.bifrostSkills);
  const next = current.filter((item) => item.name.toLowerCase() !== skill.name.toLowerCase());
  next.push({ name: skill.name, version: skill.version, id: skill.id });
  next.sort((a, b) => a.name.localeCompare(b.name));
  updateRepoState(state, repoId, { bifrostSkills: next });
}

async function installRepoBifrostSkill(state, current, summary, options = {}) {
  const runtime = requireRuntime(state);
  const managementAuth = managementAuthFromState(state);
  if (!managementAuth) throw new Error("Bifrost management authentication is missing; run `pifrost global setup`");
  const bundle = await fetchBifrostSkillBundle(runtime.url, managementAuth, summary);
  if (options.expectedId && (bundle.skill.id !== options.expectedId ||
      bundle.skill.name.toLowerCase() !== summary.name.toLowerCase())) {
    throw new Error("Bifrost Skill identity changed during discovery; retry");
  }
  const installed = await installBifrostSkillBundle(current.repo.root, bundle, {
    allowModifiedReplace: options.force === true, allowSourceRebind: options.force === true,
  });
  upsertConfiguredSkill(state, current.repo.id, bundle.skill);
  return { bundle, installed };
}

/**
 * Post-grant advisory step. Never changes Bifrost policy, never fails a
 * successfully configured MCP, and never prompts in a noninteractive shell.
 * All writes reuse the existing Skills bridge.
 */
async function offerMatchingMcpSkills(selectedClients, flags = {}) {
  if (!selectedClients.length || flags["no-skill-discovery"] === true) return;
  try {
    const state = loadState();
    const { url, managementKey } = requireManagement(state);
    const current = currentRepoState(state);
    const skills = await listBifrostSkills(url, managementKey);
    const config = normalizeMcpSkillDiscovery(current.config?.mcpSkillDiscovery);
    const matches = discoverMcpSkillMatches(selectedClients, skills, config);
    for (const candidate of matches) {
      if (candidate.status === "missing" || candidate.status === "dismissed") continue;
      if (candidate.status !== "matched") {
        console.log(`WARN MCP ${candidate.client.name}: Skill matching ${candidate.status}; no installation`);
        continue;
      }
      const { client, skill } = candidate;
      const compat = bifrostSkillCompatibility(skill.raw);
      if (!compat.compatible) {
        console.log(`WARN MCP ${client.name}: matching Skill ${skill.name} incompatible: ${compat.reason}`);
        continue;
      }
      const status = repoBifrostSkillStatus(current.repo.root, [{ name: skill.name, id: skill.id }])[0];
      if (status.state === "installed") {
        if (status.integrity === "modified") {
          console.log(`WARN Skill ${skill.name} is locally modified; no automatic overwrite`);
        } else if (status.installedVersion !== skill.version) {
          console.log(`Skill ${skill.name} update available ${status.installedVersion} -> ${skill.version}; run pifrost repo skills sync ${skill.name}`);
        }
        continue;
      }
      if (status.state === "collision") {
        console.log(`WARN Skill ${skill.name} already exists without Pifrost ownership; no overwrite`);
        continue;
      }
      const collisions = findOmpSkillCollisions(current.repo.root, skill.name);
      if (collisions.length) {
        console.log(`WARN Skill ${skill.name} conflicts with ${collisions.join(", ")}; no install`);
        continue;
      }
      console.log(`Matching Bifrost Skill: ${skill.name}@${skill.version} for MCP ${client.name} (${candidate.matchedBy})`);
      if (skill.description) console.log(`  ${skill.description.slice(0, 240)}`);
      console.log(`  Bifrost Skill id=${skill.id} files=${skill.fileCount} version=${skill.version}`);
      if (skill.raw?.license) console.log(`  License: ${String(skill.raw.license).slice(0, 120)}`);
      console.log(`  Project location: .agents/skills/${skill.name}; no MCP grants change`);
      let choice = flags["install-matching-skills"] === true ? "y" : "n";
      if(flags["install-matching-skills"] !== true){
        console.log("  Read-only suggestion; use pifrost repo skills add "+skill.name+" to install.");
      }
      if (choice === "d") {
        const latest = normalizeMcpSkillDiscovery(loadState().config.repos?.[current.repo.id]?.mcpSkillDiscovery);
        updateRepoState(loadState(), current.repo.id, {
          mcpSkillDiscovery: setMcpSkillDismissal(latest, client, skill),
        });
        console.log(`Dismissed Skill suggestion for ${client.name}; undo with pifrost repo skills undismiss ${client.name}`);
      } else if (choice === "y" || choice === "yes") {
        try {
          const refreshed = loadState();
          const currentRepo = currentRepoState(refreshed);
          const { bundle, installed } = await installRepoBifrostSkill(refreshed, currentRepo, skill,
            { expectedId: skill.id });
          const afterInstall = loadState();
          const latestConfig = afterInstall.config.repos?.[current.repo.id]?.mcpSkillDiscovery;
          updateRepoState(afterInstall, current.repo.id, {
            mcpSkillDiscovery: recordMcpSkillLink(latestConfig, client, bundle.skill),
          });
          console.log(`Installed ${bundle.skill.name}@${bundle.skill.version} -> ${installed.path}`);
        } catch (error) {
          console.log(`WARN MCP ${client.name} configured, but Skill installation failed: ${formatError(error)}`);
        }
      }
    }
  } catch (error) {
    console.log(`WARN Optional MCP Skill discovery unavailable: ${formatError(error)}`);
  }
}

async function commandRepoSkillsList(flags = {}) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const available = await listBifrostSkills(url, managementKey);
  const configured = new Map(configuredSkillRows(current).map((item) => [item.name.toLowerCase(), item]));
  const local = new Map(
    repoBifrostSkillStatus(current.repo.root, [...configured.values()])
      .map((item) => [item.name.toLowerCase(), item]),
  );
  printHeader(`Bifrost Skills (${available.length})`);
  const shown=listFilter(available.sort((a,b)=>a.name.localeCompare(b.name)),flags);
  console.log("Showing "+shown.items.length+" of "+shown.total+" matching Skills");
  for (const skill of shown.items) {
    const selected = configured.get(skill.name.toLowerCase());
    const status = local.get(skill.name.toLowerCase());
    const compatibility = bifrostSkillCompatibility(skill.raw);
    const flags = [
      selected ? "selected" : undefined,
      status?.state,
      status?.integrity === "modified" ? "local-modifications" : undefined,
      status?.integrity === "unverified" ? "legacy-unverified" : undefined,
      status?.installedVersion && status.installedVersion !== skill.version
        ? `update=${status.installedVersion}->${skill.version}`
        : undefined,
      compatibility.compatible ? undefined : `incompatible=${compatibility.reason}`,
    ].filter(Boolean);
    console.log(`${skill.name}  version=${skill.version}  files=${skill.fileCount}${flags.length ? `  ${flags.join("  ")}` : ""}`);
    if (skill.description) console.log(`  ${skill.description}`);
  }
  if (!available.length) console.log("No Bifrost skills are currently published.");
}

async function commandRepoSkillsAdd(name, flags = {}) {
  if (!name) throw new Error("Usage: pifrost repo skills add <name>");
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const [summary] = resolveBifrostSkillNames(await listBifrostSkills(url, managementKey), [name]);
  const compatibility = bifrostSkillCompatibility(summary.raw);
  if (!compatibility.compatible) {
    throw new Error(`Bifrost skill ${summary.name} is not safely representable in OMP: ${compatibility.reason}`);
  }
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Would install Skill "+summary.name+"@"+summary.version,
      flags.force?"May overwrite locally modified managed files":"Would preserve locally modified managed files"
    ]));return;
  }
  const { bundle, installed } = await installRepoBifrostSkill(state, current, summary, { force: flags.force === true });
  console.log(`Installed Bifrost skill ${bundle.skill.name}@${bundle.skill.version}`);
  console.log(`OMP project skill: ${installed.path}`);
}

async function commandRepoSkillsRemove(name, flags = {}) {
  if (!name) throw new Error("Usage: pifrost repo skills remove <name>");
  const state = loadState();
  const current = currentRepoState(state);
  const configured = configuredSkillRows(current);
  const found = configured.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`Bifrost skill is not configured for this repo: ${name}`);
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Would remove managed Skill "+found.name+" from this repository",
      "Would remove its local discovery link; upstream Skill remains unchanged"
    ]));return;
  }
  const removed = removeManagedBifrostSkill(current.repo.root, found.name, { force: flags.force === true });
  const next = configured.filter((item) => item.name.toLowerCase() !== found.name.toLowerCase());
  updateRepoState(state, current.repo.id, { bifrostSkills: next,
    mcpSkillDiscovery: withoutMcpSkillLinks(current.config?.mcpSkillDiscovery, found.name) });
  console.log(`Removed Bifrost skill ${found.name}${removed.alreadyMissing ? " (managed directory was already missing)" : ""}.`);
}

async function commandRepoSkillsSync(name, flags = {}) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const configured = configuredSkillRows(current);
  const wanted = name
    ? configured.filter((item) => item.name.toLowerCase() === name.toLowerCase())
    : configured;
  if (!wanted.length) {
    throw new Error(name
      ? `Bifrost skill is not configured for this repo: ${name}`
      : "No Bifrost skills are configured for this repo; use `pifrost repo skills add <name>`");
  }
  const available = await listBifrostSkills(url, managementKey);
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      ...wanted.map(item=>"Would inspect/synchronise "+item.name),
      flags.force?"May overwrite local modified managed files":"Modified managed files would be preserved"
    ]));return;
  }
  for (const summary of resolveBifrostSkillNames(available, wanted.map((item) => item.name))) {
    const compatibility = bifrostSkillCompatibility(summary.raw);
    if (!compatibility.compatible) {
      throw new Error(`Bifrost skill ${summary.name} is not safely representable in OMP: ${compatibility.reason}`);
    }
    const { bundle, installed } = await installRepoBifrostSkill(state, current, summary, { force: flags.force === true });
    console.log(`Synced ${bundle.skill.name}@${bundle.skill.version} -> ${installed.path}`);
  }
}


function findMcpClientOrThrow(clients, name) {
  const found = clients.find((item) => item.name.toLowerCase() === String(name ?? "").toLowerCase());
  if (!found) throw new Error(`Unknown Bifrost MCP client: ${name}`);
  return found;
}

async function currentRepoSkillDiscovery() {
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const [clients, virtualMcps, skills] = await Promise.all([
    listMcpClients(url, managementKey), listVirtualMcps(url, managementKey),
    listBifrostSkills(url, managementKey),
  ]);
  const policy = effectiveRepoMcpPolicy(vk, virtualMcps, clients);
  const active = clients.filter((client) => policy.effective.some((grant) =>
    grant.client.toLowerCase() === client.name.toLowerCase()));
  return { state, current, active, clients, skills };
}

async function commandRepoSkillSuggestions(flags = {}) {
  const { current, active, skills } = await currentRepoSkillDiscovery();
  const matches = discoverMcpSkillMatches(active, skills, current.config?.mcpSkillDiscovery);
  printHeader("MCP-matched Bifrost Skill suggestions");
  if (!matches.length) console.log("No assigned MCP clients.");
  for (const candidate of matches) {
    const skill = candidate.skill;
    const status = skill
      ? repoBifrostSkillStatus(current.repo.root, [{ name: skill.name }])[0]
      : undefined;
    const compat = skill ? bifrostSkillCompatibility(skill.raw) : undefined;
    console.log(`  ${candidate.client.name} -> ${skill?.name ?? candidate.matchedName ?? "none"}: ${candidate.status}` +
      (status ? ` local=${status.state} integrity=${status.integrity}` : "") +
      (compat && !compat.compatible ? ` incompatible=${compat.reason}` : "") +
      (status?.installedVersion && skill?.version !== status.installedVersion ? ` update=${skill.version}` : ""));
  }
  if(flags["install-matching-skills"]) await offerMatchingMcpSkills(active, flags);
  else console.log("Read-only suggestions. To install, use pifrost repo skills add <name> or explicitly --install-matching-skills.");
}

async function commandRepoSkillBind(clientName, skillName, flags = {}) {
  if (!clientName || !skillName) throw new Error("Usage: pifrost repo skills bind <client> <skill>");
  const { state, current, active, skills } = await currentRepoSkillDiscovery();
  const client = findMcpClientOrThrow(active, clientName);
  const [skill] = resolveBifrostSkillNames(skills, [skillName]);
  updateRepoState(state, current.repo.id, {
    mcpSkillDiscovery: setMcpSkillAlias(current.config?.mcpSkillDiscovery, client, skill.name),
  });
  console.log(`Bound ${client.name} -> ${skill.name} for repository Skill discovery; no grants changed.`);
  if(flags["install-matching-skills"]) await offerMatchingMcpSkills([client], flags);
  else console.log("Skill binding saved. No Skill was installed.");
}

async function commandRepoSkillUnbind(clientName) {
  if (!clientName) throw new Error("Usage: pifrost repo skills unbind <client>");
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const client = findMcpClientOrThrow(await listMcpClients(url, managementKey), clientName);
  updateRepoState(state, current.repo.id, {
    mcpSkillDiscovery: setMcpSkillAlias(current.config?.mcpSkillDiscovery, client, undefined),
  });
  console.log(`Cleared Skill alias for ${client.name}; installed Skills are unchanged.`);
}

async function commandRepoSkillDismiss(clientName, dismissed) {
  if (!clientName) throw new Error("Usage: pifrost repo skills dismiss|undismiss <client>");
  const { state, current, active, skills } = await currentRepoSkillDiscovery();
  const client = findMcpClientOrThrow(active, clientName);
  const [matched] = discoverMcpSkillMatches([client], skills, current.config?.mcpSkillDiscovery);
  if (!matched?.skill) throw new Error(`No uniquely matching Bifrost Skill for MCP ${client.name}`);
  updateRepoState(state, current.repo.id, {
    mcpSkillDiscovery: setMcpSkillDismissal(
      current.config?.mcpSkillDiscovery, client, matched.skill, dismissed),
  });
  console.log(`${dismissed ? "Dismissed" : "Restored"} suggestion for ${client.name} -> ${matched.skill.name}`);
}

async function commandRepoMcpList(flags = {}) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const clients = await listMcpClients(url, managementKey);
  printHeader(`Bifrost MCP clients (${clients.length})`);
  const shown=listFilter(clients.sort((a,b)=>a.name.localeCompare(b.name)),flags);
  console.log("Showing "+shown.items.length+" of "+shown.total+" matching MCP clients");
  for (const client of shown.items) {
    const modes = [
      client.isCodeModeClient ? "code-mode (gateway discovery)" : undefined,
      client.openApiSource ? "openapi-mcp (gateway registered)" : undefined,
      client.toolsToAutoExecute?.length ? "agent-mode" : undefined,
      client.authType ? `auth=${client.authType}` : undefined,
      client.connectionType ? `transport=${client.connectionType}` : undefined,
      client.needsSessionStickiness === true ? "sticky" : undefined,
      Number.isFinite(client.maxInstructionsLength) && client.maxInstructionsLength > 0 ? `instructions<=${client.maxInstructionsLength}B` : undefined,
    ].filter(Boolean);
    console.log(`${client.name}  state=${client.state ?? "unknown"}  tools=${client.tools.length || "unknown"}${modes.length ? `  ${modes.join(" ")}` : ""}`);
    if (client.endpointSlug) console.log(`  endpoint=/mcp/${client.endpointSlug}`);
    console.log(`  execute allow: ${client.toolsToExecuteKnown === false ? "unknown" : client.toolsToExecute?.length ? client.toolsToExecute.join(", ") : "none"}`);
    console.log(`  auto-execute: ${client.toolsToAutoExecuteKnown === false ? "unknown" : client.toolsToAutoExecute?.length ? client.toolsToAutoExecute.join(", ") : "none"}`);
    for (const warning of mcpClientExecutionDiagnostics(client, ["*"]).warnings) console.log(`  WARN ${warning}`);
    if (client.serverInstructions) console.log(`  upstream instructions: set (${Buffer.byteLength(client.serverInstructions, "utf8")}B)`);
    if (client.tools.length) console.log(`  tools: ${client.tools.join(", ")}`);
  }
}

async function requireRepoVirtualKey(state) {
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  if (!current.config?.virtualKeyId) throw new Error("Current repo is not initialized; run `pifrost repo init`");
  const vk = await getVirtualKey(url, managementKey, current.config.virtualKeyId);
  return { url, managementKey, current, vk };
}

async function commandRepoVirtualMcpList(flags = {}) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const virtualMcps = await listVirtualMcps(url, managementKey);
  const assigned = new Set(
    current.config?.virtualKeyId
      ? virtualMcpsForVirtualKey(virtualMcps, current.config.virtualKeyId).map((item) => Number(item.id))
      : [],
  );
  printHeader(`Bifrost Virtual MCPs (${virtualMcps.length})`);
  const shown=listFilter(virtualMcps.sort((a,b)=>a.name.localeCompare(b.name)),flags);
  console.log("Showing "+shown.items.length+" of "+shown.total+" matching Virtual MCP bundles");
  for (const item of shown.items) {
    const flags = [
      assigned.has(Number(item.id)) ? "assigned" : undefined,
      item.enabled ? undefined : "disabled",
      item.endpointSlug ? `/mcp/${item.endpointSlug}` : undefined,
    ].filter(Boolean);
    const toolCount = item.tools.reduce((sum, spec) => sum + (spec.toolNames.includes("*") ? 1 : spec.toolNames.length), 0);
    console.log(`${item.name}  tools=${toolCount}${flags.length ? `  ${flags.join(" ")}` : ""}  instructions=${item.instructions ? "set" : "none"} mode=${item.instructionsMode ?? "append"}`);
  }
}

async function commandRepoVirtualMcpAdd(name, flags = {}) {
  if (!name) throw new Error("Usage: pifrost repo vmcp add <name>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const available = await listVirtualMcps(url, managementKey);
  const [found] = resolveVirtualMcpNames(available, [name]);
  const alreadyAssigned = virtualMcpsForVirtualKey(available, vk.id)
    .some((item) => Number(item.id) === Number(found.id));
  if(flags["dry-run"]){console.log(operationSummary("Read-only preview",[
    "Would attach Virtual MCP bundle "+found.name+" to the repository key",
    "Inherited tools are governed by Bifrost bundle settings"
  ]));return;}
  await attachVirtualMcpToVirtualKey(url, managementKey, found.id, vk.id);
  const liveNames = [...new Set([
    ...virtualMcpsForVirtualKey(available, vk.id).map((item) => item.name),
    found.name,
  ])];
  updateRepoState(state, current.repo.id, { virtualMcps: liveNames });
  console.log(`Added Virtual MCP ${found.name} to ${current.config.virtualKeyName}`);
  if (!alreadyAssigned) {
    const clients = await listMcpClients(url, managementKey);
    await offerMatchingMcpSkills(clientsForVirtualMcps([found], clients), flags);
  }
}

async function commandRepoVirtualMcpRemove(name, flags = {}) {
  if (!name) throw new Error("Usage: pifrost repo vmcp remove <name>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const available = await listVirtualMcps(url, managementKey);
  const [found] = resolveVirtualMcpNames(available, [name]);
  if(flags["dry-run"]){console.log(operationSummary("Read-only preview",[
    "Would detach Virtual MCP bundle "+found.name,
    "Direct MCP grants and other bundles remain intact"
  ]));return;}
  await detachVirtualMcpFromVirtualKey(url, managementKey, found.id, vk.id);
  const liveNames = virtualMcpsForVirtualKey(available, vk.id)
    .filter((item) => Number(item.id) !== Number(found.id))
    .map((item) => item.name);
  updateRepoState(state, current.repo.id, { virtualMcps: liveNames });
  console.log(`Removed Virtual MCP ${found.name} from ${current.config.virtualKeyName}`);
}

async function commandRepoMcpAdd(clientName, flags) {
  if (!clientName) throw new Error("Usage: pifrost repo mcp add <client> [--tools '*|tool1,tool2']");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const available = await listMcpClients(url, managementKey);
  const found = available.find((client) => client.name.toLowerCase() === clientName.toLowerCase());
  if (!found) throw new Error(`Unknown Bifrost MCP client: ${clientName}`);
  const tools = splitCsv(flagString(flags, "tools"));
  if(tools.some(tool=>tool!=="*" && Array.isArray(found.tools) && found.tools.length>0 && !found.tools.includes(tool)))
    throw cliUsageError("A tool is not present in this client's Bifrost inventory; inspect pifrost repo mcp list --filter "+found.name);
  const alreadyAssigned = virtualKeyMcpConfigs(vk)
    .some((item) => item.mcp_client_name.toLowerCase() === found.name.toLowerCase());
  const configs = virtualKeyMcpConfigs(vk).filter((item) => item.mcp_client_name !== found.name);
  if(!tools.length)throw cliUsageError("An explicit --tools value is required; specify named tools or '*' intentionally.");
  console.log(operationSummary(flags["dry-run"]?"Read-only preview":"Changes gateway MCP grants",[
    "Client: "+found.name,
    "New executable tool allow-list: "+tools.join(", "),
    tools.includes("*")?"WARNING: wildcard permits every executable tool for this client":"Grant is limited to named tools",
    "Bifrost continues to enforce its own executable and automatic tool policies",
  ]));
  if(flags["dry-run"])return;
  configs.push({ mcp_client_name: found.name, tools_to_execute: tools });
  const updated = await updateVirtualKey(url, managementKey, vk.id, { mcp_configs: configs });
  const normalized = virtualKeyMcpConfigs(updated).map((item) => ({
    name: item.mcp_client_name,
    tools: item.tools_to_execute,
  }));
  updateRepoState(state, current.repo.id, { mcpClients: normalized });
  console.log(`Added ${found.name} to ${current.config.virtualKeyName} with tools: ${(tools.length ? tools : ["*"]).join(",")}`);
  if (!alreadyAssigned) await offerMatchingMcpSkills([found], flags);
}

async function commandRepoMcpRemove(clientName, flags = {}) {
  if (!clientName) throw new Error("Usage: pifrost repo mcp remove <client>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",["Would remove MCP grant for "+clientName,
      "Other MCP client and Virtual MCP grants are unchanged"]));return;
  }
  const configs = virtualKeyMcpConfigs(vk).filter(
    (item) => item.mcp_client_name.toLowerCase() !== clientName.toLowerCase(),
  );
  const updated = await updateVirtualKey(url, managementKey, vk.id, { mcp_configs: configs });
  const normalized = virtualKeyMcpConfigs(updated).map((item) => ({
    name: item.mcp_client_name,
    tools: item.tools_to_execute,
  }));
  updateRepoState(state, current.repo.id, { mcpClients: normalized });
  console.log(`Removed ${clientName} from ${current.config.virtualKeyName}`);
}

async function commandRepoMcpInstructions(mode, flags = {}) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (!["on", "off", "default"].includes(normalized)) {
    throw new Error("Usage: pifrost repo mcp instructions <on|off|default>");
  }
  const state = loadState();
  const runtime = requireRuntime(state);
  const current = currentRepoState(state);
  if (!current.config?.virtualKeyId) throw new Error("Current repo is not initialized; run `pifrost repo init`");

  if(flags["dry-run"]){console.log(operationSummary("Read-only preview",[
    "Would set OMP MCP server instructions to "+normalized,"Other MCP configuration remains unchanged"
  ]));return;}
  let options;
  if (normalized === "default") {
    delete state.config.repos[current.repo.id].mcpInstructions;
    saveState(state.config, state.secrets);
    options = { instructions: null };
  } else {
    const enabled = normalized === "on";
    updateRepoState(state, current.repo.id, { mcpInstructions: enabled });
    options = { instructions: enabled };
  }

  const file = writeRepoMcpConfig(current.repo.root, runtime.url, current.repo.id, options);
  const effective = repoMcpInstructions(current.repo.root);
  console.log(
    `MCP server instructions for ${current.repo.name}: ${effective === false ? "disabled" : effective === true ? "enabled (explicit)" : "enabled (OMP default)"}`,
  );
  console.log(`Updated: ${file.path}`);
}

async function commandRepoRotateKey(flags = {}) {
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  if(flags["dry-run"]){
    console.log(operationSummary("Read-only preview",[
      "Would rotate repository Virtual Key "+current.repo.name,
      "The old key may stop working after Bifrost's grace period",
      "A new key would be saved to the local secret store; restart OMP"
    ]));return;
  }
  console.log("Operation: Changes Bifrost credentials and locally stored MCP secret");
  const rotated = await rotateVirtualKey(url, managementKey, vk.id);
  const value = rotated?.value;
  if (!value || typeof value !== "string") throw new Error("Bifrost rotate response did not include the new key value");
  updateRepoState(state, current.repo.id, {}, { mcpVirtualKey: value });
  console.log(`Rotated MCP Virtual Key for ${current.repo.name}; local secret store updated.`);
}

async function commandRepoReset(flags = {}) {
  const state = loadState();
  const repo = repoIdentity();
  const repoConfig = state.config.repos?.[repo.id];
  const deleteRemote = flags["delete-remote"] === true;
  const recoverByName = flags["recover-by-name"] === true;
  const yes = flags.yes === true;
  if (recoverByName && !deleteRemote) {
    throw new Error("--recover-by-name is valid only with --delete-remote");
  }
  if (flags["dry-run"]) {
    console.log(operationSummary("Read-only preview", [
      "Repository: "+repo.name,
      "Would remove Pifrost-managed repository state, MCP entry and installed managed Skills",
      deleteRemote?"Would DELETE the remote repository Virtual Key (irreversible)":"Remote Virtual Key would be retained",
      "Other OMP MCP entries remain unchanged",
    ]));
    return;
  }

  if (deleteRemote) {
    const runtime = runtimeConfigFromState(state);
    const managementAuth = managementAuthFromState(state);
    if (!runtime.url) throw new Error("Bifrost URL is missing; run `pifrost global setup`");
    if (!managementAuth) {
      throw new Error("Bifrost management authentication is missing; run `pifrost global setup`");
    }
    const result = await deleteRepoVirtualKeyForReset({
      url: runtime.url,
      managementAuth,
      repo,
      repoConfig,
      recoverByName,
      yes,
      confirm: async ({ name, id }) => {
        const rl = createInterface({ input, output });
        try {
          console.log(`Remote Bifrost Virtual Key: ${name} (${id})`);
          const answer = await rl.question("Type DELETE to permanently remove this Virtual Key: ");
          return answer.trim() === "DELETE";
        } finally {
          rl.close();
        }
      },
    });
    if (result.cancelled) {
      console.log("Reset cancelled; local Pifrost state was not changed.");
      return;
    }
    console.log(
      result.alreadyMissing
        ? `Remote Bifrost Virtual Key ${result.name} is already absent.`
        : `Deleted remote Bifrost Virtual Key ${result.name} (${result.id}).`,
    );
  } else if (!repoConfig) {
    throw new Error("Current repo is not initialized; nothing to reset");
  }

  for (const skill of configuredSkillRows({ config: repoConfig })) {
    removeManagedBifrostSkill(repo.root, skill.name);
  }

  const path = join(repo.root, ".omp/mcp.json");
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.mcpServers?.bifrost) {
      delete parsed.mcpServers.bifrost;
      if (Object.keys(parsed.mcpServers).length === 0) delete parsed.mcpServers;
      const content = `${JSON.stringify(parsed, null, 2)}\n`;
      const fs = await import("node:fs");
      fs.writeFileSync(path, content, { mode: 0o600 });
    }
  }

  removeRepoState(state, repo.id);
  console.log(`Removed local Pifrost repo configuration for ${repo.name}.`);
  if (!deleteRemote) {
    console.log("The Bifrost Virtual Key itself was left intact; re-run repo init to reuse it or delete it explicitly.");
  }
}


async function researchSnapshot(includeLive = false) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  if (!current.config?.virtualKeyId) throw Error("Initialize the current repository first: pifrost repo init");
  const [vk, clients, virtualMcps] = await Promise.all([
    getVirtualKey(url, managementKey, current.config.virtualKeyId),
    listMcpClients(url, managementKey),
    listVirtualMcps(url, managementKey),
  ]);
  const policy = effectiveRepoMcpPolicy(vk, virtualMcps, clients);
  let liveTools, codeModeProbes;
  if (includeLive && current.secret?.mcpVirtualKey) {
    liveTools = await listMcpGatewayTools(url, current.secret.mcpVirtualKey);
    const code = eligibleResearchCodeModeClients(policy, clients, current.config?.research ?? {});
    if (code.length) codeModeProbes = await probeResearchCodeMode(
      (name, args) => callMcpGatewayTool(url, current.secret.mcpVirtualKey, name, args), code);
  }
  return { state, current, url, clients, policy, liveTools, diagnostics: researchProviderDiagnostics(policy, clients, {
    research: current.config?.research ?? {}, liveTools, codeModeProbes, ompSearch: ompWebSearchDiagnostics(),
  }) };
}
async function commandRepoResearchStatus(flags = {}) {
  const { diagnostics } = await researchSnapshot(true);
  printHeader("Bifrost MCP research providers");
  if(!flags.verbose){
    console.log("Preferred (guidance only): "+(diagnostics.preferred??"none"));
    const ready=diagnostics.providers.filter(p=>p.webResearchReady).length;
    console.log("Research-ready: "+ready+" of "+diagnostics.providers.length+" configured/discovered providers");
    for(const provider of diagnostics.providers){
      const state=provider.webResearchReady?"READY":provider.authorized?"PARTIAL":"UNVERIFIED";
      console.log("  ["+state+"] "+provider.id+" via "+provider.client+" ("+provider.mode+")");
      for(const warning of (provider.warnings??[]).slice(0,2))console.log("    "+safeUiText(warning));
    }
    console.log("Search path: "+(diagnostics.search.path??"unverified"));
    console.log("Preferred is advisory: OMP owns actual tool selection and execution.");
    console.log("For capability grants and tool names: pifrost repo research status --verbose");
    return;
  }
  console.log("Preferred (guidance): " + (diagnostics.preferred ?? "none"));
  for (const provider of diagnostics.providers) {
    console.log(provider.id + " [" + provider.client + "] profile=" + provider.profile + " mode=" + (provider.mode ?? "unknown") + " status=" + provider.status);
    for (const [cap, entry] of Object.entries(provider.capabilities ?? {})) {
      if (entry.tool) console.log("  " + cap + ": " + entry.tool + " granted=" + entry.granted + " executable=" + String(entry.executable) + " visible=" + String(entry.visible) + (entry.gatewayName ? " gateway=" + entry.gatewayName : entry.visibilityReason ? " reason=" + entry.visibilityReason : ""));
    }
  }
  console.log("Search path: " + diagnostics.search.path);
  console.log("No MCP requests are rerouted or automatically failed over by Pifrost.");
}
async function commandRepoResearchBind(id, name, flags) {
  if (!id || !name) throw Error("Usage: pifrost repo research bind <id> <bifrost-client> [--profile donsetch|hound|generic] [--search-tool name]");
  const { state, current, clients } = await researchSnapshot();
  const client = clients.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.id?.toLowerCase() === name.toLowerCase());
  if (!client) throw Error("No Bifrost MCP client named " + name + "; register it in Bifrost first");
  const profile = flagString(flags, "profile") ?? (client.name.toLowerCase() === "donsetch" ? "donsetch" : client.name.toLowerCase() === "hound" ? "hound" : "generic");
  const tools = {};
  for (const cap of ["search","fetch","crawl","screenshot"]) {
    const tool = flagString(flags, cap + "-tool");
    if (tool) {
      if (!client.tools.includes(tool)) throw Error("Bifrost client " + client.name + " does not expose tool " + tool);
      tools[cap] = tool;
    }
  }
  const entry = { id, clientId: client.id, mcpClient: client.name, profile, ...(Object.keys(tools).length || profile === "generic" ? { tools: Object.keys(tools).length ? tools : undefined } : {}) };
  const previous = normalizeResearchPreference(current.config?.research ?? {});
  const proposed = { preferred: previous.preferred, providers: [...previous.providers.filter((p) => p.id !== id),entry] };
  normalizeResearchPreference(proposed);
  updateRepoState(state, current.repo.id, { research: proposed });
  console.log("Bound " + id + " to Bifrost MCP " + client.name + " (" + profile + "); no Virtual Key grants changed.");
}
async function commandRepoResearchUnbind(id) {
  if (!id) throw Error("Usage: pifrost repo research unbind <id>");
  const { state, current } = await researchSnapshot();
  const previous = normalizeResearchPreference(current.config?.research ?? {});
  const providers = previous.providers.filter(p => p.id !== id);
  if (providers.length === previous.providers.length) throw Error("Unknown research binding: " + id);
  updateRepoState(state, current.repo.id, { research: { preferred: previous.preferred === id ? undefined : previous.preferred, providers } });
  console.log("Removed research binding " + id + "; Bifrost client and grants are unchanged.");
}
async function commandRepoResearchPrefer(id) {
  if (!id) throw Error("Usage: pifrost repo research prefer <id|none>");
  const { state, current } = await researchSnapshot();
  const previous = normalizeResearchPreference(current.config?.research ?? {});
  const preferred = id === "none" ? undefined : id;
  normalizeResearchPreference({ ...previous, preferred });
  updateRepoState(state, current.repo.id, { research: { ...previous, preferred } });
  console.log("Preferred research provider: " + (preferred ?? "automatic") + " (guidance only).");
}
async function commandRepoResearchProbe(id) {
  const { current, url, diagnostics } = await researchSnapshot(true);
  const target = diagnostics.providers.find((p) => p.id === (id || diagnostics.preferred));
  if (!target) throw Error("No matching research provider; bind a provider first");
  if (target.mode !== "classic") throw Error("Read-only live probes require a Classic MCP provider; Code Mode requires execution and is not probed");
  if (!target.searchReady) throw Error("Search tool not proven callable; inspect pifrost repo research status");
  if (!current.secret?.mcpVirtualKey) throw Error("Repository MCP Virtual Key is missing");
  const selected = target.capabilities.search;
  if (!selected.gatewayName) throw Error("Bifrost tool identity could not be resolved");
  const query = "IETF RFC 9110 HTTP semantics";
  const args = target.profile === "donsetch"
    ? { query, max_results: 3, deadline_ms: 15000 }
    : target.profile === "hound"
      ? { query }
      : { query };
  const result = await callMcpGatewayTool(url, current.secret.mcpVirtualKey, selected.gatewayName, args, { timeoutMs: 20000 });
  const status = classifyResearchResult(result, target.profile);
  console.log("Live research probe through Bifrost MCP " + target.client + ": " + (status.ok === false ? "FAIL" : status.ok === true ? "OK" : "INDETERMINATE"));
  console.log("Result status: " + JSON.stringify({ ok: status.ok, code: status.code, errorKind: status.errorKind, nextAction: status.nextAction, source: status.source }));
  if (status.ok !== true) process.exitCode = 2;
}

async function commandSecretRepoMcp(flags) {
  const id = flagString(flags, "id");
  if (!id) throw new Error("Usage: pifrost secret repo-mcp --id <repo-id>");
  const state = loadState();
  const value = state.secrets.repos?.[id]?.mcpVirtualKey;
  if (!value) throw new Error(`No repo MCP secret stored for id: ${id}`);
  process.stdout.write(value);
}

/** Explicit opt-in report. Never execute a classifier or tool and never send
 * credentials or raw config to stdout. Each source has independent failure
 * handling so partial management API access stays useful. */
async function commandGlobalObservability(flags = {}) {
  printHeader("Bifrost optional observability (read-only)");
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const management = managementAuthFromState(state);
  if (!runtime.url || !management) {
    console.log("Management access unavailable; run pifrost global setup.");
    return;
  }
  const vkId = flagString(flags, "vk-id");
  if (vkId && !/^[a-zA-Z0-9_-]{1,128}$/u.test(vkId)) {
    throw new Error("--vk-id must be a Virtual Key management ID, not a key secret");
  }
  const [complexity, gateway, providers, clients, vk] = await Promise.allSettled([
    getComplexityAnalyzerConfig(runtime.url, management),
    getBifrostConfig(runtime.url, management),
    listBifrostProviderInventory(runtime.url, management),
    listMcpClients(runtime.url, management),
    vkId ? getVirtualKey(runtime.url, management, vkId) : Promise.resolve(undefined),
  ]);
  console.log(formatGatewayComplexity(complexity.status === "fulfilled" ? complexity.value : undefined));
  console.log("");
  if (providers.status === "fulfilled") {
    try {
      const report = gatewayInjectedToolDiagnostics(providers.value,
        clients.status === "fulfilled" ? clients.value : undefined);
      console.log(formatGatewayResearchTools(report));
    } catch {
      console.log("Bifrost provider-injected research: unverified (unsupported provider inventory)");
    }
  } else {
    console.log("Bifrost provider-injected research: unverified (provider management API unavailable)");
  }
  console.log("");
  if (gateway.status === "rejected") {
    console.log("Bifrost privacy: unverified (gateway management configuration unavailable)");
  } else {
    console.log(formatGatewayPrivacy(gateway.value, vk.status === "fulfilled" ? vk.value : undefined));
    if (vkId && vk.status === "rejected") console.log("  VK inspection failed; effective logging policy remains unverified.");
  }
  console.log("");
  console.log("No routes, models, classifiers, tools, permissions, credentials or privacy settings were changed.");
}

async function commandGlobalMcpPolicy(snapshot) {
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const management = managementAuthFromState(state);
  if (!runtime.url || !management) {
    console.log("Gateway-managed MCP tools: unavailable (management access not configured)");
    return;
  }
  try {
    const providers = snapshot?.providerInventory?.ok
      ? snapshot.providerInventory.value
      : await listBifrostProviderInventory(runtime.url, management);
    const clients = snapshot?.mcpClients?.ok
      ? snapshot.mcpClients.value
      : await listMcpClients(runtime.url, management).catch(() => undefined);
    console.log(formatGatewayInjectedToolDiagnostics(gatewayInjectedToolDiagnostics(providers, clients)));
  } catch (error) {
    console.log("Gateway-managed MCP tools: unavailable (" + formatError(error) + ")");
  }
}


function judgeRuntimeConfig() {
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  if (!runtime.url || !runtime.virtualKey) {
    throw new Error("Bifrost URL and inference Virtual Key are required; run pifrost global setup");
  }
  return runtime;
}

function configFileForMigration() {
  const root = runCommand("omp",["config","path"]).stdout.trim();
  for (const name of ["config.yml","config.yaml"]) {
    const file = join(root,name);
    if(existsSync(file))return file;
  }
  throw new Error("No existing OMP global YAML found. No changes made.");
}
function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function commandOmpCommands(action,flags={}) {
  if(action==="status"){
    const result=commandStatus();
    console.log("OMP /pifrost commands: "+result.status);
    console.log("Extension: "+result.file);
    if(result.status!=="enabled")console.log("Enable explicitly: pifrost omp commands enable");
    return;
  }
  if(flags["dry-run"]){
    console.log("Would "+action+" the optional /pifrost command palette; no changes made.");
    console.log("This integration only registers a slash command; it has no event hooks or model interceptors.");
    return;
  }
  if(action==="enable" && commandExists("omp")){
    let installed;
    try { installed=JSON.parse(runCommand("omp",["plugin","list","--json"]).stdout); }
    catch { throw new Error("Could not verify installed OMP plugins. Use 'omp plugin list' and disable the legacy Pifrost runtime extension first."); }
    if(Array.isArray(installed?.npm) && installed.npm.some(x=>x?.name==="pifrost" && x.enabled!==false))
      throw new Error("Legacy Pifrost runtime plugin is active. First run 'pifrost migrate disable-extension', then restart OMP.");
  }
  const result=action==="enable" ? enableCommands() : disableCommands();
  console.log(result.changed?("OMP /pifrost commands "+(action==="enable"?"installed":"disabled")+"."):
    "Already "+(action==="enable"?"enabled":"disabled")+".");
  if(result.backup)console.log("Backup: "+result.backup);
  console.log("Extension file: "+result.file);
  console.log("Restart OMP to "+(action==="enable"?"use":"stop using")+" /pifrost.");
}
function commandDisableLegacyExtension(flags={}) {
  if(!commandExists("omp"))throw new Error("OMP CLI is required.");
  let list;
  try { list=JSON.parse(runCommand("omp",["plugin","list","--json"]).stdout); }
  catch { throw new Error("Cannot verify installed OMP plugins; no plugin modified."); }
  const installed=Array.isArray(list?.npm) ? list.npm.filter(x=>x?.name==="pifrost") : [];
  if(installed.length>1)throw new Error("Multiple Pifrost plugins reported; inspect OMP plugin list manually.");
  if(!installed.length){console.log("No exact Pifrost npm plugin found; no changes made.");return;}
  if(installed[0].enabled===false){console.log("Pifrost runtime plugin already disabled.");return;}
  if(flags["dry-run"]){console.log("Would disable only OMP npm plugin 'pifrost' (not uninstall it).");return;}
  runCommand("omp",["plugin","disable","pifrost"]);
  console.log("Disabled legacy Pifrost runtime plugin. Restart OMP.");
  console.log("Repository MCP config and installed Skills are unaffected.");
}

function commandMigrate(mode) {
  if(!commandExists("omp"))throw new Error("OMP is required for migration.");
  if(mode==="rollback"){
    const state=loadState(), journal=state.config.ompMigration030;
    if(!journal?.configPath || !journal?.backup || !journal?.afterHash)
      throw new Error("No Pifrost 0.30 migration backup recorded.");
    if(configFileForMigration()!==journal.configPath || sha256File(journal.configPath)!==journal.afterHash)
      throw new Error("OMP config changed since migration; refusing to overwrite it. Restore from the recorded backup manually.");
    if(!existsSync(journal.backup))throw new Error("Migration backup is missing.");
    copyFileSync(journal.backup,journal.configPath);
    delete state.config.ompMigration030;
    saveState(state.config,state.secrets);
    console.log("Restored OMP config from backup: "+journal.backup);
    console.log("Restart OMP; provider/plugin installation was not changed.");
    return;
  }
  const keys=["modelRoles","enabledModels","modelProviderOrder"];
  const values=Object.fromEntries(keys.map(key=>[key,readOmpConfigValueResult(key)]));
  const failures=keys.filter(key=>values[key].status!=="ok");
  if(failures.length)throw new Error("Migration aborted: unable to read "+failures.join(", "));
  const plan=planLegacyOmpCleanup(Object.fromEntries(keys.map(key=>[key,values[key].value])));
  console.log("Historical Pifrost roles found: "+plan.removedRoles);
  for(const row of plan.changes)console.log("  "+row.key+": "+row.method);
  for(const warning of plan.warnings)console.log("NOTICE "+warning);
  if(mode!=="apply"){console.log("Read-only. To apply: pifrost migrate apply");return;}
  if(!plan.changes.length){console.log("No safe changes identified.");return;}
  const state=loadState();
  if(state.config.ompMigration030)throw new Error("An unapplied rollback journal exists. Review it before another migration.");
  const configPath=configFileForMigration();
  const originalHash=sha256File(configPath);
  const backup=backupOmpConfig();
  if(!backup)throw new Error("Cannot back up the OMP configuration; migration aborted.");
  if(sha256File(configPath)!==originalHash)throw new Error("OMP config changed while preparing migration; no migration writes performed.");
  try {
    for(const row of plan.changes){
      runCommand("omp",row.method==="reset" ? ["config","reset",row.key]
        : ["config","set",row.key,JSON.stringify(row.after)]);
    }
  } catch(error) {
    try {
      copyFileSync(backup,configPath);
      throw new Error("Migration failed and original OMP config was restored: "+String(error?.message??error));
    } catch(restoreError) {
      if(String(restoreError?.message??"").startsWith("Migration failed and original"))throw restoreError;
      throw new Error("Migration failed; automatic restore also failed. Preserve and restore original backup: "+backup);
    }
  }
  state.config.ompMigration030={configPath,backup,afterHash:sha256File(configPath)};
  saveState(state.config,state.secrets);
  console.log("Restored native OMP role ownership. Backup: "+backup);
  console.log("Rollback: pifrost migrate rollback (refuses if OMP config has since changed).");
  console.log("Disable the legacy Pifrost extension using OMP's plugin manager before restarting OMP.");
}

async function commandModelsList() {
  const runtime = judgeRuntimeConfig();
  const headers = { "x-bf-vk": runtime.virtualKey };
  if (runtime.apiKey) headers.Authorization = "Bearer " + runtime.apiKey;
  const listing = await requestJson(runtime.url + "/models", { headers, timeoutMs: 10_000 });
  if (!Array.isArray(listing?.data)) throw new Error("Bifrost /models returned no model list");
  for (const item of listing.data) if (item && typeof item.id === "string") {
    console.log(item.id);
  }
}
function commandModelsStatus() {
  const result = nativeModelsStatus();
  console.log(result.enabled ? "Native Bifrost model discovery: enabled ("+result.protocol+")" :
    "Native Bifrost model discovery: disabled; OMP defaults unchanged");
  console.log("OMP models.yml: " + result.path);
}
async function commandModelsEnable(flags = {}) {
  const runtime = judgeRuntimeConfig();
  const protocol = flagString(flags, "api") ?? "completions";
  if (!["completions","responses"].includes(protocol))
    throw new Error("--api must be completions or responses");
  const api = "openai-" + protocol;
  if (flags["dry-run"]) {
    console.log("Would add/update only Pifrost's marked bifrost provider under OMP models.yml");
    console.log("Gateway: " + runtime.url + " | Native API: " + api);
    console.log("All modelRoles and enabledModels stay unchanged; other providers are preserved.");
    return;
  }
  const outcome = writeNativeModels(api,runtime.url);
  console.log(outcome.changed?"Enabled native Bifrost discovery.":"Bifrost discovery already enabled.");
  console.log("OMP config: " + outcome.path);
  if(outcome.backup)console.log("Backup: " + outcome.backup);
  console.log("No OMP model role changed. Restart OMP, then use /model to select bifrost/<model-id>.");
  console.log("Models requiring a different Chat/Responses protocol need explicit native OMP overrides.");
}
function commandModelsDisable(flags = {}) {
  if(flags["dry-run"]){console.log("Would remove only the marked Pifrost Bifrost provider; OMP roles stay untouched.");return;}
  const outcome=writeNativeModels(null,null);
  console.log(outcome.changed?"Disabled Pifrost-managed Bifrost provider.":"No Pifrost-managed provider to remove.");
  if(outcome.backup)console.log("Backup: " + outcome.backup);
}
function commandInferenceSecret(kind) {
  const state=loadState();
  const value=kind==="virtual-key" ? state.secrets.inferenceVirtualKey
    : state.secrets.inferenceApiKey ?? state.secrets.inferenceVirtualKey;
  if(!value)throw new Error("Required inference secret is not configured; run pifrost global setup");
  process.stdout.write(value);
}

async function commandModelsKinds() {
  const runtime = judgeRuntimeConfig();
  const headers = { "x-bf-vk": runtime.virtualKey };
  if (runtime.apiKey) headers.Authorization = "Bearer " + runtime.apiKey;
  const catalog = await requestJson(runtime.url + "/models", { headers, timeoutMs: 10_000 });
  if (!Array.isArray(catalog?.data)) throw new Error("Bifrost model-kinds inventory returned no data array");
  const rows = catalog.data.filter(model => model && typeof model.id === "string");
  const summary = bifrostModelKindSummary(rows);
  console.log("Bifrost model-kind inventory (read-only; source: live /v1/models):");
  console.log("  chat-declared: " + summary.chat);
  console.log("  unknown/legacy metadata: " + summary.unknown + " (chat-compatible until gateway states otherwise)");
  console.log("  non-chat: " + summary.nonChat);
  const kinds = new Map();
  for (const row of rows) {
    const detail = bifrostModelKindEvidence(row);
    if (detail.chat) continue;
    kinds.set(detail.kind, (kinds.get(detail.kind) ?? 0) + 1);
  }
  for (const [kind, count] of [...kinds].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log("    " + kind + ": " + count);
  }
  console.log("  non-chat kinds must use OMP-native APIs, not Pifrost chat transport.");
  console.log("  Bifrost Decisions capability requires separate native judge discovery/probe: pifrost judge status");
}


function commandOmpWorkarounds(flags = {}) {
  const result = inspectPifrostWorkarounds({ hostVersion: getOmpVersion() });
  if (flags.json) console.log(JSON.stringify(result));
  else console.log(formatPifrostWorkarounds(result, flags.verbose === true));
}

function commandOmpContext(flags = {}, apply = false) {
  const models = readCatalog().cache?.models ?? [];
  if (apply && !flags["dry-run"]) {
    const result = configureOmpAdaptiveContext(models);
    console.log(formatAdaptiveContextPlan(result.plan));
    console.log(result.changed ? "OMP context thresholds updated; restart OMP for new sessions." :
      "No changes made.");
    if (result.backup) console.log("OMP config backup: " + result.backup);
    return;
  }
  const plan = planOmpAdaptiveContext(models);
  if (flags.json) console.log(JSON.stringify(plan));
  else console.log(formatAdaptiveContextPlan(plan) + (apply ? "\nDry-run: no changes made." : ""));
}

function commandOmpReadiness(flags = {}) {
  const settings = Object.fromEntries(
    OMP_ORCHESTRATION_SETTING_IDS.map(id => [id, readOmpConfigValueResult(id)])
  );
  const { cache, stale } = readCatalog();
  let selectedJudge;
  try { selectedJudge = nativeJudgeSelection(); } catch { selectedJudge = undefined; }
  const result = assessOmpOrchestration({
    settings, catalog: cache, stale: stale === true,
    hostVersion: getOmpVersion(), selectedJudge,
    policySnapshotVersion: PIFROST_OMP_POLICY_SNAPSHOT_VERSION,
    stalledMode: process.env.PIFROST_STALLED_TURN_MODE,
  });
  if (flags.json) console.log(JSON.stringify(result));
  else console.log(formatOmpOrchestration(result, flags.verbose === true));
}

async function commandJudgeStatus() {
  const selected = nativeJudgeSelection();
  console.log("OMP native judgment (optional; OMP owns judge execution and session usage):");
  if (!selected) {
    console.log("  disabled: set PIFROST_NATIVE_JUDGE_MODEL=jev-latest or openai/gpt-6-luna before launching OMP");
    console.log("  other OMP kinds (image, search, speech, dictation, embedding, rerank, video) remain OMP-owned");
    return;
  }
  console.log("  configured provider: bifrost-judge");
  console.log("  configured model: " + selected.model);
  const judge = nativeJudgeGateway(judgeRuntimeConfig());
  console.log("  native judgment transport: " + judge.api);
  console.log("  image judgments: " + (judge.imageEnabled ? "opted in (experimental for Jev)" : "disabled"));
  const capabilities = await resolvePinnedOmpJudgeCapabilities(judge);
  console.log("  OMP image bounds: " + capabilities.imageBounds + (capabilities.bounds ? " " + JSON.stringify(capabilities.bounds) : ""));
  console.log("  Jev box questions: " + capabilities.boxQuestions + (capabilities.ompBoxWire ? " (OMP wire: " + capabilities.ompBoxWire + ")" : ""));
  console.log("  Capabilities are metadata, not live gateway execution.");
  const current = readOmpConfigValueResult("modelRoles");
  const roles = current.status === "ok" && current.value && typeof current.value === "object"
    && !Array.isArray(current.value) ? current.value : undefined;
  console.log("  OMP judge role: " + (roles?.judge ?? (current.status === "ok" ? "not explicitly assigned" : "unavailable")));
  console.log("  role matches opt-in: " + (roles?.judge === selected.selector ? "yes" : "no"));
  console.log("  Native non-chat judges are not filtered by OMP enabledModels.");
  try {
    const status = await inspectNativeJudgeModels(judgeRuntimeConfig());
    console.log("  Bifrost native " + status.family + " model listing: " + status.status);
    console.log("  model-list names: " + status.models.length);
    if (status.status !== "available") process.exitCode = 2;
  } catch (error) {
    console.log("  Bifrost native judge models: unavailable (" + formatError(error) + ")");
    process.exitCode = 2;
  }
  console.log("  Native endpoint model listing is not a billable judgment conformance check.");
  console.log("  TypeSafe System One and OpenAI Decisions use separate native wire formats.");
  console.log("  no judgment was submitted; use pifrost judge probe to run a billed fixture");
}

async function commandJudgeProviders() {
  const config = judgeRuntimeConfig();
  if (!config.url || !config.virtualKey) throw new Error("Bifrost inference URL and Virtual Key required");
  const body = await requestJson(config.url.replace(/\/+$/u, "") + "/models", {
    method: "GET", timeoutMs: 8000, maxResponseBytes: 512000,
    headers: { "x-bf-vk": config.virtualKey },
  });
  const inventory = decisionProviderInventory(body);
  console.log("Bifrost Decisions provider visibility (read-only /v1/models):");
  for (const row of inventory.providers) console.log(`  ${row.provider}: ${row.status} (${row.listedModels.length} model(s))`);
  console.log("  Listing does not prove /v1/decisions support, provider authorization, or correct answers.");
  console.log("  Separately approved billable endpoint probes are needed for live certification.");
}

async function commandJudgeActivate(flags = {}) {
  const selected = nativeJudgeSelection();
  if (!selected) throw new Error("Set PIFROST_NATIVE_JUDGE_MODEL before activating a native judge");
  const runtime = judgeRuntimeConfig();
  if (!nativeJudgeGateway(runtime)) throw new Error("Native judgment provider not configured");
  const available = await inspectNativeJudgeModels(runtime);
  if (available.status !== "available")
    throw new Error("Configured native judge was not confirmed by Bifrost model listing");
  const read = readOmpConfigValueResult;
  if (flags["dry-run"]) {
    planJudgeRoleActivation(read,selected.selector);
    console.log(operationSummary("Read-only preview",[
      "Would set OMP modelRoles.judge to "+selected.selector,
      "All other roles and enabledModels remain unchanged",
      "OMP resolves native non-chat judge roles independently of enabledModels",
    ]));
    return;
  }
  const outcome=applyJudgeRoleActivation({
    read, selector:selected.selector, backup:backupOmpConfig,
    write:(id,value)=>runCommand("omp",["config","set",id,JSON.stringify(value)]),
  });
  console.log("OMP modelRoles.judge: "+selected.selector);
  console.log(outcome.changed?"Verified role update.":"Judge role already configured.");
  console.log("Other roles and enabledModels unchanged.");
  if (outcome.backup) console.log("Configuration backup: "+outcome.backup);
}

async function commandJudgeProbe(flags = {}) {
  const result = await probeNativeJudge(judgeRuntimeConfig(), process.env, { decisions: flags.decisions === true, image: flags.image === true, box: flags.box === true });
  console.log("Bifrost " + result.kind + " judgment conformance: OK");
  console.log("  model: " + result.model);
  console.log("  typed answers checked: " + result.answered);
  console.log("  image conformance: " + (result.image ? "PNG fixture submitted" : "not requested"));
  console.log("  usage: " + (result.hasUsage ? "reported" : "not reported"));
  console.log("  this was an explicitly requested inference request; normal judgments remain OMP-owned");
}

async function commandDoctor(flags = {}) {
  const storedWarnings = storedRuntimeConfigDiagnostics();
  if (storedWarnings.length) {
    if(flags.json){
      reportHealth({command:"doctor",json:true,checks:storedWarnings.map((detail,i)=>({
        id:"stored-config-"+i,label:"Stored Pifrost configuration",detail,
        status:"fail",required:true,action:"pifrost global setup"
      }))});
      process.exitCode=2;return;
    }
    printHeader("Stored Pifrost configuration");
    for (const warning of storedWarnings) console.log(`WARN ${warning}`);
    console.log("Repair or rerun `pifrost global setup` before live diagnostics.");
    process.exitCode = 2;
    return;
  }

  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const managementAuth = managementAuthFromState(state);
  const snapshot = await collectDoctorSnapshot({ runtime, managementAuth });

  const transportWarnings = bifrostCredentialTransportWarnings(runtime, managementAuth);
  if (!flags.verbose) {
    const catalog = printModelDoctor(process.env, { log() {} });
    const checks = [
      { label:"OMP", status:commandExists("omp") ? "ok" : "fail",
        detail: commandExists("omp") ? `Installed (${getOmpVersion() ?? "version unknown"})` : "Not installed",
        action:"Install or update OMP, then rerun pifrost doctor." },
      snapshotCheck("health", "Bifrost gateway", snapshot, "pifrost global setup", true),
      snapshotCheck("inference", "Inference access", snapshot, "pifrost global setup", true),
      snapshotCheck("management", "Management API", snapshot, "pifrost global setup", false),
      snapshotCheck("routing", "Routing rules", snapshot, "pifrost routes diagnose", false),
      {label:"Model catalogue", status:catalog.ok ? "ok" : "fail",
        detail:catalog.checks?.[0]?.summary ?? "Not verified",
        action:"pifrost models refresh --force"},
    ];
    const matrix = await buildCompatibilityMatrix({
      url: runtime.url,
      managementAuth,
      virtualKey: runtime.virtualKey,
      apiKey: runtime.apiKey,
      ompVersion: getOmpVersion(),
      bifrostVersion: snapshot.version?.ok ? snapshot.version.value : undefined,
      probes: snapshot,
    });
    const incompatibilities = [...matrix.omp, ...matrix.bifrost]
      .filter(item => item.optional !== true && item.status !== "supported");
    for (const item of incompatibilities.slice(0, 5)) {
      checks.push({
        label:`Compatibility: ${item.label}`,
        status:item.status === "unavailable" || item.status === "drifted" ? "warn" : "unknown",
        detail:item.detail ? item.detail.slice(0, 140) : "Cannot verify",
        action:"pifrost doctor --verbose",
      });
    }
    if (incompatibilities.length > 5) checks.push({
      label:"Other compatibility checks",status:"warn",
      detail:`${incompatibilities.length - 5} additional findings`,
      action:"pifrost doctor --verbose",
    });
    if (transportWarnings.length) checks.push({
      label:"Transport security",status:"warn",
      detail:`${transportWarnings.length} warning(s) - see verbose report`,
      action:"pifrost doctor --verbose",
    });
    if (storedWarnings.length) checks.push({
      label:"Stored configuration",status:"fail",
      detail:`${storedWarnings.length} unreadable or invalid file(s)`,
      action:"pifrost global setup",
    });
    const result=reportHealth({command:"doctor",checks,strict:flags.strict,json:flags.json});
    if(!flags.json) console.log(renderHealthOverview(result.checks));
    if(result.exitCode) process.exitCode = result.exitCode;
    return;
  }

  if (transportWarnings.length) {
    printHeader("Transport security");
    for (const warning of transportWarnings) console.log(`WARN ${warning}`);
    console.log("");
  }

  await commandGlobalStatus(snapshot, { verbose:true });
  console.log("");
  await commandGlobalMcpPolicy(snapshot);
  console.log("");
  console.log(formatOmpContextPolicyDiagnostics(ompContextPolicyDiagnostics()));
  console.log("");
  await commandCompatibilityDoctor(snapshot);
  console.log("");
  await commandModelsDoctor({ verbose:true });
  console.log("");
  commandRoutesEffective();
  console.log("");
  console.log("Inference diagnostics: inside OMP use /pifrost trace verbose for typed failures,");
  console.log("  gateway-reported physical model and aggregate request shape (no prompts or credentials).");
  console.log("  Route fingerprint verification cannot prove session affinity or replay validity.");
  try {
    getRepoRoot();
    console.log("");
    await commandRepoStatus(snapshot, { verbose:true });
  } catch (error) {
    if (!String(formatError(error)).includes("not inside a Git repository")) throw error;
  }
}

const COMMANDS = new Map([
  ["init", (_args, flags) => commandInit(flags)],
  ["global setup", (_args, flags) => commandGlobalSetup(flags)],
  ["global status", (_args, flags) => commandGlobalStatus(undefined, flags)],
  ["global mcp-policy", () => commandGlobalMcpPolicy()],
  ["global observability", (_args, flags) => commandGlobalObservability(flags)],
  ["status", (_args,flags) => runLiteDoctor(flags)],
  ["models", () => commandModelsStatus()],
  ["mcp", (_args,flags) => commandRepoMcpList(flags)],
  ["skills", (_args,flags) => commandRepoSkillsList(flags)],
  ["omp commands status", () => commandOmpCommands("status")],
  ["omp commands enable", (_args,flags) => commandOmpCommands("enable",flags)],
  ["omp commands disable", (_args,flags) => commandOmpCommands("disable",flags)],
  ["migrate status", () => commandMigrate("status")],
  ["migrate disable-extension", (_args,flags) => commandDisableLegacyExtension(flags)],
  ["migrate apply", () => commandMigrate("apply")],
  ["migrate rollback", () => commandMigrate("rollback")],
  ["models list", () => commandModelsList()],
  ["models status", () => commandModelsStatus()],
  ["models enable", (_args,flags) => commandModelsEnable(flags)],
  ["models disable", (_args,flags) => commandModelsDisable(flags)],
  ["models kinds", () => commandModelsKinds()],
  ["repo init", (_args, flags) => commandRepoInit(flags)],
  ["repo status", (_args, flags) => commandRepoStatus(undefined, flags)],
  ["repo rotate-key", (_args, flags) => commandRepoRotateKey(flags)],
  ["repo reset", (_args, flags) => commandRepoReset(flags)],
  ["repo mcp list", (_args,flags) => commandRepoMcpList(flags)],
  ["repo mcp add", (args, flags) => commandRepoMcpAdd(args[0], flags)],
  ["repo mcp remove", (args, flags) => commandRepoMcpRemove(args[0], flags)],
  ["repo mcp instructions", (args, flags) => commandRepoMcpInstructions(args[0], flags)],
  ["repo vmcp list", (_args,flags) => commandRepoVirtualMcpList(flags)],
  ["repo vmcp add", (args, flags) => commandRepoVirtualMcpAdd(args[0], flags)],
  ["repo vmcp remove", (args, flags) => commandRepoVirtualMcpRemove(args[0], flags)],
  ["repo skills list", (_args,flags) => commandRepoSkillsList(flags)],
  ["repo skills suggestions", (_args, flags) => commandRepoSkillSuggestions(flags)],
  ["repo skills bind", (args, flags) => commandRepoSkillBind(args[0], args[1], flags)],
  ["repo skills unbind", (args) => commandRepoSkillUnbind(args[0])],
  ["repo skills dismiss", (args) => commandRepoSkillDismiss(args[0], true)],
  ["repo skills undismiss", (args) => commandRepoSkillDismiss(args[0], false)],
  ["repo skills add", (args, flags) => commandRepoSkillsAdd(args[0], flags)],
  ["repo skills remove", (args, flags) => commandRepoSkillsRemove(args[0], flags)],
  ["repo skills sync", (args, flags) => commandRepoSkillsSync(args[0], flags)],
  ["secret repo-mcp", (_args, flags) => commandSecretRepoMcp(flags)],
  ["secret inference", () => commandInferenceSecret("auth")],
  ["secret inference-vk", () => commandInferenceSecret("virtual-key")],
  ["doctor", (_args, flags) => runLiteDoctor(flags)],
]);

function resolveCommand(positional) {
  for (let length = positional.length; length > 0; length -= 1) {
    const key = positional.slice(0, length).join(" ");
    const handler = COMMANDS.get(key);
    if (handler) {
      // A short overview alias is only valid by itself. Do not mistake an
      // unsupported old subcommand for extra positional arguments to an alias.
      if (length === 1 && ["models","mcp","skills","status"].includes(key) && positional.length > 1)
        return undefined;
      return { handler, args: positional.slice(length) };
    }
  }
  return undefined;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [one] = positional;
  if (flags.version || one === "--version" || one === "version") {
    console.log(VERSION);
    return;
  }
  if (!one || one === "help") {
    process.stdout.write(flags.all || flags["help-all"] ? HELP : compactCliHelp(VERSION));
    return;
  }

  const resolved = resolveCommand(positional);
  if (resolved) {
    const name = positional.slice(0, positional.length - resolved.args.length).join(" ");
    if (flags.help) {
      process.stdout.write(commandUsage(name) + "\n");
      return;
    }
    const definition = validateCliInvocation(name, resolved.args, flags);
    if(["gateway-change","local-change"].includes(definition.operation) && !flags.json){
      console.log("Operation: "+(flags["dry-run"]?"Read-only preview":operationLabel(definition.operation)));
    }
    if (definition.operation === "billed" && !flags.yes) {
      console.log("Operation: " + operationLabel(definition.operation));
      console.log("This command performs real provider calls and may incur charges.");
    }
    return resolved.handler(resolved.args, flags);
  }
  throw Object.assign(new Error("Unknown command. Use pifrost help for the available commands."), { isUsage: true });
}

main().catch((error) => {
  // Preserve a single parseable result even if health inspection cannot start.
  if(process.argv.slice(2).includes("--json")){
    console.log(JSON.stringify({
      schemaVersion:1,
      command:process.argv.slice(2).filter(x=>!x.startsWith("--")).slice(0,2).join(" "),
      result:"FAILED",
      counts:{ok:0,issues:1},
      checks:[{id:"command-error",label:"Command failed",status:"fail",
        required:true,detail:safeUiText(error instanceof Error?error.message:String(error)),
        action:"pifrost doctor"}]
    },null,2));
    process.exitCode=error?.isUsage===true?1:2;
    return;
  }
  console.error(formatCliFailure(error, { isUsage: error?.isUsage === true }));
  process.exitCode = 1;
});
