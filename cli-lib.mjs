import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const VERSION = "0.2.0";
export const MCP_SCHEMA_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
export const DEFAULT_BIFROST_URL = "http://127.0.0.1:8180/v1";
export const DEFAULT_MCP_TIMEOUT_MS = 120_000;

export const ROLE_MAP = Object.freeze({
  default: "bifrost/omp-default",
  smol: "bifrost/omp-smol",
  task: "bifrost/omp-task",
  advisor: "bifrost/omp-advisor",
  slow: "bifrost/omp-slow",
  plan: "bifrost/omp-plan",
  designer: "bifrost/omp-designer",
  vision: "bifrost/omp-vision",
  commit: "bifrost/omp-commit",
  tiny: "bifrost/omp-tiny",
});

export class PifrostHttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "PifrostHttpError";
    this.status = status;
    this.body = body;
  }
}

export function nonEmpty(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeBifrostUrl(value) {
  const input = nonEmpty(value);
  if (!input) throw new Error("Bifrost URL is required");
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid Bifrost URL: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Bifrost URL must use http:// or https://");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Bifrost URL must not contain a query string or fragment");
  }
  let path = parsed.pathname.replace(/\/+$/u, "");
  path = path.replace(/\/(?:chat\/completions|models)$/u, "");
  if (!/\/v1$/u.test(path)) path = `${path}/v1`;
  parsed.pathname = path;
  return parsed.toString().replace(/\/$/u, "");
}

export function bifrostManagementBase(value) {
  const parsed = new URL(normalizeBifrostUrl(value));
  parsed.pathname = parsed.pathname.replace(/\/v1$/u, "") || "/";
  return parsed.toString().replace(/\/$/u, "");
}

export function bifrostMcpUrl(value) {
  return `${bifrostManagementBase(value)}/mcp`;
}

export function pifrostConfigDir(env = process.env) {
  return nonEmpty(env.PIFROST_CONFIG_DIR) ?? resolve(homedir(), ".config/pifrost");
}

export function pifrostPaths(env = process.env) {
  const root = pifrostConfigDir(env);
  return {
    root,
    config: join(root, "config.json"),
    secrets: join(root, "secrets.json"),
    backups: join(root, "backups"),
  };
}

export function ompAgentDir(env = process.env) {
  return nonEmpty(env.PI_CODING_AGENT_DIR) ?? resolve(homedir(), ".omp/agent");
}

export function aliasManifestPath(env = process.env) {
  return nonEmpty(env.PIFROST_ALIASES) ?? resolve(ompAgentDir(env), "pifrost.aliases.json");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object: ${path}`);
  }
  return parsed;
}

function writeJsonAtomic(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
  chmodSync(path, mode);
}

export function loadState(env = process.env) {
  const paths = pifrostPaths(env);
  const config = readJson(paths.config, {
    schemaVersion: 1,
    bifrost: {},
    repos: {},
  });
  const secrets = readJson(paths.secrets, {
    schemaVersion: 1,
    repos: {},
  });
  config.schemaVersion ??= 1;
  config.bifrost ??= {};
  config.repos ??= {};
  secrets.schemaVersion ??= 1;
  secrets.repos ??= {};
  return { paths, config, secrets };
}

export function saveState(config, secrets, env = process.env) {
  const paths = pifrostPaths(env);
  writeJsonAtomic(paths.config, config, 0o600);
  writeJsonAtomic(paths.secrets, secrets, 0o600);
  return paths;
}

export function redactSecret(value) {
  if (!nonEmpty(value)) return "missing";
  return "set";
}

export function runtimeConfigFromState(state) {
  const url = nonEmpty(process.env.BIFROST_URL) ?? nonEmpty(state.config?.bifrost?.url);
  const apiKey = nonEmpty(process.env.BIFROST_API_KEY) ?? nonEmpty(state.secrets?.inferenceApiKey);
  const virtualKey =
    nonEmpty(process.env.BIFROST_VIRTUAL_KEY) ?? nonEmpty(state.secrets?.inferenceVirtualKey);
  return { url: url ? normalizeBifrostUrl(url) : undefined, apiKey, virtualKey };
}

export function managementKeyFromState(state) {
  return nonEmpty(process.env.BIFROST_MANAGEMENT_API_KEY) ?? nonEmpty(state.secrets?.managementApiKey);
}

export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const headers = { Accept: "application/json", ...(options.headers ?? {}) };
    let body;
    if (options.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    const response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      const detail =
        parsed?.error?.message ?? parsed?.message ?? (typeof parsed === "string" ? parsed.slice(0, 500) : "");
      throw new PifrostHttpError(
        response.status,
        `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        parsed,
      );
    }
    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Request timed out: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testInference({ url, apiKey, virtualKey }) {
  if (!url || !apiKey || !virtualKey) throw new Error("Inference URL, API key and Virtual Key are required");
  const body = await requestJson(`${normalizeBifrostUrl(url)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, "x-bf-vk": virtualKey },
  });
  const models = Array.isArray(body?.data) ? body.data : [];
  if (!models.length) throw new Error("Bifrost inference test returned no models");
  return { models: models.length };
}

export function managementHeaders(key) {
  if (!nonEmpty(key)) throw new Error("Bifrost management API key is required; run `pifrost global setup`");
  return { Authorization: `Bearer ${key}` };
}

export async function testManagement(url, key) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys?limit=1&offset=0`, {
    headers: managementHeaders(key),
  });
  return body;
}

export async function getRoutingRules(url, key) {
  const base = bifrostManagementBase(url);
  const headers = managementHeaders(key);
  const candidates = [
    `${base}/api/routing/rules?limit=100&offset=0`,
    `${base}/api/governance/routing-rules?limit=100&offset=0`,
  ];
  let lastError;
  for (const endpoint of candidates) {
    try {
      const body = await requestJson(endpoint, { headers });
      const rules = Array.isArray(body?.rules)
        ? body.rules
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body)
            ? body
            : [];
      return rules;
    } catch (error) {
      lastError = error;
      if (!(error instanceof PifrostHttpError) || ![404, 405].includes(error.status)) throw error;
    }
  }
  throw lastError ?? new Error("Unable to read Bifrost routing rules");
}

export function aliasIdFromRule(rule) {
  const name = nonEmpty(rule?.name);
  if (name && /^omp-[A-Za-z0-9._-]+$/u.test(name)) return name;
  const expression = nonEmpty(rule?.cel_expression) ?? "";
  const match = expression.match(/["'](omp-[A-Za-z0-9._-]+)["']/u);
  return match?.[1];
}

export function targetReference(target) {
  const model = nonEmpty(target?.model);
  if (!model) return undefined;
  const provider = nonEmpty(target?.provider);
  if (!provider) return model;
  if (model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return model;
  return `${provider}/${model}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function deriveAliasesFromRules(rules) {
  const aliases = {};
  for (const rule of rules ?? []) {
    if (rule?.enabled === false) continue;
    const id = aliasIdFromRule(rule);
    if (!id) continue;
    const targets = Array.isArray(rule?.targets) ? [...rule.targets] : [];
    targets.sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0));
    const chain = unique([
      ...targets.map(targetReference),
      ...(Array.isArray(rule?.fallbacks) ? rule.fallbacks.map(nonEmpty) : []),
    ]);
    if (!chain.length) continue;
    aliases[id] = { name: id, chain };
  }
  return { includePhysicalModels: false, aliases };
}

export function loadAliasManifest(path = aliasManifestPath()) {
  if (!existsSync(path)) return { includePhysicalModels: false, aliases: {} };
  return readJson(path, { includePhysicalModels: false, aliases: {} });
}

export function backupFile(path, backupDir) {
  if (!existsSync(path)) return undefined;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const destination = join(backupDir, `${basename(path)}.${stamp}.bak`);
  copyFileSync(path, destination);
  chmodSync(destination, 0o600);
  return destination;
}

export function writeAliasManifest(manifest, env = process.env) {
  const path = aliasManifestPath(env);
  const state = loadState(env);
  const backup = backupFile(path, state.paths.backups);
  writeJsonAtomic(path, manifest, 0o600);
  return { path, backup };
}

export function diffAliases(localManifest, remoteManifest) {
  const local = localManifest?.aliases ?? {};
  const remote = remoteManifest?.aliases ?? {};
  const ids = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort();
  return ids.flatMap((id) => {
    const left = local[id]?.chain ?? local[id] ?? undefined;
    const right = remote[id]?.chain ?? remote[id] ?? undefined;
    if (JSON.stringify(left) === JSON.stringify(right)) return [];
    return [{ id, local: left, remote: right }];
  });
}

export function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "pipe" });
  return !result.error && result.status === 0;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return { stdout: result.stdout?.trim() ?? "", stderr: result.stderr?.trim() ?? "" };
}

export function installOmpPlugin() {
  if (!commandExists("omp")) throw new Error("`omp` is not installed or not on PATH");
  runCommand("omp", ["install", "--force", "github:alutke/pifrost"], { inherit: true });
}

export function backupOmpConfig(env = process.env) {
  if (!commandExists("omp")) return undefined;
  let agentDir;
  try {
    agentDir = runCommand("omp", ["config", "path"]).stdout;
  } catch {
    agentDir = ompAgentDir(env);
  }
  const candidates = [join(agentDir, "config.yml"), join(agentDir, "config.yaml")];
  const configPath = candidates.find(existsSync);
  if (!configPath) return undefined;
  const state = loadState(env);
  return backupFile(configPath, state.paths.backups);
}

export function configureOmp() {
  if (!commandExists("omp")) throw new Error("`omp` is not installed or not on PATH");
  const backup = backupOmpConfig();
  const settings = [
    ["modelProviderOrder", JSON.stringify(["bifrost"])],
    ["enabledModels", JSON.stringify(["bifrost/*"])],
    ["retry.modelFallback", "false"],
    ["task.enableEffort", "true"],
    ["task.enableLsp", "true"],
    ...Object.entries(ROLE_MAP).map(([role, model]) => [`modelRoles.${role}`, model]),
  ];
  for (const [key, value] of settings) runCommand("omp", ["config", "set", key, value]);
  return { backup, settings: settings.length };
}

export function getRepoRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0 || !nonEmpty(result.stdout)) {
    throw new Error("Current directory is not inside a Git repository");
  }
  return realpathSync(result.stdout.trim());
}

function sanitizeGitRemote(value) {
  const remote = nonEmpty(value);
  if (!remote) return undefined;
  if (/^[^@]+@[^:]+:.+/u.test(remote)) {
    const [, host, path] = remote.match(/^[^@]+@([^:]+):(.+)$/u) ?? [];
    return host && path ? `${host}/${path.replace(/\.git$/u, "")}` : remote;
  }
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    return `${url.host}${url.pathname}`.replace(/\.git$/u, "").replace(/\/+$/u, "");
  } catch {
    return remote.replace(/\.git$/u, "");
  }
}

export function repoIdentity(cwd = process.cwd()) {
  const root = getRepoRoot(cwd);
  const remoteResult = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const identity = sanitizeGitRemote(remoteResult.status === 0 ? remoteResult.stdout : undefined) ?? root;
  const name = basename(root).replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "repo";
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 10);
  const id = `${name.toLowerCase()}-${digest}`;
  return { root, name, identity, id };
}

export function mcpConfigPath(root) {
  return join(root, ".omp/mcp.json");
}

export function buildRepoMcpConfig(existing, bifrostUrl, repoId) {
  const result = existing && typeof existing === "object" && !Array.isArray(existing) ? structuredClone(existing) : {};
  result.$schema ??= MCP_SCHEMA_URL;
  result.mcpServers ??= {};
  result.mcpServers.bifrost = {
    type: "http",
    url: bifrostMcpUrl(bifrostUrl),
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    headers: {
      "x-bf-vk": `!pifrost secret repo-mcp --id ${repoId}`,
    },
  };
  return result;
}

export function writeRepoMcpConfig(root, bifrostUrl, repoId) {
  const path = mcpConfigPath(root);
  const existing = existsSync(path) ? readJson(path, {}) : {};
  mkdirSync(dirname(path), { recursive: true });
  const backup = existsSync(path) ? backupFile(path, join(dirname(path), "backups")) : undefined;
  writeJsonAtomic(path, buildRepoMcpConfig(existing, bifrostUrl, repoId), 0o600);
  return { path, backup };
}

function arrayFromResponse(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export function normalizeMcpClient(client) {
  const name = nonEmpty(client?.name) ?? nonEmpty(client?.client_name) ?? nonEmpty(client?.client_id) ?? String(client?.id ?? "");
  const rawTools = Array.isArray(client?.tools)
    ? client.tools
    : Array.isArray(client?.available_tools)
      ? client.available_tools
      : [];
  const tools = unique(
    rawTools.map((tool) =>
      typeof tool === "string"
        ? nonEmpty(tool)
        : nonEmpty(tool?.name) ?? nonEmpty(tool?.function?.name) ?? nonEmpty(tool?.tool_name),
    ),
  );
  return {
    id: client?.id ?? client?.client_id,
    name,
    state: client?.state ?? client?.status ?? client?.connection_state,
    disabled: Boolean(client?.disabled),
    allowOnAllVirtualKeys: Boolean(client?.allow_on_all_virtual_keys),
    tools,
    raw: client,
  };
}

export async function listMcpClients(url, managementKey) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/mcp/clients?limit=100&offset=0`, {
    headers: managementHeaders(managementKey),
  });
  return arrayFromResponse(body, ["clients", "mcp_clients", "items"]).map(normalizeMcpClient);
}

export async function listVirtualKeys(url, managementKey, search) {
  const base = bifrostManagementBase(url);
  const query = new URLSearchParams({ limit: "100", offset: "0" });
  if (nonEmpty(search)) query.set("search", search.trim());
  const body = await requestJson(`${base}/api/governance/virtual-keys?${query}`, {
    headers: managementHeaders(managementKey),
  });
  return arrayFromResponse(body, ["virtual_keys", "keys", "items"]);
}

export async function getVirtualKey(url, managementKey, id) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}`, {
    headers: managementHeaders(managementKey),
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function createVirtualKey(url, managementKey, request) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys`, {
    method: "POST",
    headers: managementHeaders(managementKey),
    body: request,
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function updateVirtualKey(url, managementKey, id, request) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: managementHeaders(managementKey),
    body: request,
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function rotateVirtualKey(url, managementKey, id) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    headers: managementHeaders(managementKey),
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export function virtualKeyMcpConfigs(vk) {
  return (Array.isArray(vk?.mcp_configs) ? vk.mcp_configs : [])
    .map((config) => {
      const name =
        nonEmpty(config?.mcp_client_name) ??
        nonEmpty(config?.mcp_client?.name) ??
        nonEmpty(config?.client_name);
      if (!name) return undefined;
      const tools = Array.isArray(config?.tools_to_execute) ? config.tools_to_execute.map(String) : [];
      return { mcp_client_name: name, tools_to_execute: tools };
    })
    .filter(Boolean);
}

export async function upsertRepoVirtualKey({ state, repo, clients, url, managementKey }) {
  const keyName = `omp-${repo.name.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")}-mcp`;
  const local = state.config.repos?.[repo.id];
  let vk;
  if (local?.virtualKeyId) {
    try {
      vk = await updateVirtualKey(url, managementKey, local.virtualKeyId, {
        name: local.virtualKeyName ?? keyName,
        mcp_configs: clients.map((client) => ({
          mcp_client_name: client.name,
          tools_to_execute: client.tools,
        })),
        is_active: true,
      });
    } catch (error) {
      if (!(error instanceof PifrostHttpError) || error.status !== 404) throw error;
    }
  }
  if (!vk) {
    const matches = await listVirtualKeys(url, managementKey, keyName);
    const existing = matches.find((candidate) => candidate?.name === keyName);
    if (existing?.id) {
      vk = await updateVirtualKey(url, managementKey, existing.id, {
        name: keyName,
        mcp_configs: clients.map((client) => ({
          mcp_client_name: client.name,
          tools_to_execute: client.tools,
        })),
        is_active: true,
      });
      if (!nonEmpty(vk?.value) && nonEmpty(existing?.value)) vk.value = existing.value;
    } else {
      vk = await createVirtualKey(url, managementKey, {
        name: keyName,
        description: `Pifrost MCP-only key for ${repo.name}`,
        mcp_configs: clients.map((client) => ({
          mcp_client_name: client.name,
          tools_to_execute: client.tools,
        })),
        is_active: true,
      });
    }
  }
  if (!vk?.id) throw new Error("Bifrost did not return a Virtual Key id");
  let keyValue = nonEmpty(vk?.value);
  if (!keyValue || /\*|redact|masked/iu.test(keyValue)) {
    const rotated = await rotateVirtualKey(url, managementKey, vk.id);
    keyValue = nonEmpty(rotated?.value);
    vk = { ...vk, ...rotated };
  }
  if (!keyValue) throw new Error("Bifrost did not return the Virtual Key value after create/update/rotate");
  state.config.repos[repo.id] = {
    name: repo.name,
    identity: repo.identity,
    virtualKeyId: vk.id,
    virtualKeyName: vk.name ?? keyName,
    mcpClients: clients,
  };
  state.secrets.repos[repo.id] = { mcpVirtualKey: keyValue };
  saveState(state.config, state.secrets);
  return vk;
}

export async function testMcp(url, virtualKey) {
  const endpoint = bifrostMcpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-bf-vk": virtualKey,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "pifrost-cli", version: VERSION },
        },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : text;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export function currentRepoState(state, cwd = process.cwd()) {
  const repo = repoIdentity(cwd);
  return {
    repo,
    config: state.config.repos?.[repo.id],
    secret: state.secrets.repos?.[repo.id],
  };
}

export function updateRepoState(state, repoId, patch, secretPatch) {
  state.config.repos[repoId] = { ...(state.config.repos[repoId] ?? {}), ...patch };
  if (secretPatch) state.secrets.repos[repoId] = { ...(state.secrets.repos[repoId] ?? {}), ...secretPatch };
  saveState(state.config, state.secrets);
}

export function removeRepoState(state, repoId) {
  delete state.config.repos?.[repoId];
  delete state.secrets.repos?.[repoId];
  saveState(state.config, state.secrets);
}
