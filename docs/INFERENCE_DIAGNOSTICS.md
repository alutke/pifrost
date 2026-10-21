# Release A — inference diagnostics (0.29.3)

Release A is **observability only**. It does not modify route selection, model
fallback order, output-token requests, reasoning replay, permissions, or retries.

## Evidence and scope

A synthetic fixture (`test/fixtures/release-a-incident.json`) records the
structural signature of the 20 October 2026 incident:
- A 555-item OpenAI Responses history (35 user messages, 100 assistant
  messages, 210 function calls and 210 matching outputs).
- Zero native reasoning items despite reasoning effort `high`.
- A 712,434 requested output cap; the CommandCode model rejected the request
  against its own 393,216 maximum.
- A physical DeepSeek fallback denied by a Bifrost virtual-key model allowlist.
- Routing rule/session-affinity evidence showing that the selected provider may
  differ from the configured primary.

Only these non-secret structural facts and synthetic errors are included.
The original uploaded history, tool arguments, reasoning, IDs and credentials
are **not** committed to the repository.

## Interpretation and limitations

Use `/pifrost trace` for human-readable errors, and
`/pifrost trace verbose` for structural counts, HTTP status, Bifrost IDs,
the served physical model *when gateway-confirmed*, and typed failure codes.

- `REASONING_REPLAY_INVALID`: upstream says a required reasoning field was
  missing or invalid. Zero reasoning items in the **outgoing request** is
  evidence, not proof that Pifrost dropped reasoning; OMP serialization and
  Bifrost translation must be tested separately.
- `OUTPUT_LIMIT_EXCEEDED`: provider rejected the requested token budget.
  Release A does not clamp it; Release B will address budgets.
- `MODEL_NOT_PERMITTED`: Bifrost denied the model for the virtual key. Fix
  permissions or route configuration in Bifrost; Pifrost does not bypass them.
- `ROUTE_CONTRACT_UNKNOWN` / `PROTOCOL_INCOMPATIBLE`: explicit upstream
  evidence of stale routing metadata or protocol mismatch.
- `UPSTREAM_TRANSIENT`: upstream 5xx, not an automatic retry instruction.
- `OTHER_REQUEST` / `UNKNOWN`: do not infer a more specific diagnosis.

Structural diagnostics include protocol, input item counts, assistant items,
reasoning item counts, tool-call pairing counts, the requested output-token
limit and reasoning effort. They contain **no original message text**.

Pifrost's Bifrost headers prove the gateway's reported selection, not that
a specific routing rule matched; Bifrost Logs/Routes remain authoritative.
`pifrost routes verify` verifies the configured policy fingerprint, not
session affinity, an upstream response, virtual-key permissions, or compatibility
of a specific historical transcript.

## Subsequent releases

B: output-token enforcement. C: physical routing compatibility.
D: reasoning replay correctness. E: bounded recovery. F: cross-provider
hardening. Do not attribute their planned safeguards to this release.
