#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

import {
  VERSION,
  PifrostHttpError,
  aliasManifestPath,
  buildRepoMcpConfig,
  commandExists,
  configureOmp,
  currentRepoState,
  deriveAliasesFromRules,
  diffAliases,
  getRepoRoot,
  getRoutingRules,
  getVirtualKey,
  installOmpPlugin,
  listMcpClients,
  loadAliasManifest,
  loadState,
  managementAuthFromState,
  managementAuthLabel,
  normalizeBifrostUrl,
  removeRepoState,
  repoIdentity,
  requestJson,
  rotateVirtualKey,
  runCommand,
  runtimeConfigFromState,
  saveState,
  testInference,
  testManagement,
  testMcp,
  updateRepoState,
  updateVirtualKey,
  upsertRepoVirtualKey,
  virtualKeyMcpConfigs,
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
  pifrost models refresh [--force]
  pifrost models doctor
  pifrost repo init [--clients a,b] [--tools '*']
  pifrost repo status
  pifrost repo rotate-key
  pifrost repo mcp list
  pifrost repo mcp add <client> [--tools '*|tool1,tool2']
  pifrost repo mcp remove <client>
  pifrost repo reset
  pifrost secret repo-mcp --id <repo-id>
  pifrost doctor
  pifrost --version

Global setup options:
  --url <url>                    Bifrost URL, e.g. http://192.168.1.221:8180/v1
  --api-key <key>                Inference Bearer/API key
  --virtual-key <key>            Global inference Virtual Key
  --management-auth <mode>       basic (Bifrost OSS) or bearer (Enterprise)
  --management-username <user>   OSS admin/dashboard username
  --management-password <pass>   OSS admin/dashboard password
  --management-key <key>         Enterprise scoped management API key
  --skip-omp                     Do not change OMP settings
  --skip-test                    Save without connectivity tests
  --yes                          Accept existing/default values non-interactively

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
  throw new Error("Management auth mode must be `basic` (Bifrost OSS) or `bearer` (Bifrost Enterprise)");
}

function buildManagementAuth(mode, username, password, apiKey) {
  if (!mode) return undefined;
  if (mode === "basic") {
    if (!username || !password) {
      throw new Error("Bifrost OSS management auth requires both --management-username and --management-password");
    }
    return { mode: "basic", username, password };
  }
  if (!apiKey) throw new Error("Bifrost Enterprise management auth requires --management-key");
  return { mode: "bearer", apiKey };
}

function requireRuntime(state) {
  const runtime = runtimeConfigFromState(state);
  if (!runtime.url || !runtime.apiKey || !runtime.virtualKey) {
    throw new Error("Global inference configuration is incomplete; run `pifrost global setup`");
  }
  return runtime;
}

function requireManagement(state) {
  const runtime = requireRuntime(state);
  const managementAuth = managementAuthFromState(state);
  if (!managementAuth) {
    throw new Error(
      "Bifrost management authentication is missing; run `pifrost global setup`. Use OSS admin username/password (Basic auth), or an Enterprise scoped API key.",
    );
  }
  // Keep the legacy local variable name so the rest of the control-plane code
  // remains source-compatible; it now carries a management-auth descriptor.
  return { ...runtime, managementKey: managementAuth };
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

  if (!explicitMode) {
    if (flagString(flags, "management-key") || process.env.BIFROST_MANAGEMENT_API_KEY) managementMode = "bearer";
    if (
      flagString(flags, "management-username") ||
      flagString(flags, "management-password") ||
      process.env.BIFROST_ADMIN_USERNAME ||
      process.env.BIFROST_ADMIN_PASSWORD
    ) {
      managementMode = "basic";
    }
  }

  const nonInteractive = Boolean(flags.yes) || (!process.stdin.isTTY && !flagString(flags, "url"));
  if (!nonInteractive) {
    await withPrompter(async (rl) => {
      url = await ask(rl, "Bifrost URL", url ?? "http://127.0.0.1:8180/v1");
      apiKey = await askSecret(rl, "Inference API/Bearer key", apiKey);
      virtualKey = await askSecret(rl, "Global inference Virtual Key", virtualKey);
      const wantManagement = await confirm(
        rl,
        "Configure management auth for route sync and repo MCP automation?",
        true,
      );
      if (wantManagement) {
        const selected = await ask(
          rl,
          "Management auth mode (basic=OSS admin credentials, bearer=Enterprise API key)",
          managementMode ?? "basic",
        );
        managementMode = normalizeManagementMode(selected);
        if (managementMode === "basic") {
          managementUsername = await ask(rl, "Bifrost admin username", managementUsername);
          managementPassword = await askSecret(rl, "Bifrost admin password", managementPassword);
          managementApiKey = undefined;
        } else {
          managementApiKey = await askSecret(rl, "Enterprise scoped management API key", managementApiKey);
          managementUsername = undefined;
          managementPassword = undefined;
        }
      } else {
        managementMode = undefined;
        managementUsername = undefined;
        managementPassword = undefined;
        managementApiKey = undefined;
      }
    });
  }

  if (!url || !apiKey || !virtualKey) {
    throw new Error("Bifrost URL, inference API key and global inference Virtual Key are required");
  }
  url = normalizeBifrostUrl(url);
  const managementAuth = buildManagementAuth(
    managementMode,
    managementUsername,
    managementPassword,
    managementApiKey,
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
  state.secrets.inferenceApiKey = apiKey;
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

async function commandGlobalStatus() {
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const managementAuth = managementAuthFromState(state);
  printHeader("Global Pifrost status");
  console.log(`Config directory:       ${state.paths.root}`);
  console.log(`Bifrost URL:            ${runtime.url ?? "missing"}`);
  console.log(`Inference API key:      ${runtime.apiKey ? "set" : "missing"}`);
  console.log(`Inference Virtual Key:  ${runtime.virtualKey ? "set" : "missing"}`);
  console.log(`Management auth:        ${managementAuthLabel(managementAuth)}`);
  if (managementAuth?.mode === "basic") {
    console.log(`Admin username:         ${managementAuth.username ? "set" : "missing"}`);
    console.log(`Admin password:         ${managementAuth.password ? "set" : "missing"}`);
  } else if (managementAuth?.mode === "bearer") {
    console.log(`Management API key:     ${managementAuth.apiKey ? "set" : "missing"}`);
  }
  console.log(`OMP installed:          ${boolMark(commandExists("omp"))}`);
  if (runtime.url && runtime.apiKey && runtime.virtualKey) {
    try {
      const result = await testInference(runtime);
      console.log(`Inference connection:   OK (${result.models} models)`);
    } catch (error) {
      console.log(`Inference connection:   FAIL (${formatError(error)})`);
    }
  }
  if (runtime.url && managementAuth) {
    try {
      await testManagement(runtime.url, managementAuth);
      console.log("Management connection:  OK");
    } catch (error) {
      console.log(`Management connection:  FAIL (${formatError(error)})`);
    }
  }
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

async function commandRoutesList() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const rules = await getRoutingRules(url, managementKey);
  const manifest = deriveAliasesFromRules(rules);
  printHeader(`Bifrost OMP routes (${Object.keys(manifest.aliases).length})`);
  for (const [id, definition] of Object.entries(manifest.aliases).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(id);
    definition.chain.forEach((member, index) => console.log(`  ${index + 1}. ${member}`));
  }
}

async function commandRoutesDiff() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const remote = deriveAliasesFromRules(await getRoutingRules(url, managementKey));
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
  }
  process.exitCode = 2;
}

async function commandRoutesSync(flags = {}) {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const rules = await getRoutingRules(url, managementKey);
  const manifest = deriveAliasesFromRules(rules);
  const count = Object.keys(manifest.aliases).length;
  if (!count) throw new Error("No enabled omp-* routing rules could be derived from Bifrost");
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

function modelTableFromCache() {
  const cachePath = join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "", ".omp/agent"), "pifrost.catalog.json");
  if (!existsSync(cachePath)) return { cachePath, cache: undefined };
  try {
    return { cachePath, cache: JSON.parse(readFileSync(cachePath, "utf8")) };
  } catch {
    return { cachePath, cache: undefined };
  }
}

async function commandModelsDoctor() {
  const { cachePath, cache } = modelTableFromCache();
  printHeader("Pifrost model catalog");
  if (!cache) {
    console.log(`No valid catalog file found at ${cachePath}`);
    console.log("Run: pifrost models refresh --force");
    process.exitCode = 2;
    return;
  }
  console.log(`Cache: ${cachePath}`);
  console.log(`Generated: ${cache.generatedAt ?? "unknown"}`);
  const models = Array.isArray(cache.models) ? cache.models : [];
  for (const model of models) {
    const efforts = model.thinking?.efforts?.join(",") ?? "-";
    const images = model.input?.includes("image") ? "yes" : "no";
    console.log(
      `${String(model.id).padEnd(16)} context=${String(model.contextWindow).padEnd(8)} max=${String(model.maxTokens).padEnd(8)} thinking=${efforts.padEnd(24)} images=${images}`,
    );
  }
  const diagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];
  const unresolved = diagnostics.filter((item) => Array.isArray(item.unresolved) && item.unresolved.length);
  if (unresolved.length) {
    console.log("\nUnresolved route members:");
    for (const item of unresolved) console.log(`  ${item.id}: ${item.unresolved.join(", ")}`);
    process.exitCode = 2;
  }
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
  const available = await listMcpClients(url, managementKey);
  const names = splitCsv(flagString(flags, "clients"));
  const commonTools = splitCsv(flagString(flags, "tools"));
  const clients = names.length
    ? resolveNamedClients(available, names, commonTools)
    : await chooseClientsInteractively(available);
  const vk = await upsertRepoVirtualKey({ state, repo, clients, url, managementKey });
  const file = writeRepoMcpConfig(repo.root, url, repo.id);
  const refreshed = loadState();
  const secret = refreshed.secrets.repos?.[repo.id]?.mcpVirtualKey;
  if (!secret) throw new Error("Repo MCP Virtual Key was not persisted");
  const test = await testMcp(url, secret);

  printHeader(`Repo configured: ${repo.name}`);
  console.log(`Repo id:          ${repo.id}`);
  console.log(`Virtual Key:      ${vk.name ?? refreshed.config.repos?.[repo.id]?.virtualKeyName}`);
  console.log(`Virtual Key id:   ${vk.id}`);
  console.log(`MCP clients:      ${clients.map((client) => `${client.name}[${client.tools.join(",")}]`).join(", ")}`);
  console.log(`OMP MCP config:   ${file.path}`);
  console.log(`MCP initialize:   HTTP ${test.status}${test.ok ? " OK" : " FAIL"}`);
  if (!test.ok) {
    console.log(JSON.stringify(test.body));
    process.exitCode = 2;
  }
}

async function commandRepoStatus() {
  const state = loadState();
  const runtime = requireRuntime(state);
  const repoState = currentRepoState(state);
  printHeader(`Repo Pifrost status: ${repoState.repo.name}`);
  console.log(`Repo id:          ${repoState.repo.id}`);
  console.log(`Virtual Key id:   ${repoState.config?.virtualKeyId ?? "missing"}`);
  console.log(`Virtual Key name: ${repoState.config?.virtualKeyName ?? "missing"}`);
  console.log(`Repo secret:      ${repoState.secret?.mcpVirtualKey ? "set" : "missing"}`);
  console.log(`MCP config:       ${join(repoState.repo.root, ".omp/mcp.json")}${existsSync(join(repoState.repo.root, ".omp/mcp.json")) ? "" : " (missing)"}`);
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
    `MCP clients:      ${(repoState.config?.mcpClients ?? []).map((client) => `${client.name}[${client.tools.join(",")}]`).join(", ") || "none"}`,
  );
}

async function commandRepoMcpList() {
  const state = loadState();
  const { url, managementKey } = requireManagement(state);
  const clients = await listMcpClients(url, managementKey);
  printHeader(`Bifrost MCP clients (${clients.length})`);
  for (const client of clients.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${client.name}  state=${client.state ?? "unknown"}  tools=${client.tools.length || "unknown"}`);
    if (client.tools.length) console.log(`  ${client.tools.join(", ")}`);
  }
}

async function requireRepoVirtualKey(state) {
  const { url, managementKey } = requireManagement(state);
  const current = currentRepoState(state);
  if (!current.config?.virtualKeyId) throw new Error("Current repo is not initialized; run `pifrost repo init`");
  const vk = await getVirtualKey(url, managementKey, current.config.virtualKeyId);
  return { url, managementKey, current, vk };
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

async function commandRepoRotateKey() {
  const state = loadState();
  const { url, managementKey, current, vk } = await requireRepoVirtualKey(state);
  const rotated = await rotateVirtualKey(url, managementKey, vk.id);
  const value = rotated?.value;
  if (!value || typeof value !== "string") throw new Error("Bifrost rotate response did not include the new key value");
  updateRepoState(state, current.repo.id, {}, { mcpVirtualKey: value });
  console.log(`Rotated MCP Virtual Key for ${current.repo.name}; local secret store updated.`);
}

async function commandRepoReset() {
  const state = loadState();
  const current = currentRepoState(state);
  const path = join(current.repo.root, ".omp/mcp.json");
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
  removeRepoState(state, current.repo.id);
  console.log(`Removed local Pifrost repo configuration for ${current.repo.name}.`);
  console.log("The Bifrost Virtual Key itself was left intact; delete it in Bifrost or re-run repo init to reuse it.");
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
  await commandGlobalStatus();
  console.log("");
  await commandModelsDoctor();
  try {
    getRepoRoot();
    console.log("");
    await commandRepoStatus();
  } catch (error) {
    if (!String(formatError(error)).includes("not inside a Git repository")) throw error;
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [one, two, three, four] = positional;
  if (flags.version || one === "--version" || one === "version") {
    console.log(VERSION);
    return;
  }
  if (flags.help || !one || one === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (one === "init") return commandInit(flags);
  if (one === "global" && two === "setup") return commandGlobalSetup(flags);
  if (one === "global" && two === "status") return commandGlobalStatus();
  if (one === "global" && two === "configure-omp") {
    const result = configureOmp();
    console.log(`Configured ${result.settings} OMP settings.`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
    return;
  }
  if (one === "routes" && two === "list") return commandRoutesList();
  if (one === "routes" && two === "diff") return commandRoutesDiff();
  if (one === "routes" && two === "sync") return commandRoutesSync(flags);
  if (one === "models" && two === "refresh") return commandModelsRefresh(flags);
  if (one === "models" && two === "doctor") return commandModelsDoctor();
  if (one === "repo" && two === "init") return commandRepoInit(flags);
  if (one === "repo" && two === "status") return commandRepoStatus();
  if (one === "repo" && two === "rotate-key") return commandRepoRotateKey();
  if (one === "repo" && two === "reset") return commandRepoReset();
  if (one === "repo" && two === "mcp" && three === "list") return commandRepoMcpList();
  if (one === "repo" && two === "mcp" && three === "add") return commandRepoMcpAdd(four, flags);
  if (one === "repo" && two === "mcp" && three === "remove") return commandRepoMcpRemove(four);
  if (one === "secret" && two === "repo-mcp") return commandSecretRepoMcp(flags);
  if (one === "doctor") return commandDoctor();

  throw new Error(`Unknown command: ${positional.join(" ")}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(`pifrost: ${formatError(error)}`);
  process.exitCode = 1;
});
