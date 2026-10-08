#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

import { deleteRepoVirtualKeyForReset } from "./repo-reset.mjs";
import { collectDoctorSnapshot } from "./doctor-probes.mjs";
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
import {
  houndCodeModeClientNames,
  houndMcpDiagnostics,
  probeHoundCodeMode,
} from "./hound-diagnostics.mjs";

import {
  bifrostSkillCompatibility,
  fetchBifrostSkillBundle,
  installBifrostSkillBundle,
  listBifrostSkills,
  normalizeConfiguredBifrostSkills,
  removeManagedBifrostSkill,
  repoBifrostSkillStatus,
  resolveBifrostSkillNames,
} from "./skills-bridge.mjs";

import {
  VERSION,
  PIFROST_OMP_MIN_VERSION,
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
  readOmpConfigValue,
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

const HELP = `Pifrost ${VERSION} — OMP ↔ Maxim Bifrost configuration and control plane

Usage:
  pifrost init
  pifrost global setup [options]
  pifrost global status
  pifrost global configure-omp
  pifrost routes list
  pifrost routes diff
  pifrost routes sync [--no-refresh]
  pifrost routes diagnose
  pifrost routes effective
  pifrost routes explain <role|alias> [--input-tokens N] [--output-tokens N] [--image] [--tools] [--reasoning] [--tool-search] [--between-tools] [--tool-choice auto|required|any|name:tool] [--service-tier tier]
  pifrost models refresh [--force]
  pifrost models doctor
  pifrost repo init [--clients a,b] [--tools '*'] [--virtual-mcps 'Bundle A,Bundle B'] [--no-mcp-instructions]
  pifrost repo status
  pifrost repo rotate-key
  pifrost repo mcp list
  pifrost repo mcp add <client> [--tools '*|tool1,tool2']
  pifrost repo mcp remove <client>
  pifrost repo mcp instructions <on|off|default>
  pifrost repo vmcp list
  pifrost repo vmcp add <name>
  pifrost repo vmcp remove <name>
  pifrost repo skills list
  pifrost repo skills add <name>
  pifrost repo skills remove <name>
  pifrost repo skills sync [name]
  pifrost repo reset [--delete-remote] [--recover-by-name] [--yes]
  pifrost secret repo-mcp --id <repo-id>
  pifrost doctor
  pifrost --version

Global setup options:
  --url <url>                    Bifrost URL, e.g. http://192.168.1.221:8180/v1
  --api-key <key>                Optional separate inference Bearer/API key (Bifrost 2.x can use VK-only auth)
  --virtual-key <key>            Global inference Virtual Key
  --management-auth <mode>       basic (Bifrost OSS) or bearer (Enterprise)
  --management-username <user>   OSS admin/dashboard username
  --management-password <pass>   OSS admin/dashboard password
  --management-key <key>         Enterprise scoped management API key
  --skip-omp                     Do not change OMP settings
  --skip-test                    Save without connectivity tests
  --yes                          Accept existing/default values non-interactively

Repo init options:
  --clients <a,b>                 Direct MCP clients to grant
  --tools <*|tool1,tool2>         Tool allow-list for selected direct MCP clients
  --virtual-mcps <a,b>            Named Bifrost Virtual MCP bundles to attach
  --rotate-existing               Explicitly rotate an adopted existing repo Virtual Key when its raw value is unavailable
  --no-mcp-instructions           Keep Bifrost MCP tools but omit its server instructions from OMP prompts

Repo reset options:
  --delete-remote                 Delete the repo Bifrost Virtual Key before local cleanup
  --recover-by-name               With --delete-remote, recover only the exact canonical VK name
  --yes                           Skip the destructive DELETE confirmation

Environment overrides:
  BIFROST_URL
  BIFROST_API_KEY
  BIFROST_VIRTUAL_KEY
  BIFROST_MANAGEMENT_AUTH_MODE
  BIFROST_ADMIN_USERNAME
  BIFROST_ADMIN_PASSWORD
  BIFROST_MANAGEMENT_API_KEY
  PIFROST_CONFIG_DIR

Bifrost OSS management APIs use HTTP Basic auth with the dashboard/admin
username and password. Scoped management API keys are a Bifrost Enterprise
feature. Secrets are stored in ~/.config/pifrost/secrets.json with mode 0600.
Repo .omp/mcp.json files contain no secret; they resolve the repo VK through
'!pifrost secret repo-mcp --id ...' at connection time.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 2) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
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
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
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

  const nonInteractive = Boolean(flags.yes) || (!process.stdin.isTTY && !flagString(flags, "url"));
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

  if (!url || !virtualKey) {
    throw new Error("Bifrost URL and global inference Virtual Key are required");
  }
  url = normalizeBifrostUrl(url);
  let setupState;
  try {
    setupState = await getBifrostSetupState(url);
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

  if (!flags["skip-test"]) {
    process.stdout.write("Testing inference connection... ");
    const inference = await testInference({ url, apiKey, virtualKey });
    console.log(`OK (${inference.models} models visible)`);
    if (managementAuth) {
      process.stdout.write(`Testing management API via ${managementAuthLabel(managementAuth)}... `);
      await testManagement(url, managementAuth);
      console.log("OK");
    }
  }

  state.config.bifrost = { ...(state.config.bifrost ?? {}), url };
  if (apiKey) state.secrets.inferenceApiKey = apiKey;
  else delete state.secrets.inferenceApiKey;
  state.secrets.inferenceVirtualKey = virtualKey;

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

  const paths = saveState(state.config, state.secrets);
  console.log(`Saved config:  ${paths.config}`);
  console.log(`Saved secrets: ${paths.secrets} (0600)`);

  if (!flags["skip-omp"]) {
    process.stdout.write("Configuring OMP roles/settings... ");
    const result = configureOmp();
    console.log(`OK (${result.settings} settings)`);
    if (result.backup) console.log(`OMP config backup: ${result.backup}`);
  }
}

async function commandGlobalStatus(snapshot) {
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
      console.log(`Gateway config 2.x:     MCP-auth=${mcpAuthMode}, chain-depth=${chainDepth}, required-headers=${requiredHeaders.length}`);
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
  printHeader("Pifrost first-time setup");
  if (!commandExists("omp")) throw new Error("OMP is required but `omp` is not on PATH");
  console.log("Installing/updating Pifrost OMP extension...");
  installOmpPlugin();
  await commandGlobalSetup(flags);
  const state = loadState();
  if (managementAuthFromState(state)) {
    console.log("Synchronizing Bifrost omp-* routes...");
    await commandRoutesSync({ "no-refresh": true });
  } else {
    console.log("Skipping route sync because no management authentication is configured.");
  }
  console.log("Refreshing Pifrost model catalog...");
  await commandModelsRefresh({ force: true });
  await commandGlobalStatus();
}

async function routingSnapshot() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const discovered = await discoverRoutingRules(url, managementKey);
  return {
    ...discovered,
    manifest: deriveAliasesRobust(discovered.rules),
  };
}

async function commandRoutesList() {
  const { manifest } = await routingSnapshot();
  printHeader(`Bifrost OMP routes (${Object.keys(manifest.aliases).length})`);
  for (const [id, definition] of Object.entries(manifest.aliases).sort(([a], [b]) => a.localeCompare(b))) {
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
  const { manifest: remote } = await routingSnapshot();
  const local = loadAliasManifest();
  const differences = diffAliases(local, remote);
  if (!differences.length) {
    console.log("Routes are in sync.");
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

async function commandRoutesSync(flags = {}) {
  const { manifest, rules, diagnostics } = await routingSnapshot();
  const count = Object.keys(manifest.aliases).length;
  if (!count) {
    const sourceSummary = diagnostics
      .map((item) => `${item.path}=${item.ok ? item.count : `HTTP-${item.status ?? "error"}`}`)
      .join(", ");
    throw new Error(
      `Bifrost returned ${rules.length} routing rule(s), but none could be derived as omp-* aliases (${sourceSummary}). Run \`pifrost routes diagnose\` for details.`,
    );
  }
  const result = writeAliasManifest(manifest);
  console.log(`Wrote ${count} aliases to ${result.path}`);
  if (result.backup) console.log(`Previous manifest backed up to ${result.backup}`);
  if (!flags["no-refresh"]) await commandModelsRefresh({ force: true });
}

async function commandModelsRefresh(flags = {}) {
  if (!commandExists("omp")) throw new Error("`omp` is not installed or not on PATH");
  const env = { ...process.env };
  if (flags.force) env.PIFROST_FORCE_REFRESH = "1";
  runCommand("omp", ["models", "refresh"], { env, inherit: true });
}

async function commandModelsDoctor() {
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
      const answer = (await rl.question(`Allowed tools for ${client.name} [*]: `)).trim();
      result.push({ name: client.name, tools: answer ? splitCsv(answer) : ["*"] });
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
  }
}

async function commandRepoStatus(snapshot) {
  const state = loadState();
  const runtime = requireRuntime(state);
  const repoState = currentRepoState(state);
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
    console.log(`  ${skill.name}@${version}: ${skill.state} source=Bifrost -> .agents/skills`);
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
      let liveTools;
      let liveToolsError;
      if (repoState.secret?.mcpVirtualKey) {
        try {
          liveTools = await listMcpGatewayTools(runtime.url, repoState.secret.mcpVirtualKey);
        } catch (error) {
          liveToolsError = formatError(error);
        }
      }
      let codeModeProbe;
      const codeModeClientNames = houndCodeModeClientNames(policy, clients);
      if (codeModeClientNames.length && liveTools && repoState.secret?.mcpVirtualKey) {
        try {
          codeModeProbe = await probeHoundCodeMode(
            (toolName, args) => callMcpGatewayTool(
              runtime.url,
              repoState.secret.mcpVirtualKey,
              toolName,
              args,
            ),
            codeModeClientNames,
          );
        } catch (error) {
          codeModeProbe = {
            ok: false,
            error: formatError(error),
            files: [],
          };
        }
      }
      const ompSearch = ompWebSearchDiagnostics();
      const hound = houndMcpDiagnostics(policy, clients, virtualMcps, {
        ...(liveTools ? { liveTools } : {}),
        ...(codeModeProbe ? { codeModeProbe } : {}),
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
          console.log(
            `  ${client.name}: granted=${execution.grantedCount} executable=${execution.executableCount} auto=${execution.autoExecutableCount}`,
          );
          for (const row of execution.rows) {
            console.log(
              `    ${row.tool}: granted=yes executable=${row.executable ? "yes" : "no"} auto=${row.autoExecutable ? "yes" : "no"}`,
            );
          }
          for (const warning of execution.warnings) console.log(`    WARN ${warning}`);
        }
      }
      for (const item of policy.unresolved) {
        console.log(`  WARN ${item.client}[${item.tools.join(",")}] via ${item.sources.join("+")}: ${item.reason}`);
      }
      console.log("Web research backends:");
      const houndState = !hound.hound.configured
        ? "not configured"
        : !hound.hound.liveVerified
          ? hound.hound.mode === "code"
            ? "configured; Code Mode binding unverified"
            : "configured; gateway unverified"
          : hound.hound.researchComplete
            ? "research ready"
            : hound.hound.available
              ? "partial"
              : "not visible";
      console.log(`  MCP/Hound:        ${houndState} mode=${hound.hound.mode}`);
      for (const client of hound.hound.clients) {
        const upstream = client.serverInstructions ? "present" : "none";
        const mode = client.isCodeModeClient ? "code" : "classic";
        const cap = client.maxInstructionsLength === undefined ? "" : ` maxInstructions=${client.maxInstructionsLength}`;
        console.log(`    client=${client.name} mode=${mode} state=${client.state ?? "unknown"} via=${client.sources.join("+") || "unknown"} upstream-instructions=${upstream}${cap}`);
      }
      for (const [capability, status] of Object.entries(hound.hound.capabilities)) {
        const gateway = status.gatewayVisible === undefined
          ? "unverified"
          : status.gatewayVisible
            ? `yes (${status.gatewayName ?? status.tool})`
            : "no";
        console.log(`    ${capability.padEnd(10)} tool=${status.tool} configured=${status.configured ? "yes" : "no"} gateway-visible=${gateway}`);
      }
      console.log(`    search ready:   ${hound.hound.searchReady ? "yes" : "no"}`);
      console.log(`    web research:   ${hound.hound.webResearchReady ? "ready" : "incomplete"}`);
      console.log(`    deep research:  ${hound.hound.deepResearchReady ? "ready" : "incomplete"}`);
      console.log(`    screenshot:     ${hound.hound.screenshotCallable ? "callable" : "unavailable"}`);
      const visualWebState = hound.hound.visualWebStatus === "native"
        ? "ready (native image transport)"
        : hound.hound.visualWebStatus === "recovered"
          ? "ready (Pifrost screenshot recovery)"
          : hound.hound.visualWebStatus === "conditional-code-mode"
            ? "conditional (Code Mode provenance unavailable)"
            : "not multimodal-ready";
      console.log(`    visual web:     ${visualWebState}`);
      console.log(`    contract:       ${hound.hound.contractComplete ? "6/6 tools available" : `${hound.hound.visibleCount ?? hound.hound.configuredCount}/6 tools available`}`);
      if (hound.hound.codeMode.configured) {
        const metaCount = Object.values(hound.hound.codeMode.metaTools)
          .filter((item) => item.gatewayVisible === true).length;
        const binding = hound.hound.codeMode.probe?.ok
          ? `${hound.hound.codeMode.probe.bindingLevel} (${hound.hound.codeMode.probe.serverName})`
          : "unverified";
        console.log(`    Code Mode:      ${metaCount}/4 meta-tools binding=${binding}`);
        if (hound.hound.codeMode.probe?.error) {
          console.log(`      probe:         ${hound.hound.codeMode.probe.error}`);
        }
      }
      if (hound.hound.missingResearch.length) console.log(`    missing research: ${hound.hound.missingResearch.join(", ")}`);
      if (hound.hound.missing.length) console.log(`    missing contract: ${hound.hound.missing.join(", ")}`);
      for (const warning of hound.hound.transportWarnings) console.log(`    WARN ${warning}`);
      if (liveToolsError) console.log(`    gateway tools/list: unavailable (${liveToolsError})`);
      console.log(`  OMP native web:   ${hound.search.omp.available ? hound.search.omp.source : `${hound.search.omp.status}: ${hound.search.omp.source}`}`);
      if (hound.search.omp.error) console.log(`    error:          ${hound.search.omp.error}`);
      if (hound.search.omp.primary) console.log(`    primary:        ${hound.search.omp.primary}`);
      if (hound.search.omp.fallbacks.length) console.log(`    fallbacks:      ${hound.search.omp.fallbacks.join(" -> ")}`);
      console.log(`  Search path:      ${hound.search.path}`);
      console.log("    Hound remains a repository-scoped Bifrost MCP backend; OMP/model tool choice is unchanged.");
      if (liveTools) {
        const surface = mcpToolSurfaceDiagnostics(liveTools);
        console.log("MCP tool presentation:");
        console.log(`  gateway-visible:  ${surface.visibleTools}`);
        console.log(`  OMP default mode: ${surface.ompDefaultLoadMode} (${surface.discoverableTools} MCP tools)`);
        console.log(`  schema footprint: ~${surface.estimatedSchemaTokens} tokens if eagerly serialized (${surface.schemaBytes} bytes)`);
        console.log(`  wire deferral:    ${surface.providerDeferral}; discoverable is not the same as provider defer_loading`);
      }
      for (const item of hound.instructions) {
        console.log(`  VMCP instructions: ${item.name} mode=${item.mode} text=${item.instructions ? "set" : "none"}`);
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
        console.log(`  ${live.name}: upstream=${live.version} installed=${localSkill.installedVersion ?? "missing"} id=${live.id}${update}${incompatible}`);
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

async function installRepoBifrostSkill(state, current, summary) {
  const runtime = requireRuntime(state);
  const managementAuth = managementAuthFromState(state);
  if (!managementAuth) throw new Error("Bifrost management authentication is missing; run `pifrost global setup`");
  const bundle = await fetchBifrostSkillBundle(runtime.url, managementAuth, summary);
  const installed = await installBifrostSkillBundle(current.repo.root, bundle);
  upsertConfiguredSkill(state, current.repo.id, bundle.skill);
  return { bundle, installed };
}

async function commandRepoSkillsList() {
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
  for (const skill of available.sort((a, b) => a.name.localeCompare(b.name))) {
    const selected = configured.get(skill.name.toLowerCase());
    const status = local.get(skill.name.toLowerCase());
    const compatibility = bifrostSkillCompatibility(skill.raw);
    const flags = [
      selected ? "selected" : undefined,
      status?.state,
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

async function commandRepoSkillsAdd(name) {
  if (!name) throw new Error("Usage: pifrost repo skills add <name>");
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  const [summary] = resolveBifrostSkillNames(await listBifrostSkills(url, managementKey), [name]);
  const compatibility = bifrostSkillCompatibility(summary.raw);
  if (!compatibility.compatible) {
    throw new Error(`Bifrost skill ${summary.name} is not safely representable in OMP: ${compatibility.reason}`);
  }
  const { bundle, installed } = await installRepoBifrostSkill(state, current, summary);
  console.log(`Installed Bifrost skill ${bundle.skill.name}@${bundle.skill.version}`);
  console.log(`OMP project skill: ${installed.path}`);
}

async function commandRepoSkillsRemove(name) {
  if (!name) throw new Error("Usage: pifrost repo skills remove <name>");
  const state = loadState();
  const current = currentRepoState(state);
  const configured = configuredSkillRows(current);
  const found = configured.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`Bifrost skill is not configured for this repo: ${name}`);
  const removed = removeManagedBifrostSkill(current.repo.root, found.name);
  const next = configured.filter((item) => item.name.toLowerCase() !== found.name.toLowerCase());
  updateRepoState(state, current.repo.id, { bifrostSkills: next });
  console.log(`Removed Bifrost skill ${found.name}${removed.alreadyMissing ? " (managed directory was already missing)" : ""}.`);
}

async function commandRepoSkillsSync(name) {
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
  for (const summary of resolveBifrostSkillNames(available, wanted.map((item) => item.name))) {
    const compatibility = bifrostSkillCompatibility(summary.raw);
    if (!compatibility.compatible) {
      throw new Error(`Bifrost skill ${summary.name} is not safely representable in OMP: ${compatibility.reason}`);
    }
    const { bundle, installed } = await installRepoBifrostSkill(state, current, summary);
    console.log(`Synced ${bundle.skill.name}@${bundle.skill.version} -> ${installed.path}`);
  }
}

async function commandRepoMcpList() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const clients = await listMcpClients(url, managementKey);
  printHeader(`Bifrost MCP clients (${clients.length})`);
  for (const client of clients.sort((a, b) => a.name.localeCompare(b.name))) {
    const modes = [
      client.isCodeModeClient ? "code-mode" : undefined,
      client.toolsToAutoExecute?.length ? "agent-mode" : undefined,
      client.authType ? `auth=${client.authType}` : undefined,
      client.connectionType ? `transport=${client.connectionType}` : undefined,
      client.needsSessionStickiness === true ? "sticky" : undefined,
      Number.isFinite(client.maxInstructionsLength) && client.maxInstructionsLength > 0 ? `instructions<=${client.maxInstructionsLength}B` : undefined,
    ].filter(Boolean);
    console.log(`${client.name}  state=${client.state ?? "unknown"}  tools=${client.tools.length || "unknown"}${modes.length ? `  ${modes.join(" ")}` : ""}`);
    if (client.endpointSlug) console.log(`  endpoint=/mcp/${client.endpointSlug}`);
    console.log(`  execute allow: ${client.toolsToExecute?.length ? client.toolsToExecute.join(", ") : "none"}`);
    console.log(`  auto-execute: ${client.toolsToAutoExecute?.length ? client.toolsToAutoExecute.join(", ") : "none"}`);
    if (client.toolsToAutoExecute?.includes("*")) console.log("  WARN auto-execute wildcard grants every executable tool approval-free execution");
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

async function commandRepoVirtualMcpList() {
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
  for (const item of virtualMcps.sort((a, b) => a.name.localeCompare(b.name))) {
    const flags = [
      assigned.has(Number(item.id)) ? "assigned" : undefined,
      item.enabled ? undefined : "disabled",
      item.endpointSlug ? `/mcp/${item.endpointSlug}` : undefined,
    ].filter(Boolean);
    const toolCount = item.tools.reduce((sum, spec) => sum + (spec.toolNames.includes("*") ? 1 : spec.toolNames.length), 0);
    console.log(`${item.name}  tools=${toolCount}${flags.length ? `  ${flags.join(" ")}` : ""}  instructions=${item.instructions ? "set" : "none"} mode=${item.instructionsMode ?? "append"}`);
  }
}

async function commandRepoVirtualMcpAdd(name) {
  if (!name) throw new Error("Usage: pifrost repo vmcp add <name>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const available = await listVirtualMcps(url, managementKey);
  const [found] = resolveVirtualMcpNames(available, [name]);
  await attachVirtualMcpToVirtualKey(url, managementKey, found.id, vk.id);
  const liveNames = [...new Set([
    ...virtualMcpsForVirtualKey(available, vk.id).map((item) => item.name),
    found.name,
  ])];
  updateRepoState(state, current.repo.id, { virtualMcps: liveNames });
  console.log(`Added Virtual MCP ${found.name} to ${current.config.virtualKeyName}`);
}

async function commandRepoVirtualMcpRemove(name) {
  if (!name) throw new Error("Usage: pifrost repo vmcp remove <name>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const available = await listVirtualMcps(url, managementKey);
  const [found] = resolveVirtualMcpNames(available, [name]);
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
  const configs = virtualKeyMcpConfigs(vk).filter((item) => item.mcp_client_name !== found.name);
  configs.push({ mcp_client_name: found.name, tools_to_execute: tools.length ? tools : ["*"] });
  const updated = await updateVirtualKey(url, managementKey, vk.id, { mcp_configs: configs });
  const normalized = virtualKeyMcpConfigs(updated).map((item) => ({
    name: item.mcp_client_name,
    tools: item.tools_to_execute,
  }));
  updateRepoState(state, current.repo.id, { mcpClients: normalized });
  console.log(`Added ${found.name} to ${current.config.virtualKeyName} with tools: ${(tools.length ? tools : ["*"]).join(",")}`);
}

async function commandRepoMcpRemove(clientName) {
  if (!clientName) throw new Error("Usage: pifrost repo mcp remove <client>");
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
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

async function commandRepoMcpInstructions(mode) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (!["on", "off", "default"].includes(normalized)) {
    throw new Error("Usage: pifrost repo mcp instructions <on|off|default>");
  }
  const state = loadState();
  const runtime = requireRuntime(state);
  const current = currentRepoState(state);
  if (!current.config?.virtualKeyId) throw new Error("Current repo is not initialized; run `pifrost repo init`");

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

async function commandRepoRotateKey() {
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
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

async function commandSecretRepoMcp(flags) {
  const id = flagString(flags, "id");
  if (!id) throw new Error("Usage: pifrost secret repo-mcp --id <repo-id>");
  const state = loadState();
  const value = state.secrets.repos?.[id]?.mcpVirtualKey;
  if (!value) throw new Error(`No repo MCP secret stored for id: ${id}`);
  process.stdout.write(value);
}

async function commandDoctor() {
  const storedWarnings = storedRuntimeConfigDiagnostics();
  if (storedWarnings.length) {
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

  await commandGlobalStatus(snapshot);
  console.log("");
  await commandCompatibilityDoctor(snapshot);
  console.log("");
  await commandModelsDoctor();
  console.log("");
  commandRoutesEffective();
  try {
    getRepoRoot();
    console.log("");
    await commandRepoStatus(snapshot);
  } catch (error) {
    if (!String(formatError(error)).includes("not inside a Git repository")) throw error;
  }
}

const COMMANDS = new Map([
  ["init", (_args, flags) => commandInit(flags)],
  ["global setup", (_args, flags) => commandGlobalSetup(flags)],
  ["global status", () => commandGlobalStatus()],
  ["global configure-omp", () => {
    const result = configureOmp();
    console.log(`Configured ${result.settings} OMP settings.`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
  }],
  ["routes list", () => commandRoutesList()],
  ["routes diff", () => commandRoutesDiff()],
  ["routes sync", (_args, flags) => commandRoutesSync(flags)],
  ["routes diagnose", () => commandRoutesDiagnose()],
  ["routes effective", () => commandRoutesEffective()],
  ["routes explain", (args, flags) => commandRoutesExplain(args[0], flags)],
  ["models refresh", (_args, flags) => commandModelsRefresh(flags)],
  ["models doctor", () => commandModelsDoctor()],
  ["repo init", (_args, flags) => commandRepoInit(flags)],
  ["repo status", () => commandRepoStatus()],
  ["repo rotate-key", () => commandRepoRotateKey()],
  ["repo reset", (_args, flags) => commandRepoReset(flags)],
  ["repo mcp list", () => commandRepoMcpList()],
  ["repo mcp add", (args, flags) => commandRepoMcpAdd(args[0], flags)],
  ["repo mcp remove", (args) => commandRepoMcpRemove(args[0])],
  ["repo mcp instructions", (args) => commandRepoMcpInstructions(args[0])],
  ["repo vmcp list", () => commandRepoVirtualMcpList()],
  ["repo vmcp add", (args) => commandRepoVirtualMcpAdd(args[0])],
  ["repo vmcp remove", (args) => commandRepoVirtualMcpRemove(args[0])],
  ["repo skills list", () => commandRepoSkillsList()],
  ["repo skills add", (args) => commandRepoSkillsAdd(args[0])],
  ["repo skills remove", (args) => commandRepoSkillsRemove(args[0])],
  ["repo skills sync", (args) => commandRepoSkillsSync(args[0])],
  ["secret repo-mcp", (_args, flags) => commandSecretRepoMcp(flags)],
  ["doctor", () => commandDoctor()],
]);

function resolveCommand(positional) {
  for (let length = positional.length; length > 0; length -= 1) {
    const key = positional.slice(0, length).join(" ");
    const handler = COMMANDS.get(key);
    if (handler) return { handler, args: positional.slice(length) };
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
  if (flags.help || !one || one === "help") {
    process.stdout.write(HELP);
    return;
  }

  const resolved = resolveCommand(positional);
  if (resolved) return resolved.handler(resolved.args, flags);
  throw new Error(`Unknown command: ${positional.join(" ")}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(`pifrost: ${formatError(error)}`);
  process.exitCode = 1;
});
