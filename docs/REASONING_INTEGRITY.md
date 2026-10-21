# Release D — reasoning replay integrity (v0.29.6)

Pifrost delegates conversation serialization and provider-approved non-substantive
replay placeholders to **OMP**. At the final wire boundary, Pifrost audits the
replay shape only when a verified physical-model policy establishes a strict
requirement. No prompt text, reasoning, signatures or tool payloads are logged.

The original 20 October 2026 incident had 555 input items, 100 assistant
messages, 210 tool calls/outputs and *zero* structured reasoning items.
For a verified strict thinking-mode Responses model, such a request is
intercepted with `REASONING_REPLAY_INVALID` before upstream submission.
A matching physical model policy passed to OMP may instead cause OMP itself to
reconstruct supported non-substantive replay placeholders and permit the turn.

Other providers are not arbitrarily forced into strict mode. Unknown/opaque
models retain their model capabilities and are reported as **unverified**.
Native structured reasoning, encrypted replay signatures, IDs, Chat reasoning
fields, and tool call IDs remain untouched.

Use `/pifrost trace verbose` to inspect contract provenance, assistant run
counts, missing required runs and gateway error classifications. No automatic
rewriting of conversation history, model switching, reruns of completed tools,
Bifrost permission changes or background services are introduced.

If the gateway subsequently rejects a structurally valid request, examine its
actual outgoing physical-provider payload using Bifrost's request ID: a gateway
Responses-to-Chat conversion defect cannot be repaired safely by fabricating
model thoughts at the Pifrost boundary.
