/**
 * Runtime-only Bifrost route state. Each OMP extension installation owns one
 * store; a request captures a single immutable generation before dispatch.
 * Refreshes publish one complete generation, never a sequence of partially
 * updated maps or process-global route state.
 */
import type { BifrostProviderModel, AliasDiagnostic } from "./index.ts";
import { extractDynamicRouteProfiles, type DynamicRouteProfile } from "./dynamic-routing.ts";
import { gatewayProtocolOrder, type GatewayWireProtocol } from "./multi-protocol-routing.ts";
import { physicalPolicyIdentity } from "./request-compatibility.ts";
import { resolvePifrostReasoningReplayRequirement } from "./transport-model.ts";
import {
  unanimousStrictReasoningRequirement,
  type ReasoningReplayRequirement,
  type ReasoningWireProtocol,
} from "./reasoning-integrity.ts";
import type { OutputBudgetMember } from "./output-budget.ts";

export interface RuntimeRouteSnapshot {
  readonly generation: number;
  readonly dynamicRoutes: ReadonlyMap<string, DynamicRouteProfile>;
  readonly gatewayProtocols: ReadonlyMap<string, readonly GatewayWireProtocol[]>;
  readonly aliasDiagnostics: ReadonlyMap<string, AliasDiagnostic>;
  readonly opaqueReplayPolicies: ReadonlyMap<string, Readonly<{ chat: ReasoningReplayRequirement; responses: ReasoningReplayRequirement }>>;
  readonly outputMembers: ReadonlyMap<string, readonly OutputBudgetMember[]>;
}

const empty = (): RuntimeRouteSnapshot => Object.freeze({
  generation: 0,
  dynamicRoutes: new Map<string, DynamicRouteProfile>(),
  gatewayProtocols: new Map<string, readonly GatewayWireProtocol[]>(),
  aliasDiagnostics: new Map<string, AliasDiagnostic>(),
  opaqueReplayPolicies: new Map<string, Readonly<{ chat: ReasoningReplayRequirement; responses: ReasoningReplayRequirement }>>(),
  outputMembers: new Map<string, readonly OutputBudgetMember[]>(),
});

function buildSnapshot(
  models: readonly BifrostProviderModel[],
  diagnostics: readonly AliasDiagnostic[],
  generation: number,
): RuntimeRouteSnapshot {
  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic.id !== "string" || !diagnostic.id.trim() ||
        !Array.isArray(diagnostic.chain) ||
        !Array.isArray(diagnostic.unresolved) ||
        (diagnostic.members !== undefined && !Array.isArray(diagnostic.members))) {
      throw new Error("Invalid route diagnostics; retaining previous atomic catalogue generation");
    }
  }
  const dynamicRoutes = extractDynamicRouteProfiles(models);
  const aliasDiagnostics = new Map(diagnostics.map(item => [item.id.toLowerCase(), item] as const));
  const opaqueReplayPolicies = new Map(diagnostics.map(diagnostic => {
    const resolve = (protocol: ReasoningWireProtocol): ReasoningReplayRequirement => {
      const members = diagnostic.members ?? [];
      const complete = members.length > 0 &&
        members.length === diagnostic.chain.length &&
        diagnostic.unresolved.length === 0 &&
        members.every(item => item.status === "resolved" && item.capabilities?.reasoning === true);
      if (!complete) return "unknown";
      const requirements = members.map(item => {
        const identity = physicalPolicyIdentity(item.reference);
        return identity
          ? resolvePifrostReasoningReplayRequirement(identity.provider, identity.id, protocol)
          : "unknown";
      });
      return unanimousStrictReasoningRequirement(requirements, true);
    };
    return [diagnostic.id.toLowerCase(), Object.freeze({
      chat: resolve("openai-completions"),
      responses: resolve("openai-responses"),
    })] as const;
  }));
  const outputMembers = new Map(diagnostics.map(item => [item.id.toLowerCase(),
    Object.freeze((item.members ?? []).map(member => Object.freeze({
      reference: member.reference,
      ...(member.capabilities?.maxTokens !== undefined ? { maxTokens: member.capabilities.maxTokens } : {}),
      ...(member.sources?.maxTokens ? { source: member.sources.maxTokens } : {}),
    }))),
  ] as const));
  const gatewayProtocols = new Map(
    diagnostics.map(item => [item.id.toLowerCase(), gatewayProtocolOrder(item)] as const)
      .filter((entry): entry is readonly [string, readonly GatewayWireProtocol[]] => entry[1] !== undefined)
      .map(([id, protocols]) => [id, Object.freeze([...protocols])] as const),
  );
  return Object.freeze({ generation, dynamicRoutes, aliasDiagnostics,
    opaqueReplayPolicies, outputMembers, gatewayProtocols });
}

/** Deliberately no singleton: provider registration, fetch refresh and streams
 * share only the instance explicitly created inside pifrostProvider(). */
export function createRuntimeRouteState() {
  let current = empty();
  return {
    capture: (): RuntimeRouteSnapshot => current,
    publish(models: readonly BifrostProviderModel[], diagnostics: readonly AliasDiagnostic[] = []): RuntimeRouteSnapshot {
      // Build completely before replacing, so failure leaves prior state intact.
      const next = buildSnapshot(models, diagnostics, current.generation + 1);
      current = next;
      return next;
    },
  };
}
