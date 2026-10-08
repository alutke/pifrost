# Pifrost technical reference

> This is the detailed technical/reference documentation retained from the original README. For installation and normal use, start with the [main README](../README.md).

Pifrost is a native **OhMyPi 18** provider and terminal control plane for **Maxim Bifrost**.

It has two responsibilities:

1. expose Bifrost routing aliases such as `omp-default`, `omp-slow`, `omp-plan`, and `omp-vision` to OMP with conservative capability metadata; and
2. configure and operate the OMP ↔ Bifrost integration from a normal terminal, including global inference credentials, OMP model roles, route synchronization, model-cache refresh, and repository-specific MCP Virtual Keys.

Pifrost is derived from [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), but uses the current OMP 18 native provider API.

> **Bifrost OSS:** scoped management API keys are an Enterprise feature. Bifrost OSS management endpoints use the configured dashboard/admin username and password over HTTP Basic auth. Pifrost supports OSS Basic auth and Enterprise Bearer/scoped-key auth separately.

---

## Contents

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation and upgrade](#installation-and-upgrade)
- [First-time setup](#first-time-setup)
- [Global configuration](#global-configuration)
- [OMP configuration](#omp-configuration)
- [OMP agent attribution](#omp-agent-attribution)
- [Routing aliases](#routing-aliases)
- [Model metadata and startup cache](#model-metadata-and-startup-cache)
- [Time-of-day pricing diagnostics](#time-of-day-pricing-diagnostics)
- [Upstream compatibility doctor](#upstream-compatibility-doctor)
- [Bifrost Skills → OMP Skills bridge](#bifrost-skills--omp-skills-bridge)
- [Repository-specific MCP](#repository-specific-mcp)
- [Repository reset and cleanup](#repository-reset-and-cleanup)
- [Credential and security model](#credential-and-security-model)
- [CLI reference](#cli-reference)
- [Configuration files](#configuration-files)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Architecture

Pifrost deliberately does **not** become a second prompt router. Bifrost remains the authority for provider selection and fallback.

```text
OMP
 │
 │ bifrost/omp-default
 │ bifrost/omp-slow
 │ bifrost/omp-plan
 │ ...
 ▼
Pifrost OMP provider
 │
 │ Pifrost OpenAI Chat Completions transport
 │ Authorization: Bearer <inference API key>
 │ x-bf-vk: <global inference Virtual Key>
 │ x-bf-session-id: <OMP session id>
 │ User-Agent: pifrost/<version> OMP
 │ x-bf-eh-user-agent: pifrost/<version> OMP
 │ x-bf-eh-x-opencode-session: <OMP session id>
 ▼
Bifrost /v1
 │
 ├─ routing rules
 ├─ provider fallback
 ├─ provider credentials
 └─ physical model providers
```

For each inference request, OMP supplies a stable conversation `sessionId`. Pifrost sends that value directly as `x-bf-session-id`, which lets Bifrost keep session-aware routing plus provider/key affinity on the same eligible route/key across turns. The same value is also sent as `x-bf-eh-x-opencode-session`; Bifrost strips the `x-bf-eh-` prefix and the selected upstream receives `x-opencode-session`, satisfying OpenCode Go's separate per-conversation session requirement. Both headers are constructed per request, so Pifrost does not mutate shared provider headers. Pifrost also forwards its explicit client identity upstream as `x-bf-eh-user-agent`.


The management/control-plane path is separate:

```text
pifrost CLI
 │
 ├─ Bifrost OSS
 │    Authorization: Basic base64(admin_username:admin_password)
 │
 └─ Bifrost Enterprise
      Authorization: Bearer <scoped management API key>
 │
 ▼
Bifrost /api/*
 │
 ├─ routing rules
 ├─ Virtual Keys
 └─ MCP client metadata
```

Repository MCP access is separate again:

```text
<repo>/.omp/mcp.json
 │
 │ x-bf-vk: !pifrost secret repo-mcp --id <repo-id>
 ▼
Pifrost local secret store
 │
 │ dedicated repository MCP Virtual Key
 ▼
Bifrost /mcp
 │
 ├─ direct MCP client/tool grants on the repo VK
 └─ named Virtual MCP bundles attached to the repo VK
```

The intended identity separation is:

```text
Global LLM inference  -> global inference VK
Bifrost administration -> OSS admin Basic auth OR Enterprise API key
Repository MCP access -> one dedicated MCP VK per repository
```

Do not reuse a repository MCP VK as the global inference VK.

New Pifrost repository MCP keys on Bifrost 2.x are explicitly created with `allow_all_providers: false` and no provider configs, making the intended MCP-only posture explicit. Existing repository keys are not silently rewritten, because that could destroy operator-managed governance.

---

### Bifrost 2.x feature ownership

Pifrost integrates the Bifrost features that affect the OMP boundary: Virtual-Key auth/governance, routing metadata, complexity-routing awareness, model capability discovery, MCP gateway access and diagnostics, version/health detection, and quota reporting.

Features that are transparent gateway responsibilities remain owned by Bifrost and require no duplicate Pifrost implementation: provider adapters, semantic caching, request/response logging, OpenTelemetry, cost accounting, guardrails, fallback execution, batch handling, storage backends, and Bifrost's own dashboard/configuration. Pifrost should observe those contracts where relevant, not become a second Bifrost.

Pifrost 0.7 projects `service_tier` only through capability-safe routes. The logical alias advertises only service tiers common to every known route member; context-aware prewalk additionally removes a physical member when it cannot honor the specific requested tier. Bifrost still owns provider/model selection among the remaining compatible members. Pifrost does not invent a provider family or choose a faster physical model itself.

---

## Why Pifrost derives alias metadata

A Bifrost route may expose a logical model such as:

```text
omp-slow
  -> openai/gpt-5.6-luna
  -> CommandCode GOAT/deepseek/deepseek-v4-pro
  -> deepseek/deepseek-v4-pro
```

OMP only sees `bifrost/omp-slow`. Pifrost therefore calculates a conservative capability envelope across every route member:

- `contextWindow` = minimum safe context window across the chain
- `maxTokens` = minimum safe output limit
- image input = enabled only when every member supports images
- reasoning = enabled only when every member supports reasoning
- explicit thinking efforts = intersection of published effort levels
- tool support = true only when every member advertises tool support
- deferred Tool Search and between-tools thinking = enabled only when every known member can preserve the semantic contract
- service tiers = intersection of tiers exposed by every known member
- pricing status = preserved when uniform; reported as variable when the route mixes pricing semantics
- displayed token cost = conservative maximum across route members

If a route member cannot be resolved safely, Pifrost withholds the alias instead of fabricating metadata.

### Capability discovery and model identity

Pifrost includes one narrowly scoped free-entitlement exception for `CommandCode GOAT/meituan/LongCat-2.0:free`. The live Bifrost inventory currently exposes that route without authoritative limits, while the upstream LongCat-2.0 contract publishes a 1M context window, 131,072 maximum output tokens, text input, reasoning and native tool calling. Pifrost uses those verified limits only for that exact CommandCode GOAT SKU. It does not generalize them to OpenRouter or other `:free` model identifiers.


Pifrost resolves capability facts per field rather than assuming one source is complete. The normal trust order is:

1. rich, explicit metadata returned by the live Bifrost `/v1/models` inventory;
2. the Bifrost public pricing/model-parameter datasheets;
3. an equivalent canonical model-family row in those datasheets;
4. a narrowly scoped vendor-backed capability override for a known upstream omission; and
5. conservative catalog fallback when the model identity and capability are safe to establish.

Transport-compatibility axes are handled more carefully. Pifrost asks OMP's host-owned `resolveModelPolicy()` engine for the actual provider/model/protocol route rather than inferring transport policy by intersecting bundled catalogue rows. That runtime policy outranks the generic Bifrost datasheet for semantic compatibility such as whether reasoning and tools may coexist. OMP expresses this particular axis as `disableReasoningWithTools`; Pifrost translates it to its positive `supportsReasoningWithTools` capability before prewalk. Explicit live Bifrost capability metadata still outranks both. Unknown or unmapped provider identities fall back to Bifrost metadata rather than receiving a permissive guess.

Diagnostics preserve origin as `live`, `omp-provider-policy`, `bifrost-datasheet`, `canonical-family`, `vendor-override`, or `fallback` for each route member and capability.

The generic compatibility defaults used for a sparse physical `/v1/models` entry (`128K` context / `8K` output) are **not** accepted as authoritative route limits. A configured route member that is temporarily absent from `/v1/models` may receive a metadata-only identity anchor, but that anchor carries no trusted capabilities. Pifrost still withholds the logical alias unless safe context and output limits can be established from a stronger source.

Model identity matching tolerates provider/aggregator prefix changes, mixed capitalization, and explicitly known entitlement aliases such as the current Ox Alpha spellings. It does not blindly strip arbitrary `-free` suffixes, and it rejects ambiguous vendor-qualified matches rather than assuming two same-tailed model names are identical.

### Doctor 2.0 and route explanations

Pifrost persists the resolved capability surface of each physical route member, not only the conservative logical alias envelope. This lets the standalone CLI explain compatibility without becoming the policy router.

`pifrost routes effective` reads OMP's effective `modelRoles` and joins each Pifrost selector to its cached Bifrost alias and physical members. The output includes the catalogue timestamp and age; a stale snapshot is explicitly marked because it may no longer match live Bifrost membership. `pifrost doctor` includes the same provenance/freshness information.

`pifrost routes explain <role|alias>` accepts hypothetical request constraints such as `--input-tokens`, `--output-tokens`, `--image`, `--tools`, `--reasoning`, `--tool-search`, `--between-tools`, `--tool-choice` and `--service-tier`. Runtime prewalk and the CLI call the same dependency-free eligibility evaluator, so the reported exclusions cannot drift from the routing implementation.

Between-tools thinking is intentionally not a hard Pifrost exclusion. Bifrost 2.2.4+ rewrites unsupported `between_tools` fallbacks to a compatible disabled/adaptive form; Pifrost therefore keeps those members in the configured chain and reports the downgrade as a notice.

Routing ownership is explicit:

- **OMP** owns agent/tool orchestration and native web-search orchestration.
- **Pifrost** owns capability/protocol compatibility prefiltering and may cross protocol groups only when an earlier group fails before emitting model output.
- **Bifrost** owns provider/model ordering, credentials, physical policy routing, same-protocol fallbacks and governance.

Pifrost preserves the relative order of all surviving Bifrost members and never reorders them for quality, cost, quota, availability preference or provider preference.

### Hound and MCP presentation diagnostics

Hound remains an external repository-scoped Bifrost MCP client. Pifrost does not own its process lifecycle, browser runtime, HTTP endpoint, search engines, BYOK keys, proxy pool or cache policy.

The flow remains:

```text
OMP/model
   │
   ▼
repository .omp/mcp.json + repo Virtual Key
   │
   ▼
Bifrost MCP gateway
   │
   ▼
Hound / master-fetch
```

Pifrost recognizes the six supported Hound tools: `mcp_smart_search`, `mcp_smart_fetch`, `mcp_smart_crawl`, `mcp_screenshot`, `cache_clear` and `version`. Management-side recognition uses the discovered tool contract rather than requiring the client to be literally named `hound`.

There are two live verification paths:

1. **Classic MCP.** Repository-key-scoped Bifrost `tools/list` exposes the Hound tools directly. Pifrost normalizes Bifrost client prefixes back to canonical Hound names.
2. **Bifrost Code Mode.** A code-mode Hound client intentionally disappears from the raw tool list and Bifrost exposes `listToolFiles`, `readToolFile`, `getToolDocs` and `executeToolCode` instead. Pifrost verifies those four meta-tools, calls `listToolFiles`, then uses `readToolFile` to confirm the Hound binding and exact repository-visible Hound functions. The probe supports both Bifrost server-level and tool-level Code Mode binding.

The Code Mode probe is deliberately non-destructive. It never invokes Hound search/fetch/crawl/screenshot, never launches Hound's browser and never makes an Internet research request. Nested Hound calls remain governed by Bifrost's repository Virtual Key and its `tools_to_execute` policy.

Capability reporting is derived rather than binary:

- `searchReady`: search is available.
- `webResearchReady`: search + fetch are available.
- `deepResearchReady`: search + fetch + crawl are available.
- `screenshotCallable`: the screenshot tool can be invoked.
- `visualWebReady`: screenshot content is either natively preserved or safely rehydrated from a directly exposed Hound screenshot result.
- `visualWebConditional`: a Code Mode screenshot tool is callable, but nested image provenance is insufficient for safe rehydration.
- `contractComplete`: all six Hound tools are repository-visible.
- `administrativeComplete`: cache + version support are repository-visible.

This distinction prevents missing `cache_clear` or `version` from making a complete research surface look unusable, and prevents search-only access from being described as deep research.

#### Screenshot transport limitation

The current supported Bifrost MCP implementation converts upstream MCP `ImageContent` into text shaped like `[Image Response: <base64>, MIME: image/png]`. Pifrost installs a compatibility bridge at OMP's `tool_result` boundary, but only for directly exposed Hound `mcp_screenshot` tools. The marker must pass MIME allowlisting, canonical Base64 validation, image magic-byte validation, per-image limits, aggregate decoded-byte limits and per-result image-count limits. Existing native image blocks are untouched, so a future Bifrost rich-content fix naturally bypasses the bridge.

When the active OMP model genuinely sends image input on its wire transport, the recovered screenshot is passed through directly. For a text-only active model, Pifrost resolves only OMP's configured `@vision` role and runs a bounded no-tools one-shot analysis. Fallback routing belongs inside that role's Pifrost/Bifrost route; Pifrost does not scan unrelated models for an opportunistic image-capable fallback.

Bifrost Code Mode remains **conditional**, not multimodal-ready: the outer `executeToolCode` result has already lost trustworthy nested-tool provenance, so Pifrost deliberately does not reinterpret image-looking text from Code Mode as an image. Fixing native image-block passthrough belongs in Bifrost; Pifrost does not add a direct-Hound bypass because that would weaken repository Virtual Key governance.

OMP's native `modelRoles.web` and `retry.fallbackChains.web` remain independent from Hound. An unset OMP web role is still distinguished from OMP being unavailable or its config being unreadable. Pifrost reports availability and does not choose the tool/model route.

OMP MCP `discoverable` presentation, Bifrost Code Mode and provider-side `defer_loading`/Tool Search are also separate mechanisms. Pifrost reports the live gateway surface and approximate eager schema footprint without conflating those features.

The release CI pins the Hound contract to **v12.4.1 / commit `1dab81b7fc03721688cfb7775fc1222c7f9805ba`**. Current Hound `master` is checked separately by a scheduled upstream canary so upstream drift remains visible without making unrelated Pifrost releases non-reproducible.

### Effective thinking display

Pifrost stores the pre-normalization provider catalog. OMP 18 may subsequently derive a thinking-control surface for sparse reasoning models. `pifrost models doctor` and `pifrost doctor` report the **OMP-effective** result:

```text
source=explicit     -> Pifrost published the effort ladder directly
source=omp-derived  -> OMP derives the effective ladder from the sparse model metadata
```

For example, a sparse OpenAI-compatible reasoning alias can appear as:

```text
thinking=minimal,low,medium,high source=omp-derived
```

while a route with a known explicit intersection may show:

```text
thinking=high,max source=explicit
```

---

## Requirements

- Node.js **22.19 or later**
- OhMyPi **18.4.5 or later** in the 18.x line
- Maxim Bifrost **2.2.4 or later** with the OpenAI-compatible Chat Completions endpoint enabled, plus the Responses endpoint for routes that contain Responses-only members
- a global Bifrost inference Virtual Key that can see the physical models in the `omp-*` routes
- optionally, a separate Bifrost inference API/Bearer credential; Bifrost 2.x `sk-bf-*` Virtual Keys can authenticate inference directly
- outbound HTTPS access to `getbifrost.ai` when refreshing public capability metadata

For route synchronization and repository MCP automation, Pifrost also needs management authentication:

- **Bifrost OSS:** dashboard/admin username and password
- **Bifrost Enterprise:** optionally, a scoped management API key

### Transport-security warning

HTTP Basic auth is encoding, not encryption. If Bifrost is exposed over plain `http://`, the admin credential is recoverable by an observer who can inspect that traffic.

Prefer localhost, a tightly controlled private network, or TLS/HTTPS in front of Bifrost.

---

## Installation and upgrade

### Install the terminal CLI

```bash
npm install --global github:alutke/pifrost
hash -r
pifrost --version
```

Expected for this release:

```text
0.9.0
```

Bun can also install the package globally:

```bash
bun add --global github:alutke/pifrost
hash -r
pifrost --version
```

### Install/update the OMP extension

```bash
omp install --force github:alutke/pifrost
```

### Normal upgrade sequence

```bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost
pifrost --version
pifrost routes sync
pifrost doctor
```

### Upgrading from 0.5.x to 0.6.0

0.6.0 is a performance, robustness and architecture release. It does **not** change the Pifrost configuration schema, Bifrost routing ownership, repository MCP grants or alias semantics.

- Existing `~/.config/pifrost/` config/secrets and repository associations remain compatible.
- Run the normal upgrade sequence, then `pifrost doctor`. No manual route or MCP migration is required.
- Model-reference and exact-route-member lookup are more efficient but preserve the existing conservative ambiguity rules.
- `pifrost doctor` now shares one concurrent read-only Bifrost snapshot across global/compatibility/repository diagnostics, reducing repeated management/inference calls.
- Generic JSON HTTP responses are bounded; abnormally large control-plane responses now fail explicitly rather than consuming unbounded memory.
- Bifrost Skill attachments stream directly into a confined staging tree. Existing Pifrost-owned installed Skills remain compatible and are refreshed normally with `pifrost repo skills sync`.
- Skill installation/removal now refuses symlinked managed paths. Replace any intentionally symlinked `.agents`/Skill directory with a real repository directory before syncing.
- Local config/secret writes use exclusive atomic temporary files and fsync-before-rename.
- Agent attribution remains process-local observability only, but its aggregate identity cardinality is now bounded.

### Upgrading from 0.4.x to 0.5.0

0.5.0 keeps the existing Pifrost config/secrets format compatible, but raises the tested OMP boundary and adds several opt-in surfaces.

- OMP **18.3.2+** is now the tested baseline. Reinstall/update the OMP extension after upgrading Pifrost.
- Bifrost **2.0.0+** remains the minimum gateway baseline; **2.2.3+** is recommended for the complete 0.5.0 feature set (session affinity, pinned fallbacks, structured quota provenance, time-of-day pricing diagnostics and the Skills bridge).
- Run `pifrost routes sync` after upgrade. The model catalogue cache schema is now v5 and refreshes old cached metadata automatically.
- Request-scoped `x-bf-session-id` affinity is automatic; no new route configuration is required.
- Existing repository MCP grants and Virtual MCP assignments are preserved. MCP server instructions remain at their previous explicit/default setting.
- Bifrost Skills are **opt-in** per repository; upgrading does not install a skill or grant an MCP/tool permission.
- `pifrost global configure-omp` remains the bootstrap/recovery path. Interactive OMP configuration changes now use OMP's approval-aware `cfg://` path.
- Finish with `pifrost doctor` and review any `UNAVAILABLE`, `INACCESSIBLE` or `DRIFT` compatibility entries before relying on the corresponding feature.

### Read-only live 0.6 smoke check

For a configured Bifrost 2.2.3+ instance, the release includes an explicit read-only smoke test. It does not create/update routing rules, Virtual Keys, MCP assignments, Skills or other Bifrost configuration.

OSS management auth:

```bash
export BIFROST_URL='http://127.0.0.1:8180/v1'
export BIFROST_VIRTUAL_KEY='sk-bf-...'
export BIFROST_ADMIN_USERNAME='admin'
export BIFROST_ADMIN_PASSWORD='...'
# optional when inference uses a separate Bearer credential:
export BIFROST_API_KEY='...'

npm run smoke:live
```

Enterprise management auth can use `BIFROST_MANAGEMENT_API_KEY` instead of the admin username/password. The smoke checks health/version, inference model visibility, quota response shape, routing reads, MCP-client discovery, Virtual MCP discovery and Skills discovery using GET/self-service operations only.

---

## First-time setup

### Bifrost OSS

Run:

```bash
pifrost init
```

The wizard asks for:

```text
Bifrost URL
Inference API/Bearer key (optional on Bifrost 2.x)
Global inference Virtual Key
Configure management auth? -> Yes
Management auth mode        -> basic
Bifrost admin username
Bifrost admin password
```

Example Bifrost URL:

```text
http://192.168.1.221:8180/v1
```

On Bifrost 2.x, the inference API/Bearer key may be left blank when the global Virtual Key is an `sk-bf-*` key. Pifrost still sends `x-bf-vk` for governance identity; when a separate Bearer credential is configured it is preserved.

Pifrost then:

1. installs/updates the OMP extension;
2. validates `/v1/models` with the inference identity;
3. validates the management API using Basic auth;
4. stores durable configuration under `~/.config/pifrost/`;
5. applies the recommended OMP settings;
6. reads live `omp-*` routing rules;
7. writes `~/.omp/agent/pifrost.aliases.json`; and
8. performs a network-backed model refresh to seed the startup catalog.

### Bifrost Enterprise

Use Bearer/scoped management auth:

```bash
pifrost global setup \
  --url 'https://bifrost.example.com/v1' \
  --api-key "$BIFROST_API_KEY" \
  --virtual-key "$BIFROST_VIRTUAL_KEY" \
  --management-auth bearer \
  --management-key "$BIFROST_MANAGEMENT_API_KEY" \
  --yes
```

---

## Global configuration

### Interactive

```bash
pifrost global setup
```

Existing secrets are not printed. The setup can be rerun safely.

### OSS non-interactive

Prefer environment variables for admin credentials in automation:

```bash
export BIFROST_ADMIN_USERNAME='admin'
export BIFROST_ADMIN_PASSWORD='...'

pifrost global setup \
  --url 'http://192.168.1.221:8180/v1' \
  --api-key "$BIFROST_API_KEY" \
  --virtual-key "$BIFROST_VIRTUAL_KEY" \
  --management-auth basic \
  --yes
```

Relevant flags:

```text
--url <url>
--api-key <key>
--virtual-key <key>
--management-auth <basic|bearer>
--management-username <username>
--management-password <password>
--management-key <enterprise-key>
--skip-omp
--skip-test
--yes
```

### Verify

```bash
pifrost global status
```

A healthy OSS setup includes:

```text
Inference connection:   OK (... models)
Management auth:        basic (OSS admin credentials)
Admin username:         set
Admin password:         set
Management connection:  OK
```

---

## OMP configuration

Apply the recommended OMP settings with:

```bash
pifrost global configure-omp
```

Pifrost uses OMP's schema-aware CLI and backs up the previous global config. This remains the bootstrap/recovery path. Inside an interactive OMP session, Pifrost now uses OMP's native `cfg://` protocol so reads show the **effective value and provenance** and writes retain OMP's normal approval flow.

The effective settings are equivalent to:

```yaml
modelProviderOrder:
  - bifrost

enabledModels:
  - bifrost/*

modelRoles:
  default: bifrost/omp-default
  smol: bifrost/omp-smol
  task: bifrost/omp-task
  advisor: bifrost/omp-advisor
  slow: bifrost/omp-slow
  plan: bifrost/omp-plan
  designer: bifrost/omp-designer
  vision: bifrost/omp-vision
  commit: bifrost/omp-commit
  tiny: bifrost/omp-tiny

retry:
  modelFallback: false

task:
  enableEffort: true
  enableLsp: true
```

`retry.modelFallback` should remain `false` when Bifrost owns provider/model fallback.

### Interactive `cfg://` integration

Within the top-level OMP TUI:

```text
/pifrost config
/pifrost config status
```

shows the Pifrost-owned settings with their current OMP provenance, such as `global config`, `project config`, `environment variable`, or `session override`.

Apply the recommended Pifrost profile as **session-only overrides**:

```text
/pifrost config apply
```

OMP's own `cfg://` approval host authorizes each change. After an approved session change, Pifrost offers to persist the same profile; persistent writes still go through a second OMP approval step.

Apply directly to the global OMP config (still approval-gated by OMP):

```text
/pifrost config apply save
```

Individual Pifrost-owned settings can be changed with JSON values:

```text
/pifrost config set retry.modelFallback false
/pifrost config set modelRoles {"advisor":"bifrost/omp-advisor"}
/pifrost config save task.enableLsp true
```

The bridge is intentionally limited to Pifrost-owned settings. For other OMP settings, use the canonical `cfg://` surface directly. Pifrost refuses cfg writes from subagents and headless/RPC sessions, and refuses to operate if the active OMP settings cwd does not match the command session.

`/pifrost doctor` also includes this effective-value/provenance view when run from the interactive top-level OMP session.

---

## OMP agent attribution

Pifrost uses OMP 18.3.2's `ctx.agent` identity strictly for observability. It does **not** use agent name, depth or parentage to select a model or alter Bifrost routing.

The extension binds the OMP session id already used for `x-bf-session-id` to:

```text
kind:     main | sub
id:       Main | 0-Explore | 1-Task | ...
name:     main | explore | task | advisor | ...
depth:    task nesting depth
parentId: spawning agent id, when present
```

Each Pifrost inference records the logical route requested by OMP. `/pifrost doctor` therefore includes process-local attribution such as:

```text
OMP agent attribution:
  current: main [main] id=Main depth=0
  current routes: omp-default=12
  active sessions: 3
  process usage:
    task [sub] -> omp-task: 74 request(s)
    main [main] -> omp-default: 31 request(s)
    advisor [sub] -> omp-advisor: 18 request(s)
```

Attribution is in-memory only. Active session bindings are capped and are removed on OMP `session_shutdown`; aggregate counters survive only for the lifetime of the OMP process. If an inference races ahead of `session_start`, Pifrost temporarily holds the request under the session id and backfills it when `ctx.agent` becomes available.

No extra provider/model routing policy, retry policy or fallback policy is inferred from agent identity.

---

## Routing aliases

### List live routes

```bash
pifrost routes list
```

### Diagnose Bifrost routing discovery

```bash
pifrost global status
pifrost routes list
```

Pifrost's routing reader probes the canonical `/api/routing/rules` surface and falls back to the compatibility `/api/governance/routing-rules` surface where required. `global status` reports the discovered 2.x routing features and `routes list` shows the effective `omp-*` routes.

### Compare live routes with the local manifest

```bash
pifrost routes diff
```

Exit status:

```text
0 = in sync
2 = differences found
1 = operational/configuration error
```

### Synchronize

```bash
pifrost routes sync
```

This:

1. reads the live enabled Bifrost routing rules;
2. derives the `omp-*` chains;
3. backs up the old manifest;
4. writes `~/.omp/agent/pifrost.aliases.json`; and
5. refreshes the model catalog.

Skip the final model refresh when required:

```bash
pifrost routes sync --no-refresh
```

Pifrost does not modify the Bifrost routing rules themselves.

### Bifrost 2.x routing semantics

Bifrost 2.x routing is richer than a single ordered fallback list. Rules can be scoped to global, customer, team, Virtual Key or user traffic; contain weighted targets; use priority; reference the complexity analyzer; and opt into `chain_rule` re-evaluation.

Pifrost keeps Bifrost as the runtime routing authority. For OMP metadata it computes a **conservative reachability envelope**:

- multiple enabled rules for the same `omp-*` logical model are unioned rather than allowing the last rule to overwrite earlier scopes;
- weighted targets and fallbacks are all included because any of them can serve the request;
- a chained alias includes a conservative downstream routing closure;
- OMP then receives the minimum safe context/output and the intersection of portable image/reasoning/tool capabilities across that envelope.

This may deliberately under-advertise a highly scoped route. It must never over-advertise a capability that a valid Bifrost 2.x fallback cannot satisfy.

Bifrost persists session-aware routing/complexity decisions and provider/key affinity from `x-bf-session-id`. Pifrost's custom OMP transport receives `rawOptions.sessionId` for each inference request and projects it into that header at request time. The header is therefore isolated per request rather than stored on the shared provider registration, avoiding cross-session races while enabling Bifrost's session behavior automatically for Pifrost inference traffic. Pifrost also detects and reports session-enabled complexity configuration.

For successful and failed inference attempts, Pifrost also consumes Bifrost's routed-identity response headers. `/pifrost trace` reports the recent actual provider/model, Pifrost protocol attempt, Bifrost fallback state/index, request type and upstream latency for the active OMP session; `/pifrost doctor` includes the latest five rows. Bifrost 2.2.6 provides the routed-identity headers. When a newer Bifrost release exposes `x-bifrost-request-id` and `x-bifrost-trace-id`, Pifrost captures those correlation identifiers without requiring a Pifrost release.

Pifrost deliberately keeps OMP Responses `previous_response_id` chaining disabled through Bifrost, including apparently single-member routes. OMP itself defaults stateful chaining off for third-party Responses proxies, and Pifrost cannot prove that a Bifrost route will retain the same provider, key and server-side response store across future turns. Full-context replay therefore remains the safe compatibility mode.

`pifrost global status` / `pifrost doctor` also report the number of enabled rules, scopes, weighted/chained rules and complexity-based rules, plus whether the complexity-analyzer configuration surface is available.

---

## Time-of-day pricing diagnostics

Pifrost preserves Bifrost's released time-of-day pricing fields from the pricing datasheet:

```text
off_peak_cost_multiplier
peak_hours.timezone
peak_hours.windows[].days/start/end
```

Base token rates remain the peak rates, exactly as Bifrost defines them. Pifrost evaluates the current band only for diagnostics; it does **not** rewrite route order, choose a cheaper provider, or change the price metadata OMP uses for the logical alias.

`/pifrost doctor` shows pricing per reachable route member instead of inventing one effective price for a heterogeneous `omp-*` alias:

```text
resolved deepseek/deepseek-v4-flash -> deepseek/deepseek-v4-flash
  pricing band=off-peak source=bifrost-datasheet:deepseek/deepseek-v4-flash multiplier=0.5x
  schedule=Mon-Fri 01:00-04:00; Mon-Fri 06:00-10:00 UTC
  peak(input/output)=$0.44/$1.32 per 1M current(input/output)=$0.22/$0.66 per 1M
```

The evaluator mirrors Bifrost's semantics: Go weekday numbering (Sunday=0), IANA timezones, half-open `[start,end)` windows, midnight wrapping, `24:00` as an end-of-day marker, and fail-closed peak pricing for malformed schedules. The displayed band is evaluated when the doctor report is rendered, so a cached catalog does not freeze an old peak/off-peak state.

The public datasheet identifies catalogue pricing. Scoped custom-pricing overrides remain Bifrost-owned and may change the final billed rate.

At inference time, Bifrost 2.2.x may return its authoritative nested request-cost breakdown in `usage.cost`, including `total_cost`. Pifrost captures that total while streaming the response, preserves the original nested breakdown on the compatibility payload as `pifrost_bifrost_cost`, and applies the authoritative total to OMP's parsed usage event. This post-parse step is required because OMP only trusts scalar provider-reported cost automatically for selected native gateway providers, not the logical `bifrost` provider. The translation is opportunistic: when Bifrost does not emit a nested cost object, OMP's normal catalogue estimate remains unchanged. Pifrost does not recalculate Bifrost's service-tier, long-context, cache, custom-price or ancillary-cost rules itself.

---

## Model metadata and startup cache

The non-secret last-known-good catalog is stored at:

```text
~/.omp/agent/pifrost.catalog.json
```

Its identity is bound to:

- normalized Bifrost URL
- a one-way fingerprint of the global inference VK
- a fingerprint of the alias manifest

Changing one of those invalidates the cache. Resolver/schema upgrades can also invalidate older cache formats so stale capability assumptions are not carried across releases.

### Why it exists

Without a synchronous local catalog, OMP can start before network-backed Bifrost discovery finishes and initially show `no-model`. The local catalog allows aliases to register immediately at startup.

### Refresh

```bash
pifrost models refresh --force
```

Equivalent low-level form:

```bash
PIFROST_FORCE_REFRESH=1 omp models refresh
```

### Diagnose

```bash
pifrost models doctor
```

The report includes context, maximum output, effective thinking levels, image support, and thinking origin. Route diagnostics also show how each member was resolved and the per-capability source (`live`, `bifrost-datasheet`, `canonical-family`, `vendor-override`, or `fallback`) so an unresolved route can explain what evidence was missing.

### Bifrost 2.x usage and governance in OMP

Pifrost registers OMP's native usage provider against Bifrost's self-service:

```text
GET /api/governance/virtual-keys/quota
```

The request is authenticated with the configured global Virtual Key; admin credentials are not passed into the OMP extension. Where configured in Bifrost, OMP can display:

- Virtual Key budget consumption;
- token and request rate-limit windows;
- provider-scoped budget/rate limits; and
- model-scoped budget/rate limits.

Bifrost 2.2.3+ also returns structured governance provenance for externally managed quota rows. Pifrost preserves the returned `source_type`, `source_id` and `source_name` in the OMP usage report's `metadata.governanceSources` map and adds a human-readable per-limit note. Direct Virtual Key, provider-config and model-config limits are tagged separately rather than being presented as inherited governance. External limits with the same budget/rate-limit ID remain distinct by source instead of being accidentally deduplicated.

`pifrost global status` / `pifrost doctor` now list the observed governance sources, for example:

```text
Governance sources:
  Access Profile "Engineering" [ap-eng]
  Direct provider config: deepseek
  Direct model config: deepseek/deepseek-v4-pro
```

This is read-only. Pifrost does not change Bifrost budgets, access profiles, provider/model allow-lists or rate limits.

---

## Upstream compatibility doctor

`pifrost doctor` includes a live upstream feature matrix. Version checks establish the minimum contract; non-mutating API probes then verify the live path where Bifrost exposes a discoverable endpoint.

```text
Upstream compatibility
OMP version:             18.8.4 (minimum 18.4.5; validated through 18.8.4)
  [OK] Pifrost OMP baseline >=18.4.5 — available in OMP 18.8.5
  [OK] MCP instructions:false >=18.3.1 — available in OMP 18.8.5
  [OK] cfg:// protocol >=18.3.1 — available in OMP 18.8.5
  [OK] OMP 18.4 model capability metadata >=18.4.5 — available in OMP 18.8.5
  [OK] OMP model presets >=18.4.5 — available in OMP 18.8.5
Bifrost version:         2.2.6 (minimum 2.2.4; validated through 2.2.6)
  [OK] Virtual MCPs >=2.2.0 — live API contract verified
  [OK] Bifrost Skills >=2.2.0 — live Skills API contract verified
  [OK] Session affinity >=2.2.2 — version contract satisfied; inference path reachable
  [OK] Pinned routing fallbacks >=2.2.3 — version contract satisfied; routing API verified
  [OK] Quota SourceRef provenance >=2.2.3 — live quota contract verified
  [OK] Code Mode execution allow-list enforcement >=2.2.5 — available in Bifrost 2.2.6
  [OK] First-run setup/auth posture >=2.2.6 — setup complete; inference auth enforced
  [OK] Chat→Responses compatibility adapter >=2.2.6 — convert_chat_to_responses=enabled
  [OK] Routed-identity response headers >=2.2.6 — available in Bifrost 2.2.6
  [OK] Deferred Tool Search >=2.2.4 — available in Bifrost 2.2.6
  [OK] Between-tools thinking >=2.2.4 — available in Bifrost 2.2.6
  [OK] Service-tier capability metadata >=2.2.4 — available in Bifrost 2.2.6
Compatibility summary:  OK
```

The four states are **OK**, **UNAVAILABLE** (installed version predates the feature), **INACCESSIBLE** (credentials/configuration/live path prevent verification), and **DRIFT** (the version should support the feature but the live contract shape is incompatible).

Bifrost 2.2.6 first-run state is read from the public `/api/session/is-auth-enabled` response. If `setup_required` is true, Pifrost stops setup with an explicit instruction to complete Bifrost's setup-token/dashboard flow; Pifrost does not request, generate, store or forward the setup token. The same probe reports whether inference authentication is enforced.

Gateway compatibility diagnostics read the released `client_config.compat.convert_chat_to_responses` setting. The newer `force_reasoning_only_models_to_responses` capability is tracked only by the Bifrost-dev canary until it is released; Pifrost does not assume that unreleased behavior.

Release CI validates both the minimum supported OMP loader and the current validated OMP release. A separate scheduled canary checks the same current-contract surfaces against OMP `main`, so upstream image-tokenisation, provider-cost, preset or related compatibility drift is detected without making unreleased upstream code a release dependency.

Session affinity has no read-only discovery endpoint, so its check combines the Bifrost >=2.2.2 contract with a live inference-path probe. Pinned fallbacks similarly combine the >=2.2.3 contract with the routing API and validate object fallback shape when such fallbacks are present. The doctor never creates, edits or deletes Bifrost configuration.

---

## Bifrost Skills → OMP Skills bridge

Bifrost 2.2.x can store and serve Agent Skills. Pifrost can opt individual Bifrost skills into a repository and materialize them in OMP's native project skill location:

```text
<repo>/.agents/skills/<skill-name>/SKILL.md
```

No separate skill runtime is introduced. Once installed, OMP discovers the skill through its normal project-level `.agent/.agents` Skills provider.

List what Bifrost currently publishes:

```bash
pifrost repo skills list
```

Install one skill into the current repository:

```bash
pifrost repo skills add release-notes
```

Refresh one or all configured skills to the versions Bifrost is currently serving:

```bash
pifrost repo skills sync release-notes
pifrost repo skills sync
```

Remove a Pifrost-managed copy:

```bash
pifrost repo skills remove release-notes
```

Pifrost stores the selected **skill name** as the portable identity, with the observed Bifrost id/version recorded as provenance. Every installed directory contains a separate `.pifrost-bifrost-skill.json` ownership marker. Updates are staged and swapped atomically; removal refuses to delete a directory that does not carry a valid Pifrost marker.

Before installation Pifrost checks common OMP project/user skill locations, OMP Skillshare manifests, and skills shipped by installed OMP npm/link plugins for an existing skill with the same name. A collision fails closed instead of silently overriding or shadowing the authored or packaged skill.

Bifrost's `allowed_tools` field is deliberately not bridged in this release. OMP 18.3 loads arbitrary skill frontmatter but does not enforce Bifrost's per-skill tool allow-list as an execution policy. A Bifrost skill with non-empty `allowed_tools` is therefore marked **incompatible** and installation is refused rather than weakening its policy.

Attached Bifrost skill files are fetched through Bifrost's released generic serving endpoint. Paths are revalidated locally; absolute paths, traversal components and malformed relative paths are rejected before anything is written.

Skills remain independent from MCP governance: adding a skill never grants an MCP client, Virtual MCP, tool, provider key, route or model. `pifrost repo status` and `pifrost doctor` show the Bifrost source, installed/upstream versions, missing/collision state, upstream id and compatibility result.

---

## Repository-specific MCP

Each repository gets its own Bifrost MCP Virtual Key. Access can come from direct MCP client/tool grants, named Bifrost Virtual MCP bundles, or both. Pifrost stores Virtual MCP **names** in local state for portability and resolves those names to Bifrost's numeric Virtual MCP IDs only when it attaches/detaches the repo VK.

### List available Bifrost MCP clients

From any configured repo:

```bash
pifrost repo mcp list
```

Example:

```text
n8n      state=connected  tools=34
railway  state=connected  tools=30
```

On Bifrost 2.x, Pifrost also surfaces MCP-client-global capabilities such as connection/auth type, per-user OAuth/headers or token exchange, Code Mode, Agent Mode auto-execute tools, endpoint slug and session stickiness. Repository Virtual Keys continue to control only **which MCP clients/tools the repository may execute**. Pifrost deliberately does not rewrite an MCP client's global auth, Code Mode or Agent Mode configuration when assigning it to a repo.

Pifrost 0.7 also reports the effective MCP instruction path: per-client upstream instructions and byte caps where Bifrost exposes them, plus Virtual MCP `instructions` and `instructions_mode`. For web research, Pifrost treats Hound as a Bifrost-hosted MCP backend rather than a logical model. If the effective repository policy exposes Hound's canonical MCP tools, `pifrost repo status` reports search/fetch/crawl/screenshot/cache/version visibility and any missing tools. OMP's own `web_search` role remains separately owned by OMP.

### Interactive initialization

```bash
cd /path/to/repo
pifrost repo init
```

Pifrost:

1. identifies the Git root and sanitized `origin` identity;
2. creates a stable local repo ID;
3. lists the current Bifrost MCP clients;
4. asks which clients/tools should be exposed;
5. creates or updates `omp-<repo>-mcp` in Bifrost;
6. stores the raw repo VK only in `~/.config/pifrost/secrets.json`;
7. writes/merges `<repo>/.omp/mcp.json`; and
8. tests Bifrost `/mcp` with the repo key.

### Non-interactive initialization

One direct client with all its exposed tools:

```bash
pifrost repo init --clients railway --tools '*'
```

Multiple direct clients:

```bash
pifrost repo init --clients n8n,railway --tools '*'
```

Virtual MCP bundles can be assigned without duplicating their underlying client/tool lists:

```bash
pifrost repo init --virtual-mcps 'Development Tools,Infrastructure'
```

Direct grants and Virtual MCPs can be combined:

```bash
pifrost repo init --clients railway --tools get-logs --virtual-mcps 'Development Tools'
```

When `--virtual-mcps` is supplied without `--clients`, an existing repo's direct MCP grants are preserved. On a new repo this creates an MCP-only VK with no direct client grants. Supplying `--virtual-mcps=` explicitly removes all direct Virtual MCP attachments while leaving direct MCP grants unchanged.

### Generated repo config

Pifrost does not put the raw VK in the repository. It generates command indirection:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "bifrost": {
      "type": "http",
      "url": "http://bifrost.lan:8180/mcp",
      "timeout": 120000,
      "headers": {
        "x-bf-vk": "!pifrost secret repo-mcp --id myrepo-a1b2c3d4e5"
      }
    }
  }
}
```

OMP executes the local `!pifrost secret ...` command and uses stdout as the MCP header value.

### MCP server instructions

OMP 18.3.2 can keep an MCP server's tools active while omitting that server's `initialize.instructions` text from the system prompt. Pifrost exposes this only for its generated `bifrost` server entry; unrelated MCP servers in the same `.omp/mcp.json` are left unchanged.

To opt out during repo initialization:

```bash
pifrost repo init --clients railway --no-mcp-instructions
```

For an existing repo:

```bash
pifrost repo mcp instructions off
```

Re-enable explicitly, or return to OMP's default behavior:

```bash
pifrost repo mcp instructions on
pifrost repo mcp instructions default
```

The generated entry then contains `"instructions": false`. This does **not** disable Bifrost MCP tools, change the repo Virtual Key, or alter Bifrost's MCP permissions; it only controls whether OMP injects Bifrost's server-provided instructions into prompts. Existing repos remain unchanged unless the flag or command is used.

### Status

```bash
pifrost repo status
```

A healthy repo reports:

```text
Virtual Key id:   <uuid>
Virtual Key name: omp-<repo>-mcp
Repo secret:      set
MCP instructions: disabled
MCP initialize:   HTTP 200 OK
Direct MCP grants: railway[*]
Virtual MCPs:     Development Tools
Live Virtual MCPs: Development Tools
Effective MCP tools:
  railway[*] via direct+virtual:Development Tools
```

The effective-policy view mirrors Bifrost's union semantics: direct grants and enabled Virtual MCP grants are unioned per client, `*` wins, and an explicitly configured client prevents an `allow_by_default` client policy from reopening tools. Disabled Virtual MCPs and disabled/unresolvable clients are reported but do not appear as effective tools.

### Add a client

```bash
pifrost repo mcp add railway --tools '*'
```

Restrict tools when appropriate:

```bash
pifrost repo mcp add railway --tools list-projects,list-services,get-logs
```

### Remove a client

```bash
pifrost repo mcp remove railway
```

### Manage Virtual MCP bundles

List Virtual MCPs and see which are attached to the current repo VK:

```bash
pifrost repo vmcp list
```

Attach or detach a named bundle:

```bash
pifrost repo vmcp add 'Development Tools'
pifrost repo vmcp remove 'Development Tools'
```

The repo continues to connect to Bifrost's plain `/mcp` endpoint. That endpoint exposes the whole-key union of direct grants plus all attached Virtual MCP bundles; Pifrost does not need to create a separate OMP MCP server entry per bundle.

### Rotate the repo VK

```bash
pifrost repo rotate-key
```

Rotation is explicit. Pifrost does not silently rotate an existing key just because its raw value is unavailable locally.

---

## Repository reset and cleanup

Since Pifrost 0.2.5, both a **local-only reset** and a **full reset including the Bifrost Virtual Key** are supported.

### Local-only reset

```bash
pifrost repo reset
```

This is backward-compatible behavior. It:

- removes any Pifrost-owned bridged Bifrost Skill directories from `<repo>/.agents/skills/`;
- removes the Pifrost repo association from the local config/secret store; and
- removes only the generated `bifrost` entry from `<repo>/.omp/mcp.json`.

It refuses to delete a colliding/non-Pifrost-owned skill directory and deliberately leaves the Bifrost Virtual Key intact.

### Full reset including the remote Bifrost VK

```bash
pifrost repo reset --delete-remote
```

Pifrost displays the exact stored VK name/id and requires:

```text
Type DELETE to permanently remove this Virtual Key:
```

Only after remote deletion succeeds does Pifrost remove local state.

This ordering is deliberate: a management/API failure cannot silently remove the local association and orphan the remote key again.

### Non-interactive full reset

For deliberate automation:

```bash
pifrost repo reset --delete-remote --yes
```

`--yes` bypasses the interactive `DELETE` prompt. It should be treated as a destructive flag.

### Recovery when local state was already removed

If an older/manual cleanup removed the local repo association before deleting the remote Pifrost VK, the normal full reset cannot know the remote id. Pifrost will refuse to guess:

```text
Current repo has no stored Bifrost Virtual Key id
```

Use the explicit recovery mode:

```bash
pifrost repo reset --delete-remote --recover-by-name
```

or, for scripted cleanup:

```bash
pifrost repo reset --delete-remote --recover-by-name --yes
```

Recovery is intentionally narrow:

- it calculates the canonical key name `omp-<repo>-mcp`;
- it accepts only an **exact** name match;
- it does not delete fuzzy/near matches such as `omp-<repo>-mcp-old`;
- it refuses deletion when duplicate exact names make the target ambiguous; and
- if the exact key is already absent, that is treated as the desired remote end-state and local cleanup can proceed.

### HTTP 404 behavior

If Bifrost returns `404 Virtual key not found` during a stored-id reset, Pifrost treats that as idempotent success: the remote key is already absent, so local cleanup continues.

### Other management errors

For authentication, transport, server, or validation failures, Pifrost stops and leaves the local repo state/config untouched.

---

## Credential and security model

Pifrost separates four credential classes.

### Inference API/Bearer key

Used by the OMP provider:

```text
Authorization: Bearer <inference API key>
```

### Global inference Virtual Key

Used for Bifrost inference governance:

```text
x-bf-vk: <global inference VK>
```

### Management authentication

Bifrost OSS:

```text
Authorization: Basic base64(admin_username:admin_password)
```

Bifrost Enterprise:

```text
Authorization: Bearer <scoped management API key>
```

Management credentials are standalone-CLI-only and are not exposed to the OMP provider runtime.

### Repository MCP Virtual Keys

Each repo gets a separate key such as:

```text
omp-homelab-mcp
omp-dockeddeals-mcp
```

Repo keys are created with MCP assignments and no broad provider configuration.

### Local storage permissions

Pifrost writes:

```text
~/.config/pifrost/config.json
~/.config/pifrost/secrets.json
```

with mode `0600` and creates the configuration directory privately.

`0600` is filesystem access control, not encryption at rest.

---

## CLI reference

| Command | Purpose |
| --- | --- |
| `pifrost init` | Guided first-time setup and OMP extension install/update |
| `pifrost global setup` | Configure inference and management credentials |
| `pifrost global status` | Validate global config and connectivity |
| `pifrost global configure-omp` | Apply recommended OMP provider/model-role settings |
| `pifrost routes list` | Show live Bifrost `omp-*` routes |
| `pifrost routes diff` | Compare live routes with the local alias manifest |
| `pifrost routes sync` | Rebuild the local alias manifest and refresh models |
| `pifrost models refresh --force` | Perform live model/datasheet discovery |
| `pifrost models doctor` | Inspect effective cached model capabilities |
| `pifrost repo init` | Create/update repo-specific MCP governance and config |
| `pifrost repo status` | Validate the current repo MCP integration |
| `pifrost repo mcp list` | List Bifrost MCP clients/tools |
| `pifrost repo mcp add <client>` | Add an MCP client/tool allow-list to the repo VK |
| `pifrost repo mcp remove <client>` | Remove an MCP client from the repo VK |
| `pifrost repo mcp instructions <on\|off\|default>` | Control OMP injection of Bifrost MCP server instructions for this repo |
| `pifrost repo vmcp list` | List Bifrost Virtual MCP bundles and current-repo assignment |
| `pifrost repo vmcp add <name>` | Attach a named Virtual MCP bundle to the repo VK |
| `pifrost repo vmcp remove <name>` | Detach a named Virtual MCP bundle from the repo VK |
| `pifrost repo skills list` | List Bifrost Skills and current repo install/compatibility state |
| `pifrost repo skills add <name>` | Install one compatible Bifrost Skill into OMP's project skill path |
| `pifrost repo skills remove <name>` | Remove one Pifrost-owned bridged skill from the repo |
| `pifrost repo skills sync [name]` | Refresh one/all configured Bifrost Skills to the currently served versions |
| `pifrost repo rotate-key` | Explicitly rotate the repo MCP VK |
| `pifrost repo reset` | Remove local repo integration only |
| `pifrost repo reset --delete-remote` | Delete the stored remote repo VK, then local integration |
| `pifrost repo reset --delete-remote --recover-by-name` | Recover an orphaned canonical repo VK by exact name, then delete it |
| `pifrost doctor` | Run global, model, current-repo, and routing diagnostics |
| `pifrost secret repo-mcp --id <id>` | Internal repo-key resolver used by OMP MCP headers |
| `pifrost --version` | Show installed Pifrost version |

### Repo-reset flags

```text
--delete-remote   delete the Bifrost repo VK before local cleanup
--recover-by-name explicitly recover an orphaned canonical repo VK by exact name
--yes             bypass destructive confirmation (automation only)
```

`--recover-by-name` is valid only with `--delete-remote`.

---

## Configuration files

### Pifrost global files

```text
~/.config/pifrost/config.json
~/.config/pifrost/secrets.json
```

### Alias manifest

```text
~/.omp/agent/pifrost.aliases.json
```

### Startup catalog

```text
~/.omp/agent/pifrost.catalog.json
```

The startup catalog is non-secret.

### Repository MCP config

```text
<repo>/.omp/mcp.json
```

The generated Pifrost Bifrost entry contains command indirection rather than the raw repo VK.

### Inference precedence

```text
OMP CLI flag
  -> environment variable
  -> ~/.config/pifrost store
```

Relevant inference environment variables:

```text
BIFROST_URL
BIFROST_API_KEY
BIFROST_VIRTUAL_KEY
PIFROST_ALIASES
PIFROST_CONFIG_DIR
```

### Management precedence

```text
explicit global-setup flags
  -> management environment variables
  -> ~/.config/pifrost store
```

Management environment variables:

```text
BIFROST_MANAGEMENT_AUTH_MODE=basic|bearer
BIFROST_ADMIN_USERNAME
BIFROST_ADMIN_PASSWORD
BIFROST_MANAGEMENT_API_KEY
```

---

## OpenRouter through Bifrost

Pifrost treats OpenRouter as a Bifrost-owned upstream, not as a second client-side transport. Route members such as `openrouter/vendor/model` therefore remain ordinary Bifrost targets while Pifrost advertises a conservative OMP capability envelope.

Because Pifrost actually runs inside OMP/pi, it also forwards the originating harness attribution through Bifrost using `x-bf-eh-http-referer: https://pi.dev/` and `x-bf-eh-x-title: pi`. Bifrost strips the escape prefix and OpenRouter receives `HTTP-Referer` / `X-Title`. This is required by OpenRouter free endpoints that gate access to recognised agentic harnesses, such as `thinkingmachines/inkling:free`. Pifrost keeps its own versioned `User-Agent`; it does not spoof a pi user agent. If Bifrost is configured with a dynamic-header allowlist, both escaped attribution headers must be permitted.

Pifrost adds provider-qualified OpenRouter catalog fallback, explicit handling for OpenRouter routing variants (`:nitro`, `:floor`, `:online`, `:exacto`, `:extended`), and tool/reasoning compatibility projection from Bifrost's model-parameters datasheet. Routing variants may inherit the base model's capability metadata; billing/entitlement variants such as `:free` deliberately may not. A free route must have its own live or datasheet limits so Pifrost never silently borrows a paid SKU's larger context/output envelope.

Bifrost remains responsible for provider credentials, provider selection/fallback, request translation and provider-specific parameter dropping. Pifrost does not inject an OpenRouter API key or emulate OpenRouter routing client-side.

## Dynamic context-aware Bifrost routes

Pifrost removes the weakest-context-member ceiling for simple Bifrost logical routes. After `pifrost routes sync`, aliases backed by one global, terminal, unweighted routing rule are marked `context-aware`. Pifrost advertises the largest context window available anywhere in that route while keeping the route-wide safe minimum output ceiling.

At request time Pifrost estimates prompt demand with a conservative safety allowance, reserves the requested output budget, and prewalks the synced physical route chain. Eligibility covers context/output capacity, image input, tools/tool-choice, reasoning-with-tools and **wire protocol support**. Pifrost then partitions the eligible route into contiguous protocol groups without changing route order.

Pifrost natively executes two OpenAI-family wire transports: `openai-responses` and `openai-completions`. Each group is dispatched through OMP's own native transport for that protocol. Adjacent members that share a protocol stay together and are supplied to Bifrost using its native top-level `fallbacks` array, so Bifrost remains responsible for credentials, governance, accounting, provider retries and same-protocol failover. If an entire group fails before producing model output, Pifrost advances to the next protocol group. The initial stream-start envelope is buffered during this decision. Once any real text, thinking or tool output is emitted, cross-protocol replay is forbidden to avoid duplicate or contradictory assistant output.

The original logical role remains the OMP-facing model identity. Pifrost records the selected physical member as the upstream model and sends route diagnostics such as `x-pifrost-logical-model`, `x-pifrost-route-protocol`, `x-pifrost-route-attempt` and `x-pifrost-route-primary` to Bifrost.

Protocol is provider-qualified. Pifrost can therefore treat `opencode-go/muse-spark-1.3-contributor` as OpenAI Responses-only while independently treating a similarly named model on another provider according to that provider's transport contract. Protocol provenance is resolved in this order: authoritative live Bifrost `supported_methods`; OMP's compiled provider `api-routes` policy (`apiRouteFor`), which is provider-qualified and covers gateway-only ids absent from the static bundle; Bifrost model-parameter `supported_endpoints`; provider-qualified bundled catalog metadata; then narrowly scoped verified hints. Provider-specific route policy intentionally outranks generic family datasheet matches so a Chat-capable sibling provider cannot make a Responses-only OpenCode Go route appear Chat-compatible. Unknown protocol metadata retains the historical Chat-compatible default unless another established capability excludes it.

For example, `Responses Muse 1M -> Chat CommandCode 1M -> Chat DeepSeek 1.048M` becomes two attempts: Muse first through Bifrost `/v1/responses`, followed only on a pre-output failure by one Chat attempt whose Bifrost fallback chain is CommandCode then DeepSeek. For OpenCode Go, Pifrost presents the bare upstream model identity to OMP's provider-policy resolver while retaining the full `opencode-go/...` reference as `requestModelId` for Bifrost. This preserves OMP's OpenCode-specific Responses replay/tool/reasoning semantics without bypassing Bifrost. Prewalk remains active for eligible `context-aware` routes even when all members have equal context windows, because protocol/tool/image compatibility can still differ.

Request-time context sizing on the native OMP path follows OMP's semantic token-accounting model rather than `JSON.stringify()` size. Pifrost computes a separate semantic prompt estimate for each physical route candidate. When OMP's policy resolves a tokenizer family, text fragments use the matching explicitly packaged `pi-natives` tokenizer; unknown families fall back to the local byte estimator with a 10% disagreement margin. Image blocks use OMP-aligned model/dimension-aware image-token rules. A trustworthy provider usage report can anchor the established prefix only when its recorded physical upstream model matches the candidate being evaluated; cross-provider/fallback usage is not reused. Without a valid anchor, Pifrost counts system prompt text, active/inactive tool schemas and semantic message content. OMP-internal metadata such as timestamps, usage objects, routing/provider payloads and tool-result `details` is deliberately excluded because it is not model prompt content. The older serialized-body estimator remains only as a fallback for non-native/final-wire paths.

Reasoning-with-tools and reasoning-with-`tool_choice` are distinct compatibility dimensions. Bifrost's `supports_reasoning_with_tool_calls` controls whether reasoning can coexist with an offered tool set. OMP's `disableReasoningOnToolChoice` controls a narrower wire-policy case: reasoning must be suppressed when a `tool_choice` selector is actually serialized. Tool definitions alone do not trigger that selector rule. Pifrost carries both properties independently through enrichment, alias synthesis and runtime prewalk.

OMP normally serializes the model's output ceiling even when the caller did not explicitly request that many tokens. Pifrost preserves OMP's `maxTokensExplicit` intent across its custom transport so diagnostics can distinguish an explicit output request from the implicit model-default ceiling. The serialized ceiling still participates in context safety because it remains the provider-visible maximum for that turn. If every member is excluded, the error includes each member and its concrete exclusion reasons rather than presenting a generic capacity-only message.

Dynamic compilation is deliberately disabled for scope-specific, weighted, chained, complexity, budget, quota, header or parameter-dependent rules because bypassing those logical rules could change Bifrost semantics. It is also disabled whenever a Bifrost routing target or fallback pins a provider key: Pifrost records the pin for diagnostics but leaves execution of the pinned chain entirely to Bifrost rather than flattening it into a client-side string fallback list. Those aliases continue to use the static weakest-member envelope.

Run `pifrost doctor` after syncing to inspect route-member protocol provenance together with `dynamic-context=<static>-><advertised>` and the derived context bands.

## Troubleshooting

### OpenCode Go returns `MissingSessionID`

Pifrost forwards OMP's per-conversation session id to Bifrost as `x-bf-session-id` for Bifrost session affinity and separately as `x-bf-eh-x-opencode-session` for OpenCode Go. It also forwards `pifrost/<version> OMP` with `x-bf-eh-user-agent`. Dynamic OpenCode Go attempts use OMP's native OpenCode provider policy and the correct Chat or Responses transport while retaining Bifrost as the HTTP/authentication hop. If Bifrost has a non-empty client header allowlist, it must permit the dynamic extra-header names; otherwise Bifrost will drop the OpenCode forwarding header before provider dispatch and OpenCode Go will reject the request.

The two session headers deliberately have different consumers: `x-bf-session-id` is consumed by Bifrost itself for routing/provider-key affinity, while the escaped OpenCode header is forwarded to the selected OpenCode Go upstream.


### `pifrost --version` is old

```bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost
pifrost --version
```

### Bifrost OSS management returns 401

Rerun:

```bash
pifrost global setup
```

Choose `basic` and use the active Bifrost dashboard/admin credentials.

### OMP starts with `no-model`

```bash
pifrost global status
pifrost models refresh --force
pifrost models doctor
omp models bifrost
```

Verify `~/.omp/agent/pifrost.catalog.json` exists and contains the aliases.

### Route commands show zero aliases

```bash
pifrost global status
pifrost routes list
```

Pifrost checks the canonical routing endpoint and its compatibility fallback. Use the global routing summary to confirm management access/features, then compare the live route list before running `pifrost routes sync`.

### MCP shows `virtual key required`

The MCP request did not contain a usable VK. A Pifrost-managed repo should contain:

```json
"x-bf-vk": "!pifrost secret repo-mcp --id ..."
```

Check:

```bash
pifrost repo status
```

### MCP shows `virtual key not found`

The request contains a VK but Bifrost no longer recognizes the value. Reinitialize or explicitly rotate:

```bash
pifrost repo init
# or
pifrost repo rotate-key
```

### Repo init finds an old remote key whose raw value is unavailable

Pifrost deliberately does not rotate it silently. If it is an obsolete repo integration and you want a clean recreation, use:

```bash
pifrost repo reset --delete-remote --recover-by-name
pifrost repo init --clients <client> --tools '*'
```

For an intentionally scripted clean recreation:

```bash
pifrost repo reset --delete-remote --recover-by-name --yes
pifrost repo init --clients railway --tools '*'
```

### `repo reset --delete-remote` says no stored VK id

Local Pifrost state was probably removed earlier. If you deliberately want Pifrost to look up the exact canonical key name, add:

```bash
--recover-by-name
```

Pifrost will not use fuzzy matching and will refuse ambiguous duplicates.

### Full reset fails with HTTP 500/401/etc.

Pifrost intentionally leaves local repo state intact when requested remote deletion fails. Fix management connectivity/authentication and rerun the reset.

### OAuth MCP clients

Pifrost manages Bifrost-side VK/tool assignment and OMP configuration. It cannot bypass upstream OAuth consent. OAuth MCP servers can still require a browser authorization and callback flow.

---

## Development

```bash
npm install
npm run check
npm test
node scripts/validate-public-datasheets.mjs
npx tsx scripts/validate-current-routing.ts
```

The control plane is intentionally split by responsibility: `routing-core.ts` owns pure routing semantics, `http-client.mjs` owns bounded/cancellable HTTP transport, and `doctor-probes.mjs` owns the concurrent read-only diagnostic snapshot. The single `cli.mjs` command registry orchestrates those domain services rather than maintaining parallel dispatch or repository implementations.

CI validates:

- TypeScript compilation
- standalone Node CLI syntax
- unit/CLI tests
- public Bifrost datasheet coverage
- current OMP routing envelopes
- loading through the released OMP 18.3.2 CLI/plugin loader
- current Bifrost 2.0/current-2.x routing, governance and MCP contract canaries

Management credentials and raw VK values must never be added to provider runtime configuration, model catalogs, route manifests, diagnostics, or committed test fixtures.

---

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
