# Changelog

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
- Preserved separate Bifrost Bearer/API authentication and `x-bf-vk` inference governance.
- Changed bare Bifrost URL normalization to the live `/v1` mount.
- Added an OMP 18.0.4 plugin-loader validation step to CI so runtime extension import compatibility is tested directly.

## 0.1.0

- Initial Pifrost provider derived from `lxdlam/pi-bifrost-provider`.
- Dynamic Bifrost physical-model discovery over OpenAI Chat Completions.
- Conservative capability-envelope synthesis for Bifrost routing aliases.
- `/pifrost doctor` alias diagnostics.
- OMP-focused alias manifest and configuration documentation.
