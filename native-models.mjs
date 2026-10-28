/**
 * Pifrost 0.30: optional native OMP models.yml integration.
 * This is configuration-only. Pifrost does not register a runtime provider.
 * A scoped, marked YAML block is the only content we own in models.yml.
 */
import { randomUUID } from "node:crypto";
import { constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, copyFileSync, writeFileSync, closeSync, fsyncSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { ompAgentDir } from "./cli-lib.mjs";

export const NATIVE_START = "  # PIFROST-NATIVE-MODELS-START";
export const NATIVE_END = "  # PIFROST-NATIVE-MODELS-END";
const ROOT_PROVIDERS = /^providers:[ \t]*(?:#.*)?$/mu;
const BIFROST_ENTRY = /^  bifrost:[ \t]*(?:#.*)?$/mu;

function yaml(value) { return JSON.stringify(value); }
function safeModelUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Native model setup needs a plain HTTP(S) Bifrost URL without embedded credentials.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function nativeProviderBlock(url, api = "openai-completions", authMode = "vk") {
  if (!["openai-completions", "openai-responses"].includes(api)) throw new Error("Unsupported OMP native API");
  if (!["vk","bearer","bearer+vk"].includes(authMode)) throw new Error("Invalid Bifrost authentication mode");
  const safeUrl = safeModelUrl(url);
  return [
    NATIVE_START,
    "  bifrost:",
    "    baseUrl: " + yaml(safeUrl),
    "    api: " + api,
    ...(authMode.includes("bearer") ? [
      '    apiKey: "!pifrost secret inference-bearer"',
      "    authHeader: true",
    ] : [
      "    auth: none",
      "    authHeader: false",
    ]),
    ...(authMode.includes("vk") ? [
      "    headers:",
      '      x-bf-vk: "!pifrost secret inference-vk"',
    ] : []),
    "    discovery:",
    "      type: openai-models-list",
    "      injectV1: false",
    NATIVE_END,
  ].join("\n");
}

/** Insert or replace our own marked provider only. Refuse user-owned bifrost records. */
export function mergeNativeProviderYaml(original, block) {
  if (typeof original !== "string") throw new Error("Expected YAML text");
  if (!["", "\n"].includes(original) && /\r/u.test(original)) throw new Error("CRLF YAML is not modified automatically.");
  const countStart = original.split(NATIVE_START).length - 1;
  const countEnd = original.split(NATIVE_END).length - 1;
  if (countStart !== countEnd || countStart > 1) throw new Error("Pifrost marker mismatch; refusing to edit YAML.");
  if (countStart === 1) {
    const start = original.indexOf(NATIVE_START);
    const end = original.indexOf(NATIVE_END, start) + NATIVE_END.length;
    if (end < start) throw new Error("Invalid Pifrost managed block");
    const managed = original.slice(start, end);
    if (!/^  # PIFROST-NATIVE-MODELS-START\n  bifrost:\n[\s\S]*\n  # PIFROST-NATIVE-MODELS-END$/u.test(managed)) {
      throw new Error("Managed provider block changed structurally; refusing to edit.");
    }
    const urlLine=/^    baseUrl: (".*")$/mu.exec(managed);
    const apiLine=/^    api: (openai-(?:completions|responses))$/mu.exec(managed);
    const mode=managed.includes('    apiKey: "!pifrost secret inference-bearer"')
      ? (managed.includes("      x-bf-vk:")?"bearer+vk":"bearer") : "vk";
    let expected;
    try { expected = urlLine && apiLine ? nativeProviderBlock(JSON.parse(urlLine[1]),apiLine[1],mode) : undefined; }
    catch { expected = undefined; }
    if (managed !== expected) throw new Error("Managed provider has local edits; refusing to overwrite them.");
    const prefix = original.slice(0,start), suffix = original.slice(end);
    const result = block ? prefix + block + suffix : (prefix+suffix).replace(/\n{3,}/gu,"\n\n");
    return result.trim()==="providers:" ? "" : result;
  }
  if (!block) return original;
  if (BIFROST_ENTRY.test(original)) throw new Error("An unmanaged bifrost provider already exists; edit it manually.");
  if (!original.trim()) return "providers:\n" + block + "\n";
  const match = ROOT_PROVIDERS.exec(original);
  if (match) {
    const next = match.index + match[0].length;
    return original.slice(0,next) + "\n" + block + original.slice(next);
  }
  if (/^providers\s*:/mu.test(original)) throw new Error("Non-standard root providers mapping; manual edit required.");
  return original.replace(/\s*$/u,"\n\n") + "providers:\n" + block + "\n";
}

export function nativeModelsPath(env = process.env) { return join(ompAgentDir(env), "models.yml"); }

export function nativeModelsStatus(env = process.env) {
  const path = nativeModelsPath(env);
  if (!existsSync(path)) return {path, enabled:false};
  const content = readFileSync(path,"utf8");
  const enabled = content.includes(NATIVE_START) && content.includes(NATIVE_END);
  const protocol = enabled ? /^    api: (openai-(?:completions|responses))$/mu.exec(content.slice(content.indexOf(NATIVE_START),content.indexOf(NATIVE_END)))?.[1] : undefined;
  return {path, enabled, protocol};
}

/** Atomic, backed-up opt-in edits. Do not overwrite symlinks or auto-modify user providers. */
export function writeNativeModels(api, url, env = process.env, authMode = "vk") {
  const path = nativeModelsPath(env);
  const parent = dirname(path);
  // OMP accepts both filenames. Never introduce a second competing file that
  // could shadow an existing user-owned configuration.
  if (!existsSync(path) && existsSync(join(parent,"models.yaml")))
    throw new Error("OMP already has models.yaml; refusing to create competing models.yml. Migrate it explicitly.");
  mkdirSync(parent,{recursive:true,mode:0o700});
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error("Refusing to modify non-regular OMP models.yml");
  const existing = existsSync(path) ? readFileSync(path,"utf8") : "";
  const updated = mergeNativeProviderYaml(existing, api ? nativeProviderBlock(url,api,authMode) : "");
  if(updated===existing)return {changed:false,path};
  const backup = existsSync(path) ? path+".pifrost-backup-"+Date.now()+"-"+randomUUID() : undefined;
  if(backup)copyFileSync(path,backup,constants.COPYFILE_EXCL);
  const temp = path+".pifrost-"+randomUUID()+".tmp";
  const fd = openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try {writeFileSync(fd,updated);fsyncSync(fd);}
  finally {closeSync(fd);}
  renameSync(temp,path);
  return {changed:true,path,backup};
}
