# Security policy

## Supported versions

Security fixes target the latest published Pifrost version on `main`.
Previous release tags are historical references, not maintained security
branches unless the maintainer explicitly announces a backport.

## Report a vulnerability privately

Do **not** disclose live Bifrost Virtual Keys, API keys, OAuth tokens,
credentials, MCP tool outputs or reproducible secrets in public issues or
pull requests. If GitHub private vulnerability reporting is enabled for
this repository, use the **Report a vulnerability** flow under its Security
tab. Otherwise contact the repository owner privately through a published
contact channel before disclosing sensitive details. Do not assume a
public issue is private.

Useful non-secret report details: affected Pifrost and OMP/Bifrost
versions, attack preconditions, redacted request/response structure,
expected and observed behaviour, potential credential exposure and the
minimal reproduction. Never attach real session reasoning or user data.

## Boundaries

Pifrost is an OMP integration and Bifrost control-plane client. Bifrost
owns credentials, Virtual Key policy, inference provider routing and MCP
authorization. OMP owns tool execution, session history and user approval.
Pifrost's compatibility fallback must never bypass a live Bifrost rule
without valid attestation. No security guarantee is inferred from
mock-only CI tests or a successful model response.

Run `npm ci && npm run check && npm test && npm run release:check`
for a candidate fix; keep live probes explicitly opt-in.
