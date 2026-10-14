import { createHash } from "node:crypto";

/** One semantic catalog identity shared by the standalone CLI watcher and
 * the native OMP provider. Verification-only timestamps never affect identity.
 * Preserve all unknown fields as safety-critical.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([key,nested]) => [key, canonical(nested)]));
  }
  return value;
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
export function semanticAliasFingerprint(config) {
  if (!config) return hash(JSON.stringify(null));
  const relevant = { ...config };
  delete relevant.synchronizedAt;
  return hash(JSON.stringify(canonical(relevant)));
}
export function inferenceKeyFingerprint(key) {
  return hash(typeof key === "string" ? key.trim() : "");
}
