# Output-budget policy — Release 4 behaviour, current v0.29.18

Bifrost still owns physical provider selection, fallback order, virtual-key
permissions, and accounting. Pifrost enforces request/output-token ceilings
only where the requested target and the limit's provenance are actually known.
Pifrost does **not** reroute the user to avoid token caps, invent per-role
defaults, replay provider failures, or take ownership of Bifrost fallback.

## Which ceiling applies?

1. **Locally dispatched physical compatibility attempt.** Apply the
   user-requested maximum, any explicit operator cap, and verified/live
   output ceilings for the **first physical target actually addressed** in
   the attempt. The available Bifrost same-protocol fallback targets remain
   in their original order but their lower ceilings do *not* reduce the
   primary model's maximum.
2. **Native/opaque logical alias via Bifrost.** Apply the user's requested
   maximum, OMP-advertised logical alias ceiling, and explicit operator cap.
   Physical chain members are **diagnostic only**: Pifrost does not know
   which member Bifrost will select at dispatch and cannot assert that a
   fallback's output limit applies to the current physical request.
3. **Direct physical model.** Exact, entitlement-specific confirmed
   endpoint limits remain enforceable. An unrelated provider with the same
   model name must not inherit that limit.
4. **Explicit context headroom.** Only exact context/input accounting
   supplied directly to the budget helper constrains remaining output.
   Approximate OMP prewalk estimates do not reduce the budget.

A user-specified `maxTokens` for a locally selected physical compatibility
target is not overridden by the alias's synthetic conservative model
advertisement. If no explicit request exists, OMP's ordinary advertised
model default still applies. Pifrost cannot enlarge a number that OMP has
already normalized down before calling this extension.

A gateway may subsequently select a fallback with lower capacity. Such a
fallback can reject the larger request, and Bifrost owns that outcome.
Pifrost does **not** retry after committed output, lower a successful
primary to guarantee every possible fallback, or assert end-to-end
compatibility from metadata. When operators require every fallback to
succeed with the same request, use a deliberately compatible Bifrost chain
or a conscious lower user/operator cap.

## Safeguards retained

- Known physical output ceilings still cap the correct selected provider.
  For example, evidence-confirmed CommandCode GOAT / DeepSeek V4.1 Flash
  requests are bounded to 393,216 tokens *when that physical target is
  actually dispatched*. That ceiling does not get copied to an OpenCode Go
  or other route member.
- `PIFROST_OUTPUT_CAP_TOKENS` and per-role
  `PIFROST_OUTPUT_CAP_DEFAULT`, `PIFROST_OUTPUT_CAP_TASK`, etc. still
  apply and can only lower a budget. A value of `0` disables just that
  optional cap.
- The final-wire clamp includes only existing `max_tokens`,
  `max_completion_tokens`, and `max_output_tokens` fields, even if a
  payload hook raised them after planning. OMP remains owner of the
  serializer; no new fields are injected.
- Diagnostics count all observed physical route members and known/unknown
  ceiling evidence, while only the selected physical target is eligible
  to constrain the request.
- No artificial 8K, 16K or 32K OMP role caps have been added.

## Regression evidence and verification limits

The suite covers a 131K primary paired with an 8K fallback, a confirmed
393,216-token CommandCode primary, the same model through a different
entitlement, explicit 16K operator override and an opaque native Bifrost
logical alias. It reproduces the previous 712,434-token rejected request
without claiming a different provider must share the same ceiling.

These are deterministic tests of Pifrost's request policy. Real upstream
acceptance depends on the gateway's live provider, model, entitlement and
selected fallback; opt-in billable provider tests are still required to
establish full live conformance.

## Release 5B — gateway egress evidence

An accepted Pifrost request and Pifrost's final-wire token cap do not prove Bifrost forwarded the cap to the physical provider. If Bifrost reports `max_tokens`, `max_completion_tokens` or `max_output_tokens` in `extra_fields.dropped_compat_plugin_params` or the `x-bifrost-dropped-compat-params` response header, `/pifrost trace` displays `gateway-dropped-output-cap=yes egress-limit=unverified`. Unknown egress remains unknown. The compatibility plugin and datasheet fixes belong in Bifrost (upstream issue #8765). HTTP 413 is terminal and must not trigger a second inference attempt.
