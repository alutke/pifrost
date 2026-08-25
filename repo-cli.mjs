#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  currentRepoState,
  getVirtualKey,
  loadState,
  managementAuthFromState,
  removeRepoState,
  repoIdentity,
  rotateVirtualKey,
  runtimeConfigFromState,
  testMcp,
  updateRepoState,
  updateVirtualKey,
  upsertRepoVirtualKey,
  virtualKeyMcpConfigs,
  writeRepoMcpConfig,
} from "./cli-lib.mjs";
import { listMcpClients, mcpAssignment } from "./mcp-client-normalization.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

function printHeader(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function requireManagement(state) {
  const runtime = runtimeConfigFromState(state);
  const managementAuth = managementAuthFromState(state);
  if (!runtime.url || !runtime.apiKey || !runtime.virtualKey) {
    throw new Error("Global inference configuration is incomplete; run `pifrost global setup`");
  }
  if (!managementAuth) {
    throw new Error("Bifrost management authentication is missing; run `pifrost global setup`");
  }
  return { ...runtime, managementKey: managementAuth };
}

function parseSelection(value, max) {
  const indexes = splitCsv(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= max);
  return [...new Set(indexes)];
}

async function chooseClientsInteractively(clients) {
  if (!clients.length) throw new Error("Bifrost returned no named MCP clients");
  const rl = createInterface({ input, output });
  try {
    console.log("\nAvailable Bifrost MCP clients:");
    clients.forEach((client, index) => {
      const tools = client.tools.length ? `${client.tools.length} tools` : "tools not reported";
      const id = client.id && client.id !== client.name ? `; id=${client.id}` : "";
      console.log(`  [${index + 1}] ${client.name} (${client.state ?? "unknown"}; ${tools}${id})`);
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
  } finally {
    rl.close();
  }
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

  for (const client of clients) mcpAssignment(client, client.tools);

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
  const runtime = runtimeConfigFromState(state);
  if (!runtime.url) throw new Error("Global Bifrost URL is missing; run `pifrost global setup`");
  const repoState = currentRepoState(state);
  printHeader(`Repo Pifrost status: ${repoState.repo.name}`);
  console.log(`Repo id:          ${repoState.repo.id}`);
  console.log(`Virtual Key id:   ${repoState.config?.virtualKeyId ?? "missing"}`);
  console.log(`Virtual Key name: ${repoState.config?.virtualKeyName ?? "missing"}`);
  console.log(`Repo secret:      ${repoState.secret?.mcpVirtualKey ? "set" : "missing"}`);
  const mcpPath = join(repoState.repo.root, ".omp/mcp.json");
  console.log(`MCP config:       ${mcpPath}${existsSync(mcpPath) ? "" : " (missing)"}`);
  if (repoState.secret?.mcpVirtualKey) {
    try {
      const test = await testMcp(runtime.url, repoState.secret.mcpVirtualKey);
      console.log(`MCP initialize:   HTTP ${test.status}${test.ok ? " OK" : " FAIL"}`);
      if (!test.ok) console.log(`MCP response:     ${JSON.stringify(test.body)}`);
    } catch (error) {
      console.log(`MCP initialize:   FAIL (${error instanceof Error ? error.message : String(error)})`);
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
    const id = client.id && client.id !== client.name ? `  id=${client.id}` : "";
    console.log(`${client.name}${id}  state=${client.state ?? "unknown"}  tools=${client.tools.length || "unknown"}`);
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
  const assignment = mcpAssignment(found, tools.length ? tools : ["*"]);
  const configs = virtualKeyMcpConfigs(vk).filter((item) => item.mcp_client_name !== found.name);
  configs.push(assignment);
  const updated = await updateVirtualKey(url, managementKey, vk.id, { mcp_configs: configs });
  const normalized = virtualKeyMcpConfigs(updated).map((item) => ({
    name: item.mcp_client_name,
    tools: item.tools_to_execute,
  }));
  updateRepoState(state, current.repo.id, { mcpClients: normalized });
  console.log(`Added ${found.name} to ${current.config.virtualKeyName} with tools: ${assignment.tools_to_execute.join(",")}`);
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
      writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    }
  }
  removeRepoState(state, current.repo.id);
  console.log(`Removed local Pifrost repo configuration for ${current.repo.name}.`);
  console.log("The Bifrost Virtual Key itself was left intact; delete it in Bifrost or re-run repo init to reuse it.");
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [one, two, three] = positional;
  if (one === "init") return commandRepoInit(flags);
  if (one === "status") return commandRepoStatus();
  if (one === "rotate-key") return commandRepoRotateKey();
  if (one === "reset") return commandRepoReset();
  if (one === "mcp" && two === "list") return commandRepoMcpList();
  if (one === "mcp" && two === "add") return commandRepoMcpAdd(three, flags);
  if (one === "mcp" && two === "remove") return commandRepoMcpRemove(three);
  throw new Error(`Unknown repo command: ${positional.join(" ")}`);
}

main().catch((error) => {
  console.error(`pifrost: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
