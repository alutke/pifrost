# Release 5A — OMP and Bifrost contract foundation (v0.29.14)

Release 5A advances the **packaged** Pifrost compatibility baseline without
changing live routes or gateway configuration. It does not automatically upgrade
a Bifrost server. It retains Bifrost-owned physical routing, credentials,
governance, MCP retries, quota and model selection; OMP retains agent lifecycle,
session history, tool execution, model serialization, native judgments and
compaction. Pifrost remains an optional adapter and read-only diagnostic layer.

## Tested package and contract pins

| Item | Current | Historical or minimum |
| --- | --- | --- |
| Pifrost | v0.29.14 | v0.29.13 |
| OMP runtime policy and all five direct npm packages | 18.12.5 | 18.12.1 |
| OMP compiled host checked by CI | 18.12.5 | 18.12.1, minimum 18.10.4 |
| Bifrost HTTP pinned upstream contracts | 2.3.2 | historical contracts from 2.0.0 through 2.3.0 |
| Minimum documented Bifrost runtime | 2.2.4 | Not lowered |

The upstream OMP 18.12.5 commit is
`d5cd750e41fede277f9eb933455da92a0738915e`; the Bifrost HTTP
2.3.2 transport tag resolves to
`a05ea20e68bf116a35e9f05b1a3d749624b3935e`.
Contract fixtures reference immutable commits, not moving `main` branches.
Their successful retrieval checks source-level shapes and known compatibility
contracts, **not real provider execution or the installed Bifrost binary**.

## Operator gateway upgrade warning

Bifrost 2.3.1 introduced multiple database migrations, including irreversible
storage changes for OpenAPI MCP clients, virtual-key metadata and gateway
configuration. Before deploying Bifrost 2.3.2 to an existing database:

1. Take tested backups of the Bifrost database, configured settings and any
   object-store data needed for an actual restore. Record the current image
   digest, enabled plugins, configured Virtual Keys and tool grants without
   copying secrets into release evidence.
2. Run a migration rehearsal against a copied database. Verify gateway startup,
   effective auth, routes, enabled MCP clients and logs.
3. Rebuild any custom Go plugins with Go 1.27.3. Bifrost 2.3.2 changes the Go
   security baseline to address CVE-2026-111943; it adds no further database
   migrations beyond 2.3.1.
4. Confirm a database restore path. Simply reinstalling the prior Docker image
   may not undo irreversible schema changes.
5. Only after a successful rehearsal, update the real gateway independently.
   Pifrost itself never triggers a server migration or deploys Bifrost.

Upstream reported MCP replay of non-idempotent mutations (issue #8795),
datasheet-based output-limit stripping (#8765), truncated aggregate model
inventories (#8759) and missing custom provider usage (#8749) still require
independent conformance. Pifrost 5A makes no safety claim for these gateway
behaviours; planned releases 5B through 5F cover the tests and feature work.

## Local validation

```bash
npm ci
npm run check
npm test
npm run release:check
pifrost doctor --verbose
pifrost omp readiness --verbose
```

The pinned CI additionally checks compiled OMP plugin discovery across the
minimum, previous and current hosts; native extension source/API contracts;
historical and 2.3.2 Bifrost contract fixtures; and clean GitHub installs.
Local mocked and source checks are not a substitute for a separately approved
live physical fallback, billed judgment or MCP mutation conformance probe.

## Rollback

Reinstall the last known good Pifrost/OMP package versions if needed; keep
previous matching release tags and their dependency locks. Record and preserve
the original Bifrost configuration and database prior to running gateway
migrations. Pifrost 5A adds no daemon, service, polling process, model role cap,
default billable probe or automatic MCP permission increase.
