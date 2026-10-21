# Contributing to Pifrost

Before changing behaviour, consult
[README](README.md), [technical reference](docs/REFERENCE.md),
[host support evidence](docs/INTEGRATION_SUPPORT.md),
[OMP compatibility](docs/OMP_COMPATIBILITY.md) and
[workaround register](workaround-register.mjs).

## Ownership rules

1. OMP owns sessions, agent lifecycle, tool calls, model transport serializers,
   native compaction, reasoning history and judgment execution.
2. Bifrost owns physical model order, provider/key routing, quotas,
   session affinity, same-protocol fallback and MCP governance.
3. Pifrost owns only translation, conservative metadata, evidenced
   compatibility boundaries and diagnostics. Do not create a second router,
   daemon, permanent services or a shadow session-history store.

When updating model budget logic, do not cap a primary physical model
solely because a weaker fallback might be selected later by Bifrost.
Retain evidence-confirmed target limits and explicit user/operator caps.

## Local development

Requirements: Node.js 22.19+, npm, Bun for native host tests, and a
matching pinned OMP policy snapshot. Install dependencies with `npm ci`.

```bash
npm ci
npm run check
npm test
npm run release:check
```

Check architecture checks, metadata diagnostics, Bash/Node/Bun integration,
packaging and minimum/current compiled OMP compatibility in CI. Do not
silently remove regression checks to make CI green.

Submit changes as an issue or pull request with: a user-visible failure or
upstream contract gap, proof (redacted), preservation of route/provider
authority, positive/negative tests, doc updates and removal criteria for
temporary workarounds. Describe what requires a live billable Bifrost probe.
Do not commit keys, bearer tokens or historical conversations.
