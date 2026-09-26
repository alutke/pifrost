import {
  getBifrostConfig,
  getBifrostHealth,
  getBifrostVersion,
  getComplexityAnalyzerConfig,
  getRoutingRules,
  getVirtualKeyQuota,
  listMcpClients,
  listVirtualMcps,
  testInference,
  testManagement,
} from "./cli-lib.mjs";
import { listBifrostSkills } from "./skills-bridge.mjs";

export async function probe(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function skipped(reason) {
  return { ok: false, skipped: true, error: new Error(reason) };
}

export async function collectDoctorSnapshot({ runtime, managementAuth }) {
  const hasUrl = Boolean(runtime?.url);
  const hasInference = hasUrl && Boolean(runtime?.virtualKey);
  const hasManagement = hasUrl && Boolean(managementAuth);

  const [
    version,
    health,
    inference,
    quota,
    management,
    routing,
    gateway,
    complexity,
    mcpClients,
    virtualMcps,
    skills,
  ] = await Promise.all([
    hasUrl ? probe(() => getBifrostVersion(runtime.url)) : Promise.resolve(skipped("Bifrost URL is not configured")),
    hasUrl ? probe(() => getBifrostHealth(runtime.url)) : Promise.resolve(skipped("Bifrost URL is not configured")),
    hasInference ? probe(() => testInference(runtime)) : Promise.resolve(skipped("Inference Virtual Key is not configured")),
    hasInference ? probe(() => getVirtualKeyQuota(runtime.url, runtime.virtualKey)) : Promise.resolve(skipped("Inference Virtual Key is not configured")),
    hasManagement ? probe(() => testManagement(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => getRoutingRules(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => getBifrostConfig(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => getComplexityAnalyzerConfig(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => listMcpClients(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => listVirtualMcps(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
    hasManagement ? probe(() => listBifrostSkills(runtime.url, managementAuth)) : Promise.resolve(skipped("Management authentication is not configured")),
  ]);

  return {
    version,
    health,
    inference,
    quota,
    management,
    routing,
    gateway,
    complexity,
    mcpClients,
    virtualMcps,
    skills,
  };
}

export function probeValue(snapshot, key) {
  const item = snapshot?.[key];
  if (!item) return undefined;
  if (item.ok) return item.value;
  throw item.error;
}
