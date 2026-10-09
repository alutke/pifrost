import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  bifrostManagementBase,
  managementHeaders,
  nonEmpty,
  requestJson,
} from "./cli-lib.mjs";

export const BIFROST_SKILL_MARKER = ".pifrost-bifrost-skill.json";
export const BIFROST_SKILL_ROOT = ".agents/skills";

function yamlString(value) {
  return `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;
}
function yamlKey(key) {
  return /^[A-Za-z0-9_.-]+$/u.test(key) ? key : yamlString(key);
}
function yamlScalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value === null) return "null";
  return yamlString(value);
}
function writeYamlList(lines, values, indent) {
  const prefix = "  ".repeat(indent);
  for (const item of values) {
    if (Array.isArray(item)) {
      lines.push(`${prefix}-`);
      writeYamlList(lines, item, indent + 1);
    } else if (item && typeof item === "object") {
      lines.push(`${prefix}-`);
      for (const nestedKey of Object.keys(item).sort()) writeYamlValue(lines, nestedKey, item[nestedKey], indent + 1);
    } else {
      lines.push(`${prefix}- ${yamlScalar(item)}`);
    }
  }
}

function writeYamlValue(lines, key, value, indent = 0) {
  const prefix = "  ".repeat(indent);
  const field = yamlKey(key);
  if (Array.isArray(value)) {
    lines.push(`${prefix}${field}:`);
    writeYamlList(lines, value, indent + 1);
    return;
  }
  if (value && typeof value === "object") {
    lines.push(`${prefix}${field}:`);
    for (const nestedKey of Object.keys(value).sort()) writeYamlValue(lines, nestedKey, value[nestedKey], indent + 1);
    return;
  }
  lines.push(`${prefix}${field}: ${yamlScalar(value)}`);
}

export function normalizeBifrostSkill(skill) {
  const name = nonEmpty(skill?.name);
  const id = nonEmpty(skill?.id);
  if (!name || !id) return undefined;
  return {
    id,
    name,
    description: nonEmpty(skill?.description) ?? "",
    version: nonEmpty(skill?.latest_version) ?? nonEmpty(skill?.version) ?? "unknown",
    highestVersion: nonEmpty(skill?.highest_version),
    fileCount: Number.isFinite(Number(skill?.file_count))
      ? Number(skill.file_count)
      : Array.isArray(skill?.files) ? skill.files.length : 0,
    allowedTools: nonEmpty(skill?.allowed_tools),
    compatibility: nonEmpty(skill?.compatibility),
    raw: skill,
  };
}

export function bifrostSkillCompatibility(skill) {
  const normalized = normalizeBifrostSkill(skill);
  if (!normalized) return { compatible: false, reason: "missing stable Bifrost skill id/name" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized.name) || normalized.name.length > 64) {
    return { compatible: false, reason: "skill name does not satisfy Bifrost Agent Skills naming rules" };
  }
  if (normalized.allowedTools) {
    return {
      compatible: false,
      reason: "Bifrost allowed_tools cannot be enforced by the OMP 18.3 skill loader",
    };
  }
  return { compatible: true };
}

export async function listBifrostSkills(url, managementAuth) {
  const base = bifrostManagementBase(url);
  const result = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const body = await requestJson(
      `${base}/api/skills?limit=${limit}&offset=${offset}&sort_by=name&order=asc`,
      { headers: managementHeaders(managementAuth), timeoutMs: 15_000 },
    );
    const page = Array.isArray(body?.skills) ? body.skills : [];
    for (const row of page) {
      const normalized = normalizeBifrostSkill(row);
      if (normalized) result.push(normalized);
    }
    const total = Number(body?.total);
    if (Number.isFinite(total) && result.length >= total) break;
    if (page.length < limit) break;
    offset += page.length;
    if (offset > 100_000) throw new Error("Refusing excessive Bifrost skill pagination");
  }
  return result;
}

export function resolveBifrostSkillNames(skills, names) {
  const byName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill]));
  return names.map((requested) => {
    const found = byName.get(String(requested).trim().toLowerCase());
    if (!found) throw new Error(`Unknown Bifrost skill: ${requested}`);
    return found;
  });
}

export async function getBifrostSkill(url, managementAuth, id) {
  const base = bifrostManagementBase(url);
  const body = await requestJson(`${base}/api/skills/${encodeURIComponent(id)}`, {
    headers: managementHeaders(managementAuth),
    timeoutMs: 15_000,
  });
  const normalized = normalizeBifrostSkill(body?.skill);
  if (!body?.skill || !normalized) throw new Error(`Bifrost returned invalid skill payload for id ${id}`);
  return { ...normalized, raw: body.skill };
}

export function composeBifrostSkillMarkdown(skill) {
  const raw = skill?.raw ?? skill;
  const normalized = normalizeBifrostSkill(raw);
  if (!normalized) throw new Error("Cannot compose invalid Bifrost skill");
  const lines = ["---", `name: ${yamlString(normalized.name)}`, `description: ${yamlString(normalized.description)}`];
  if (nonEmpty(raw?.license)) lines.push(`license: ${yamlString(raw.license)}`);
  if (nonEmpty(raw?.compatibility)) lines.push(`compatibility: ${yamlString(raw.compatibility)}`);
  if (nonEmpty(raw?.allowed_tools)) lines.push(`allowed-tools: ${yamlString(raw.allowed_tools)}`);

  const extras = raw?.extra_frontmatter && typeof raw.extra_frontmatter === "object" && !Array.isArray(raw.extra_frontmatter)
    ? raw.extra_frontmatter : {};
  const reserved = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const key of Object.keys(extras).sort()) if (!reserved.has(key)) writeYamlValue(lines, key, extras[key], 0);

  const metadata = raw?.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  if (Object.keys(metadata).length) {
    lines.push("metadata:");
    for (const key of Object.keys(metadata).sort()) writeYamlValue(lines, key, String(metadata[key]), 1);
  }
  lines.push("---");
  return `${lines.join("\n")}\n${typeof raw?.skill_md_body === "string" ? raw.skill_md_body : ""}`;
}

export function safeSkillFilePath(value) {
  const raw = nonEmpty(value);
  if (!raw) throw new Error("Bifrost skill file path is empty");
  if (raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/u.test(raw)) {
    throw new Error(`Unsafe Bifrost skill file path: ${raw}`);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe Bifrost skill file path: ${raw}`);
  }
  return parts.join("/");
}

async function downloadSkillFile(url, destination, budget, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  const response = await fetch(url, {
    headers: { Accept: "*/*" },
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxFileBytes) {
    throw new Error(`Downloaded skill file exceeds ${maxFileBytes} bytes`);
  }
  if (Number.isFinite(declared) && budget.total + declared > budget.max) {
    throw new Error(`Bifrost skill exceeds the ${Math.floor(budget.max / (1024 * 1024))} MB bridge safety limit`);
  }

  let fileBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      fileBytes += chunk.length;
      budget.total += chunk.length;
      if (fileBytes > maxFileBytes) {
        callback(new Error(`Downloaded skill file exceeds ${maxFileBytes} bytes`));
        return;
      }
      if (budget.total > budget.max) {
        callback(new Error(`Bifrost skill exceeds the ${Math.floor(budget.max / (1024 * 1024))} MB bridge safety limit`));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    limiter,
    createWriteStream(destination, { flags: "wx", mode: 0o644 }),
  );
}

export async function fetchBifrostSkillBundle(url, managementAuth, summary) {
  const skill = await getBifrostSkill(url, managementAuth, summary.id);
  const compatibility = bifrostSkillCompatibility(skill.raw);
  if (!compatibility.compatible) {
    throw new Error(`Bifrost skill ${skill.name} is not safely representable in OMP: ${compatibility.reason}`);
  }
  const base = bifrostManagementBase(url);
  const files = (Array.isArray(skill.raw?.files) ? skill.raw.files : []).map((file) => {
    const path = safeSkillFilePath(file?.path);
    const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
    return {
      path,
      url: `${base}/api/skills/serve/${encodeURIComponent(skill.name)}/files/${encoded}`,
      declaredBytes: Number.isFinite(Number(file?.file_size_bytes)) ? Number(file.file_size_bytes) : undefined,
    };
  });
  return {
    skill,
    markdown: composeBifrostSkillMarkdown(skill),
    files,
    sourceUrl: `${base}/api/skills/serve/${encodeURIComponent(skill.name)}/download.zip`,
  };
}

export function bifrostSkillInstallPath(repoRoot, name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(name ?? "")) || String(name ?? "").length > 64) {
    throw new Error(`Unsafe Bifrost skill name: ${name}`);
  }
  return join(repoRoot, BIFROST_SKILL_ROOT, name);
}
function markerPath(repoRoot, name) {
  return join(bifrostSkillInstallPath(repoRoot, name), BIFROST_SKILL_MARKER);
}
export function readBifrostSkillMarker(repoRoot, name) {
  const target = bifrostSkillInstallPath(repoRoot, name);
  const path = markerPath(repoRoot, name);
  if (!existsSync(target) || !existsSync(path)) return undefined;
  try {
    if (lstatSync(target).isSymbolicLink() || lstatSync(path).isSymbolicLink()) return undefined;
    const marker = JSON.parse(readFileSync(path, "utf8"));
    if (marker?.provider !== "bifrost" || marker?.name !== name) return undefined;
    return marker;
  } catch {
    return undefined;
  }
}


/**
 * Snapshot the complete managed payload, excluding Pifrost's marker. Unexpected
 * files and symlinks count as local modification, not content to overwrite.
 */
function skillPayloadHashes(directory) {
  const hashes = {};
  function visit(root, prefix = "") {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!prefix && entry.name === BIFROST_SKILL_MARKER) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(root, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error(`Unsafe managed Skill payload entry: ${relative}`);
      }
      if (stat.isDirectory()) visit(path, relative);
      else hashes[relative] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
  visit(directory);
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}

export function managedBifrostSkillIntegrity(repoRoot, name) {
  const marker = readBifrostSkillMarker(repoRoot, name);
  if (!marker) return { status: "unmanaged" };
  if (!marker.fileHashes || typeof marker.fileHashes !== "object" ||
      Array.isArray(marker.fileHashes)) return { status: "unverified" }; // legacy v1 marker
  try {
    const actual = skillPayloadHashes(bifrostSkillInstallPath(repoRoot, name));
    const expected = marker.fileHashes;
    const modified = Object.keys(actual).length !== Object.keys(expected).length ||
      Object.entries(actual).some(([file, sha]) => expected[file] !== sha);
    return { status: modified ? "modified" : "clean" };
  } catch (error) {
    return { status: "modified", reason: String(error.message ?? error) };
  }
}

function frontmatterSkillName(skillFile) {
  try {
    const text = readFileSync(skillFile, "utf8").slice(0, 16_384);
    const block = /^---\s*\n([\s\S]*?)\n---/u.exec(text)?.[1];
    if (!block) return undefined;
    const line = block.split(/\r?\n/u).find((entry) => /^name\s*:/u.test(entry.trim()));
    if (!line) return undefined;
    let value = line.slice(line.indexOf(":") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pluginPackageDirs(nodeModules) {
  if (!existsSync(nodeModules)) return [];
  const result = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const first = join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(first, { withFileTypes: true })) {
        if (scoped.isDirectory()) result.push(join(first, scoped.name));
      }
    } else {
      result.push(first);
    }
  }
  return result;
}

function candidateSkillRoots(repoRoot, home = homedir()) {
  const pluginSkills = [
    ...pluginPackageDirs(join(repoRoot, ".omp/plugins/node_modules")),
    ...pluginPackageDirs(join(home, ".omp/plugins/node_modules")),
  ].map((pluginRoot) => join(pluginRoot, "skills"));
  return [
    join(repoRoot, ".agents/skills"),
    join(repoRoot, ".agent/skills"),
    join(repoRoot, ".codex/skills"),
    join(repoRoot, ".opencode/skills"),
    join(repoRoot, ".claude/skills"),
    join(home, ".agents/skills"),
    join(home, ".agent/skills"),
    join(home, ".codex/skills"),
    join(home, ".config/opencode/skills"),
    join(home, ".claude/skills"),
    ...pluginSkills,
  ];
}
function manifestSkillNames(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Object.keys(parsed?.skills ?? {}).map((id) => id.split("/").at(-1)).filter(Boolean);
  } catch {
    return [];
  }
}

export function findOmpSkillCollisions(repoRoot, name, options = {}) {
  const target = resolve(bifrostSkillInstallPath(repoRoot, name));
  const collisions = [];
  for (const root of candidateSkillRoots(repoRoot, options.home)) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = resolve(root, entry.name);
      if (skillDir === target && readBifrostSkillMarker(repoRoot, name)) continue;
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const declared = frontmatterSkillName(skillFile);
      if (entry.name.toLowerCase() === name.toLowerCase() || declared?.toLowerCase() === name.toLowerCase()) collisions.push(skillDir);
    }
  }
  const home = options.home ?? homedir();
  for (const manifest of [join(repoRoot, ".omp/skills.json"), join(home, ".omp/agent/skills.json")]) {
    if (manifestSkillNames(manifest).some((candidate) => candidate?.toLowerCase() === name.toLowerCase())) collisions.push(manifest);
  }
  return [...new Set(collisions)];
}

function secureSkillParent(repoRoot, create) {
  const root = realpathSync(repoRoot);
  let current = root;
  for (const component of [".agents", "skills"]) {
    const next = join(current, component);
    if (existsSync(next)) {
      const stat = lstatSync(next);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlinked Skill path: ${next}`);
      if (!stat.isDirectory()) throw new Error(`Expected Skill directory: ${next}`);
    } else if (create) {
      mkdirSync(next, { mode: 0o700 });
    } else {
      return undefined;
    }
    current = next;
  }
  return current;
}

function assertSafeManagedTarget(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlinked Skill target: ${target}`);
  if (!stat.isDirectory()) throw new Error(`Expected Skill directory: ${target}`);
}

export async function installBifrostSkillBundle(repoRoot, bundle, options = {}) {
  const name = bundle?.skill?.name;
  const version = bundle?.skill?.version;
  const skillId = bundle?.skill?.id;
  if (!name || !version || !skillId) throw new Error("Invalid Bifrost skill bundle");
  const compatibility = bifrostSkillCompatibility(bundle.skill.raw ?? bundle.skill);
  if (!compatibility.compatible) throw new Error(`Bifrost skill ${name} is not safely representable in OMP: ${compatibility.reason}`);

  const parent = secureSkillParent(repoRoot, true);
  const target = join(parent, name);
  assertSafeManagedTarget(target);
  const existingMarker = readBifrostSkillMarker(repoRoot, name);
  if (existingMarker && managedBifrostSkillIntegrity(repoRoot, name).status === "modified" &&
      !options.allowModifiedReplace) {
    throw new Error(`Refusing to overwrite locally modified Pifrost Skill ${name}; use explicit --force to replace`);
  }
  if (existsSync(target) && !existingMarker) throw new Error(`OMP skill collision: ${target} exists but is not owned by Pifrost`);
  const collisions = findOmpSkillCollisions(repoRoot, name, options).filter((path) => resolve(path) !== resolve(target));
  if (collisions.length) throw new Error(`OMP skill collision for "${name}": ${collisions.join(", ")}`);

  const staging = mkdtempSync(join(parent, `.${name}.pifrost-tmp-`));
  const backup = join(parent, `.${name}.pifrost-backup-${randomUUID()}`);
  try {
    writeFileSync(join(staging, "SKILL.md"), bundle.markdown, { mode: 0o644 });
    const budget = {
      total: Buffer.byteLength(bundle.markdown, "utf8"),
      max: options.maxBundleBytes ?? 500 * 1024 * 1024,
    };
    for (const file of bundle.files ?? []) {
      const path = safeSkillFilePath(file.path);
      const destination = resolve(staging, ...path.split("/"));
      if (!destination.startsWith(resolve(staging) + sep)) throw new Error(`Unsafe Bifrost skill file path: ${path}`);
      mkdirSync(dirname(destination), { recursive: true });
      if (Buffer.isBuffer(file.data)) {
        budget.total += file.data.length;
        if (budget.total > budget.max) throw new Error("Bifrost skill exceeds the bridge safety limit");
        writeFileSync(destination, file.data, { mode: 0o644, flag: "wx" });
      } else if (file.url) {
        await downloadSkillFile(file.url, destination, budget, {
          timeoutMs: options.timeoutMs,
          maxFileBytes: options.maxFileBytes,
        });
      } else {
        throw new Error(`Bifrost skill file ${path} has no downloadable source`);
      }
    }

    const marker = {
      schemaVersion: 2,
      provider: "bifrost",
      name,
      bifrostSkillId: skillId,
      version,
      ...(bundle.sourceUrl ? { sourceUrl: bundle.sourceUrl } : {}),
      installedAt: new Date().toISOString(),
      fileHashes: skillPayloadHashes(staging),
    };
    writeFileSync(join(staging, BIFROST_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o644 });

    if (existsSync(target)) renameSync(target, backup);
    try {
      renameSync(staging, target);
    } catch (error) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
    return { path: target, marker };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw error;
  }
}

export function removeManagedBifrostSkill(repoRoot, name, options = {}) {
  const parent = secureSkillParent(repoRoot, false);
  const target = parent ? join(parent, name) : bifrostSkillInstallPath(repoRoot, name);
  if (!parent || !existsSync(target)) return { removed: false, alreadyMissing: true, path: target };
  assertSafeManagedTarget(target);
  if (!readBifrostSkillMarker(repoRoot, name)) throw new Error(`Refusing to remove ${target}: directory is not owned by Pifrost`);
  if (managedBifrostSkillIntegrity(repoRoot, name).status === "modified" && !options.force) {
    throw new Error(`Refusing to remove locally modified Pifrost Skill ${name}; use --force to discard edits`);
  }
  rmSync(target, { recursive: true, force: true });
  return { removed: true, alreadyMissing: false, path: target };
}

export function normalizeConfiguredBifrostSkills(value) {
  const rows = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const name = nonEmpty(typeof row === "string" ? row : row?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    result.push({
      name,
      ...(nonEmpty(row?.version) ? { version: nonEmpty(row.version) } : {}),
      ...(nonEmpty(row?.id) ? { id: nonEmpty(row.id) } : {}),
    });
  }
  return result;
}

export function repoBifrostSkillStatus(repoRoot, configured) {
  return normalizeConfiguredBifrostSkills(configured).map((item) => {
    const marker = readBifrostSkillMarker(repoRoot, item.name);
    const target = bifrostSkillInstallPath(repoRoot, item.name);
    return {
      ...item,
      path: target,
      state: marker ? "installed" : existsSync(target) ? "collision" : "missing",
      integrity: marker ? managedBifrostSkillIntegrity(repoRoot, item.name).status : "unmanaged",
      installedVersion: nonEmpty(marker?.version),
      bifrostSkillId: nonEmpty(marker?.bifrostSkillId),
    };
  });
}
