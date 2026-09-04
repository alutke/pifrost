# Changelog

## 0.3.0

- Raised the supported integration baseline to Bifrost **2.0.0+** and OhMyPi **18.1.10**, while retaining compatibility fallbacks for older Bifrost routing surfaces where they are harmless.
- Migrated the package manifest from OMP's legacy `pi.extensions` compatibility key to the current `omp.extensions` contract and changed CI to load the package through the released OMP 18.1.10 CLI.
- Added Bifrost 2.x Virtual-Key-native inference authentication: an `sk-bf-*` Virtual Key can operate Pifrost without a separate inference API key; existing Bearer + `x-bf-vk` configurations remain supported.
- Added an OMP native usage provider backed by Bifrost's self-service `/api/governance/virtual-keys/quota` endpoint, exposing Virtual Key budgets, request/token rate limits, and provider/model scoped governance as read-only OMP usage limits.
- Added Bifrost version and health discovery plus doctor/status reporting for routing scopes, weighted/chained rules, complexity-analyzer availability, MCP Code Mode, Agent Mode auto-execution, per-user auth/token exchange, endpoint slugs and session stickiness.
- Bifrost session-aware complexity/routing is detected but Pifrost does not fabricate `x-bf-session-id` under OMP 18.1: extension provider headers are shared/static while subagents may share a model registry, so mutating them per session would be racy. A caller-supplied header or future OMP per-request header hook can enable that Bifrost feature safely.
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
