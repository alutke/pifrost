# Changelog

## Unreleased

## 0.6.8 — 2026-09-27

- Fixed `pifrost repo init` returning HTTP 409 when updating an already-associated legacy repo Virtual Key such as `omp-homelab-mcp` on Bifrost 2.2.3.
- Repo Virtual Key policy updates no longer resend the unique `name` field. They update only mutable fields such as `is_active` and `mcp_configs`, avoiding Bifrost's uniqueness conflict on PUT.
- Existing stored Virtual Key ids, names and raw secrets are preserved; this fix does not recreate or rotate working repo keys.
- Preserved the 0.6.7 repo-scoped naming and 409 create-race recovery for newly initialized repositories.
- Added an exact regression for the live homelab shape: an existing `omp-homelab-mcp` key with n8n is updated to n8n + Railway while the mock Bifrost rejects any PUT that contains `name`.

## 0.6.7 — 2026-09-27

- Fixed `pifrost repo init` failing with HTTP 409 when a Bifrost Virtual Key already used the basename-only canonical name.
- Repo MCP Virtual Key names are now scoped to Pifrost's stable repository id (for example `omp-homelab-<identity-hash>-mcp`) rather than only the checkout basename, preventing collisions between unrelated repositories named `homelab`.
- Existing repos with a stored Virtual Key id/name continue to use that association; fresh repos do not silently adopt an ambiguous legacy basename-only key.
- Exact-name recovery now paginates the full Bifrost Virtual Key inventory and compares names locally instead of relying on optional server-side `search` semantics.
- Added HTTP 409 race recovery: if another init creates the canonical key between lookup and create, Pifrost re-reads the exact repo-scoped name and safely adopts it.
- Exposed the existing explicit `--rotate-existing` recovery option through `pifrost repo init`; existing keys with masked/unavailable raw values are never rotated implicitly.
- Added regression coverage for same-basename repo isolation, search-independent lookup, 409 create races, explicit rotation recovery, and reset naming.

## 0.6.6 — 2026-09-27

- Restored the complete 10-role model catalogue for the current routing set by adding a narrowly scoped verified capability record for `stealth/pixel-canary` (262,144 context, 131,072 output, image input, reasoning and tools). This prevents `omp-advisor` from being withheld when Command Code's live/catalog metadata has not caught up with the new stealth model.
- Added verified MiMo V2.6 Flash and Pro capability records from Xiaomi's current model/API contracts, including 1,048,576 context, 131,072 output, multimodal image input, reasoning, tools and the documented reasoning-effort mappings.
- Fixed the current `omp-vision` route so OpenCode Go, Command Code GOAT and Xiaomi MiMo variants of `mimo-v2.6-flash` retain image capability instead of collapsing the alias to text-only.
- Kept provider/vendor matching narrow: the new hints do not leak to explicitly different vendors with the same model tail.
- Added regression tests for the live `omp-advisor` Pixel Canary route and the three-provider `omp-vision` MiMo V2.6 route, including alias synthesis, capability provenance and multimodal output.
- Advanced the catalogue cache schema to v6 so installations automatically reject pre-fix cached catalogues and rebuild the corrected model set.

## 0.6.5 — 2026-09-27

- Changed Git/GitHub installation packaging to ship the standalone CLI runtime as committed `dist/` artifacts instead of building them on the consumer machine.
- Removed the `prepare` lifecycle hook entirely. npm therefore no longer enters its Git-dependency build/repack path for Pifrost global installs, avoiding the install-state failures seen after 0.6.4.
- Kept `build:runtime` as an explicit development/release maintenance command only; CI rebuilds `dist/` from the TypeScript sources and fails if committed artifacts are stale.
- Added a Linux CI regression that performs the same global GitHub install shape used by users — `npm install --global --prefix <temp> github:alutke/pifrost#<sha>` — and verifies that the installed package directory, executable link and `pifrost --version` all survive the install.
- Retained the existing packed-tarball installation check and OMP/Bifrost compatibility suite, so both registry-style and GitHub-source installation paths are now release-gated.

## 0.6.4 — 2026-09-27

- Fixed Git/GitHub npm installs failing during `prepare` with `tsc: not found` on global installs where development dependencies are unavailable.
- Replaced the consumer-side TypeScript compiler dependency with a zero-dependency Node.js runtime builder using Node 22's built-in type stripping; Pifrost's supported Node baseline already provides this capability.
- Kept the generated standalone CLI runtime isolated in `dist/`, while the native OMP extension continues to use its TypeScript sources.
- Added release validation that deletes `dist/`, rebuilds it using only the Node executable, verifies all runtime artifacts are recreated, then packs, installs and executes the resulting package from `node_modules`.
- Kept `npm pack --json` machine-readable by making the preparation build silent, preventing lifecycle output from corrupting release metadata parsing.

## 0.6.3 — 2026-09-27

- Fixed global/standalone CLI installs so Node.js never executes Pifrost TypeScript from inside `node_modules`; CLI-facing TypeScript is compiled to JavaScript in `dist/` during package preparation while the native OMP extension remains TypeScript.
- Extracted the catalogue cache schema version into a dependency-free shared source module, preserving one authoritative schema constant across the OMP runtime and compiled terminal diagnostics.
- Decoupled stored runtime configuration from extension-only TypeScript types so the terminal build stays minimal and does not pull the full OMP extension graph into the CLI runtime.
- Added a dedicated runtime TypeScript build configuration and automatic `prepare` build for Git/GitHub npm installs.
- Strengthened release validation to create a real tarball, install it into a temporary `node_modules` tree with lifecycle scripts disabled, and execute the installed `pifrost --version` and `pifrost --help`. This directly guards against the `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` regression in 0.6.2.
- Scanned and removed the remaining transitive `.mjs -> .ts` CLI edge in route discovery; the installed-package regression gate now passes alongside the complete unit and upstream compatibility suite.

## 0.6.2 — 2026-09-26

- Consolidated the terminal control plane onto a single `cli.mjs` package entry point, command parser and command registry; removed the overlapping `cli-entry.mjs` and `repo-cli.mjs` implementations.
- Preserved the robust dual-endpoint/paginated Bifrost route discovery path while moving route list/diff/sync/diagnose behind the canonical command registry.
- Restored the full repository command surface through the actual `pifrost` binary, including Virtual MCP, MCP-instruction and Bifrost Skills operations that could previously be shadowed by the reduced repo dispatcher.
- Centralized runtime and management preconditions so repository operations use the same Bifrost 2.x Virtual-Key-native inference rules as global operations; a separate inference Bearer/API key is no longer incorrectly required for repo management.
- Removed the duplicated model-catalog schema constant: terminal diagnostics now consume `CATALOG_CACHE_SCHEMA_VERSION` directly from `cache.ts`, fixing the schema-4/schema-5 mismatch.
- Added a renderer-neutral diagnostic result contract and migrated model-catalog diagnostics to emit structured checks alongside the existing human-readable output.
- Added package-binary command-surface regression coverage and release validation against the declared `bin.pifrost` entry point so future dispatcher drift fails CI.

## 0.6.1 — 2026-09-26

- Reworked the repository README around the human onboarding and operating journey, with a clear install → `pifrost init` → `pifrost doctor` happy path.
- Moved deep architecture, compatibility, routing, model-metadata and MCP implementation detail into `docs/REFERENCE.md` while retaining links from the main README.
- Added the technical reference to the release package so README links remain useful in packaged installations.
- Added CI-gated GitHub release automation: a new version on `main` is tagged and released only after the main CI workflow succeeds.

## 0.6.0 — 2026-09-26

- Reworked model-reference selection into a single-pass best-match resolver, removing whole-candidate sorting and quadratic tie comparison while preserving Pifrost's existing vendor/family ambiguity safety.
- Indexed exact live-model lookups during dynamic-route catalog construction instead of repeatedly scanning the physical model inventory for each route member.
- Parallelized independent OMP `cfg://` profile reads while preserving sequential approval semantics for writes.
- Bounded process-level agent-attribution cardinality; excess unique agent identities now collapse into a bounded `<other>` aggregate instead of growing process-lifetime memory without limit.
- Added stored-config diagnostics that preserve fail-closed OMP startup behavior while making malformed local JSON visible to `/pifrost doctor` and terminal diagnostics.
- Extracted a bounded HTTP client with response-size ceilings, `AbortSignal.timeout()/AbortSignal.any()` cancellation, caller-abort distinction, and consistent HTTP error handling.
- Hardened atomic config/secret writes with UUID temporary names, exclusive/no-follow creation, fsync-before-rename and cleanup on failure.
- Consolidated Bifrost target/fallback/pin/alias/feature parsing into one typed `routing-core.ts`, eliminating duplicated routing semantics between route discovery and the CLI.
- Refactored terminal diagnostics around one concurrent read-only Bifrost snapshot so global status, compatibility checks and repo status can reuse version/inference/quota/routing/MCP/Skills probes instead of issuing duplicate network calls.
- Extracted diagnostic probes and HTTP transport from the monolithic CLI control-plane module and moved routing domain semantics into TypeScript, reducing coupling while retaining compatibility exports.
- Replaced long imperative CLI dispatch chains with declarative longest-match command registries in both the public entry point and delegated command layer.
- Reworked Bifrost Skill attachment installation to stream files directly into the atomic staging tree instead of retaining the full bundle in memory. Per-file and aggregate size limits are enforced during streaming.
- Hardened bridged Skill filesystem handling against symlinked `.agents`, `skills`, managed-target and marker paths, and switched staging/backup names to OS-generated/random identifiers.
- Added regression coverage for bounded HTTP bodies, caller cancellation, single-snapshot diagnostics, typed routing-core semantics, streamed Skill installation, symlink refusal, config corruption visibility, bounded agent aggregates and linear resolver behavior.
- The 0.6.0 changes are control-plane/runtime hardening only: Bifrost remains authoritative for routing, provider selection, credentials, fallback execution and governance; no client-side price/provider router was introduced.

## 0.5.0 — 2026-09-26

- Raised the OhMyPi compatibility baseline from 18.1.10 to **18.3.2** across runtime dependencies, development tooling, the package contract canary, CI plugin-loader validation, and documented requirements.
- Kept the OMP baseline upgrade behavior-neutral: no Bifrost routing, fallback, MCP, quota, or inference-header semantics changed as part of that dependency-only step.
- Added request-scoped Bifrost session affinity: Pifrost now sends OMP's authoritative `sessionId` as `x-bf-session-id` on every inference request, enabling Bifrost 2.2.2+ provider/key affinity and session-aware routing without mutating shared provider headers.
- Preserved the separate OpenCode Go session contract via `x-bf-eh-x-opencode-session`; caller-supplied conflicting session headers are replaced case-insensitively so one request cannot accidentally carry two identities.
- Added regression coverage for stable same-session identity, cross-session isolation, caller-header immutability, and the backward-compatible OpenCode session helper; updated doctor/README messaging to remove the obsolete OMP 18.1 limitation.
- Added a released Bifrost 2.2.2 session-affinity contract canary to CI.
- Added Bifrost 2.2.3 pinned-fallback compatibility: object-form fallbacks now participate in alias capability envelopes instead of being silently omitted, with `key_id` / `provider_key_name` provenance retained in the alias manifest and diagnostics.
- Pinned primary targets or fallbacks are explicitly excluded from Pifrost's local context-aware route compilation, so provider-key pins remain Bifrost-owned and cannot be lost by flattening the route to plain string fallbacks.
- Route listing/status/diff now surface pinned-routing state, including pin-only changes, and CI pins the released Bifrost 2.2.3 fallback wire/config contracts.
- Added named Bifrost Virtual MCP support for repository governance. Repo state stores portable Virtual MCP names, resolves them to Bifrost IDs only for the supported attach/detach API, and keeps direct `mcp_configs` as an independent optional grant surface.
- Added `pifrost repo vmcp list/add/remove` plus `repo init --virtual-mcps`; existing direct MCP grants are preserved when only Virtual MCP assignments are changed.
- Added live effective MCP-policy diagnostics that union direct grants, enabled Virtual MCP tool specs and `allow_by_default` clients using Bifrost's wildcard/configured-client semantics, while flagging disabled or unresolved clients.
- Added released Bifrost 2.2.0 Virtual MCP API/wire contract canaries and HTTP helper regression coverage.
- Added repo-scoped OMP 18.3 MCP instruction control. `repo init --no-mcp-instructions` and `repo mcp instructions on|off|default` can suppress Bifrost's server-provided instructions without disabling its tools.
- Pifrost preserves the existing Bifrost instruction policy across repo-config regeneration, modifies only its generated `mcpServers.bifrost` entry, and leaves unrelated MCP servers untouched.
- `repo status` now reports the effective instruction policy, and CI pins the released OMP 18.3.2 schema/runtime contract for `instructions: false`.
- Added Bifrost 2.2.3 structured quota provenance. Pifrost now preserves quota `SourceRef` fields (`source_type`, `source_id`, `source_name`) in OMP report metadata and per-limit notes while explicitly distinguishing direct VK/provider/model governance from externally inherited governance.
- External budgets/rate limits that reuse the same Bifrost row ID are source-qualified in their OMP limit IDs so they are not collapsed during deduplication; legacy pre-`SourceRef` `source` labels remain supported.
- `global status` and `doctor` now surface observed governance origins, and CI pins the released Bifrost 2.2.3 `SourceRef` and sourced-quota contracts.
- Added an upstream compatibility matrix to `pifrost doctor`, including installed OMP/Bifrost version detection, minimum-version gates, and non-mutating live probes for Virtual MCPs, the inference/session path, routing/pinned fallbacks, and quota SourceRef responses.
- Compatibility results distinguish `supported`, `unavailable`, `inaccessible`, and `drifted`; each degraded capability explains the affected Pifrost behavior instead of reducing all failures to a generic connectivity error.
- OMP doctor coverage now reports the tested 18.3.2 baseline plus 18.3.1+ MCP `instructions:false` and `cfg://` capability gates, while Bifrost feature gates document 2.2.0 Virtual MCPs, 2.2.2 session affinity, and 2.2.3 pinned fallbacks/quota SourceRef.
- Added native OMP `cfg://` integration for the Pifrost-owned setting set (`modelProviderOrder`, `enabledModels`, `retry.modelFallback`, task effort/LSP, and `modelRoles`). Reads use OMP's active `Settings` instance and report effective values plus provenance.
- Added `/pifrost config status|apply|set|save`. All mutations run through OMP's exported `CfgProtocolHandler`, preserving its user-approval host, session-only vs `/save` semantics, validation, environment/project shadowing behavior, and persistence path.
- The cfg bridge is restricted to the interactive top-level OMP session and verifies cwd scope before reading or writing, preventing a rebound subagent or headless session from mutating the wrong settings instance.
- `/pifrost doctor` now includes Pifrost-relevant OMP setting provenance, while the standalone `pifrost global configure-omp` command remains the bootstrap/recovery path.
- CI now pins the released OMP 18.3.2 `CfgProtocolHandler` approval/session/persistence contract in addition to the MCP contract.
- Added OMP 18.3.2 `ctx.agent` attribution as observability-only metadata. Pifrost binds the existing inference session id to agent kind/id/name/depth/parent identity and records logical route request counts without influencing model selection or Bifrost fallback.
- `/pifrost doctor` now shows the current agent lineage plus process-local per-agent/per-route request counts. Requests that arrive before `session_start` are backfilled once the agent identity is known.
- Active agent-session bindings are capped and released on `session_shutdown`; aggregate counters are memory-only and live only for the OMP process lifetime. Concurrent subagent isolation and shutdown cleanup have regression coverage.
- CI now pins the released OMP 18.3.2 `ExtensionAgentIdentity` / `ctx.agent` contract.
- Added display-only Bifrost time-of-day pricing awareness. Pricing normalization now preserves `off_peak_cost_multiplier` and `peak_hours`, while route diagnostics retain each reachable member's peak token rates and pricing source.
- `/pifrost doctor` evaluates the current peak/off-peak band at render time per route member, including IANA timezone conversion, half-open windows, midnight wrapping and Bifrost-compatible fail-closed handling for malformed schedules.
- Pifrost deliberately leaves OMP model costs at peak/base rates and never reorders routes or selects providers from price; Bifrost remains the billing and routing authority. Catalogue pricing is identified separately from any Bifrost-scoped custom override not exposed by the public datasheet.
- Catalog cache schema bumped to v5 so old diagnostics without time-of-day pricing metadata are refreshed after upgrade.
- CI now pins Bifrost 2.2.3's `off_peak_cost_multiplier`, `peak_hours`, request-start-time billing and window-evaluation contracts.
- Added an opt-in Bifrost Skills → OMP Skills bridge using OMP's native project-level `.agents/skills/<name>` discovery path. No second skill runtime or MCP coupling is introduced.
- Added `pifrost repo skills list/add/remove/sync`. Pifrost stores portable Bifrost skill names plus observed id/version provenance, fetches attached files from Bifrost's released serving API, and atomically installs updates with an explicit ownership marker.
- Skill installation revalidates every path and fails closed on authored/project/user skill collisions. Pifrost will only update or remove directories carrying its own Bifrost-skill marker.
- Bifrost skills with non-empty `allowed_tools` are reported as incompatible because OMP 18.3 does not enforce that Bifrost tool allow-list; Pifrost refuses to weaken the policy silently.
- `repo status` / `doctor` now expose installed Bifrost skill provenance and upstream-version drift, while repo reset removes only Pifrost-owned bridged skill directories.
- CI now pins the released Bifrost 2.2.3 Skills CRUD/serving contracts and OMP 18.3.2 project Agent Skills discovery/identity contracts.
- The upstream compatibility doctor now gates and live-probes Bifrost Skills at >=2.2.0, distinguishing missing credentials, unavailable old versions and Skills API contract drift before repo installation is attempted.
- Release-hardening for 0.5.0 adds a read-only live Bifrost 2.2.3+ smoke script covering health/version, inference inventory, quota, routing, MCP clients, Virtual MCPs and Skills without calling mutation endpoints.
- Added release-package validation that checks the package/CLI/changelog/README version contract and verifies the npm dry-run tarball contains the new 0.5 modules.
- Reconciled the documented repo-reset surface with the CLI: `--delete-remote`, `--recover-by-name` and `--yes` now invoke the already-tested exact-name/confirmed remote-VK deletion helpers before local cleanup.
- Refreshed migration, CLI, Skills, reset and release-version documentation for the 0.5.0 boundary.

## 0.4.0

- Added request-time context-aware route compilation for simple Bifrost logical aliases. A 1M -> 256K -> 1M route can now advertise 1M to OMP while automatically excluding the 256K member only when the actual request no longer fits.
- Added a conservative final-wire request estimator with output-token reserve, fixed headroom, image allowance and capability guards. No eligible member means fail-closed rather than an unsafe oversized request.
- Dynamic requests preserve route order and delegate the eligible chain to Bifrost via its native top-level `fallbacks` request field. Provider credentials, retries, governance and failover remain Bifrost-owned.
- `pifrost routes sync` opts in only single global terminal unweighted rules without scope/budget/quota/complexity/header/parameter-dependent semantics. Complex routes retain the previous weakest-member static envelope.
- Dynamic profile metadata is persisted in the model cache and exposed by `pifrost doctor` as the original static context, advertised context and request bands.
- Cache schema bumped to v4.

## 0.3.4

- Added an exact, vendor-backed capability override for `CommandCode GOAT/meituan/LongCat-2.0:free`, restoring the `omp-advisor` alias when Bifrost exposes only generic sparse limits for that entitlement.
- The override uses the upstream LongCat-2.0 contract's 1,000,000-token context window and 131,072-token output ceiling, text input, native tool calling and reasoning support.
- Kept reasoning-effort and forced/named tool-choice semantics conservative because the upstream contract documents thinking as enabled/disabled rather than a portable effort ladder, and does not guarantee every reseller-specific forced-tool sub-form.
- The override is deliberately scoped to the CommandCode GOAT free SKU. OpenRouter and arbitrary `:free` variants remain isolated and must provide their own live/datasheet evidence.

## 0.3.3

- Hardened OpenRouter-through-Bifrost support without moving provider routing into Pifrost.
- Added OpenRouter as a provider-qualified OMP catalog fallback source so sparse Bifrost metadata prefers OpenRouter's own model envelope instead of a cross-provider family intersection.
- Added collision-safe identity handling for OpenRouter routing variants (`:nitro`, `:floor`, `:online`, `:exacto`, `:extended`) while deliberately keeping billing/entitlement variants such as `:free` distinct.
- Projected Bifrost model-parameter compatibility for `tool_choice`, forced/named tool choice and reasoning-with-tools into the logical OMP alias envelope. Heterogeneous fallback chains now downgrade to the weakest portable tool/reasoning combination instead of assuming the primary's behavior.
- Expanded diagnostics and regression coverage for OpenRouter provider qualification, variant handling, free-tier isolation and mixed reasoning/tool fallback chains.

## 0.3.2

- Fixed an OMP runtime crash on forced-tool turns (`disableReasoningOnForcedToolChoice` read from an undefined compat record).
- Pifrost now rebuilds its custom logical route as a resolved `openai-completions` model before entering OMP's built-in Chat Completions transport, restoring the complete OpenAI compatibility policy while preserving the new per-conversation OpenCode Go session-header forwarding.
- No Bifrost routing, provider selection, fallback, or model-envelope behavior changed.

## 0.3.1

- Added a Pifrost-specific OpenAI Chat Completions transport so every routed inference request can use OMP's per-request `sessionId` without mutating shared provider headers.
- Fixed OpenCode Go's enforced session contract by forwarding the stable OMP conversation id through Bifrost as `x-bf-eh-x-opencode-session`, which Bifrost strips to upstream `x-opencode-session`.
- Forwarded Pifrost's explicit `pifrost/0.3.1 OMP` client identity through Bifrost as `x-bf-eh-user-agent` while retaining the normal Bifrost-facing `User-Agent`.
- Preserved OpenAI Chat Completions reasoning/tool-choice request shaping in the custom transport, including mandatory-reasoning clamping and caller header precedence, and added regression coverage for authoritative session-header replacement.
- Documented the Bifrost header-allowlist requirement for deployments that restrict dynamic `x-bf-eh-*` forwarding.

## 0.3.0

- Raised the supported integration baseline to Bifrost **2.0.0+** and OhMyPi **18.1.10**, while retaining compatibility fallbacks for older Bifrost routing surfaces where they are harmless.
- Migrated the package manifest from OMP's legacy `pi.extensions` compatibility key to the current `omp.extensions` contract and changed CI to load the package through the released OMP 18.1.10 CLI.
- Added Bifrost 2.x Virtual-Key-native inference authentication: an `sk-bf-*` Virtual Key can operate Pifrost without a separate inference API key; existing Bearer + `x-bf-vk` configurations remain supported.
- Added an OMP native usage provider backed by Bifrost's self-service `/api/governance/virtual-keys/quota` endpoint, exposing Virtual Key budgets, request/token rate limits, and provider/model scoped governance as read-only OMP usage limits.
- Added Bifrost version and health discovery plus doctor/status reporting for routing scopes, weighted/chained rules, complexity-analyzer availability, MCP Code Mode, Agent Mode auto-execution, per-user auth/token exchange, endpoint slugs and session stickiness.
- Bifrost session-aware complexity/routing is detected but Pifrost does not fabricate `x-bf-session-id` under OMP 18.1: extension provider headers are shared/static while subagents may share a model registry, so mutating them per session would be racy. A caller-supplied header or future OMP per-request header hook can enable that Bifrost feature safely.
- Bifrost `service_tier` is not projected onto heterogeneous `omp-*` aliases: OMP 18.1 resolves tiers by model family before Bifrost chooses the final routed target, so assigning one family to a multi-family alias would misrepresent valid fallbacks. Direct/homogeneous routes retain their native tier behavior.
- Updated route synchronization for Bifrost 2.x: canonical `/api/routing/rules` is authoritative when populated; scoped rules for one `omp-*` alias are unioned conservatively instead of overwriting each other, and `chain_rule` routes include a conservative downstream capability closure.
- Added safe handling for Bifrost 2.x `reasoning.effort: "none"`: Pifrost maps it onto OMP's `minimal` control only when the model does not expose a distinct `minimal` wire value, and fallback intersections retain only effort mappings every member agrees on.
- Expanded MCP discovery to understand current 2.x client fields including `is_code_mode_client`, `tools_to_auto_execute`, `auth_type`, `endpoint_slug`, `needs_session_stickiness`, ping capability and per-user header metadata. Pifrost surfaces these modes but does not overwrite MCP-client-global configuration when assigning a client to a repository key.
- New repository MCP Virtual Keys explicitly set Bifrost 2.x deny-by-default inference governance (`allow_all_providers: false`, empty provider configs), preserving the existing MCP-only security model. Existing keys are not destructively rewritten.
- Reduced network-backed dynamic discovery timeouts and parallelized live-model/datasheet retrieval so Pifrost stays within OMP 18.1's 15-second dynamic-provider discovery budget.
- Bumped the catalog cache schema to invalidate pre-2.x capability assumptions after upgrade.
- Added a CI canary against the Bifrost 2.0/current-2.x routing, governance and MCP contracts, alongside regression coverage for VK-only auth, quota parsing, scoped/chained routing, MCP 2.x modes, current OMP packaging, and MCP-only VK creation.

## 0.2.7

- Reworked model identity resolution so provider, aggregator and vendor prefixes, mixed capitalization, and explicitly equivalent entitlement aliases can drift without requiring a Pifrost release for every spelling change.
- Added collision protection: vendor-qualified models with the same tail are no longer treated as interchangeable, and ambiguous live matches are diagnosed instead of selecting the first candidate.
- Capability resolution now follows an explicit trust order per field: rich live Bifrost metadata, direct Bifrost datasheet metadata, equivalent canonical-family metadata, narrow vendor-backed overrides, then conservative catalog fallback.
- Generic sparse `/v1/models` defaults such as 128K context / 8K output remain usable for direct physical-model compatibility but are tagged as fallback and are never accepted as authoritative route limits.
- Added capability provenance to route diagnostics (`live`, `bifrost-datasheet`, `canonical-family`, `vendor-override`, `fallback`) and preserved those diagnostics in the last-known-good catalog cache.
- Added a metadata-only route-inventory bridge for configured Bifrost route members temporarily absent from `/v1/models`. The bridge carries no trusted capabilities; a route still requires safe context/output evidence before it can synthesize.
- Added current metadata support for CommandCode `stealth/ox-alpha`, OpenCode Go `ox-alpha-free` / `x-preview-f-free`, and DeepSeek `deepseek-v4-flash-vision-exp`, including image support for the DeepSeek vision model.
- Bumped the catalog-cache schema so stale pre-provenance caches are rejected after upgrade; `PIFROST_FORCE_REFRESH` also bypasses an otherwise valid cache.
- Expanded regression coverage for provider/vendor prefixes, mixed case, known `-free` aliases without blanket suffix stripping, same-model multi-provider routes, unsafe family collisions, live-metadata precedence, canonical-family discovery, inventory lag, and conservative context/output/vision/reasoning/tool intersections.
- Updated the integration validator to the current ten implemented `omp-*` routes; `omp-task` must resolve and `omp-vision` must advertise image input.

## 0.2.6

- Added a layered capability resolver for route members: Bifrost public datasheets remain primary, while OMP's bundled model catalog supplies safe context/output, modality, reasoning, thinking, tool and compatibility metadata when Bifrost's public feeds lag a current provider model.
- Added narrow verified fallbacks for Ox Alpha and DeepSeek V4 Flash Vision Exp so the currently implemented `omp-task` and `omp-vision` routes synthesize even when those preview models have not yet landed in both upstream catalogs.
- Normalized known Ox Alpha identities across `stealth/ox-alpha`, `ox-alpha-free`, and `x-preview-f-free`, including live `/v1/models` alias drift.
- Removed blanket `-free` capability inheritance. Pifrost no longer assumes arbitrary free variants have the same context/output limits as paid/base models; only explicitly known-equivalent entitlement aliases are merged.
- Extended metadata fallback to reseller/custom-provider routes such as CommandCode by conservatively intersecting matching OMP catalog surfaces when no direct provider catalog exists.
- Preserved the safety rule for genuinely unknown models: if neither Bifrost, OMP's installed catalog nor a narrow verified hint can establish safe context and output limits, the route member remains withheld rather than receiving generic guessed values.
- Updated the current-routing integration test to the ten Bifrost routes presently in use, including Ox Alpha and DeepSeek V4 Flash Vision Exp, and added regression coverage for alias drift, future OMP-catalog models, vision preservation, tool support and unknown-model withholding.
- Added `@oh-my-pi/pi-catalog` as a runtime dependency for bundled model metadata; `@oh-my-pi/pi-ai` remains the runtime model type dependency.

## 0.2.5

- Added `pifrost repo reset --delete-remote` for a complete repository reset that removes the repo's Bifrost Virtual Key before deleting local Pifrost state and the generated `bifrost` MCP entry.
- Remote deletion is destructive and therefore requires typing `DELETE` interactively by default; `--yes` provides an explicit non-interactive path for automation.
- A failed remote management request leaves local repo configuration untouched. HTTP 404 is treated idempotently as an already-complete remote deletion so local cleanup can continue.
- Added `--recover-by-name` as an explicit recovery mode for repositories whose local association was removed before the remote VK. Recovery matches only the exact canonical `omp-<repo>-mcp` name and rejects ambiguous duplicates rather than guessing.
- Plain `pifrost repo reset` remains backward-compatible and local-only; it does not require management connectivity and continues to leave the remote VK intact.
- Added regression coverage for confirmation/cancellation, `--yes`, exact-name recovery, ambiguous recovery refusal, 404 handling, delete failures, and Virtual Key DELETE request construction.

## 0.2.4

- Fixed `pifrost models doctor` and the model section of `pifrost doctor` so thinking levels match OMP's effective model metadata rather than only the raw pre-normalization cache.
- Sparse OpenAI-compatible reasoning aliases now report OMP-derived `minimal,low,medium,high` when OMP would derive that control surface; explicit Pifrost ladders such as `high,max` remain unchanged.
- Diagnostic output labels derived surfaces with `source=omp-derived` and explicit surfaces with `source=explicit`.
- Added regression coverage for explicit, OMP-derived, and non-reasoning diagnostic display paths.

## 0.2.3

- Fixed Bifrost MCP client discovery against the current nested management response shape, where client identity/configuration is returned under `client.config` while tools/state remain top-level.
- `pifrost repo mcp list` now displays the actual MCP client names and IDs instead of blank entries.
- `pifrost repo init` now sends the real Bifrost MCP client display name in `mcp_client_name`, preventing the `HTTP 500: failed to get MCP client: not found` failure caused by empty client names.
- Repo MCP add/init paths now validate that a selected MCP client has a usable name before mutating a Virtual Key.
- Preserved compatibility with older flat MCP client response shapes.
- Added regression tests for current nested Bifrost clients, legacy flat clients, tool-name normalization, client listing, and Virtual Key MCP assignment payloads.

## 0.2.2

- Fixed `pifrost routes list|diff|sync` returning zero aliases on Bifrost installations where one routing management path returns an empty `200` while the compatibility path contains the persisted rules.
- Route discovery now probes both `/api/routing/rules` and `/api/governance/routing-rules`, merges their results, and deduplicates rules instead of stopping on the first successful HTTP response.
- Added compatibility parsing for `rules`, `routing_rules`, `items`, direct `data` arrays, and nested `data`/`result` response shapes.
- Expanded alias detection to support Bifrost query-builder conditions as well as direct rule names and CEL expressions.
- Added `pifrost routes diagnose`, which reports each endpoint's status, response shape, raw rule count, derived alias count, and unmatched rule names without exposing management credentials.
- `pifrost routes sync` now reports the raw routing-rule count and endpoint diagnostics when no `omp-*` aliases can be derived.
- `pifrost init` and `pifrost doctor` now use the resilient routing discovery path.
- Added regression tests for empty-canonical/non-empty-legacy responses, endpoint merging/deduplication, alternate response shapes, and query-builder alias extraction.

## 0.2.1

- Corrected Bifrost management authentication for OSS deployments: Pifrost now supports the dashboard/admin username and password over HTTP Basic auth, matching Bifrost OSS's management API behavior.
- Retained Enterprise scoped management API keys as an optional Bearer-auth mode.
- Added `--management-auth`, `--management-username`, and `--management-password` to `pifrost global setup`; `--management-key` remains available for Enterprise.
- Added `BIFROST_MANAGEMENT_AUTH_MODE`, `BIFROST_ADMIN_USERNAME`, and `BIFROST_ADMIN_PASSWORD` environment overrides while preserving `BIFROST_MANAGEMENT_API_KEY`.
- Added backward compatibility for 0.2.0 stores containing `managementApiKey` only; they continue to resolve as Bearer management authentication.
- Management credentials remain CLI-only: neither OSS admin credentials nor Enterprise management API keys are exposed to the OMP provider runtime.
- Updated global status/doctor output to report the active management authentication mode and validate it against Bifrost.
- Added tests for Basic and Bearer Authorization headers, CLI persistence, environment precedence, 0.2.0 migration compatibility, and management-secret non-exposure.
- Corrected the README user guide to explain that scoped management API keys are Enterprise-only and that Bifrost OSS uses Basic auth with its configured admin credentials.

## 0.2.0

- Added a standalone `pifrost` terminal CLI for first-time setup, global status/configuration, Bifrost route synchronization, model-cache management, diagnostics, and repository-specific MCP administration.
- Added secure persistent global configuration under `~/.config/pifrost/`; the OMP extension now uses CLI flags first, environment variables second, and the Pifrost store as the default fallback.
- Kept the Bifrost management API credential outside the OMP extension runtime; only inference URL/API-key/Virtual-Key values are loaded by the provider.
- Added `pifrost global setup`, which tests inference/management connectivity and configures OMP roles through OMP's schema-aware `omp config set` command with a backup of the previous global config.
- Added `pifrost routes list`, `routes diff`, and `routes sync`; route sync supports both the current `/api/routing/rules` endpoint and the older `/api/governance/routing-rules` endpoint.
- Added `pifrost repo init` and per-repo MCP commands. Repo initialization creates/updates a dedicated MCP Virtual Key with explicit Bifrost `mcp_configs`, writes `.omp/mcp.json`, stores the raw VK outside the repository, and runs an MCP initialize test.
- Repo `.omp/mcp.json` files now use OMP's `!command` header resolution (`!pifrost secret repo-mcp --id ...`) so raw MCP Virtual Keys do not need to live in the repository or a repo `.env` file.
- Added repo MCP client list/add/remove commands, repo key rotation, repo status/reset, a combined terminal doctor, and a terminal model-catalog doctor.
- Added CLI syntax/configuration/secret-resolution tests and persistent-config fallback tests.
- Expanded the README into a full installation, global setup, route management, model cache, repo MCP, command reference, security model, update, and troubleshooting guide.

## 0.1.3

- Added a non-secret last-known-good catalog cache at `~/.omp/agent/pifrost.catalog.json` so OMP can register Pifrost aliases synchronously at interactive startup instead of beginning in `no-model` while network discovery completes.
- Cache identity is scoped to the normalized Bifrost URL, a one-way inference Virtual Key fingerprint, and the alias-manifest fingerprint; changing any of them invalidates the cache.
- Pifrost never serializes the Bifrost API key or Virtual Key into the catalog cache.
- Fresh caches avoid Bifrost/datasheet network work on the startup critical path. Refresh-due caches are served immediately and refreshed in the background for the next session.
- Added `/pifrost refresh` for an explicit network-backed catalog refresh.
- Added `PIFROST_FORCE_REFRESH=1` for command-scoped forced refreshes and `PIFROST_REFRESH_INTERVAL_MS` / `PIFROST_CACHE_FILE` tuning hooks.
- Added cache round-trip, credential non-persistence, alias-manifest invalidation, Virtual Key scoping and stale-cache tests.

## 0.1.2

- Kept Bifrost `/v1/models` as the inference-VK-filtered live inventory while enriching route metadata from Bifrost's own public datasheets.
- Added context/output/pricing discovery from `https://getbifrost.ai/datasheet` and reasoning/tool discovery from `https://getbifrost.ai/datasheet/model-parameters`.
- Corrected context semantics: `max_input_tokens` is used as the context/input ceiling when `context_length` is absent; it is not added to `max_output_tokens`.
- Provider-specific price-only rows now inherit missing limits from capability-complete rows for the same underlying model while retaining their own prices.
- Added narrowly scoped vendor-backed capability hints for fields Bifrost's public feeds currently omit, including GPT-5.6 image/reasoning capabilities and Xiaomi MiMo-V2.5 image/reasoning capabilities.
- Route members without authoritative context/output metadata are withheld instead of falling back to generic 128K/8K values.
- Kept provider-qualified route members distinct during alias synthesis, even when multiple providers serve the same underlying model ID.
- Added support for subscription `-free` entitlement aliases such as Laguna S 2.1 Free inheriting the underlying model's capability metadata.
- Added an integration check for the ten current OMP routing chains, plus public-datasheet coverage checks, unit tests, typechecking and the real OMP 18.0.4 plugin loader.

## 0.1.1

- Replaced the legacy `@earendil-works/pi-ai/compat` provider layer with OMP 18's native `pi.registerProvider(name, config)` API.
- Dynamic Bifrost discovery now uses OMP 18 `fetchDynamicModels` and canonical `thinking` metadata.
- Preserved separate Bifrost Bearer/API auth and `x-bf-vk` inference governance.
- Changed bare Bifrost URL normalization to the live `/v1` mount.
- Added an OMP 18.0.4 plugin-loader validation step to CI so runtime extension import compatibility is tested directly.

## 0.1.0

- Initial Pifrost provider derived from `lxdlam/pi-bifrost-provider` under the MIT license.
- Dynamic Bifrost physical-model discovery over OpenAI Chat Completions.
- Conservative capability-envelope synthesis for Bifrost routing aliases.
- `/pifrost doctor` alias diagnostics.
- OMP-focused alias manifest and configuration documentation.
