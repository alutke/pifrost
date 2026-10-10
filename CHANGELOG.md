## 0.12.2 — 2026-10-10

- Bound the exact CommandCode GOAT `inclusionai/ling-3.1-flash:free` entitlement to its observed 32,768-token completion ceiling, even when the live Bifrost model list or public datasheet advertises 65,536. No blanket `:free` stripping or cross-provider limit inheritance.
- Corrected the non-dynamic Chat Completions transport to clamp caller-supplied output limits to the selected model. Dynamic aliases retain the existing per-attempt and same-protocol fallback ceilings.
- Preserved explicit OMP reasoning disable/force-off requests rather than silently re-enabling mandatory-effort thinking; implicit requests continue to receive the minimum required effort. Disabled reasoning no longer sends a stale reasoning-effort parameter.
- Resolved CommandCode physical-route compatibility from the actual upstream model family while retaining the full Bifrost route identifier on the wire. Suppressed the opaque Responses reasoning-summary request for the exact DeepSeek V4.1 Flash reseller route that returns `reasoning unavailable`, while keeping necessary reasoning history replay. This aligns the OMP policy resolver on DeepSeek Chat/Responses routes and leaves Bifrost in charge of physical routing.
- Expanded request-policy regressions across Chat Completions and Responses, reasoning enabled/off, provider-qualified free entitlements, output clamp boundaries, and catalogue provenance. Bumped the model-cache schema to v17 to discard incompatible cached limits.
- DeepSeek V4.1 providers may still return synthetic `reasoning unavailable` records when genuine replayable reasoning is absent; this release does not strip required tool-call reasoning or pretend those provider-generated records are real reasoning.

## 0.12.1 — 2026-10-09

- Fixed Classic MCP research discovery for Bifrost's live `<client>-<tool>` gateway presentation (including `donsetch-web_search`), retaining qualified legacy formats, exact tool identity and ambiguity-safe matching across clients. Call probes use the returned wire name.
- Research diagnostics now distinguish missing gateway publication, unsupported or conflicting gateway names, missing client declarations, and unverified Code Mode metadata. No changes to Bifrost grants, executable tool policy, or OMP's native search selection.
- Changed `repo init` to offer matching, missing Bifrost Skills whenever a client or Virtual MCP is explicitly selected, including reselected existing grants; existing installations and dismissals remain respected. Unattended installs still require `--install-matching-skills`, never just `--yes`.
- Added regression coverage for live DonSeTch Classic naming, generic client naming, overlapping clients, gateway ambiguity, Code Mode isolation, and reselected direct/Virtual MCP Skill consent.

## 0.12.0 — 2026-10-09

- Added opt-in, provider-neutral MCP-to-Bifrost-Skill discovery when selecting direct MCP clients or underlying clients of a newly assigned Virtual MCP. Matching is exact and case-insensitive, with explicit aliases for different names; installs use the existing OMP Skills bridge.
- Interactive consent defaults to No; noninteractive automation requires explicit `--install-matching-skills` rather than inheriting `--yes`. Newly assigned clients are offered once; an unavailable Skill service or refused/incompatible Skill never rolls back MCP grants.
- New per-repository Skill suggestions, explicit bind/unbind, dismissal/undismissal commands and provenance-based diagnostics for orphaned MCP links, missing installs and renamed upstream Skill IDs.
- Added SHA-256 managed-Skill integrity manifests, guarded updates/removals for locally modified payloads, source-ID rebind protection, and refusal of reserved bridge-owned bundle paths. Existing schema-v1 markers remain readable.
- Preserved per-repository research, Skills and discovery preferences across `repo init`, extended architecture validation and included mock-Bifrost CLI integration and regression tests.

## 0.11.0 — 2026-10-09

- Provider-neutral Bifrost MCP research discovery and capability diagnostics: DonSeTch four-tool profile, retained Hound compatibility, explicitly mapped generic providers, repo-local provider preferences and bindings.
- CLI research status, bind, unbind, prefer and explicit read-only search probe, plus provider-neutral repo status/doctor. Effective Bifrost Virtual Key and execute allow-list gates readiness; no duplicate runtime tool routing or automatic fallback.
- Code Mode metadata-only inspection, DonSeTch application-level result errors including folded [meta] envelopes, trusted screenshot recovery with repo-specific generic mappings, and stateful-handle warnings.
- Comprehensive regression coverage, pinned DonSeTch release MCP contract check and scheduled upstream canary, reproducible packaged documentation, and preserved non-loopback HTTP doctor-only warning semantics.

## 0.10.1 — 2026-10-09

- Audited all 19 non-main branch tips against `main`, reviewed merged PR histories and the two superseded unmerged P1/P2 branches, including branch-exclusive provenance/MCP/setup tests. No valuable missing functionality needs porting: authoritative session-scoped provenance, MCP policy diagnostics, Bifrost setup checks and OMP canaries are already present in the current architecture.
- One-time safe branch-hygiene workflow deletes only the 19 explicitly reviewed obsolete branches after checking exact head SHAs and confirming that there are no open pull requests. Deletions use force-with-lease. The workflow does not automatically delete future development branches and does not touch tags.
- No changes to inference routing, model policy, MCP grants, Hound configuration, credentials or Bifrost runtime behaviour.

## 0.10.0 — 2026-10-09

- Completed the root/branch architecture, code-quality and security hardening review. Added an executable architecture-boundary validator that keeps OMP runtime modules out of CLI/control-plane dependencies, keeps pinned OMP catalog/native imports at the extension boundary, preserves Bifrost ownership of physical fallback, and preserves stateless Responses across heterogeneous routes.
- Corrected MCP execution-policy semantics for current and older Bifrost surfaces. Pifrost now distinguishes an absent `tools_to_execute` / `tools_to_auto_execute` field from an explicit empty deny-all list, and Hound readiness respects an explicit Bifrost execution denial instead of treating repository visibility alone as callable.
- Added stable Bifrost 2.2.6 Chat→Responses compatibility visibility. Doctor/global status report `convert_chat_to_responses` and newer reasoning-only conversion when exposed, without implementing request conversion in Pifrost.
- Expanded Bifrost setup/auth diagnostics in global status, including first-time setup state and whether inference auth is enforced.
- Added a doctor-only transport-security warning for credentialed non-loopback `http://` Bifrost endpoints. This is advisory only: Pifrost does not block the endpoint, require an override, change setup, or alter inference/management behavior.
- Hardened CI/release supply chain: least-privilege read permissions for CI, pinned GitHub Action commit SHAs, disabled persisted checkout credentials, and SHA-256 verification for downloaded OMP release binaries. Production dependency auditing runs in the scheduled canary so a changing advisory feed cannot make an otherwise reproducible release nondeterministic.
- Hardened the Bifrost Skills bridge by refusing HTTP redirects on file downloads. Bifrost 2.2.6 serves skill files directly, so cross-origin or same-origin redirects are unnecessary and are no longer followed.
- Added pinned Bifrost 2.2.5 MCP execution-enforcement and 2.2.6 Chat→Responses contracts while retaining moving Bifrost `dev`, OMP `main` and Hound `master` checks as scheduled canaries only.
- Closed obsolete PR #34 rather than allowing an older v0.9.1 branch to be merged over the v0.9.2 line. Existing historical branches were left unchanged because the connected GitHub surface does not expose branch deletion.
- Kept upstream ownership intact: Hound BYOK/proxy rotation/cache behavior stays in Hound; Bifrost routing, pricing, key selection, session affinity, Code Mode and protocol conversion stay in Bifrost; OMP agent/compaction/model-role behavior stays in OMP.

## 0.9.2 — 2026-10-08

- Advanced the current validated OMP host from 18.8.4 to **18.8.6**, including the compiled-binary compatibility gate and exact tokenizer/image-policy contracts. OMP 18.8.5/18.8.6 introduce account/compaction, warm-cache pruning and prompt-cache-lookback behavior but no Pifrost transport contract change requiring duplicated runtime policy.
- Confirmed compaction ownership after OMP 18.8.5/18.8.6: OMP continues to own normal automatic compaction, per-model thresholds and cache-aware pruning. Pifrost's optional compact-before-skip coordinator remains narrowly scoped to preserving smaller physical fallbacks and invokes OMP's own `compact()` implementation.
- Corrected the technical reference's remaining legacy wording that described Pifrost's pinned policy resolver as host-owned. The runtime boundary is now consistently documented as an 18.4.5 policy snapshot plus explicit compatibility patches, independently validated against the current OMP host.
- No physical route ordering, provider selection, fallback ownership, quota policy, MCP policy or billing behavior changed.

## 0.9.1 — 2026-10-08

- Corrected candidate-specific context prewalk for locally recounted assistant history. Pifrost now includes opaque reasoning signatures, redacted thinking and Anthropic server-tool payloads that OMP replays to providers, preventing cross-model fallback estimates from understating context usage when a prior provider-usage anchor cannot be reused.
- Propagated Bifrost's authoritative resolved-model response header back into the assistant message's `upstreamModel`. Subsequent candidate-specific prewalk therefore anchors provider usage to the model that actually served a same-protocol fallback, not merely the Pifrost attempt primary.
- Tightened unknown-image accounting: bounded candidate-specific Gemini, Anthropic and OpenAI detail rules are used when dimensions cannot be decoded, while unbounded OpenAI original-detail rules retain OMP's safe 12K wire fallback instead of manufacturing a multi-million-token sentinel estimate.
- Fixed first-time setup-token precedence. A stale ambient `BIFROST_SETUP_TOKEN` can no longer displace already configured OSS Basic or Enterprise Bearer management credentials; explicit setup mode remains available and setup tokens remain non-persistent.
- Separated reproducible release gates from moving upstream canaries. Release CI now validates only pinned Bifrost release contracts; Bifrost `dev` checks run only in the scheduled upstream-canary workflow, matching the existing OMP/Hound pattern.
- Made the OMP compatibility boundary explicit. Doctor now distinguishes TESTED CURRENT, SUPPORTED, NEWER THAN VALIDATED and UNSUPPORTED host versions and reports the pinned 18.4.5 policy snapshot separately from the 18.8.4 host-validation boundary. Exact image-policy and opaque replay-accounting parity are covered by OMP upstream canaries.
- Corrected the technical reference's stale release version and extended release validation so README, reference, package/lock versions and the pinned OMP dependency snapshot must agree.
- Preserved the architecture: Bifrost still owns physical ordering, same-protocol fallback, credentials, governance and billing; Pifrost still owns only request compatibility/context prewalk, cross-protocol pre-output advance and observability.

## 0.9.0 — 2026-10-08

- Reworked context-aware prewalk to size each physical route member independently instead of applying one logical-model prompt estimate to the whole fallback chain. Text now uses OMP's native tokenizer family when the candidate exposes one, image blocks use OMP-aligned model/dimension-aware accounting, and trustworthy usage anchors are reused only for the physical upstream model that produced them.
- Added an OMP compatibility envelope with release CI against the minimum loader and the current validated OMP 18.8.4 binary, plus a scheduled contract canary against OMP `main`. `pifrost doctor` now reports both the minimum and the current validated OMP boundary.
- Added a streaming-safe Bifrost cost bridge. When Bifrost returns its nested authoritative `usage.cost.total_cost` shape, Pifrost exposes that total to OMP as provider-reported cost while retaining the original Bifrost breakdown for diagnostics; JSON and SSE responses are both supported.
- Kept routing ownership unchanged: Pifrost still performs compatibility/context prewalk only, while Bifrost remains authoritative for provider/model ordering, same-protocol fallback, governance and billing.
- Added Bifrost 2.2.6 first-time setup awareness. Pifrost reads the public setup state, reports incomplete setup distinctly in doctor/compatibility output, and can use a setup token ephemerally via `--setup-token` or `BIFROST_SETUP_TOKEN`; setup tokens are never persisted.
- Added request-level routing provenance inside OMP. `/pifrost trace` shows the logical route, protocol attempt, requested primary, actual Bifrost provider/model, fallback index, upstream latency, authoritative request cost and `x-bifrost-request-id` when the connected Bifrost build emits it.
- Added effective MCP execution-policy diagnostics. Repository status now intersects Virtual Key grants with each client's `tools_to_execute` hard allow-list and `tools_to_auto_execute` approval-free subset, with explicit warnings for wildcard auto-execution.
- Extended Bifrost contract coverage for the 2.2.6 setup-lock and routed-response headers, plus advisory dev canaries for request IDs, reasoning-only Chat→Responses conversion and bounded Code Mode execution. Unreleased Bifrost features are not enabled or claimed as stable runtime capabilities.
- Raised the recommended/validated Bifrost level to 2.2.6 while retaining 2.2.4 as the minimum supported baseline.

## 0.8.10 — 2026-10-02

- Corrected the incomplete 0.8.9 reasoning-with-tools fix. The live `openai/gpt-6.1-sol` route could still resolve to `reasoningWithTools=false` because Pifrost inferred provider policy by combining multiple bundled OMP catalogue families; that ambiguity allowed the stale Bifrost model-parameters value to win.
- Pifrost now queries OMP's host-owned `resolveModelPolicy()` engine directly for the actual physical provider/model/protocol identity. Prewalk therefore uses the same compatibility engine as the eventual transport model instead of approximating transport behavior from bundled catalogue rows.
- Added route-provider normalization for OpenAI, OpenAI Codex, Azure, DeepSeek, OpenRouter, OpenCode Go/Zen, Xiaomi and CommandCode. Unmapped identities remain unknown and continue to fall back to Bifrost metadata rather than being guessed.
- Added live OMP-policy regressions proving `openai/gpt-6.1-sol` permits reasoning plus tools on both Chat Completions and Responses, while Azure `gpt-6-astra` retains its explicit reasoning-with-tools restriction.
- Advanced the model-catalog cache schema to v16 so the failed v15 compatibility decision cannot survive an upgrade.
- No physical route reordering, provider selection, quota policy, pricing policy, or Bifrost same-protocol fallback behavior changed.

## 0.8.9 — 2026-10-02

- Fixed Pifrost prewalk incorrectly excluding OpenAI/Codex route members such as `openai/gpt-6.1-sol` from normal OMP coding turns with both reasoning and tools. The failure happened before inference, so Bifrost and CLI Proxy showed no attempted OpenAI request and Pifrost silently advanced to the next eligible route member.
- Added semantic translation for OMP's provider-authored `compat.disableReasoningWithTools` axis into Pifrost's positive `supportsReasoningWithTools` capability. An explicit OMP provider policy now outranks a conflicting generic Bifrost model-parameters row for this transport-compatibility decision, while explicit live capability data remains highest priority.
- Preserved genuine provider restrictions: an OMP provider policy that disables reasoning with tools still excludes that member. Routes without an exact provider-policy match continue to use Bifrost datasheet metadata, so this is not a blanket permissive override.
- Added Azure/OpenAI provider-policy recognition and regression coverage for stale OpenAI negative metadata, explicit provider restrictions, and unmatched-provider fallback behavior.
- Advanced the model-catalog cache schema to v15 so installations cannot retain a stale v14 `reasoningWithTools=false` decision after upgrading.
- No Bifrost route order, provider preference, quota policy, pricing policy, or same-protocol fallback ownership changed.

## 0.8.8 — 2026-10-01

- Fixed clean OMP GitHub-plugin installation by declaring `@oh-my-pi/pi-utils@18.4.5` as an explicit Pifrost runtime dependency. OMP's compiled extension validator can install/load `pi-catalog` without materializing its transitive `pi-utils` dependency in the plugin's resolvable runtime graph, which caused `native.ts` validation to fail from `pi-catalog/src/compat/cascade.ts`.
- Reversed the 0.8.7 release guard that incorrectly prohibited a direct `pi-utils` dependency and now requires the full runtime dependency closure (`pi-ai`, `pi-catalog`, and `pi-utils`) in both `package.json` and the lockfile.
- Extended release-package validation to assert that a clean installed artifact contains `@oh-my-pi/pi-utils`; existing CI continues to validate the exact clean GitHub install path with the compiled OMP 18.4.8 binary.
- No routing, model-selection, Bifrost, MCP, provider, or inference behavior changed.

## 0.8.7 — 2026-10-01

- Fixed clean GitHub-plugin installation under the compiled OMP 18.4.x loader by moving all runtime `pi-catalog` imports to Pifrost's extension entry boundary (`native.ts`). Nested Pifrost modules now receive OMP's host-owned policy/catalog functions by injection instead of resolving a second on-disk catalog dependency graph, avoiding the upstream compiled-loader failure tracked in OMP #13731/#13940.
- Preserved the existing request-policy, bundled-catalog fallback and provider API-route behavior: `transport-model.ts` still uses OMP's authoritative `resolveModelPolicy`, while `catalog-fallback.ts` still uses OMP bundled models and `apiRouteFor`; only the module-resolution boundary changed.
- Removed the ineffective direct `@oh-my-pi/pi-utils` workaround and added release guards that prevent nested runtime modules from importing `pi-catalog` again.
- Added a clean GitHub-SHA installation regression using the compiled OMP 18.4.8 release binary, matching the production installation path that exposed the defect.
- No routing, model-selection, Bifrost, MCP, or provider behavior changed.

## 0.8.6 — 2026-10-01

- Fixed compiled OMP 18.4.x extension loading by removing Pifrost's runtime import of `@oh-my-pi/pi-catalog/build`, the root-level catalog subpath affected by upstream OMP issue #13940.
- Added a Pifrost transport-only model materializer built only on OMP's bundled-safe `@oh-my-pi/pi-catalog/compat/resolve` surface, preserving request-policy resolution for Chat Completions and Responses without depending on broken catalog root-level subpaths.
- Kept Bifrost as the routing/billing authority: the local materializer applies request-relevant OMP catalog policy and capability corrections but deliberately does not mutate price cards for ephemeral transport models.
- Added request-policy regression tests for OpenAI Responses and OpenAI-compatible chat, plus guards preventing the broken catalog-build path or broad catalog-root import from returning to Pifrost runtime code.
- Release packaging now includes and validates the new transport materializer. Model-catalog schema remains v14.

## 0.8.5 — 2026-10-01

- Hardened Bifrost rich-content recovery so only directly exposed Hound `mcp_screenshot` results can be rehydrated; arbitrary Bifrost MCP text and `executeToolCode` output can no longer impersonate trusted image transport framing.
- Added image magic-byte validation plus per-result image-count and aggregate decoded-byte limits on top of the existing MIME, Base64 and per-image size checks.
- Made automatic visual analysis deterministic: Pifrost now resolves only OMP's configured `@vision` role; provider/model fallback remains inside the normal Pifrost/Bifrost vision route instead of scanning unrelated OMP models.
- Fixed Hound `liveVerified` so a successful generic Bifrost `tools/list` no longer marks Hound live when no Hound tool is actually visible.
- Added explicit native/recovered/conditional-Code-Mode visual status and hardened Code Mode signature detection to parse actual virtual `.pyi` function definitions rather than substring matches.
- Strengthened release contracts for Hound screenshot `ImageContent`, Bifrost's exact classic/Code-Mode image marker format, and OMP 18.4.5 image-on-wire semantics.
- Added security/regression coverage for marker spoofing, aggregate limits, deterministic `@vision` selection, classic screenshot scoping, Code Mode exclusion, false-positive `.pyi` signatures and negative Hound live verification.
- Consolidated Hound screenshot documentation around the current compatibility boundary; Pifrost still does not connect to or manage Hound directly.

## 0.8.4 — 2026-10-01

- Added a Pifrost-only rich-content compatibility bridge for current Bifrost MCP releases that flatten upstream `ImageContent` into `[Image Response: <base64>, MIME: ...]` text.
- The bridge is scoped to the repository-owned Bifrost MCP server, validates supported image MIME types, Base64 canonical form and decoded size, preserves mixed text/image ordering, leaves malformed markers untouched, and never double-decodes native OMP image blocks.
- Recovered screenshots are returned as native OMP `ImageContent`. Image-capable active models receive them directly; text-only active models use OMP's configured `@vision` model for a bounded no-tools visual analysis whose text is appended while the original image remains in session history.
- Preserved the existing Bifrost/Hound topology and repository Virtual Key governance: Pifrost does not connect directly to Hound or add a second MCP execution path.
- Updated Hound diagnostics to distinguish native Bifrost image preservation from Pifrost recovery and to keep Code Mode visual readiness conditional when an image may be discarded inside `executeToolCode`.
- Added regressions for mixed-content recovery, native-image pass-through, malformed/unsupported/oversized markers, Bifrost tool scoping, `@vision` delegation and image-capable active-model bypass.

# Changelog

## 0.8.3 — 2026-09-30

- Made Hound diagnostics fully aware of Bifrost MCP Code Mode. Code-mode clients are no longer misreported as missing merely because Bifrost intentionally hides their raw tools behind `listToolFiles`, `readToolFile`, `getToolDocs` and `executeToolCode`.
- Added a repository-key-scoped, non-destructive Code Mode verifier that inspects Bifrost's virtual `.pyi` files with `listToolFiles` + `readToolFile`, supporting both server-level and tool-level binding without invoking Hound search/fetch/crawl/browser actions.
- Split Hound readiness into search, web research (search + fetch), deep research (search + fetch + crawl), screenshot-callable, visual-web, contract-complete and administrative-complete states instead of one overloaded core/complete label.
- Added an explicit Bifrost image-transport warning. Current supported Bifrost MCP code flattens upstream MCP `ImageContent` to text, so Hound screenshot remains callable but Pifrost does not claim end-to-end multimodal screenshot support.
- Preserved repository Virtual Key governance for Code Mode. Pifrost probes only through the existing Bifrost MCP endpoint and does not add a direct Hound connection or deployment/runtime management.
- Added a generic repository-scoped MCP `tools/call` helper used by the Code Mode probe, preserving id-aware Streamable HTTP/SSE handling and the repo `x-bf-vk` credential boundary.
- Consolidated MCP client shape normalization behind one pure implementation shared by the CLI and helper module, eliminating field drift around Code Mode, tool schemas, instruction metadata, allow-by-default and session settings.
- Expanded Hound regression coverage for full/partial Code Mode, server- and tool-level bindings, optional-only grants, MCP tool-call transport and normalization parity.
- Corrected the supported Hound contract pin to the actual v12.4.1 commit `1dab81b7fc03721688cfb7775fc1222c7f9805ba`. Release CI validates the pinned contract only; current Hound master moved to a scheduled upstream canary so upstream changes cannot randomly break an otherwise reproducible release.
- Release version advanced to 0.8.3; model-catalog schema remains v14 because model/route capability metadata is unchanged.

## 0.8.2 — 2026-09-30

- Removed the previous three-tool MCP search adapter completely from Pifrost runtime diagnostics, CLI output, tests and current documentation.
- Added first-class diagnostics for Hound / `master-fetch` when it is exposed **only through repository-scoped Bifrost MCP**. Pifrost does not install, start, proxy or connect directly to Hound.
- Detects Hound by its six canonical MCP tools rather than by Bifrost client name: `mcp_smart_search`, `mcp_smart_fetch`, `mcp_smart_crawl`, `mcp_screenshot`, `cache_clear` and `version`.
- Normalizes Bifrost-prefixed gateway tool names back to the canonical Hound contract and distinguishes configured grants from tools actually visible through the repository Virtual Key's live `tools/list`.
- Reports Hound capabilities independently: search, fetch, crawl, screenshot, cache and version. Core research readiness requires search + fetch + crawl; optional capabilities can be granted independently without being misreported as a complete Hound surface.
- Compares only Hound's `mcp_smart_search` with OMP native `web_search`; fetch/crawl/screenshot remain MCP research tools and no synthetic `omp-web` model or Pifrost-owned search router is introduced.
- Preserves Hound's intended search→fetch workflow: search supplies ranked URLs/snippets while source content is obtained with `mcp_smart_fetch`.
- Surfaces Bifrost client instruction presence/limits and attached Virtual MCP instruction provenance alongside the Hound tool surface.
- Added a CI-pinned upstream Hound contract canary against `master-fetch` commit `86d1b1329c0eed6133f29e3effe6a40a29f9dcdc`, covering the six canonical tools and Streamable HTTP `/mcp` contract.
- Added Hound-specific MCP policy/gateway/prefix/partial-grant regression coverage and moved all Tool Search examples to Hound tool names.
- Release version advanced to 0.8.2; model-catalog schema remains v14 because model/route capability metadata is unchanged.


## 0.8.1 — 2026-09-30

- Hardened the 0.7/0.8 capability architecture after a full routing/code-quality audit without expanding Pifrost into a second policy router.
- Fixed between-tools reasoning fallback semantics. Pifrost no longer removes a physical fallback solely because it lacks native `between_tools`; Bifrost 2.2.4+ remains responsible for downgrading or omitting that mode per physical model.
- Introduced one dependency-free route-eligibility engine shared by runtime prewalk and `pifrost routes explain`, covering protocol, context/output reserve, image/tools, tool-choice variants, reasoning-with-tools, Tool Search, between-tools notices and service tiers.
- Formalized routing ownership: Pifrost may capability-filter and partition by wire protocol while preserving Bifrost order; Bifrost remains authoritative for physical model/provider ordering, policy routing and same-protocol fallback. Cross-protocol retry remains allowed only before any model output is committed.
- Persisted the additional member-level tool-choice compatibility fields required for offline diagnostics and advanced the catalogue cache schema to v14.
- Made `routes effective` expose the catalogue snapshot timestamp/age and warn when route membership may be stale instead of presenting cached data as implicitly live.
- Made OMP native-web diagnostics tri-state: an intentionally unset `modelRoles.web` is distinct from OMP being unavailable or `omp config` failing.
- Made the previous three-tool MCP search adapter's reporting modality-specific so partial grants could not claim unrelated search modes.
- Hardened Bifrost MCP Streamable HTTP parsing by matching JSON-RPC request ids and ignoring notifications/unrelated SSE events.
- Added exact Bifrost 2.2.4 contract gates for Tool Search, between-tools downgrade behavior and service-tier capability metadata, and renamed the OMP contract validator to the version-neutral `validate-omp-contract.mjs`.
- Added regression coverage for preserved fallback order, between-tools downgrade, shared runtime/CLI eligibility, cache freshness, partial MCP-search grants, OMP unavailable/error states and id-aware MCP SSE responses.
- Began decomposing large modules by extracting shared route eligibility, route CLI helpers and MCP JSON-RPC transport into focused modules.
- Switched CI to reproducible lockfile-based dependency installation and added cross-module transport/integration coverage.


## 0.8.0 — 2026-09-30

- Completed Doctor 2.0's effective-route view. Pifrost now joins OMP's effective `modelRoles` to each `bifrost/omp-*` alias and shows the underlying Bifrost physical members with their individual context, output, image, tool, Tool Search, between-tools-thinking, service-tier and protocol capabilities.
- Added `pifrost routes effective` for the same role → Pifrost alias → Bifrost physical-route report outside the full doctor.
- Added `pifrost routes explain <role|alias>` with request constraints for context/output reserve, image/tools, reasoning, Tool Search, between-tools thinking and service tier. It reports each physical member as eligible or excluded and gives the exact capability reason without taking routing ownership away from Bifrost.
- Deepened the then-current three-tool MCP search diagnostics from configuration inference to live gateway verification, using repository-key-scoped Bifrost `tools/list` and prefix-aware canonicalization.
- Added dual MCP/native search-path reporting alongside OMP's effective `modelRoles.web` selector and `retry.fallbackChains.web`; an unset web role is correctly reported as OMP's built-in default search chain.
- Added MCP presentation/context diagnostics: live gateway tool count, OMP's default discoverable presentation, approximate eager schema bytes/tokens, and an explicit distinction between discoverable tools and provider-side `defer_loading`/Tool Search.
- Preserved MCP tool schemas from Bifrost management metadata so diagnostics can measure the visible tool surface instead of counting names only.
- Kept all new behavior diagnostic/control-plane only: Bifrost remains authoritative for physical routing and fallback, OMP remains authoritative for native web-search orchestration, and Pifrost still does not manufacture an `omp-web` model.
- Advanced the model-catalog cache schema to v13 because route-member capability detail is now persisted for offline/effective-route diagnostics.


## 0.7.0 — 2026-09-30

- Raised Pifrost's tested OMP baseline to 18.4.5 and Bifrost baseline to 2.2.4 so route synthesis can consume the current service-tier, pricing and reasoning capability contracts instead of relying on the 18.3.2-era model surface.
- Expanded physical and logical route capability modelling with Tool Search, between-tools thinking, service-tier support/available tiers and OMP pricing status. Heterogeneous aliases continue to expose only capabilities that are safe across their eligible route members.
- Extended context-aware prewalk to reject physical members that cannot satisfy a wire-level Tool Search request, between-tools thinking request or explicit service tier. Tool Search requests prefer OpenAI Responses when that is the compatible physical transport.
- Added a capability bridge for OMP deferred-tool intent on compatible Responses routes: deferred function tools regain `defer_loading` and a server `tool_search` meta-tool after OMP serialization. The bridge is capability-gated and does not silently degrade onto Chat Completions.
- Added between-tools thinking bridging through Bifrost. When OMP requests reasoning-off semantics on a route whose eligible members support Bifrost's between-tools contract, Pifrost emits `reasoning.type=between_tools` instead of forcing an incompatible disabled/low-effort form.
- Extended Doctor compatibility reporting for the 18.4.5/2.2.4 baseline and Bifrost Tool Search, between-tools thinking and service-tier capability support.
- Extended MCP diagnostics with per-client instruction caps/upstream instruction presence, Virtual MCP `instructions`/`instructions_mode`, effective repository instruction provenance and explicit detection for the then-current three-tool MCP search contract.
- Kept search architecture deliberately layered: the MCP search backend remained separate from OMP native web search, with no synthetic `bifrost/omp-web` route or Pifrost-owned native-search fallback chain.
- Advanced the model-catalog cache schema to v12 so 0.6.x cached route envelopes cannot hide the new capability metadata after upgrade.


## 0.6.19 — 2026-09-27

- Fixed OpenRouter agentic-harness-gated free models through Bifrost. Direct testing confirmed `thinkingmachines/inkling:free` returns HTTP 403 without application attribution, succeeds with `HTTP-Referer: https://pi.dev/` plus `X-Title: pi`, fails through plain Bifrost, and succeeds when those headers are forwarded through Bifrost's `x-bf-eh-*` escape mechanism.
- Pifrost now forwards its real originating OMP/pi application identity on every Bifrost inference request as `x-bf-eh-http-referer: https://pi.dev/` and `x-bf-eh-x-title: pi`. Bifrost strips the prefix before provider dispatch, allowing OpenRouter to recognise the request as coming from an agentic harness.
- Kept Pifrost's existing versioned `pifrost/<version> OMP` User-Agent and upstream `x-bf-eh-user-agent`; the fix does not spoof a pi User-Agent because the observed OpenRouter gate was already satisfied by Referer + Title alone.
- Applied the attribution at the native provider boundary rather than special-casing Inkling, so future OpenRouter route members with the same agentic-harness gate work automatically when used from OMP through Bifrost.
- Added provider-contract regression coverage for the forwarded attribution headers and preserved existing session/OpenCode forwarding behavior.
- Cache schema remains v11 because model and route capability metadata are unchanged.


## 0.6.18 — 2026-09-27

- Fixed heterogeneous Bifrost route failures where OMP could request a larger completion ceiling than a physical fallback supports (for example `max_completion_tokens=262144` reaching a 131072-token OpenRouter/Xiaomi MiMo model and being rejected with HTTP 400).
- Output-token limits are now treated correctly as ceilings rather than hard capability requirements. Lower-output route members remain eligible and Pifrost clamps each dispatched attempt to the safest ceiling supported by every same-protocol member delegated to Bifrost.
- Native mixed-protocol execution now computes a per-attempt max-token ceiling before both OpenAI Responses and Chat Completions dispatch, preserving larger limits on capable attempts while protecting smaller fallbacks.
- Final-wire dynamic Chat rewriting also clamps `max_completion_tokens`, `max_tokens`, and `max_output_tokens` when Bifrost receives an eligible heterogeneous fallback chain.
- Context prewalk now reserves the output that each physical member can actually emit after clamping, avoiding false exclusion when an oversized caller ceiling can safely be reduced for that member. Protocol, image, tool, reasoning, and true context-window incompatibilities still fail closed.
- Added regressions for the observed 262144→131072 failure, mixed fallback ceilings, Responses-style `max_output_tokens`, member-specific context eligibility, and preservation of larger ceilings for capable single-member attempts.
- Cache schema remains v11 because route-profile metadata is unchanged.


## 0.6.17 — 2026-09-27

- Fixed the 0.6.16 OMP plugin-install regression where extension validation failed because the new context estimator imported `@oh-my-pi/pi-agent-core/tokenizer`, whose native `@oh-my-pi/pi-natives` dependency is not available in OMP's clean GitHub plugin sandbox.
- Removed the agent-core/native runtime dependency entirely. Dynamic-route prewalk now applies the same semantic provider-context accounting with a dependency-free local tokenizer: trustworthy provider usage anchors the established prefix, while only model-visible system/tool/message content is estimated locally.
- Preserved the 0.6.16 false-overflow fix: large internal tool-result `details`, usage records, timestamps and routing metadata are still excluded from prompt sizing, so the observed ~1.49M-token false estimate cannot recur through the old `JSON.stringify(Context)` path.
- Kept 0.6.15 mixed-protocol execution unchanged: Muse remains the first `omp-default` attempt through Bifrost `/v1/responses`, with the Chat-compatible DeepSeek group used only after a pre-output failure.
- Added a CI release gate that installs the exact GitHub commit into a fresh OMP plugin home via `omp install github:<repo>#<sha> --force` and validates the installed plugin. This reproduces the user installation path that 0.6.16 failed and prevents development-checkout dependency leakage from masking future packaging regressions.
- Cache schema remains v11 because route-profile metadata is unchanged.

## 0.6.16 — 2026-09-27

- Fixed dynamic-route context prewalk falsely rejecting small OMP turns as larger than the model window. The native route path had been estimating `JSON.stringify()` of OMP's internal Context objects, which can include large non-wire metadata such as tool-result `details`, provider usage records, timestamps and routing state.
- Native OMP routing introduced semantic provider-context sizing with trustworthy provider-usage anchors and model-visible content counting; its initial implementation instantiated OMP's model-aware `Tokenizer`, which was later replaced in 0.6.17 because that native dependency is not deployable in OMP's clean plugin sandbox.
- Provider usage anchors now mirror OMP's trust and rewrite rules, including rejection of aborted/error turns, pure-output usage, predated retained tails after history rewrites and stale usage across pruned tool results.
- The legacy serialized-body estimator remains available only as a fallback for non-native/final-wire callers; a native semantic estimate explicitly outranks it in route planning.
- Added regressions proving that multi-megabyte tool-result metadata that is not model prompt content cannot inflate a small turn into a false >1M-token overflow, and that the semantic estimate wins over the raw request-object size.
- The 0.6.15 mixed-protocol execution model is unchanged: Muse remains the first `omp-default` attempt through Bifrost `/v1/responses`, followed on a pre-output failure by the Chat-compatible DeepSeek group.
- Cache schema remains v11 because route-profile metadata is unchanged; this release corrects request-time context sizing only.

## 0.6.15 — 2026-09-27

- Added native mixed-protocol execution for simple context-aware Bifrost routes. Pifrost can now keep Responses-only and Chat-Completions members in one logical OMP route instead of excluding the non-Chat members.
- The current `omp-default` route now genuinely tries `opencode-go/muse-spark-1.3-contributor` first through Bifrost `/v1/responses`; if that attempt fails before producing model output, Pifrost advances to the Chat group headed by Command Code DeepSeek, with direct DeepSeek retained as Bifrost's same-protocol fallback.
- Route order is preserved by grouping only contiguous members with the same wire protocol. Bifrost remains responsible for credentials, governance, accounting, provider retries and fallbacks within each protocol group; Pifrost owns only the boundary between protocol groups.
- Cross-protocol fallback is replay-safe: Pifrost buffers the initial stream-start envelope and may advance only before real text, thinking or tool output is emitted. Once output is committed, the turn is never replayed on another model or protocol.
- OpenCode Go Responses attempts now use OMP's native `opencode-go` provider policy while keeping Bifrost as the HTTP/authentication hop. The bare upstream model id is used for OMP policy resolution and the full `opencode-go/...` reference is retained as `requestModelId` for Bifrost.
- Existing OMP session identity forwarding is preserved on every protocol attempt, including `x-bf-session-id` for Bifrost affinity and `x-bf-eh-x-opencode-session` for OpenCode Go.
- Pifrost no longer depends on Bifrost's `convert_chat_to_responses` compatibility catalogue to make gateway-only Muse models usable; native protocol selection is based on Pifrost's provider-qualified route metadata.
- Added exact current-route regressions for Muse-first planning, Responses-to-Chat pre-output fallback, same-protocol Bifrost fallbacks, logical-model identity preservation and the no-replay-after-output safety rule.
- Advanced the model-catalog cache schema to v11 so pre-multi-protocol route profiles are rebuilt after upgrade.

## 0.6.14 — 2026-09-27

- Fixed the remaining `omp-default` prewalk failure after 0.6.13 protocol filtering. Pifrost had conflated OMP's `disableReasoningOnToolChoice` wire-policy flag with Bifrost's broader `supports_reasoning_with_tool_calls` capability, so DeepSeek Chat members could be rejected merely because a reasoning request offered tools.
- Reasoning/tool compatibility is now represented as two independent route capabilities: `supportsReasoningWithTools` controls whether reasoning may coexist with an offered tool set, while `disableReasoningOnToolChoice` applies only when the final wire request actually contains `tool_choice`.
- Added an exact regression for the live 0.6.13 route: Responses-only OpenCode Go Muse is excluded, while Command Code DeepSeek and direct DeepSeek remain eligible for a reasoning request with tools and no `tool_choice`.
- Preserved OMP's `maxTokensExplicit` intent across Pifrost's custom transport. Runtime diagnostics now label the serialized output reserve as caller-requested or an implicit OMP/model ceiling instead of implying every model-default cap was explicitly requested.
- Expanded no-eligible-route errors to report the concrete exclusion reasons for every physical member.
- Advanced the model-catalog cache schema to v10 so route profiles generated with the old reasoning/tool semantics are discarded after upgrade.

## 0.6.13 — 2026-09-27

- Fixed a wire-protocol precedence bug exposed by the current OpenCode Go Muse route. Pifrost previously allowed generic/cross-provider Bifrost datasheet `supported_endpoints` metadata to override OMP's provider-specific `apiRouteFor()` policy.
- Protocol authority is now ordered as: live Bifrost `supported_methods`; OMP provider-specific `api-routes`; Bifrost datasheet endpoints; provider-qualified bundled catalog metadata; verified fallback hints.
- Added a regression where a generic OpenRouter/Meta Muse datasheet row advertises Chat Completions while `opencode-go/muse-spark-1.3-contributor` is Responses-only. The OpenCode Go provider policy now wins and runtime prewalk removes Muse from Pifrost's Chat request before Bifrost dispatch.
- Advanced the model-catalog cache schema to v9 so route profiles generated by 0.6.12 with the old protocol precedence are discarded.

## 0.6.12 — 2026-09-27

- Fixed protocol enrichment for gateway-only models that are absent from OMP's bundled static model snapshot. Pifrost now reads OMP's compiled provider `api-routes` policy via `apiRouteFor(provider, modelId)`, the same authoritative rules used by OMP provider managers at runtime.
- The current `opencode-go/muse-spark-1.3-contributor` route now resolves as `openai-responses` even though that SKU is not present in `getBundledModels("opencode-go")`. Command Code's current DeepSeek route resolves independently as `openai-completions`.
- Route enrichment applies provider `api-routes` before static bundled-model protocol metadata, while retaining live Bifrost `supported_methods` and datasheet `supported_endpoints` at higher precedence.
- Replaced the synthetic 0.6.11 Muse regression with a test against OMP's real compiled `apiRouteFor()` policy, so gateway-first transport rules cannot silently disappear from Pifrost again.
- Advanced the model-catalog cache schema to v8, forcing installations to discard protocol-incomplete 0.6.11 route profiles.
- Expanded `pifrost models doctor` to display per-member protocol values/provenance and to clarify that displayed context bands are capacity-only; runtime prewalk additionally filters protocol and other request capabilities.

## 0.6.11 — 2026-09-27

- Added provider-qualified wire-protocol capability tracking for physical route members. Pifrost now normalizes OpenAI Chat Completions, OpenAI Responses and Anthropic Messages metadata instead of assuming that every model visible through Bifrost can service Pifrost's Chat-Completions transport.
- Extended the simple-route prewalk to reject members with an authoritative protocol mismatch before the request reaches Bifrost. The current `opencode-go/muse-spark-1.3-contributor` route is therefore skipped for Pifrost Chat requests while Chat-compatible Command Code/DeepSeek fallbacks remain eligible.
- Protocol provenance is resolved conservatively from live Bifrost `supported_methods`, Bifrost `supported_endpoints`, provider-qualified OMP catalog metadata, then narrowly scoped verified hints. Unknown protocol metadata remains eligible; Pifrost does not invent a transport contract.
- Made capability prewalk run for every eligible `context-aware` simple route even when all members expose the same context window, so protocol, image, tool and reasoning constraints cannot be bypassed by equal context sizes.
- Added regressions reproducing the observed `ModelProtocolUnsupported` failure on the current `omp-default` route and verifying that provider-qualified protocol differences are preserved.
- Advanced the model-catalog cache schema to v7 so protocol-blind cached route profiles are rejected after upgrade.
- Removed the stale hard-coded `pifrost/0.4.1 OMP` provider identity. Pifrost now derives the forwarded User-Agent version from the installed package version.
- Retained the existing OMP 18.3.2 compatibility floor; the required OpenCode Go protocol pins are present in the released 18.3.2 catalog and the full released-loader contract remains CI-gated.

## 0.6.10 — 2026-09-27

- Fixed the actual cause of repeated HTTP 409 failures when `pifrost repo init` adds or changes MCP grants on an existing Bifrost 2.2.3 Virtual Key.
- Bifrost's Virtual Key update contract requires the numeric `id` of every existing `mcp_configs` row. Pifrost previously discarded those row ids and resent existing clients such as n8n as new rows, causing the unique `(virtual_key, mcp_client)` constraint to fail.
- Bifrost 2.2.3 maps any `ErrAlreadyExists` from the whole Virtual Key transaction to the misleading message `A virtual key with this name already exists`, which obscured the MCP-config collision.
- Pifrost now fetches the authoritative Virtual Key detail before every update, preserves each existing MCP-config row id, and sends the id back for retained grants while leaving genuinely new grants id-less.
- Existing repo Virtual Key ids, secrets and policy remain intact. Legacy name migration from 0.6.9 is retained, but MCP grant reconciliation is now independently correct.
- Added a regression reproducing the live homelab update: existing n8n row id is retained while Railway is added as a new grant.

## 0.6.9 — 2026-09-27

- Fixed the remaining Bifrost 2.2.3 HTTP 409 on existing legacy repo Virtual Keys. Bifrost's update store resolves rows by `id OR name` and rewrites the full row, so a duplicated basename-only legacy name can make even a policy-only PUT fail.
- When a repo already has a locally stored Virtual Key id/name from the pre-0.6.7 basename-only scheme, `repo init` now migrates that same key in place to the repo-scoped canonical name (for example `omp-homelab-59894f4310-mcp`) while applying the requested MCP grants.
- The migration preserves the Virtual Key id and raw secret; it changes only the key name/policy and therefore does not require rotation or MCP credential replacement.
- Before migration, Pifrost verifies that the canonical repo-scoped name is not owned by a different Virtual Key. A conflict fails closed with a specific diagnostic instead of adopting or overwriting another key.
- Fresh/canonical keys retain the 0.6.7/0.6.8 idempotent create/update behaviour.
- Added regression coverage reproducing Bifrost 2.2.3's legacy-name 409 and verifying in-place migration from n8n-only to n8n + Railway.

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
