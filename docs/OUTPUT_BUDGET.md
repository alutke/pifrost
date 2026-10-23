# Output-budget policy — Release 4 behaviour, current v0.29.21

Bifrost still owns physical provider selection, fallback order, virtual-key
permissions, and accounting. Pifrost enforces request/output-token ceilings
only where the requested target and the limit's provenance are actually known.
Pifrost does **not** reroute the user to avoid token caps, invent per-role
defaults, replay provider failures, or take ownership of Bifrost fallback.

## Which ceiling applies?

1. **Locally dispatched physical compatibility attempt.** Apply the requested
   maximum, explicit operator cap and verified/live physical ceilings for the
   actual primary addressed in that request. A weak fallback does not
   automatically restrict a directly dispatched, capable primary.
2. **Native or opaque Bifrost logical alias.** Bifrost owns target selection,
   session affinity and fallback. Before forwarding a single logical request,
   Pifrost constrains the output budget by the narrowest **independently
   confirmed, exact entitlement-specific endpoint ceiling** among the known
   route candidates. Unverified `live` or fallback catalogue maxima are
   excluded from this physical safety envelope. The logical alias advertised
   maximum and explicitly configured operator caps still apply.
3. **Direct physical model.** Use exact, entitlement-qualified evidence for
   that provider/model; a similarly named model on a different entitlement
   is not automatically constrained.
4. **Exact context headroom.** Direct, exact helper inputs can constrain output
   headroom. Approximate prewalk estimates do not silently reduce output.

The gateway envelope is a deliberate trade-off: for one logical request,
Bifrost can select any route member (including by session affinity). The
smallest *verified* hard limit prevents an observed limit violation without
taking over routing; it can constrain an otherwise more capable member if
the gateway may dispatch to a confirmed smaller one. Where that is undesirable,
configure separate Bifrost routes or a local physical dispatch exception.

Unknown or overestimated provider limits can still cause an upstream 400.
They must be diagnosed as `OUTPUT_LIMIT_EXCEEDED` when the provider supplies
a token-range error. Pifrost cannot infer all future provider limits from
catalogue metadata, and does not silently retry HTTP inference calls: the
previous request may have reached provider-managed tools.

## Safeguards retained

- The 22 October 2026 OpenCode Go / DeepSeek V4.1 Flash response and prior
  CommandCode GOAT / DeepSeek V4.1 Flash response independently establish a
  393,216-token limit for their *exact* respective endpoints. A logical alias
  whose candidate chain includes either is clamped to this verified ceiling.
  Other providers do not inherit it based on a similar model name.
- `PIFROST_OUTPUT_CAP_TOKENS` and per-role
  `PIFROST_OUTPUT_CAP_DEFAULT`, `PIFROST_OUTPUT_CAP_TASK`, etc. remain
  optional and lower-only; `0` disables only that operator cap.
- Final-wire clamping covers existing `max_tokens`,
  `max_completion_tokens` and `max_output_tokens` after any OMP payload
  callback; Pifrost never invents a provider-specific token field.
- Diagnostics preserve confirmed versus unverified member provenance. No
  artificial universal 8K, 16K, 32K or 393K role ceiling is imposed.

## Regression evidence and limits

Tests cover 670,395 requested vs. 393,216 confirmed, Bifrost-controlled
native and opaque routes, session-affinity/fallback candidates, direct
primary-only compatibility exceptions, weak unverified fallbacks, explicit
operator caps, payload-hook mutations and the original protocol-fallback
test. The range error is classified without retaining original prompt,
credentials or tool arguments.

This proves local request construction and classification, not that Bifrost
or a third-party provider will honour the cap at egress. The existing
gateway egress diagnostics below remain authoritative when Bifrost strips
an output parameter. No additional daemon, polling service or billable
probe is introduced.

## Release 5B — gateway egress evidence

An accepted Pifrost request and Pifrost's final-wire token cap do not prove Bifrost forwarded the cap to the physical provider. If Bifrost reports `max_tokens`, `max_completion_tokens` or `max_output_tokens` in `extra_fields.dropped_compat_plugin_params` or the `x-bifrost-dropped-compat-params` response header, `/pifrost trace` displays `gateway-dropped-output-cap=yes egress-limit=unverified`. Unknown egress remains unknown. The compatibility plugin and datasheet fixes belong in Bifrost (upstream issue #8765). HTTP 413 is terminal and must not trigger a second inference attempt.
