# Pifrost 0.30 security model (unpublished candidate)

Pifrost is an optional CLI-first Bifrost connector, not an OMP inference proxy. An installed legacy runtime plugin must be disabled separately before using the new command palette.

- **Credential separation:** inference Virtual Keys and optional Bearer keys are independent of Bifrost management authentication. MCP/Skills management never requires an inference Virtual Key. The selected OMP profile resolves environment-first credentials from private Pifrost secret commands.
- **Virtual Key permissions:** direct MCP clients, explicitly allowed tools and Virtual MCP bundles are constrained by Bifrost per-repository VKs. The CLI does not bypass Bifrost execution policy.
- **Repository local files:** .omp/mcp.json contains command-resolved secrets, not a raw VK; .agents/skills uses ownership markers and content hashes. Reset preflights local ownership before any irreversible remote Virtual Key action.
- **Model configuration:** optional marked models.yml entries are written with backups. OMP remains responsible for role selection, reasoning, streaming, retries, tool calls and compaction. Do not infer that all Bifrost physical models support the selected Chat/Responses protocol.
- **Slash interface:** /pifrost registers one opt-in command only; no hooks or runtime providers. Mutations require interactive confirmation. Gateway error bodies are not sent to notifications, and common credential patterns in successful responses are redacted.
- **Migration:** only exact Pifrost historical role values can be changed; enabledModels and modelProviderOrder always remain OMP-owned. Rollback refuses to overwrite later user changes.
- **Operational caveats:** shell-argument secrets can be exposed in process lists and history; use private environment variables or protected prompts. Remote Bifrost calls can be chargeable or make irreversible grant changes. Do not test against live production credentials without approval.

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
