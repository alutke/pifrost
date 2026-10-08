import { managementAuthFromState, runtimeConfigFromState } from "./cli-lib.mjs";

/**
 * Resolve the minimum runtime identity needed for Pifrost inference-aware
 * operations. Bifrost 2.x Virtual Keys can authenticate inference directly, so
 * a separate Bearer/API key is deliberately optional.
 */
export function requireRuntime(state, env = process.env) {
  const runtime = runtimeConfigFromState(state, env);
  if (!runtime.url || !runtime.virtualKey) {
    throw new Error(
      "Global inference configuration is incomplete; Bifrost URL and Virtual Key are required. Run `pifrost global setup`",
    );
  }
  return runtime;
}

/**
 * Resolve the common control-plane precondition used by every management
 * command, including repository MCP/Skills operations.
 */
export function requireManagement(state, env = process.env) {
  const runtime = requireRuntime(state, env);
  const managementAuth = managementAuthFromState(state, env);
  if (!managementAuth) {
    throw new Error(
      "Bifrost management authentication is missing; run `pifrost global setup`. Use OSS admin username/password (Basic auth), an Enterprise scoped API key, or BIFROST_SETUP_TOKEN only while completing first-time Bifrost setup.",
    );
  }
  return { ...runtime, managementKey: managementAuth };
}
