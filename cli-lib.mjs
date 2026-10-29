import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  aliasIdFromRule,
  deriveAliasesFromRules,
  routingFeatureSummary,
} from "./dist/routing-core.js";
import { PifrostHttpError, requestJson } from "./http-client.mjs";
import { postMcpJsonRpc, McpAmbiguousToolOutcomeError } from "./mcp-rpc.mjs";
import {
  mcpClientExecutionDiagnostics,
  normalizeMcpClientShape,
} from "./mcp-client-shape.mjs";

export { PifrostHttpError, requestJson };
export { mcpClientExecutionDiagnostics };
export { aliasIdFromRule, deriveAliasesFromRules, routingFeatureSummary };

export const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
export const MCP_SCHEMA_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
export const DEFAULT_BIFROST_URL = "http://127.0.0.1:8180/v1";
export const DEFAULT_MCP_TIMEOUT_MS = 120_000;
export const PIFROST_OMP_MIN_VERSION = "18.10.4";
export const PIFROST_OMP_POLICY_SNAPSHOT_VERSION = "18.12.5";
export const PIFROST_OMP_VALIDATED_VERSION = "18.12.5";
export const PIFROST_BIFROST_MIN_VERSION = "2.2.4";
export const PIFROST_BIFROST_VALIDATED_VERSION = "2.3.2";

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

export function nonEmpty(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
  // Match native OMP profile precedence and roots. Named profiles ignore
  // PI_CODING_AGENT_DIR; the selected profile applies to models and commands.
  const profile = (Object.hasOwn(env,"OMP_PROFILE") ? env.OMP_PROFILE : env.PI_PROFILE)?.trim();
  const configRoot = resolve(homedir(), nonEmpty(env.PI_CONFIG_DIR) ?? ".omp");
  if (profile && profile !== "default") {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(profile) || profile === "..") {
      throw new Error("Unsafe OMP profile name; select a simple named OMP profile.");
    }
    return resolve(configRoot, "profiles", profile, "agent");
  }
  return nonEmpty(env.PI_CODING_AGENT_DIR) ?? resolve(configRoot, "agent");
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
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const fd = openSync(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    mode,
  );
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, path);
    chmodSync(path, mode);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
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

export function runtimeConfigFromState(state, env = process.env) {
  const url = nonEmpty(env.BIFROST_URL) ?? nonEmpty(state.config?.bifrost?.url);
  const apiKey = nonEmpty(env.BIFROST_API_KEY) ?? nonEmpty(state.secrets?.inferenceApiKey);
  const virtualKey =
    nonEmpty(env.BIFROST_VIRTUAL_KEY) ?? nonEmpty(state.secrets?.inferenceVirtualKey);
  return { url: url ? normalizeBifrostUrl(url) : undefined, apiKey, virtualKey };
}

/**
 * Resolve Bifrost management authentication for the standalone CLI.
 *
 * OSS uses the dashboard/admin username and password over HTTP Basic auth.
 * Enterprise can instead use a scoped management API key over Bearer auth.
 * Normal management environment variables override stored configuration.
 * BIFROST_SETUP_TOKEN is intentionally weaker: unless setup mode is requested
 * explicitly, stored Basic/Bearer credentials outrank it so a stale bootstrap
 * token cannot break a completed installation. A pre-0.2.1 `managementApiKey`
 * is retained as a backward-compatible bearer credential.
 */
export function managementAuthFromState(state, env = process.env) {
  const requestedMode = nonEmpty(env.BIFROST_MANAGEMENT_AUTH_MODE)?.toLowerCase();
  const envApiKey = nonEmpty(env.BIFROST_MANAGEMENT_API_KEY);
  const envUsername = nonEmpty(env.BIFROST_ADMIN_USERNAME);
  const envPassword = nonEmptySecret(env.BIFROST_ADMIN_PASSWORD);
  const envSetupToken = nonEmptySecret(env.BIFROST_SETUP_TOKEN);

  if (requestedMode === "setup") {
    return envSetupToken ? { mode: "setup", setupToken: envSetupToken } : undefined;
  }
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

  // An ambient setup token is a last-resort bootstrap credential only. Once
  // normal management credentials exist they must win, otherwise a stale
  // BIFROST_SETUP_TOKEN can break every post-setup management operation.
  if (envSetupToken) return { mode: "setup", setupToken: envSetupToken };
  return undefined;
}

/** Backward-compatible helper retained for callers that explicitly need only an Enterprise API key. */
export function managementKeyFromState(state, env = process.env) {
  return nonEmpty(env.BIFROST_MANAGEMENT_API_KEY) ?? nonEmpty(state.secrets?.managementApiKey);
}

export function managementAuthLabel(auth) {
  if (auth?.mode === "basic") return "basic (OSS admin credentials)";
  if (auth?.mode === "bearer") return "bearer (Enterprise scoped API key)";
  if (auth?.mode === "setup") return "setup token (ephemeral)";
  if (typeof auth === "string" && nonEmpty(auth)) return "bearer (legacy API key)";
  return "missing";
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

export async function getBifrostSetupState(url) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/session/is-auth-enabled`, { timeoutMs: 8_000 });
  return {
    authEnabled: body?.is_auth_enabled === true,
    inferenceAuthEnforced: body?.inference_auth_enforced === true,
    setupRequired: body?.setup_required === true,
    setupTokenConfigured: body?.setup_token_configured === true,
    authType: nonEmpty(body?.auth_type) ?? "unknown",
  };
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

function quotaSourceRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sourceType = nonEmpty(value.source_type);
  const sourceId = nonEmpty(value.source_id);
  const sourceName = nonEmpty(value.source_name) ?? nonEmpty(value.source);
  if (!sourceType && !sourceId && !sourceName) return undefined;
  return { sourceType, sourceId, sourceName };
}

export function quotaGovernanceSources(quota) {
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) return [];
  const result = [];
  const seen = new Set();
  const add = (entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };

  const rateSources = (Array.isArray(quota.rate_limits) ? quota.rate_limits : [])
    .map(quotaSourceRef)
    .filter(Boolean);
  const rootRows = [
    ...(Array.isArray(quota.budgets) ? quota.budgets : []),
    ...(!rateSources.length && quota.rate_limit ? [quota.rate_limit] : []),
  ];
  let hasDirectVirtualKey = false;
  const externalSources = [];
  for (const row of rootRows) {
    const source = quotaSourceRef(row);
    if (source) externalSources.push(source);
    else hasDirectVirtualKey = true;
  }
  externalSources.push(...rateSources);
  if (hasDirectVirtualKey) {
    add({ kind: "virtual_key", name: nonEmpty(quota.virtual_key_name) });
  }
  for (const source of externalSources) add({ kind: "external", ...source });

  for (const config of Array.isArray(quota.provider_configs) ? quota.provider_configs : []) {
    const provider = nonEmpty(config?.provider);
    const hasGovernance =
      (Array.isArray(config?.budgets) && config.budgets.length > 0) ||
      Boolean(config?.rate_limit) ||
      (Array.isArray(config?.rate_limits) && config.rate_limits.length > 0);
    if (hasGovernance) add({ kind: "provider_config", provider });
  }

  for (const config of Array.isArray(quota.model_configs) ? quota.model_configs : []) {
    const modelId = nonEmpty(config?.model_name) ?? nonEmpty(config?.model);
    const provider = nonEmpty(config?.provider);
    const hasGovernance =
      (Array.isArray(config?.budgets) && config.budgets.length > 0) ||
      Boolean(config?.rate_limit) ||
      (Array.isArray(config?.rate_limits) && config.rate_limits.length > 0);
    if (hasGovernance && modelId && modelId !== "*") add({ kind: "model_config", provider, modelId });
  }

  return result;
}

export function formatQuotaGovernanceSource(source) {
  if (source?.kind === "external") {
    const type = nonEmpty(source.sourceType)
      ?.split(/[_-]+/u)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ?? "External";
    const name = nonEmpty(source.sourceName);
    const id = nonEmpty(source.sourceId);
    return `${type}${name ? ` "${name}"` : ""}${id ? ` [${id}]` : ""}`;
  }
  if (source?.kind === "provider_config") return `Direct provider config: ${source.provider ?? "unknown"}`;
  if (source?.kind === "model_config") {
    return `Direct model config: ${source.provider ? `${source.provider}/` : ""}${source.modelId ?? "unknown"}`;
  }
  return `Direct Virtual Key${source?.name ? ` "${source.name}"` : ""}`;
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

/** Read-only redacted provider inventory for gateway-owned injected-tool visibility. */
export async function listBifrostProviderInventory(url, auth) {
  const base = bifrostManagementBase(url);
  return requestJson(base + "/api/providers", {
    headers: managementHeaders(auth),
    timeoutMs: 10_000,
  });
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
  if (auth?.mode === "setup") {
    const token = nonEmptySecret(auth.setupToken);
    if (!token) throw new Error("Bifrost setup-token auth requires BIFROST_SETUP_TOKEN or --setup-token");
    return { "X-Bifrost-Setup-Token": token };
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
    const leftDefinition = local[id];
    const rightDefinition = remote[id];
    const left = leftDefinition?.chain ?? leftDefinition ?? undefined;
    const right = rightDefinition?.chain ?? rightDefinition ?? undefined;
    const localPins = Array.isArray(leftDefinition?.routingPins) ? leftDefinition.routingPins : [];
    const remotePins = Array.isArray(rightDefinition?.routingPins) ? rightDefinition.routingPins : [];
    if (JSON.stringify(left) === JSON.stringify(right) && JSON.stringify(localPins) === JSON.stringify(remotePins)) return [];
    return [{
      id,
      local: left,
      remote: right,
      ...(localPins.length || remotePins.length ? { localPins, remotePins } : {}),
    }];
  });
}

export function parseSemver(value) {
  const input = nonEmpty(value);
  if (!input) return undefined;
  const match = input.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:$|[^0-9])/u);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
  };
}

export function compareSemver(left, right) {
  const a = typeof left === "string" ? parseSemver(left) : left;
  const b = typeof right === "string" ? parseSemver(right) : right;
  if (!a || !b) return undefined;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

export function versionAtLeast(version, minimum) {
  const comparison = compareSemver(version, minimum);
  return comparison === undefined ? undefined : comparison >= 0;
}

export function compatibilityValidationStatus(version, minimum, validated) {
  const parsed = parseSemver(version);
  if (!parsed) {
    return { status: "unknown", detail: "installed version is unavailable or unparseable" };
  }
  if (versionAtLeast(parsed, minimum) === false) {
    return {
      status: "unsupported",
      detail: `installed ${parsed.version} is below minimum supported ${minimum}`,
    };
  }
  const vsValidated = compareSemver(parsed, validated);
  if (vsValidated === 0) {
    return {
      status: "tested-current",
      detail: `installed ${parsed.version} matches the current validated release`,
    };
  }
  if (vsValidated !== undefined && vsValidated > 0) {
    return {
      status: "newer",
      detail: `installed ${parsed.version} is newer than Pifrost's validated ${validated} boundary`,
    };
  }
  return {
    status: "supported",
    detail: `installed ${parsed.version} is within the supported ${minimum}..${validated} envelope`,
  };
}

export function commandVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (result.error || result.status !== 0) return undefined;
  return parseSemver([result.stdout, result.stderr].filter(Boolean).join("\n"))?.version;
}

export function getOmpVersion() {
  return commandVersion("omp");
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

export function repoVirtualKeyName(repo) {
  const safe = String(repo?.id ?? repo?.name ?? "repo")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "repo";
  return `omp-${safe}-mcp`;
}

export function mcpConfigPath(root) {
  return join(root, ".omp/mcp.json");
}

export function buildRepoMcpConfig(existing, bifrostUrl, repoId, options = {}) {
  const result = existing && typeof existing === "object" && !Array.isArray(existing) ? structuredClone(existing) : {};
  result.$schema ??= MCP_SCHEMA_URL;
  result.mcpServers ??= {};
  const previous =
    result.mcpServers.bifrost && typeof result.mcpServers.bifrost === "object" && !Array.isArray(result.mcpServers.bifrost)
      ? result.mcpServers.bifrost
      : {};
  const hasInstructionsOverride = Object.prototype.hasOwnProperty.call(options, "instructions");
  const requestedInstructions = hasInstructionsOverride ? options.instructions : previous.instructions;
  if (requestedInstructions !== undefined && requestedInstructions !== null && typeof requestedInstructions !== "boolean") {
    throw new Error("Repo MCP instructions policy must be true, false, null, or undefined");
  }

  result.mcpServers.bifrost = {
    type: "http",
    url: bifrostMcpUrl(bifrostUrl),
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    ...(typeof requestedInstructions === "boolean" ? { instructions: requestedInstructions } : {}),
    headers: {
      "x-bf-vk": `!pifrost secret repo-mcp --id ${repoId}`,
    },
  };
  return result;
}

export function repoMcpInstructions(root) {
  const path = mcpConfigPath(root);
  if (!existsSync(path)) return undefined;
  const config = readJson(path, {});
  const value = config?.mcpServers?.bifrost?.instructions;
  return typeof value === "boolean" ? value : undefined;
}

export function writeRepoMcpConfig(root, bifrostUrl, repoId, options = {}) {
  const path = mcpConfigPath(root);
  const existing = existsSync(path) ? readJson(path, {}) : {};
  mkdirSync(dirname(path), { recursive: true });
  const backup = existsSync(path) ? backupFile(path, join(dirname(path), "backups")) : undefined;
  writeJsonAtomic(path, buildRepoMcpConfig(existing, bifrostUrl, repoId, options), 0o600);
  return { path, backup };
}

function arrayFromResponse(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export function normalizeMcpClient(client) {
  return normalizeMcpClientShape(client);
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

export function normalizeVirtualMcp(vmcp) {
  const rawTools = Array.isArray(vmcp?.tools) ? vmcp.tools : [];
  const rawVKs = Array.isArray(vmcp?.virtual_key_ids) ? vmcp.virtual_key_ids : [];
  return {
    id: Number(vmcp?.id),
    name: nonEmpty(vmcp?.name) ?? String(vmcp?.id ?? ""),
    endpointSlug: nonEmpty(vmcp?.endpoint_slug),
    description: nonEmpty(vmcp?.description),
    instructions: nonEmpty(vmcp?.instructions),
    instructionsMode: nonEmpty(vmcp?.instructions_mode) ?? "append",
    enabled: vmcp?.enabled !== false,
    tools: rawTools
      .map((spec) => {
        const mcpClientId = nonEmpty(spec?.mcp_client_id) ?? nonEmpty(spec?.mcpClientId);
        if (!mcpClientId) return undefined;
        const toolNames = Array.isArray(spec?.tool_names)
          ? spec.tool_names.map(String)
          : Array.isArray(spec?.toolNames)
            ? spec.toolNames.map(String)
            : [];
        return { mcpClientId, toolNames };
      })
      .filter(Boolean),
    virtualKeyIds: rawVKs.map(String),
    raw: vmcp,
  };
}

export async function listVirtualMcps(url, managementAuth) {
  const base = bifrostManagementBase(url);
  const virtualMcps = await fetchAllPages(
    `${base}/api/mcp/virtual-mcps`,
    managementHeaders(managementAuth),
    ["virtual_mcps", "items"],
  );
  return virtualMcps.map(normalizeVirtualMcp);
}

export function resolveVirtualMcpNames(virtualMcps, names) {
  const lookup = new Map((virtualMcps ?? []).map((item) => [item.name.toLowerCase(), item]));
  return unique((names ?? []).map((name) => {
    const found = lookup.get(String(name).trim().toLowerCase());
    if (!found) throw new Error(`Unknown Bifrost Virtual MCP: ${name}`);
    return found;
  }));
}

export function virtualMcpsForVirtualKey(virtualMcps, virtualKeyId) {
  const id = nonEmpty(virtualKeyId);
  if (!id) return [];
  return (virtualMcps ?? []).filter((item) => item.virtualKeyIds?.includes(id));
}

export function webSearchConfigDiagnostics(modelRoles, fallbackChains) {
  const role = modelRoles && typeof modelRoles === "object" && !Array.isArray(modelRoles)
    ? nonEmpty(modelRoles.web)
    : undefined;
  const fallback = fallbackChains && typeof fallbackChains === "object" && !Array.isArray(fallbackChains)
    ? fallbackChains.web
    : undefined;
  const fallbacks = Array.isArray(fallback)
    ? fallback.map(String).map(nonEmpty).filter(Boolean)
    : nonEmpty(fallback)
      ? [nonEmpty(fallback)]
      : [];
  return {
    status: "ok",
    available: true,
    configured: Boolean(role),
    primary: role,
    fallbacks,
    source: role ? "configured modelRoles.web" : "OMP built-in default search chain",
  };
}

export function readOmpConfigValueResult(key, options = {}) {
  const exists = options.commandExists ?? commandExists;
  const run = options.runCommand ?? runCommand;
  if (!exists("omp")) {
    return { status: "unavailable", value: undefined, error: "`omp` is not installed or not on PATH" };
  }
  try {
    const { stdout } = run("omp", ["config", "get", key, "--json"]);
    const parsed = JSON.parse(stdout);
    return { status: "ok", value: parsed?.value };
  } catch (error) {
    return {
      status: "error",
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readOmpConfigValue(key, options = {}) {
  const result = readOmpConfigValueResult(key, options);
  return result.status === "ok" ? result.value : undefined;
}

/**
 * Read-only snapshot of OMP-owned extended-context / model threshold policy.
 * Pifrost must not recalculate compaction.modelThresholds or change the user's
 * compaction policy. The actual in-session window comes from OMP's
 * ExtensionContext.getContextUsage().
 */
export function ompWebSearchDiagnostics(options = {}) {
  const roles = readOmpConfigValueResult("modelRoles", options);
  const fallback = readOmpConfigValueResult("retry.fallbackChains", options);
  if (roles.status !== "ok" || fallback.status !== "ok") {
    const unavailable = roles.status === "unavailable" && fallback.status === "unavailable";
    return {
      status: unavailable ? "unavailable" : "error",
      available: false,
      configured: false,
      primary: undefined,
      fallbacks: [],
      source: unavailable ? "OMP unavailable" : "OMP web-search configuration unreadable",
      error: roles.error ?? fallback.error,
    };
  }
  return webSearchConfigDiagnostics(roles.value, fallback.value);
}

function gatewayToolTokenEstimate(tools) {
  const bytes = Buffer.byteLength(JSON.stringify(tools ?? []), "utf8");
  return { schemaBytes: bytes, estimatedSchemaTokens: Math.ceil(bytes / 4) };
}

export function mcpToolSurfaceDiagnostics(liveTools = []) {
  const tools = Array.isArray(liveTools) ? liveTools : [];
  const estimate = gatewayToolTokenEstimate(tools);
  return {
    visibleTools: tools.length,
    discoverableTools: tools.length,
    ompDefaultLoadMode: "discoverable",
    providerDeferral: "route-dependent",
    ...estimate,
  };
}

export async function attachVirtualMcpToVirtualKey(url, managementAuth, virtualMcpId, virtualKeyId) {
  const base = bifrostManagementBase(url);
  return requestJson(
    `${base}/api/mcp/virtual-mcps/${encodeURIComponent(String(virtualMcpId))}/virtual-keys/${encodeURIComponent(virtualKeyId)}`,
    { method: "POST", headers: managementHeaders(managementAuth) },
  );
}

export async function detachVirtualMcpFromVirtualKey(url, managementAuth, virtualMcpId, virtualKeyId) {
  const base = bifrostManagementBase(url);
  return requestJson(
    `${base}/api/mcp/virtual-mcps/${encodeURIComponent(String(virtualMcpId))}/virtual-keys/${encodeURIComponent(virtualKeyId)}`,
    { method: "DELETE", headers: managementHeaders(managementAuth) },
  );
}

export async function syncVirtualMcpAssignments({
  url,
  managementAuth,
  virtualKeyId,
  desired,
  available,
}) {
  const all = available ?? await listVirtualMcps(url, managementAuth);
  const wanted = new Map((desired ?? []).map((item) => [Number(item.id), item]));
  const current = virtualMcpsForVirtualKey(all, virtualKeyId);
  const currentIds = new Set(current.map((item) => Number(item.id)));

  for (const item of wanted.values()) {
    if (!currentIds.has(Number(item.id))) {
      await attachVirtualMcpToVirtualKey(url, managementAuth, item.id, virtualKeyId);
    }
  }
  for (const item of current) {
    if (!wanted.has(Number(item.id))) {
      await detachVirtualMcpFromVirtualKey(url, managementAuth, item.id, virtualKeyId);
    }
  }
  return [...wanted.values()];
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

export async function findVirtualKeyByExactName(url, managementAuth, name) {
  const expected = nonEmpty(name);
  if (!expected) throw new Error("Bifrost Virtual Key name is required");
  // Do not depend on Bifrost's optional search semantics for correctness.
  // Fetch/paginate the inventory and compare the unique key name locally.
  const matches = (await listVirtualKeys(url, managementAuth)).filter(
    (candidate) => candidate?.name === expected,
  );
  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} Bifrost Virtual Keys named ${expected}; refusing ambiguous repo association.`,
    );
  }
  return matches[0];
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
      const rawClientId = config?.mcp_client?.client_id ?? config?.mcp_client_id ?? config?.mcp_client?.id;
      const clientId = rawClientId === undefined || rawClientId === null ? undefined : nonEmpty(String(rawClientId));
      const rawConfigId = config?.id;
      const configId = Number(rawConfigId);
      const id = Number.isSafeInteger(configId) && configId > 0 ? configId : undefined;
      if (!name && !clientId) return undefined;
      const tools = Array.isArray(config?.tools_to_execute) ? config.tools_to_execute.map(String) : [];
      return {
        ...(id ? { id } : {}),
        ...(clientId ? { mcp_client_id: clientId } : {}),
        ...(name ? { mcp_client_name: name } : {}),
        tools_to_execute: tools,
      };
    })
    .filter(Boolean);
}

function reconcileVirtualKeyMcpConfigs(vk, clients) {
  if (!Array.isArray(clients)) return undefined;
  const existingByName = new Map();
  for (const config of virtualKeyMcpConfigs(vk)) {
    const name = nonEmpty(config?.mcp_client_name);
    if (name) existingByName.set(name.toLowerCase(), config);
  }
  return clients.map((client) => {
    const name = nonEmpty(client?.name);
    if (!name) throw new Error("MCP client name is required");
    const existing = existingByName.get(name.toLowerCase());
    return {
      ...(existing?.id ? { id: existing.id } : {}),
      mcp_client_name: name,
      tools_to_execute: Array.isArray(client.tools) ? client.tools : [],
    };
  });
}

function mergeToolGrant(entry, tools, source) {
  entry.sources.add(source);
  for (const tool of tools ?? []) {
    if (tool === "*") {
      entry.wildcard = true;
      entry.tools.clear();
      continue;
    }
    if (!entry.wildcard && nonEmpty(String(tool))) entry.tools.add(String(tool));
  }
}

export function effectiveRepoMcpPolicy(vk, virtualMcps, clients) {
  const direct = virtualKeyMcpConfigs(vk);
  const attached = virtualMcpsForVirtualKey(virtualMcps, String(vk?.id ?? ""));
  const clientsById = new Map();
  const clientsByName = new Map();
  for (const client of clients ?? []) {
    const id = client?.id === undefined || client?.id === null ? undefined : nonEmpty(String(client.id));
    const name = nonEmpty(client?.name);
    if (id) clientsById.set(id.toLowerCase(), client);
    if (name) clientsByName.set(name.toLowerCase(), client);
  }

  const grants = new Map();
  const configured = new Set();
  const resolveClient = (reference, nameHint) => {
    const ref = nonEmpty(reference);
    const hint = nonEmpty(nameHint);
    return (
      (ref ? clientsById.get(ref.toLowerCase()) : undefined) ??
      (ref ? clientsByName.get(ref.toLowerCase()) : undefined) ??
      (hint ? clientsByName.get(hint.toLowerCase()) : undefined)
    );
  };
  const add = (reference, nameHint, tools, source) => {
    const client = resolveClient(reference, nameHint);
    const key = nonEmpty(client?.id === undefined ? undefined : String(client.id)) ?? nonEmpty(client?.name) ?? nonEmpty(reference) ?? nonEmpty(nameHint);
    if (!key) return;
    configured.add(key.toLowerCase());
    let entry = grants.get(key.toLowerCase());
    if (!entry) {
      entry = {
        key,
        client,
        name: nonEmpty(client?.name) ?? nonEmpty(nameHint) ?? key,
        tools: new Set(),
        wildcard: false,
        sources: new Set(),
      };
      grants.set(key.toLowerCase(), entry);
    }
    mergeToolGrant(entry, tools, source);
  };

  for (const config of direct) {
    add(config.mcp_client_id, config.mcp_client_name, config.tools_to_execute, "direct");
  }
  for (const vmcp of attached) {
    if (!vmcp.enabled) continue;
    for (const spec of vmcp.tools) {
      add(spec.mcpClientId, undefined, spec.toolNames, `virtual:${vmcp.name}`);
    }
  }

  for (const client of clients ?? []) {
    if (!client?.allowOnAllVirtualKeys || client?.disabled) continue;
    const key = nonEmpty(client?.id === undefined ? undefined : String(client.id)) ?? nonEmpty(client?.name);
    if (!key || configured.has(key.toLowerCase())) continue;
    add(key, client.name, ["*"], "default");
  }

  const effective = [];
  const unresolved = [];
  for (const entry of grants.values()) {
    const tools = entry.wildcard ? ["*"] : [...entry.tools];
    if (!entry.client) {
      unresolved.push({ client: entry.name, tools, sources: [...entry.sources], reason: "MCP client is not configured" });
      continue;
    }
    if (entry.client.disabled) {
      unresolved.push({ client: entry.name, tools, sources: [...entry.sources], reason: "MCP client is disabled" });
      continue;
    }
    if (!tools.length) continue;
    effective.push({ client: entry.name, tools, sources: [...entry.sources] });
  }

  return {
    direct,
    virtualMcps: attached.map((item) => ({
      id: item.id,
      name: item.name,
      endpointSlug: item.endpointSlug,
      enabled: item.enabled,
    })),
    effective,
    unresolved,
  };
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
  const keyName = repoVirtualKeyName(repo);
  const local = state.config.repos?.[repo.id];
  const localSecret = usableVirtualKeyValue(state.secrets.repos?.[repo.id]?.mcpVirtualKey);
  let vk;
  let created = false;
  let associatedName;

  const updateRequest = (name, currentVk) => {
    const request = {
      is_active: true,
    };
    if (name) request.name = name;
    const mcpConfigs = reconcileVirtualKeyMcpConfigs(currentVk, clients);
    if (mcpConfigs) request.mcp_configs = mcpConfigs;
    return request;
  };

  if (local?.virtualKeyId) {
    try {
      const currentVk = await getVirtualKey(url, managementKey, local.virtualKeyId);
      const localName = local.virtualKeyName ?? currentVk?.name ?? keyName;
      let requestedName;
      if (localName !== keyName) {
        // Bifrost 2.2.3's UpdateVirtualKey store resolves by "id OR name".
        // A legacy duplicate basename-only name can therefore make even a
        // policy-only PUT fail with ErrAlreadyExists. Migrate only a key that
        // is already associated locally, preserving its ID/value while moving
        // it onto the repo-scoped canonical name.
        const canonical = await findVirtualKeyByExactName(url, managementKey, keyName);
        if (canonical?.id && canonical.id !== local.virtualKeyId) {
          throw new Error(
            `Cannot migrate legacy repo Virtual Key ${localName}: canonical name ${keyName} already belongs to ${canonical.id}. Resolve that conflict in Bifrost before retrying.`,
          );
        }
        requestedName = keyName;
      }
      vk = await updateVirtualKey(
        url,
        managementKey,
        local.virtualKeyId,
        updateRequest(requestedName, currentVk),
      );
      associatedName = requestedName ?? local.virtualKeyName ?? vk?.name ?? keyName;
    } catch (error) {
      if (!(error instanceof PifrostHttpError) || error.status !== 404) throw error;
    }
  }

  if (!vk) {
    let existing = await findVirtualKeyByExactName(url, managementKey, keyName);
    if (existing?.id) {
      const currentVk = await getVirtualKey(url, managementKey, existing.id);
      vk = await updateVirtualKey(url, managementKey, existing.id, updateRequest(undefined, currentVk));
      associatedName = existing.name ?? currentVk?.name ?? vk?.name ?? keyName;
      if (!usableVirtualKeyValue(vk?.value) && usableVirtualKeyValue(existing?.value)) vk.value = existing.value;
    } else {
      try {
        created = true;
        vk = await createVirtualKey(url, managementKey, {
          name: keyName,
          description: `Pifrost MCP-only key for ${repo.identity ?? repo.name} [${repo.id}]`,
          // Explicit deny-by-default inference posture on Bifrost 2.x. The repo
          // key exists only to authenticate the MCP gateway.
          allow_all_providers: false,
          provider_configs: [],
          mcp_configs: (clients ?? []).map((client) => ({
            mcp_client_name: client.name,
            tools_to_execute: client.tools,
          })),
          is_active: true,
        });
        associatedName = vk?.name ?? keyName;
      } catch (error) {
        if (!(error instanceof PifrostHttpError) || error.status !== 409) throw error;
        // A concurrent init or eventually-consistent list can race the unique
        // name constraint. Re-read the complete inventory and adopt only the
        // exact repo-scoped canonical name.
        created = false;
        existing = await findVirtualKeyByExactName(url, managementKey, keyName);
        if (!existing?.id) throw error;
        const currentVk = await getVirtualKey(url, managementKey, existing.id);
        vk = await updateVirtualKey(url, managementKey, existing.id, updateRequest(undefined, currentVk));
        associatedName = existing.name ?? currentVk?.name ?? vk?.name ?? keyName;
        if (!usableVirtualKeyValue(vk?.value) && usableVirtualKeyValue(existing?.value)) vk.value = existing.value;
      }
    }
  }

  if (!vk?.id) throw new Error("Bifrost did not return a Virtual Key id");

  // Persist the association before dealing with a missing raw value so an explicit
  // repo rotate-key can recover safely. Never rotate an existing key implicitly.
  const liveMcpConfigs = virtualKeyMcpConfigs(vk);
  const normalizedClients = Array.isArray(clients)
    ? clients
    : liveMcpConfigs.length
      ? liveMcpConfigs.map((item) => ({
          name: item.mcp_client_name ?? item.mcp_client_id,
          tools: item.tools_to_execute,
        }))
      : (local?.mcpClients ?? []);
  state.config.repos[repo.id] = {
    name: repo.name,
    identity: repo.identity,
    virtualKeyId: vk.id,
    virtualKeyName: vk.name ?? associatedName ?? local?.virtualKeyName ?? keyName,
    mcpClients: normalizedClients,
    ...(Array.isArray(local?.virtualMcps) ? { virtualMcps: local.virtualMcps } : {}),
    ...(typeof local?.mcpInstructions === "boolean" ? { mcpInstructions: local.mcpInstructions } : {}),
    // Repository integrations are independent of VK grant reconciliation.
    ...(Array.isArray(local?.bifrostSkills) ? { bifrostSkills: local.bifrostSkills } : {}),
    ...(local?.research && typeof local.research === "object" ? { research: local.research } : {}),
    ...(local?.mcpSkillDiscovery && typeof local.mcpSkillDiscovery === "object"
      ? { mcpSkillDiscovery: local.mcpSkillDiscovery } : {}),
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

export async function listMcpGatewayTools(url, virtualKey, options = {}) {
  const request = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const response = await postMcpJsonRpc(bifrostMcpUrl(url), virtualKey, request, options);
  if (!response.ok) throw new Error(`Bifrost MCP tools/list failed (HTTP ${response.status})`);
  const body = response.body;
  if (body?.error) throw new Error(`Bifrost MCP tools/list failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  const rawTools = Array.isArray(body?.result?.tools) ? body.result.tools : [];
  return rawTools
    .map((tool) => {
      const name = nonEmpty(tool?.name);
      if (!name) return undefined;
      return {
        name,
        ...(nonEmpty(tool?.description) ? { description: nonEmpty(tool.description) } : {}),
        ...(tool?.annotations && typeof tool.annotations === "object" ? { annotations: { ...tool.annotations } } : {}),
        ...(tool?.inputSchema && typeof tool.inputSchema === "object" ? { inputSchema: tool.inputSchema } : {}),
      };
    })
    .filter(Boolean);
}

export async function callMcpGatewayTool(url, virtualKey, toolName, args = {}, options = {}) {
  const name = nonEmpty(toolName);
  if (!name) throw new Error("MCP tool name is required");
  const { requestId = 3, ...rpcOptions } = options;
  const request = {
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name,
      arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {},
    },
  };
  const response = await postMcpJsonRpc(bifrostMcpUrl(url), virtualKey, request, rpcOptions);
  if (!response.ok) {
    if (response.status >= 500) throw new McpAmbiguousToolOutcomeError();
    throw new Error(`Bifrost MCP tools/call failed for ${name} (HTTP ${response.status})`);
  }
  const body = response.body;
  if (body?.error) {
    throw new Error(`Bifrost MCP tools/call failed for ${name}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  const result = body?.result;
  if (result?.isError === true) {
    const text = Array.isArray(result?.content)
      ? result.content
        .map((block) => typeof block === "string" ? block : block?.type === "text" ? block.text : undefined)
        .filter((value) => typeof value === "string")
        .join("\n")
      : "";
    throw new Error(`Bifrost MCP tool ${name} returned an error${text ? `: ${text}` : ""}`);
  }
  return result;
}

export async function testMcp(url, virtualKey, options = {}) {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "pifrost-cli", version: VERSION },
    },
  };
  return await postMcpJsonRpc(bifrostMcpUrl(url), virtualKey, request, {
    timeoutMs: 15_000,
    ...options,
  });
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
