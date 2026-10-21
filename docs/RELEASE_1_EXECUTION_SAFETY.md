# Release 1 — execution safety (v0.29.9)

## Contract and ownership

Pifrost is an OMP/Bifrost compatibility adapter, not a second Bifrost
routing-policy engine. OMP owns session history and tool execution; Bifrost
owns routing, keys, quotas, governance, affinity, same-protocol fallback and
usage accounting. These changes protect only exceptional locally lowered
physical requests and opaque logical-alias wire-protocol negotiation.

## Physical compatibility dispatch

Native Bifrost logical routes continue to send the original `omp-*` alias.
They do not require management-plane access. When Pifrost instead needs
physical candidates because their OMP-native wire encoders differ, it must:

1. Validate the existing complete local route snapshot and encoder contracts.
2. Invoke `pifrost routes attest <alias> --json` from the OMP extension.
3. The short-lived CLI, with independently protected management credentials,
   reads Bifrost routing rules twice (3 seconds per management request),
   ensuring identical full fingerprints and alias membership.
4. Confirm an exact global simple `bifrost-simple-rule`, with no pins, and
   return the full policy fingerprint, SHA-256 of the ordered target references
   and timestamp. No local config or Bifrost resources are written.
5. Pifrost requires a matching in-memory full-policy fingerprint, ordered
   member digest, alias, schema version and attestation timestamp within
   15 seconds before the first physical HTTP attempt.

Any missing management credentials, process timeout, concurrent rule edit,
alias/member divergence, invalid response or expired attestation blocks the
physical exception **before** upstream inference. It is not silently retried
using historical cached members, and does not modify Bifrost routes.
Use `pifrost routes sync`, refresh model metadata and restart OMP after
reconciling a real change.

A successful snapshot is not an atomic lock. An edit immediately after the
read can race execution; Bifrost would need to expose revision-pinned
inference for perfect dispatch-time consistency. No claim to such a guarantee
is made here. There is no daemon, continuous polling or service.

## Shared evidence-bound attempt transitions

The same typed transition policy applies to both exceptional paths:

| Attempt mode | Next attempt allowed | Always rejected |
| --- | --- | --- |
| Gateway ingress negotiation | HTTP 400/422 with explicit unsupported-protocol evidence, before output | 401/403, 402/429, 408/504, 5xx, reasoning, output-limit and unrelated request errors |
| Local physical encoder boundary | Bifrost HTTP 502/503, classified as upstream transient, before output | 400/422, credentials/permissions, quota, rate limit, timeout 504, replay, output limits, missing HTTP evidence, all post-output failures |

All transitions remain bounded by the original ordered attempts; they never
invent providers, alter OMP sessions or replay tool executions. The attempt
runner defaults to **no transition** without an explicit policy. This is
distinct from Bifrost's own physical fallback governance.

## Verification

```bash
npm ci
npm run check
npm test
npm run release:check
pifrost routes attest omp-default --json
pifrost routes explain default --tools --reasoning
```

The attestation command is **read-only** and requires management credentials;
its JSON output contains no secrets. Tests are synthetic and do not certify
provider availability. A live acceptance test should exercise a mixed physical
compatibility route, block with mismatched policy and permissions, verify
Bifrost requests are absent after attestation rejection, and confirm a real
verified 502/503 can advance only before output is committed. Record redacted
request IDs and route fingerprints. Gateway-native passthrough must remain
available without management credentials.

## Recovery / rollback

Existing sessions and routes are not migrated. A route check failure leaves
the source session and Bifrost unchanged. If a gateway route was edited, run
`pifrost routes sync`, `pifrost models refresh --force` and restart OMP.

To roll back the package, reinstall the previously validated pinned release
`v0.29.8`, run `pifrost doctor`, and reassess physical fallback safety;
that release does not have these protections.
