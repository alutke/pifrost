# Release B — output-budget protection (v0.29.4)

This policy only limits maximum output tokens **per inference request**. It
does not constrain total session work, model reasoning level or the number
of legitimate future tool calls. Bifrost still owns its live routing rules,
fallback order, session affinity, virtual-key permissions and usage accounting.

## Safe budget order

Pifrost calculates the minimum supported ceiling using:

1. The requested `maxTokens` (or OMP-advertised default).
2. Any matching OMP role operational cap (including optional environment override).
3. The original model metadata output ceiling.
4. All known physical route members' output ceilings. Provider-scoped,
   evidence-confirmed and live-advertised ceilings take precedence over
   inflated catalog defaults; no limit from one provider is copied to another.
5. Known context-window headroom after input estimate and 2,048 token reserve.

Unresolved or stale route metadata is *not* treated as verification.
A general 32K operational cap reduces risk for opaque `omp-*` aliases,
but does not prove a smaller/unknown actual model's limit. Complete live
contract verification and affinity compatibility are Release C.

The same budget is applied before route capacity planning, to native
physical attempts and to the final serialized request. All existing
`max_tokens`, `max_completion_tokens` and `max_output_tokens` fields are
clamped, including higher values introduced by an upstream payload hook.
Pifrost does not inject a field if OMP omitted it for provider compatibility;
that limitation is surfaced through its existing transport contracts.

## Defaults and overrides

| Logical role | Default output cap |
| --- | ---: |
| `omp-default`, `omp-plan` | 32768 |
| `omp-task`, `omp-advisor` | 16384 |
| `omp-smol`, `omp-tiny`, `omp-commit` | 8192 |
| Other `omp-*` roles | 32768 |
| Direct non-OMP physical models | No new default |

Override globally using `PIFROST_OUTPUT_CAP_TOKENS=<integer>`, or per role
using `PIFROST_OUTPUT_CAP_DEFAULT`, `PIFROST_OUTPUT_CAP_TASK`,
`PIFROST_OUTPUT_CAP_ADVISOR`, etc. Role-specific values take precedence.
`0` disables *only* the operational cap, never provider/route capacity limits.
Malformed values fail with a local, actionable error instead of being ignored.

Explicit OMP max token requests remain visible as the **requested** value.
If their cap is reduced, `/pifrost trace` reports the effective ceiling and
`/pifrost trace verbose` reports the limiting source and available member
provenance. Use overrides deliberately when a role needs longer outputs.

## Regression evidence

The unit suite reproduces the 20 October 2026 request for 712434 tokens.
It confirms a 32768 default `omp-default` per-response ceiling, and a
393216 provider-confirmed CommandCode GOAT/DeepSeek V4.1 Flash cap when
operational limits are disabled or the physical model is called directly.
No prompt data, upstream thinking, tool arguments, or credentials are saved.

## Out of scope

This release does not repair missing DeepSeek `reasoning_content`/`reasoning_text`,
grant Bifrost permissions, switch providers, retry failed tool work or create
background services. Releases C and D address physical fallback compatibility
and reasoning replay separately.
