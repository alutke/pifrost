# Pifrost integration support — v0.29.14

This page tracks the **current release** and describes **tested scope**, not an assertion that a real Bifrost gateway and every provider always work. Policy snapshot: **OMP 18.12.5**. Supported historical host installation: **OMP 18.10.4**; prior compiled host **18.12.1**; current host contract: **OMP 18.12.5**. Minimum documented Bifrost: **2.2.4+**, pinned contract validation **Bifrost 2.3.2** (including 2.3.0 historical fixtures).

| Capability | 18.10.4 compiled host | 18.12.5 compiled host | Live physical provider |
| --- | --- | --- | --- |
| Plugin installation / `omp plugin list` | Tested in CI | Tested in CI | Not applicable |
| Native extension registration with mocked model discovery | Shared integration test (not executed inside the compiled host) | Shared integration test (not executed inside the compiled host) | Not proven |
| Bifrost routing, fallback and reasoning replay | Mocked CI and upstream contracts | Mocked CI and upstream contracts | Separate opt-in transport smoke |
| TypeSafe `/typesafe/v1/systemone` Jev | Not advertised as supported | Native wire mocked; optional registered provider | Opt-in billable conformance |
| OpenAI `/openai/v1/decisions` | Not advertised as supported | Native wire mocked; optional registered provider | Opt-in billable conformance |
| Jev native image judgments | Not advertised as supported | Experimental, opt-in, mocked | Opt-in billable image conformance |
| Auto-prewalk / `/seance` / advisor | Not advertised as supported | Settings and source contract inspection | No real session/consultation run |
| Optional gateway image-count metadata | Deterministic unit coverage | Deterministic unit coverage | Only if Bifrost actually reports validated fields |

## Ownership and limits

OMP owns native judgment execution, image input validation, agent sessions, prewalk, advisor and native fallback. Bifrost owns endpoint routing, gateway auth, provider policy and billing. Pifrost owns isolated model registration, conservative metadata and CLI diagnostics. Native non-chat judge roles are **not filtered** by `enabledModels`; only `modelRoles.judge` is changed by activation. Bifrost inventory image-count properties `image_count_budget` and `per_request_limits.images` are optional extensions, **not documented universal fields**. Missing fields cannot be inferred from a provider name.

## Safe user verification

```bash
pifrost doctor
pifrost omp readiness --verbose
pifrost omp workarounds --verbose
pifrost judge status
pifrost judge activate --dry-run
```

For optional **billable** native conformance, on a trusted machine with a test Bifrost Virtual Key authorised to both TypeSafe and OpenAI:

```bash
export BIFROST_URL=http://127.0.0.1:8180/v1
export BIFROST_VIRTUAL_KEY=YOUR_TEST_VIRTUAL_KEY
export PIFROST_LIVE_JUDGMENTS=1
npm run smoke:judgments
```

The smoke runs text and synthetic-image judgments for `jev-1.14.0` and `openai/gpt-6-luna` by default. Set `PIFROST_LIVE_JUDGE_MODELS` to a comma-separated subset. It fails when discovery, typed answers, or usage evidence are missing. Output suppresses upstream response bodies and secrets. It **does not** demonstrate correct answers on a representative production workload, and does not automate OMP's `/seance` or prewalk lifecycle.

## Quality gates

CI runs package and source contracts, the native-extension mocked-registration test, the model metadata tests, judge role rollback tests, historical/current compiled installation, and the workaround-registry reference validator. All assertions beyond these gates require separate evidence. Never remove routing/transport/reasoning guards based on an OMP version number alone.

For optional **read-only** live gateway image-budget inventory inspection, set `PIFROST_LIVE_IMAGE_METADATA=1` and run `npm run smoke:image-metadata` with the same Bifrost URL and test Virtual Key. No image or decision request is submitted; counts may legitimately be zero because the fields are optional.

## Historical: thinking-qualified auto-prewalk target checks (v0.29.1)

`pifrost omp readiness` checks a role such as `bifrost/omp-smol:high` using the underlying logical ID `omp-smol`, while preserving the full OMP selector in the read-only report. OMP-supported thinking suffixes are also removed when comparing basic `enabledModels` patterns. Unsupported selectors, complex scopes, missing aliases and stale caches still produce conservative unknown/warning results. No Bifrost route or OMP setting is changed by this diagnostic fix.


## Release 4 evidence update (v0.29.13)

- CI validates atomic per-request route snapshots, target-scoped output ceilings,
  Bifrost logical alias passthrough, confirmed entitlement-scoped endpoint caps,
  MCP response size bounds and denied credential redirects.
- Compiled OMP 18.10.4 and OMP 18.12.5 test **installation/plugin discovery** (with additional historical 18.12.1 coverage).
  Native integration uses a mocked Bifrost endpoint; no production provider
  fallback or live user session is proven.
- Release documentation/policy snapshot drift, missing private security guidance,
  and missing owner declarations are CI failures.
- Live provider output, requested fallback token handling, command/tool side
  effects and billing must be assessed with a separate, explicitly approved,
  potentially billable conformance probe.

## Release 5A evidence update (v0.29.14)

- The five pinned OMP package versions and the policy snapshot are all **18.12.5**; the current compiled host gate is 18.12.5, alongside 18.10.4 minimum-host and 18.12.1 historical checks.
- Bifrost 2.3.2 security and 2.3.1 feature contracts are checked against immutable upstream release commits. This validates public/source contracts, **not** the installed gateway's version or live transport semantics.
- Bifrost 2.3.1 introduces additive and some non-reversible database migrations. Before independently upgrading the actual gateway, back up the configuration/database and rehearse migrations. 2.3.2 requires rebuilding custom Go plugins with Go 1.27.3; it introduces no additional database migration.
- Upgrade does not enable tool search, auto-executing OpenAPI MCP tools, newer judgment wire modes, new response header placement, or any paid live probe. Later 5B–5F phases assess those behaviours.
