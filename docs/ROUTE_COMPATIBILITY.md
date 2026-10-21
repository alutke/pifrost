# Release C — physical-provider routing compatibility (v0.29.5)

Pifrost does not execute Bifrost CEL, make virtual-key permission changes,
change session affinity, select a billing source, or copy arbitrary gateway
rules into its fallback engine. Bifrost owns routing; OMP owns sessions,
reasoning serialization, context estimates and tool execution.

## Runtime decision

- **Bifrost native:** For a simple synchronized rule, every *reachable* member
  must be eligible and have an OMP-resolved compatible physical Chat encoder.
  Native requests keep the original logical alias and Bifrost executes its
  live rule, including normal fallback and session affinity. A stale local
  fingerprint never makes a native gateway request depend on local CEL.
- **Compatibility exception:** Protocol differences, incompatible OMP wire
  contracts or eligibility filtering require a locally constructed physical
  attempt. This path is allowed only when the route was synchronized recently,
  its saved full-policy fingerprint is valid, and every eligible physical
  encoder contract is resolved. Attempts preserve member order, use only the
  provider-native encoder and never retry after committed model output.
- **Opaque/conditional/pinned/weighted:** These are gateway-owned regardless of
  local metadata. Pifrost does not try to recreate scope, CEL, key pins,
  fallback weighting, budget conditions or session-affinity matching. The
  existing Bifrost ingress behaviour continues. A cache of provider models
  cannot prove a Bifrost routing-rule match.

## Affinity and provenance

All known route members are considered potential physical selections, not
just the primary. Bifrost response headers may identify a served provider and
model. If that qualified identity differs from the cached primary,
`/pifrost trace verbose` reports `selection=differs-from-cached-primary`
with `selection-cause=unverified`. The observation alone cannot distinguish
session affinity, normal fallback or another live gateway decision.

A full `policyFingerprint` is derived from a read of Bifrost's complete
management-plane routing rules and is stored by `pifrost routes sync`. Only
locally constructed compatibility attempts require this fingerprint plus a
fresh sync timestamp; it is not a substitute for a live Bifrost route query.
`pifrost routes verify` compares the full digest to the live rules without
rewriting the gateway. `pifrost routes reconcile` is a user-prompt/on-demand
check, not a daemon or timer.

## Virtual key restrictions

A model denied by a Bifrost virtual-key allowlist produces a specific
`MODEL_NOT_PERMITTED` diagnostic. Pifrost never bypasses this control,
reenables a member, or treats HTTP 403 as protocol compatibility retry.
Where this capability is not exposed in the model catalog, preflight cannot
truthfully claim that every member is permitted. The actual Bifrost policy
remains authoritative.

## Scope and known limitation

Release C does not manufacture missing reasoning state or repair Bifrost's
Responses-to-Chat reasoning conversion. Strict multi-turn reasoning replay
is Release D. It does not introduce output limits beyond Release B, nor
restrict an opaque route to the models present in Pifrost's last snapshot.
Inability to verify a *local physical exception* produces an actionable error
rather than an unsafe reinterpretation of an unverified Bifrost routing rule.
