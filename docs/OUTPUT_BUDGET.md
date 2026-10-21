# Release B — output-budget protection (v0.29.4)

This policy only limits maximum output tokens **per inference request**. It
does not constrain total session work, model reasoning level or the number
of legitimate future tool calls. Bifrost still owns its live routing rules,
fallback order, session affinity, virtual-key permissions and usage accounting.

## Safe budget order

Pifrost calculates the minimum supported ceiling using:

1. The requested `maxTokens` (or OMP-advertised default).
2. An **opt-in** operator cap only if explicitly supplied as an environment override.
3. The original model metadata output ceiling.
4. All known physical route members' output ceilings. Provider-scoped,
   evidence-confirmed and live-advertised ceilings take precedence over
   inflated catalog defaults; no limit from one provider is copied to another.
5. Context headroom **only if exact input accounting is explicitly supplied**. OMP itself owns normal context estimates and compaction; Pifrost does not reduce model output from approximate history-token counts.

Unresolved or stale route metadata is *not* treated as verification.
No implicit cap is invented for an `omp-*` alias. If its model
and physical members have unknown capacity, Release B does **not** claim
that the resulting request is verified safe. Full live
contract verification and affinity compatibility are Release C.

The same budget is applied before route capacity planning, to native
physical attempts and to the final serialized request. All existing
`max_tokens`, `max_completion_tokens` and `max_output_tokens` fields are
clamped, including higher values introduced by an upstream payload hook.
Pifrost does not inject a field if OMP omitted it for provider compatibility;
that limitation is surfaced through its existing transport contracts.

## No arbitrary defaults; optional overrides

All `omp-*` roles and direct physical models retain their advertised
output capabilities by default. No fixed 8K, 16K, 32K or other role cap
is imposed.

If desired, specify `PIFROST_OUTPUT_CAP_TOKENS=<positive integer>` to opt
into a global output cap, or a role-specific variable such as
`PIFROST_OUTPUT_CAP_DEFAULT`, `PIFROST_OUTPUT_CAP_TASK` or
`PIFROST_OUTPUT_CAP_ADVISOR`. Role-specific settings take precedence.
`0` disables *only* the optional cap; physical-provider limits remain
in force. Invalid settings fail explicitly.

Unverified or synthetic fallback defaults do not count as proven
physical-provider limits. The trace reports unknown member coverage.
No provider-specific confirmed ceiling is copied across entitlements.

Explicit OMP token requests remain visible as the **requested** value.
When a *verified* ceiling lowers a request, `/pifrost trace` reports it;
`/pifrost trace verbose` reports the constraint's source.

## Regression evidence

The unit suite reproduces the 20 October 2026 request for 712434 tokens.
It confirms **no arbitrary role restriction**, and a 393216
provider-confirmed CommandCode GOAT/DeepSeek V4.1 Flash cap when that
physical member is included in the known route. Without verified member
metadata the request is not falsely described as safe.
No prompt data, upstream thinking, tool arguments, or credentials are saved.

## Out of scope

This release does not repair missing DeepSeek `reasoning_content`/`reasoning_text`,
grant Bifrost permissions, switch providers, retry failed tool work or create
background services. Releases C and D address physical fallback compatibility
and reasoning replay separately.
