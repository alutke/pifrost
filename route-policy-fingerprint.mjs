import { createHash } from "node:crypto";

/** Stable, content-only hash of full gateway rule policy, not just physical
 * model chains. Do not write full CEL, key pins, or request conditions to logs.
 * Sort rule records to make API pagination ordering irrelevant. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export function routePolicyFingerprint(rules) {
  if (!Array.isArray(rules)) throw new Error("Bifrost rule inventory unavailable");
  const rows = rules.map(rule => JSON.stringify(canonical(rule))).sort();
  return createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
}
export function routePolicyDrift(localHash, remoteHash) {
  if (typeof localHash !== "string" || !/^[0-9a-f]{64}$/u.test(localHash)) return "unverified";
  if (typeof remoteHash !== "string" || !/^[0-9a-f]{64}$/u.test(remoteHash)) return "unverified";
  return localHash === remoteHash ? "verified-match" : "drifted";
}
