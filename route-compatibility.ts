/**
 * Route contract evidence — does not execute Bifrost CEL, choose a provider,
 * or infer how gateway session affinity selected a physical model.
 * All data is limited to catalog structure and observed response headers.
 */
import type { AliasDiagnostic } from "./index.ts";
import type { DynamicRouteProfile, DynamicRoutePlan } from "./dynamic-routing.ts";
import { canUseNativeBifrostRoute, compatibilityRouteSnapshotError } from "./dynamic-routing.ts";
import { normalizedPhysicalProvider } from "./endpoint-contracts.ts";

export type RouteContractMode = "bifrost-native" | "pifrost-compatibility" | "bifrost-direct";
export type RouteContractVerification = "verified-local-snapshot" | "gateway-owned-unverified" | "missing-verified-snapshot";
export interface RouteContractEvidence {
  mode: RouteContractMode;
  verification: RouteContractVerification;
  /** Count includes *every* member Bifrost may route to (including session affinity). */
  possibleMembers: number;
  unknownMembers: number;
  mixedProtocols: boolean;
  /** Confirms OMP's native physical wire encoder resolved for every candidate. */
  encodersComplete: boolean;
  /** A gateway response cannot prove *why* a member was chosen. */
  gatewaySelectionCause: "unknown";
  cachedPrimary?: string;
  policyFingerprintPrefix?: string;
}

/** Assess all route members, not just the preferred target. */
export function dynamicRouteContract(profile: DynamicRouteProfile, plan: DynamicRoutePlan): RouteContractEvidence {
  const native = canUseNativeBifrostRoute(profile, plan);
  const snapshotError = compatibilityRouteSnapshotError(profile);
  const knownProtocols = new Set(profile.members.flatMap(m=>m.protocols ?? []));
  const eligible = new Set(plan.attempts.flatMap(a=>a.members.map(m=>m.reference)));
  return {
    mode: native ? "bifrost-native" : "pifrost-compatibility",
    verification: snapshotError ? "missing-verified-snapshot" : "verified-local-snapshot",
    possibleMembers: profile.members.length,
    unknownMembers: profile.members.filter(m =>
      !m.protocols?.length || !eligible.has(m.reference)
    ).length,
    mixedProtocols: knownProtocols.has("openai-completions") && knownProtocols.has("openai-responses"),
    encodersComplete: plan.encoderContractsComplete === true,
    gatewaySelectionCause: "unknown",
    ...(profile.members[0] ? { cachedPrimary: profile.members[0].reference } : {}),
    ...(profile.policyFingerprint ? { policyFingerprintPrefix: profile.policyFingerprint.slice(0,12) } : {}),
  };
}
/** Complex, weighted, pinned and conditional rules always remain gateway-owned.
 * Catalog knowledge can warn about mixed protocols, never grant permission to
 * reproduce Bifrost's rule or claim native-encoder equivalence. */
export function opaqueRouteContract(
  logicalModel: string,
  diagnostic: AliasDiagnostic | undefined,
): RouteContractEvidence {
  const members = diagnostic?.members ?? [];
  const protocols = new Set(members.flatMap(m=>m.protocols ?? []));
  return {
    mode: "bifrost-direct",
    verification: "gateway-owned-unverified",
    possibleMembers: Math.max(members.length, diagnostic?.chain.length ?? 0),
    unknownMembers: members.length
      ? members.filter(m=>m.status!=="resolved" || !m.protocols?.length).length +
        Math.max(0,(diagnostic?.chain.length ?? 0)-members.length)
      : diagnostic?.chain.length ?? 0,
    mixedProtocols: protocols.has("openai-completions") && protocols.has("openai-responses"),
    encodersComplete: false,
    gatewaySelectionCause: "unknown",
    ...(members[0] ? { cachedPrimary: members[0].reference }
      : diagnostic?.chain[0] ? { cachedPrimary: diagnostic.chain[0] } : {}),
  };
}
/** Qualified model identity is necessary to distinguish a different served
 * member from a model-name variant; absence yields "unverified", not a claim. */
export function gatewaySelectionRelativeToPrimary(
  contract: RouteContractEvidence | undefined,
  gatewayProvider?: string,
  gatewayModel?: string,
): "matches-cached-primary" | "differs-from-cached-primary" | "unverified" {
  if (!contract?.cachedPrimary || !gatewayProvider || !gatewayModel) return "unverified";
  const slash = contract.cachedPrimary.indexOf("/");
  if (slash < 1) return "unverified";
  const provider = normalizedPhysicalProvider(contract.cachedPrimary.slice(0,slash));
  const requestedModel = contract.cachedPrimary.slice(slash+1).toLowerCase();
  return provider === normalizedPhysicalProvider(gatewayProvider)
    && requestedModel === gatewayModel.toLowerCase()
    ? "matches-cached-primary" : "differs-from-cached-primary";
}
/** Only compatibility attempts need locally proven routing state. The
 * original gateway route remains valid even when our cached snapshot is old. */
export function compatibilityExecutionError(
  profile: DynamicRouteProfile,
  plan: DynamicRoutePlan,
): string | undefined {
  if (canUseNativeBifrostRoute(profile,plan)) return undefined;
  const stale = compatibilityRouteSnapshotError(profile);
  if (stale) return stale;
  if (plan.encoderContractsComplete !== true) return `Pifrost compatibility route ${profile.id} has unresolved physical encoder contracts; refresh model metadata and rerun pifrost routes verify. Bifrost routing policy has not been changed`;
  return undefined;
}
