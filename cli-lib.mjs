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

export const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
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

function nonEmptySecret(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
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

/**
 * Resolve Bifrost management authentication for the standalone CLI.
 *
 * OSS uses the dashboard/admin username and password over HTTP Basic auth.
 * Enterprise can instead use a scoped management API key over Bearer auth.
 * Environment variables override the stored configuration. A pre-0.2.1
 * `managementApiKey` is retained as a backward-compatible bearer credential.
 */
export function managementAuthFromState(state, env = process.env) {
  const requestedMode = nonEmpty(env.BIFROST_MANAGEMENT_AUTH_MODE)?.toLowerCase();
  const envApiKey = nonEmpty(env.BIFROST_MANAGEMENT_API_KEY);
  const envUsername = nonEmpty(env.BIFROST_ADMIN_USERNAME);
  const envPassword = nonEmptySecret(env.BIFROST_ADMIN_PASSWORD);

  if (requestedMode === "basic") {
    return envUsername && envPassword ? { mode: "basic", username: envUsername, password: envPassword } : undefined;
  }
  if (requestedMode === "bearer") {
    return envApiKey ? { mode: "bearer", apiKey: envApiKey } : undefined;
  }
  if (envApiKey) return { mode: "bearer", apiKey: envApiKey };
  if (envUsername && envPassword) return { mode: "basic", username: envUsername, password: envPassword };

  const storedMode = nonEmpty(state.config?.bifrost?.managementAuthMode)?.toLowerCase();
  const storedApiKey = nonEmpty(state.secrets?.managementApiKey);
  const storedUsername = nonEmpty(state.secrets?.managementAdminUsername);
  const storedPassword = nonEmptySecret(state.secrets?.managementAdminPassword);

  if (storedMode === "basic") {
    return storedUsername && storedPassword
      ? { mode: "basic", username: storedUsername, password: storedPassword }
      : undefined;
  }
  if (storedMode === "bearer") {
    return storedApiKey ? { mode: "bearer", apiKey: storedApiKey } : undefined;
  }

  // Backward compatibility for 0.2.0 stores that had only managementApiKey.
  if (storedApiKey) return { mode: "bearer", apiKey: storedApiKey };
  if (storedUsername && storedPassword) {
    return { mode: "basic", username: storedUsername, password: storedPassword };
  }
  return undefined;
}

/** Backward-compatible helper retained for callers that explicitly need only an Enterprise API key. */
export function managementKeyFromState(state, env = process.env) {
  return nonEmpty(env.BIFROST_MANAGEMENT_API_KEY) ?? nonEmpty(state.secrets?.managementApiKey);
}

export function managementAuthLabel(auth) {
  if (auth?.mode === "basic") return "basic (OSS admin credentials)";
  if (auth?.mode === "bearer") return "bearer (Enterprise scoped API key)";
  if (typeof auth === "string" && nonEmpty(auth)) return "bearer (legacy API key)";
  return "missing";
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
  if (!url || !virtualKey) throw new Error("Inference URL and Virtual Key are required");
  const headers = { "x-bf-vk": virtualKey };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = await requestJson(`${normalizeBifrostUrl(url)}/models`, { headers });
  const models = Array.isArray(body?.data) ? body.data : [];
  if (!models.length) throw new Error("Bifrost inference test returned no models");
  return { models: models.length, authMode: apiKey ? "bearer+vk" : "virtual-key" };
}

export async function getBifrostVersion(url) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/version`, { timeoutMs: 8_000 });
  return nonEmpty(body?.version) ?? nonEmpty(body?.data?.version) ?? (typeof body === "string" ? nonEmpty(body) : undefined);
}

export async function getBifrostHealth(url) {
  const base = bifrostManagementBase(url);
  return requestJson(`${base}/health`, { timeoutMs: 8_000 });
}

export async function getVirtualKeyQuota(url, virtualKey) {
  const key = nonEmpty(virtualKey);
  if (!key) throw new Error("Bifrost Virtual Key is required for quota discovery");
  const base = bifrostManagementBase(url);
  return requestJson(`${base}/api/governance/virtual-keys/quota`, {
    headers: { "x-bf-vk": key },
    timeoutMs: 10_000,
  });
}

export async function getComplexityAnalyzerConfig(url, auth) {
  const base = bifrostManagementBase(url);
  try {
    return await requestJson(`${base}/api/routing/complexity-analyzer-config`, {
      headers: managementHeaders(auth),
      timeoutMs: 10_000,
    });
  } catch (error) {
    if (error instanceof PifrostHttpError && [404, 405].includes(error.status)) return undefined;
    throw error;
  }
}

export async function getBifrostConfig(url, auth) {
  const base = bifrostManagementBase(url);
  return requestJson(`${base}/api/config`, {
    headers: managementHeaders(auth),
    timeoutMs: 10_000,
  });
}

export function managementHeaders(auth) {
  // 0.2.0 compatibility: a bare string is an Enterprise Bearer key.
  if (typeof auth === "string") {
    const key = nonEmpty(auth);
    if (!key) throw new Error("Bifrost management authentication is required; run `pifrost global setup`");
    return { Authorization: `Bearer ${key}` };
  }
  if (auth?.mode === "basic") {
    const username = nonEmpty(auth.username);
    const password = nonEmptySecret(auth.password);
    if (!username || !password) {
      throw new Error("Bifrost OSS management auth requires an admin username and password");
    }
    const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  if (auth?.mode === "bearer") {
    const key = nonEmpty(auth.apiKey);
    if (!key) throw new Error("Bifrost Enterprise management auth requires a scoped API key");
    return { Authorization: `Bearer ${key}` };
  }
  throw new Error("Bifrost management authentication is required; run `pifrost global setup`");
}

export async function testManagement(url, auth) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys?limit=1&offset=0`, {
    headers: managementHeaders(auth),
  });
  return body;
}

function pageTotal(body) {
  const raw = body?.total_count ?? body?.totalCount;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function fetchAllPages(endpoint, headers, keys, extra = {}) {
  const limit = 100;
  const result = [];
  const seenPages = new Set();
  let offset = 0;

  while (true) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      ...extra,
    });
    const body = await requestJson(`${endpoint}?${query}`, { headers });
    const page = arrayFromResponse(body, keys);
    const signature = JSON.stringify(page.map((item) =>
      item?.id ?? item?.client_id ?? item?.name ?? item?.key ?? item,
    ));
    if (seenPages.has(signature)) break;
    seenPages.add(signature);
    result.push(...page);

    const total = pageTotal(body);
    if (total !== undefined && result.length >= total) break;
    if (page.length === 0 || page.length < limit) break;

    offset += page.length;
    if (offset > 100_000) throw new Error(`Refusing excessive pagination from ${endpoint}`);
  }

  return result;
}

export async function getRoutingRules(url, auth) {
  const base = bifrostManagementBase(url);
  const headers = managementHeaders(auth);
  const candidates = [
    `${base}/api/routing/rules`,
    `${base}/api/governance/routing-rules`,
  ];
  let lastError;
  for (const endpoint of candidates) {
    try {
      const rules = await fetchAllPages(endpoint, headers, ["rules", "routing_rules", "items"]);
      if (endpoint.includes("/api/routing/") && rules.length > 0) return rules;
      if (!endpoint.includes("/api/routing/")) return rules;
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

function routingRuleMembers(rule) {
  const targets = Array.isArray(rule?.targets) ? [...rule.targets] : [];
  targets.sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0));
  return unique([
    ...targets.map(targetReference),
    ...(Array.isArray(rule?.fallbacks) ? rule.fallbacks.map(nonEmpty) : []),
  ]);
}

export function deriveAliasesFromRules(rules) {
  const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
  const aliases = {};
  const aliasRules = new Map();
  for (const rule of enabled) {
    const id = aliasIdFromRule(rule);
    if (!id) continue;
    const members = routingRuleMembers(rule);
    if (!members.length) continue;
    const existing = aliases[id]?.chain ?? [];
    aliases[id] = { name: id, chain: unique([...existing, ...members]) };
    const bucket = aliasRules.get(id) ?? [];
    bucket.push(rule);
    aliasRules.set(id, bucket);
  }

  const allReachable = unique(enabled.flatMap(routingRuleMembers));
  for (const [id, related] of aliasRules) {
    if (related.some((rule) => rule?.chain_rule === true || rule?.chainRule === true)) {
      aliases[id] = { name: id, chain: unique([...(aliases[id]?.chain ?? []), ...allReachable]) };
    }
  }
  return { includePhysicalModels: false, aliases };
}

export function routingFeatureSummary(rules) {
  const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
  const scopes = unique(enabled.map((rule) => nonEmpty(rule?.scope) ?? "global")).sort();
  return {
    enabledRules: enabled.length,
    scopes,
    chainRules: enabled.filter((rule) => rule?.chain_rule === true || rule?.chainRule === true).length,
    weightedRules: enabled.filter((rule) => {
      const targets = Array.isArray(rule?.targets) ? rule.targets : [];
      return targets.length > 1 || targets.some((target) => Number(target?.weight ?? 1) !== 1);
    }).length,
    complexityRules: enabled.filter((rule) =>
      /complexity_tier/iu.test(String(rule?.cel_expression ?? rule?.celExpression ?? JSON.stringify(rule?.query ?? ""))),
    ).length,
  };
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
  // OMP exposes modelRoles as one schema record, not modelRoles.<role> paths.
  // Always use OMP's schema-aware CLI rather than rewriting its YAML directly.
  const settings = [
    ["modelProviderOrder", JSON.stringify(["bifrost"])],
    ["enabledModels", JSON.stringify(["bifrost/*"])],
    ["retry.modelFallback", "false"],
    ["task.enableEffort", "true"],
    ["task.enableLsp", "true"],
    ["modelRoles", JSON.stringify(ROLE_MAP)],
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
  const config = client?.config && typeof client.config === "object" && !Array.isArray(client.config)
    ? client.config
    : client;
  return {
    id: config?.client_id ?? client?.client_id ?? client?.id,
    name: nonEmpty(config?.name) ?? name,
    state: client?.state ?? client?.status ?? client?.connection_state,
    disabled: Boolean(config?.disabled ?? client?.disabled),
    allowOnAllVirtualKeys: Boolean(config?.allow_on_all_virtual_keys ?? client?.allow_on_all_virtual_keys),
    endpointSlug: nonEmpty(config?.endpoint_slug),
    connectionType: nonEmpty(config?.connection_type),
    authType: nonEmpty(config?.auth_type),
    isCodeModeClient: Boolean(config?.is_code_mode_client),
    toolsToAutoExecute: Array.isArray(config?.tools_to_auto_execute) ? config.tools_to_auto_execute.map(String) : [],
    needsSessionStickiness: typeof config?.needs_session_stickiness === "boolean" ? config.needs_session_stickiness : undefined,
    tools,
    raw: client,
  };
}

export async function listMcpClients(url, managementAuth) {
  const base = bifrostManagementBase(url);
  const clients = await fetchAllPages(
    `${base}/api/mcp/clients`,
    managementHeaders(managementAuth),
    ["clients", "mcp_clients", "items"],
  );
  return clients.map(normalizeMcpClient);
}

export async function listVirtualKeys(url, managementAuth, search) {
  const base = bifrostManagementBase(url);
  const extra = nonEmpty(search) ? { search: search.trim() } : {};
  return fetchAllPages(
    `${base}/api/governance/virtual-keys`,
    managementHeaders(managementAuth),
    ["virtual_keys", "keys", "items"],
    extra,
  );
}

export async function getVirtualKey(url, managementAuth, id) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}`, {
    headers: managementHeaders(managementAuth),
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function createVirtualKey(url, managementAuth, request) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys`, {
    method: "POST",
    headers: managementHeaders(managementAuth),
    body: request,
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function updateVirtualKey(url, managementAuth, id, request) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: managementHeaders(managementAuth),
    body: request,
  });
  return body?.virtual_key ?? body?.data ?? body;
}

export async function rotateVirtualKey(url, managementAuth, id) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    headers: managementHeaders(managementAuth),
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

function usableVirtualKeyValue(value) {
  const key = nonEmpty(value);
  if (!key || /\*|redact|masked/iu.test(key)) return undefined;
  return key;
}

export async function upsertRepoVirtualKey({
  state,
  repo,
  clients,
  url,
  managementKey,
  rotateExisting = false,
}) {
  const keyName = `omp-${repo.name.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")}-mcp`;
  const local = state.config.repos?.[repo.id];
  const localSecret = usableVirtualKeyValue(state.secrets.repos?.[repo.id]?.mcpVirtualKey);
  let vk;
  let created = false;

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
      if (!usableVirtualKeyValue(vk?.value) && usableVirtualKeyValue(existing?.value)) vk.value = existing.value;
    } else {
      created = true;
      vk = await createVirtualKey(url, managementKey, {
        name: keyName,
        description: `Pifrost MCP-only key for ${repo.name}`,
        // Explicit deny-by-default inference posture on Bifrost 2.x. The repo
        // key exists only to authenticate the MCP gateway.
        allow_all_providers: false,
        provider_configs: [],
        mcp_configs: clients.map((client) => ({
          mcp_client_name: client.name,
          tools_to_execute: client.tools,
        })),
        is_active: true,
      });
    }
  }

  if (!vk?.id) throw new Error("Bifrost did not return a Virtual Key id");

  // Persist the association before dealing with a missing raw value so an explicit
  // `repo rotate-key` can recover safely. Never rotate an existing key implicitly.
  state.config.repos[repo.id] = {
    name: repo.name,
    identity: repo.identity,
    virtualKeyId: vk.id,
    virtualKeyName: vk.name ?? keyName,
    mcpClients: clients,
  };

  let keyValue = usableVirtualKeyValue(vk?.value) ?? localSecret;
  if (!keyValue && !created && rotateExisting) {
    const rotated = await rotateVirtualKey(url, managementKey, vk.id);
    keyValue = usableVirtualKeyValue(rotated?.value);
    vk = { ...vk, ...rotated };
  }

  if (keyValue) state.secrets.repos[repo.id] = { mcpVirtualKey: keyValue };
  saveState(state.config, state.secrets);

  if (!keyValue) {
    if (created) {
      throw new Error(
        "Bifrost created the repo Virtual Key but did not return its raw value. The association was saved; run `pifrost repo rotate-key` to create and store a fresh value explicitly.",
      );
    }
    throw new Error(
      "An existing repo Virtual Key was found but its raw value is not available locally. Re-run `pifrost repo init --rotate-existing` to rotate it explicitly, or run `pifrost repo rotate-key` now that the association has been saved.",
    );
  }

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
