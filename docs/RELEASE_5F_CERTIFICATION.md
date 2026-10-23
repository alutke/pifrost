# Release 5F — judgment, cache, cost and compatibility certification (v0.29.22)

Release 5F retains the pinned OMP 18.12.5 and Bifrost 2.3.2 source-level contract. It does not install a daemon, change the provider/fallback order, start paid probes by default, rewrite reasoning history, enable global caching, add arbitrary output caps or expand MCP grants.

## Native judgments, image bounds and box

`pifrost judge status` reports configured native TypeSafe Jev / OpenAI Decisions and resolves **read-only** image bounds from the pinned OMP `nativeJudgmentImageBounds()` export and bundled OMP catalog when available. Missing metadata is shown as **unverified**, not guessed; OMP owns actual image fitting, validation and native judgment transport.

Jev `jev-1.14.0` with explicit `PIFROST_NATIVE_JUDGE_IMAGES=1` is eligible for OMP's native box-question wire; aliases (including `jev-latest`) are not assumed to resolve to a verified 1.14.0. Box answers must have finite 0–1 edges with left less than right and top less than bottom, plus normalized confidence. Only an explicit `pifrost judge probe --image --box` sends a **potentially billed** Jev box request. Text/OpenAI Decisions and unknown Jev versions cannot enter the box probe.

The new `pifrost judge providers` command reads Bifrost `/v1/models` and summarises Azure/Databricks model *visibility* only. Listing alone does not establish judgment kind, credentials, `/v1/decisions` execution or correct probability semantics. An explicit canonical live provider-specific probe would still be required for certification; Pifrost does not automatically activate either provider.

## OpenAI Responses 30m/12h caching evidence

A pure inspector reads the **actual outgoing Responses JSON** immediately before dispatch. It classifies `prompt_cache_options.ttl` (`30m` or `12h`), bounded explicit breakpoints and legacy retention fields. It never adds a TTL, key or cache breakpoint or enables Bifrost's separate *whole-response cache*. An opt-in `12h` selection can cost more for initial cache writes; it is a minimum cache lifetime request rather than a deletion deadline. Invalid fields are diagnosed, not silently changed, and gateway/provider acceptance is always **unverified** until there is independent egress proof.

`npm run smoke:cache` makes exactly **two** potentially billed Requests to `/v1/responses` only when `PIFROST_LIVE_CACHE=1`, `PIFROST_CACHE_MODEL`, `BIFROST_URL` and `BIFROST_VIRTUAL_KEY` are explicitly set. Both requests contain a static synthetic prefix. It suppresses prompts and credentials; a successful API response does **not** certify a physical 12h cache retention window or physical model attribution without provider evidence. On an error it never retries the possibly billed call. This opt-in command is not in CI.

## Bifrost usage and cost provenance

The existing Bifrost bridge preserves actual response and SSE `usage` metadata. Release 5F additionally captures `cached_tokens`, `cache_write_tokens`, and `ttl_30m_tokens` / `ttl_12h_tokens` when explicitly reported. Missing counters remain **unknown**; reported zero remains zero. Moonshot/DeepSeek and other provider usage is treated identically without invented model-specific billing formulae.

`/pifrost trace` now reports Responses cache intent, reported read/write counters and distinct evidence categories for gateway-reported cost and physical-model attribution. A Bifrost `usage.cost.total_cost` is authoritative for the logged gateway total when present; neither missing cost nor a configured route primary is presented as an actual physical charge/model. OMP's session total is a bounded summary of reported attempts, not an invoice, and a gateway header/body attribution cannot independently prove external provider egress.

## CI and live evidence

Deterministic tests cover OMP bounds delegation, Jev 1.14 box geometry and opt-in gating, read-only Decisions inventory, 12h TTL and mixed breakpoint inspection, cache counters (including zero/missing), JSON gateway cost and model identity, and redacted session traces. CI additionally checks TypeScript, Node/Bun test suites, release packaging, compiled OMP 18.10.4 / 18.12.1 / 18.12.5 installers and pinned Bifrost contracts.

Live OMP host image handling, Azure/Databricks Decisions executions, verified physical 12h provider cache persistence, price reconciliation and physical model egress are **not established** by source/fixture tests. Any live validation needs separate explicit approval, disposable credentials and provider-side log evidence. Previous Bifrost replay issue #8795 remains gateway-owned.

## Rollback

Return to verified v0.29.18. There are no migrations, global cache configuration changes, or stored local state modifications.
