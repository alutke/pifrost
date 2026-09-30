import {
  VERSION,
  getBifrostHealth,
  getBifrostVersion,
  getRoutingRules,
  getVirtualKeyQuota,
  listMcpClients,
  listVirtualMcps,
  managementAuthLabel,
  normalizeBifrostUrl,
  parseSemver,
  testInference,
  versionAtLeast,
} from "../cli-lib.mjs";
import { listBifrostSkills } from "../skills-bridge.mjs";

function env(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function managementAuthFromEnv() {
  const mode = env("BIFROST_MANAGEMENT_AUTH_MODE")?.toLowerCase();
  const apiKey = env("BIFROST_MANAGEMENT_API_KEY");
  const username = env("BIFROST_ADMIN_USERNAME");
  const password = env("BIFROST_ADMIN_PASSWORD");

  if (mode && !["basic", "bearer"].includes(mode)) {
    throw new Error("BIFROST_MANAGEMENT_AUTH_MODE must be basic or bearer");
  }
  if (mode === "bearer" || (!mode && apiKey)) {
    if (!apiKey) throw new Error("BIFROST_MANAGEMENT_API_KEY is required for bearer management auth");
    return { mode: "bearer", apiKey };
  }
  if (mode === "basic" || (!mode && username && password)) {
    if (!username || !password) {
      throw new Error("BIFROST_ADMIN_USERNAME and BIFROST_ADMIN_PASSWORD are required for basic management auth");
    }
    return { mode: "basic", username, password };
  }
  throw new Error(
    "Management credentials are required: set BIFROST_MANAGEMENT_API_KEY, or BIFROST_ADMIN_USERNAME + BIFROST_ADMIN_PASSWORD",
  );
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} did not return an array`);
  return value;
}

async function main() {
  const url = normalizeBifrostUrl(required("BIFROST_URL"));
  const virtualKey = required("BIFROST_VIRTUAL_KEY");
  const apiKey = env("BIFROST_API_KEY");
  const managementAuth = managementAuthFromEnv();

  console.log(`Pifrost ${VERSION} live smoke — read-only`);
  console.log(`Bifrost: ${url}`);
  console.log(`Inference auth: ${apiKey ? "bearer+virtual-key" : "virtual-key"}`);
  console.log(`Management auth: ${managementAuthLabel(managementAuth)}`);

  const version = await getBifrostVersion(url);
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Bifrost returned an unparseable version: ${version ?? "missing"}`);
  if (versionAtLeast(parsed, "2.2.4") !== true) {
    throw new Error(`Live smoke requires Bifrost >=2.2.4; detected ${parsed.version}`);
  }
  console.log(`[OK] version ${parsed.version}`);

  await getBifrostHealth(url);
  console.log("[OK] health endpoint");

  const inference = await testInference({ url, apiKey, virtualKey });
  console.log(`[OK] inference inventory: ${inference.models} model(s)`);

  const quota = await getVirtualKeyQuota(url, virtualKey);
  for (const key of ["budgets", "rate_limits", "provider_configs", "model_configs"]) {
    requireArray(quota?.[key], `quota.${key}`);
  }
  console.log(
    `[OK] quota: budgets=${quota.budgets.length} rate-limits=${quota.rate_limits.length} provider-configs=${quota.provider_configs.length} model-configs=${quota.model_configs.length}`,
  );

  const rules = requireArray(await getRoutingRules(url, managementAuth), "routing rules");
  console.log(`[OK] routing rules: ${rules.length}`);

  const clients = requireArray(await listMcpClients(url, managementAuth), "MCP clients");
  console.log(`[OK] MCP clients: ${clients.length}`);

  const virtualMcps = requireArray(await listVirtualMcps(url, managementAuth), "Virtual MCPs");
  console.log(`[OK] Virtual MCPs: ${virtualMcps.length}`);

  const skills = requireArray(await listBifrostSkills(url, managementAuth), "Bifrost Skills");
  console.log(`[OK] Bifrost Skills: ${skills.length}`);

  console.log("Live smoke passed. No write, attach/detach, rotate, delete, sync, or configuration endpoint was called.");
}

main().catch((error) => {
  console.error(`pifrost smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
