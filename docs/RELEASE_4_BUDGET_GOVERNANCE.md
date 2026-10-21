# Release 4 — target-scoped budgets and living documentation (v0.29.13)

## Output-token policy

In previous releases, an otherwise compatible primary model could be
capped to the weakest model in its Bifrost fallback chain, even if the
primary supported substantially more tokens. Release 4 removes this
silent reduction without claiming that every fallback shares the
primary's capacity.

When a Pifrost protocol-compatibility exception dispatches a **known
physical model**, the hard member constraint is computed against
that attempt's first physical target. Bifrost still receives its
same-protocol fallbacks in the original policy order. If the gateway
selects a weaker fallback, its own limit or rejection remains
authoritative. Where Pifrost delegates a **logical alias** to Bifrost,
physical member ceilings are reported for observability, not used
to invent a target constraint.

Verified exact-entitlement ceilings, explicit user and operator caps,
OMP's normal default output budget, final-wire field clamping and
output-commitment retry safety remain. The change does not raise an OMP
request the host already normalized, and does not force a preferred
fallback or make unknown gateway behavior look verified.

See [output budget reference](OUTPUT_BUDGET.md).

## Documentation governance

The supported-version and tested-evidence matrix is in
[INTEGRATION_SUPPORT.md](INTEGRATION_SUPPORT.md); the separate host
integration and workaround history is in
[OMP_COMPATIBILITY.md](OMP_COMPATIBILITY.md). Their main titles
and the technical reference are versioned to the same release as
`package.json`, `package-lock.json` and the current changelog.
Older headings remain explicitly historical.

`scripts/validate-documentation.mjs` checks these release identities,
dependency snapshot consistency, the support matrix's exact host scope,
and presence of the security, contribution and code-ownership guidance.
It runs in CI through `npm run check` and has negative tests for stale
versions and missing policies.

[SECURITY.md](../SECURITY.md) documents private vulnerability reporting,
credential-safe evidence and maintenance scope;
[CONTRIBUTING.md](../CONTRIBUTING.md) documents development, CI and
upstream ownership boundaries; `.github/CODEOWNERS` identifies the
current GitHub maintainer. GitHub branch protection and mandatory
review rules remain repository settings, not implied by CODEOWNERS.

## Test and deployment

```bash
npm ci
npm run check
npm test
npm run release:check
pifrost doctor
```

This release adds no background service, router, user role cap, bypass of
live Bifrost attestation or user session-history writer. Live physical
fallback behavior and actual provider output limits remain dependent
on Bifrost and upstream endpoint conformance and are **not proven**
by mock/contract CI alone.
