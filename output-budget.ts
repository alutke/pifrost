/**
 * Release B: one provider-neutral, request-scoped output budget policy.
 * Bifrost remains responsible for provider/key/fallback choice; this policy
 * only calculates and enforces a conservative output token envelope.
 *
 * It does not fetch metadata, make routing decisions, or retry inference.
 */
import { confirmedProviderOutputCeiling } from "./endpoint-contracts.ts";

export interface OutputBudgetMember {
  reference: string;
  maxTokens?: number;
  /** Capability provenance from the existing model catalog. */
  source?: string;
  contextWindow?: number;
  estimatedInputTokens?: number;
}
export type OutputBudgetConstraintSource =
  | "requested" | "advertised" | "confirmed-endpoint" | "live-member"
  | "catalog-member" | "context-headroom" | "operational-cap";
export interface OutputBudgetConstraint {
  source: OutputBudgetConstraintSource;
  tokens: number;
}
export interface OutputBudgetDecision {
  requestedTokens?: number;
  effectiveTokens: number;
  explicit: boolean;
  reduced: boolean;
  limitingSource: OutputBudgetConstraintSource;
  constraints: readonly OutputBudgetConstraint[];
  memberCount: number;
  verifiedMemberCount: number;
  unknownMemberCount: number;
}
export interface OutputBudgetInput {
  logicalModel: string;
  requestedTokens?: number | null;
  advertisedTokens?: number | null;
  members?: readonly OutputBudgetMember[];
  contextWindow?: number;
  estimatedInputTokens?: number;
  /** Distinguishes explicit user-specified output limits from OMP defaults. */
  explicit?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
}

const ROLE_CAPS: Readonly<Record<string, number>> = {
  default: 32_768, task: 16_384, advisor: 16_384, plan: 32_768,
  smol: 8_192, tiny: 8_192, commit: 8_192,
};
const GENERAL_ROLE_CAP = 32_768;
const CONTEXT_HEADROOM = 2_048;
const POSITIVE_LIMIT = 10_000_000;

export class OutputBudgetCapacityError extends Error {
  constructor(message: string) { super(message); this.name = "OutputBudgetCapacityError"; }
}
function validTokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= POSITIVE_LIMIT
    ? value : undefined;
}
/** Return undefined if no operational cap applies. 0 explicitly disables that
 * optional cap, not the provider ceiling or contextual capacity constraints. */
export function operationalOutputCap(
  logicalModel: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | undefined {
  const match = /^omp-([a-z0-9_-]+)$/iu.exec(logicalModel);
  const role = match?.[1]?.toLowerCase();
  const specificKey = role ? "PIFROST_OUTPUT_CAP_" + role.toUpperCase().replace(/-/gu, "_") : undefined;
  const key = specificKey && env[specificKey] !== undefined ? specificKey
    : env.PIFROST_OUTPUT_CAP_TOKENS !== undefined ? "PIFROST_OUTPUT_CAP_TOKENS" : undefined;
  if (key) {
    const value = env[key]?.trim();
    if (!value || !/^(0|[1-9][0-9]{0,7})$/u.test(value)) {
      throw new OutputBudgetCapacityError(`Invalid ${key}: expected integer 0 (disable) or 1..${POSITIVE_LIMIT}`);
    }
    const parsed = Number(value);
    if (parsed > POSITIVE_LIMIT) throw new OutputBudgetCapacityError(`Invalid ${key}: exceeds supported limit`);
    return parsed || undefined;
  }
  return role ? ROLE_CAPS[role] ?? GENERAL_ROLE_CAP : undefined;
}
function maxContextOutput(contextWindow: number | undefined, estimatedInput: number | undefined): number | undefined {
  if (validTokenLimit(contextWindow) === undefined || estimatedInput === undefined ||
      !Number.isFinite(estimatedInput) || estimatedInput < 0) return undefined;
  const remaining = Math.floor(contextWindow! - estimatedInput - CONTEXT_HEADROOM);
  if (remaining <= 0) throw new OutputBudgetCapacityError(
    `Estimated input ${Math.ceil(estimatedInput)} tokens leaves no output headroom within context ${contextWindow}; compact or choose a larger model`,
  );
  return remaining;
}
export function resolveOutputBudget(input: OutputBudgetInput): OutputBudgetDecision {
  const constraints: OutputBudgetConstraint[] = [];
  const add = (source: OutputBudgetConstraintSource, tokens: number | undefined): void => {
    if (tokens !== undefined) constraints.push({ source, tokens });
  };
  const requested = validTokenLimit(input.requestedTokens);
  if (input.requestedTokens != null && requested === undefined) {
    throw new OutputBudgetCapacityError("Invalid requested output-token budget; must be a positive bounded integer");
  }
  add("requested", requested);
  add("advertised", validTokenLimit(input.advertisedTokens));
  const operational = operationalOutputCap(input.logicalModel, input.environment ?? process.env);
  add("operational-cap", operational);
  add("context-headroom", maxContextOutput(input.contextWindow, input.estimatedInputTokens));

  let verifiedMembers = 0;
  const members = input.members ?? [];
  for (const member of members) {
    const confirmed = confirmedProviderOutputCeiling(member.reference);
    const live = member.source === "live" ? validTokenLimit(member.maxTokens) : undefined;
    const advertisedMember = validTokenLimit(member.maxTokens);
    if (confirmed !== undefined || live !== undefined) verifiedMembers++;
    add("confirmed-endpoint", confirmed);
    add("live-member", live);
    add("catalog-member", advertisedMember);
    add("context-headroom", maxContextOutput(member.contextWindow, member.estimatedInputTokens));
  }
  if (!members.length) {
    // A directly addressed physical provider still benefits from evidence
    // confirmed for its exact entitlement-specific qualified name.
    add("confirmed-endpoint", confirmedProviderOutputCeiling(input.logicalModel));
  }
  if (!constraints.length) {
    throw new OutputBudgetCapacityError(`No safe output limit for ${input.logicalModel}; refresh the Bifrost model catalog`);
  }
  const sorted = [...constraints].sort((a,b) => a.tokens-b.tokens);
  const selected = sorted[0]!;
  return {
    requestedTokens: requested,
    effectiveTokens: selected.tokens,
    explicit: input.explicit === true,
    reduced: requested !== undefined && selected.tokens < requested,
    limitingSource: selected.source,
    constraints,
    memberCount: members.length,
    verifiedMemberCount: verifiedMembers,
    unknownMemberCount: members.length-verifiedMembers,
  };
}

/** Clamps every present OpenAI-style token field, including caps added by an
 * upstream onPayload callback. No field is invented: OMP remains authoritative
 * about which token field the physical provider accepts. */
export function clampOutputTokenFields<T>(value: T, decision: Pick<OutputBudgetDecision, "effectiveTokens">): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  let changed = false;
  const copy = { ...record };
  for (const field of ["max_output_tokens", "max_completion_tokens", "max_tokens"]) {
    const number = copy[field];
    if (typeof number === "number" && Number.isFinite(number) && number > decision.effectiveTokens) {
      copy[field] = decision.effectiveTokens;
      changed = true;
    }
  }
  return (changed ? copy : value) as T;
}
