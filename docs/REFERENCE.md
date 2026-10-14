# Pifrost technical reference

Current operational contract for the Pifrost OMP provider and Bifrost CLI. Start with the [README](../README.md) for first installation and normal use; consult the [changelog](../CHANGELOG.md) for historical release notes. Command flags, positional arguments and side effects are defined by `cli-command-schema.mjs` and exposed with `pifrost <command> --help`.

Expected for this release:

```text
0.22.2
```

## Architecture and ownership

```text
OhMyPi agent/session & model roles
    -> Pifrost provider: capabilities, transport compatibility, request evidence
    -> Bifrost /v1: routing, provider credentials, quotas, fallback, usage and costs
    -> physical providers

Pifrost terminal CLI -> Bifrost /api: management, route synchronization, MCP grants
OMP project MCP config -> dedicated repo Virtual Key -> Bifrost MCP gateway
```

**Never make Pifrost a second policy router or agent runtime.** Bifrost owns provider/model ordering, key selection, retry governance, gateway logging and execution of MCP tools. OMP owns sessions, history, agent orchestration, compaction and judgment. Pifrost implements only the tested integration boundary: model metadata, semantic token estimates, compatibility preflight, native transport delegation, provenance and configuration.

Prefer a stable upstream contract to copied behaviour. Retain compatibility exceptions only with a reproducible defect or contract gap, a regression test and a revalidation/removal condition. CI fixtures prove protocol handling, not live-provider availability or actual gateway rule hits.

## Requirements

- Node.js **22.19+** and OMP **18.10.4+** for clean GitHub plugin installation.
- Packaged OMP packages and policy snapshot: **18.10.4**. Later OMP hosts may work but require compatibility verification; Pifrost's pinned snapshot does not automatically advance with the host.
- Bifrost **2.2.4+** with Chat Completions; the Responses endpoint is also needed for Responses members. CI exercises pinned Bifrost **2.3.0** contracts and relevant earlier compatibility.
- Global inference Virtual Key able to access the configured physical models, plus separately scoped Bifrost management credentials for synchronization and repository operations.
- Network access for live Bifrost model discovery and optional public datasheets. Some smoke tests explicitly incur provider charges.

## Installation and upgrade

```bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost
pifrost --version
pifrost init                       # first-time interactive setup only
pifrost routes sync               # after Bifrost rule changes / upgrades
pifrost doctor
```

For existing installations, omit `pifrost init` unless reconfiguring. Run `pifrost global setup` to edit inference or management credentials, and `pifrost global configure-omp --dry-run` to preview role updates. Restart OMP after route synchronization, verification or a model-catalog change. Never assume `models refresh` has fetched new routing rules.

The GitHub release is published **only after** main-branch CI passes; the workflow reads the package version and matching dated changelog heading.

## CLI semantics and command groups

`pifrost help` is the concise starting point; `pifrost help --all` enumerates all 46 registered commands and `pifrost <command> --help` describes exact supported options and side effects. The examples below are intentionally not a duplicated flag schema.

| Task | Commands |
| --- | --- |
| Global setup and inspection | `init`, `global setup`, `global status`, `global configure-omp`, `global mcp-policy`, `global observability` |
| Route operations | `routes list`, `routes diff`, `routes verify`, `routes sync`, `routes diagnose`, `routes effective`, `routes explain <role>` |
| Model discovery | `models refresh`, `models doctor`, `models kinds` |
| Judge | `judge status`, `judge activate`, `judge probe` |
| Repository | `repo init`, `repo status`, `repo rotate-key`, `repo reset` |
| MCP grants | `repo mcp list`, `repo mcp add`, `repo mcp remove`, `repo mcp instructions`; `repo vmcp list`, `repo vmcp add`, `repo vmcp remove` |
| Research | `repo research status`, `repo research bind`, `repo research unbind`, `repo research prefer`, `repo research probe` |
| Skills | `repo skills list`, `repo skills suggestions`, `repo skills bind`, `repo skills unbind`, `repo skills dismiss`, `repo skills undismiss`, `repo skills add`, `repo skills remove`, `repo skills sync` |
| Health | `doctor`, `pifrost --version`; internal `secret repo-mcp` is documented separately |

The internal `secret repo-mcp --id <id>` command resolves an MCP credential for OMP and is **not** a user-facing diagnostic. Do not capture or paste its output.

Health commands `doctor`, `global status`, `repo status` and `models doctor` support `--verbose`, redacted `--json` (schemaVersion 1) and `--strict`. Required failures return exit **2**; `--strict` also promotes warnings to failures; invalid syntax exits **1**. Use `--dry-run` only on commands advertising it. Inventory commands accept `--filter` and `--limit` where offered. Never assume an omitted `--tools` grants all tools; wildcard `'*'` must be deliberate.

## OMP configuration and sessions

`pifrost global configure-omp` merges Pifrost's role values into OMP's existing `modelRoles`, without replacing unrelated roles such as `judge`, `web` or `memory`. It preserves other configured enabled namespaces and provider ordering. If OMP configuration cannot be read safely, refuse to replace the unknown collection. In-session `/pifrost config` uses OMP's approved `cfg://` access; writes follow its normal approval rules.

Default aliases are `bifrost/omp-default`, `-smol`, `-task`, `-advisor`, `-slow`, `-plan`, `-designer`, `-vision`, `-commit` and `-tiny`. Create their physical routing rules in Bifrost. Keep OMP `retry.modelFallback: false` when Bifrost owns model fallback. OMP defines `extendedContext`, `compaction.modelThresholds`, effective context windows and session history. Pifrost's optional idle compact-before-skip invokes **OMP** compaction, and can be disabled with `PIFROST_COMPACT_BEFORE_CONTEXT_SKIP=0`.

Each OMP conversation's session ID is sent separately as `x-bf-session-id` to Bifrost and `x-bf-eh-x-opencode-session` for upstream OpenCode Go's `x-opencode-session` requirement. These are per-request forwarding headers, not global provider configuration. Attribution uses OMP agent identity for diagnostics only, never model preference or selection.

## Routing and provenance

For an exact, unconditional `omp-*` rule with all physical members request-compatible on a shared Chat wire contract, Pifrost sends the **logical alias** unchanged to Bifrost. It does not send a duplicated fallback list; Bifrost runs its live rule, selecting keys, models and same-protocol fallbacks. Receiving an alias does **not** prove that a particular CEL rule matched: confirm Bifrost routing metrics or request logs.

For a simple synchronized context-aware route, Pifrost estimates context/output demand and excludes only established incompatibilities (context, images, tools, tool choice, reasoning, service tier and protocol). Compatible members retain their Bifrost order. Mixed Chat Completions and Responses or encoder-incompatible members may require separate contiguous attempts; Pifrost advances only on failures **before** any real text, thinking or tool output. Those compatibility requests address physical models and may not increment logical `omp-*` counters; `/pifrost trace` labels them accordingly.

Context-dependent CEL, weighted, scoped, pinned, chained or ambiguous rules are **gateway-owned**. Only exact unconditional model predicates can be locally compiled into compatibility chains. Conservative reachability metadata covers every potentially selected target.

```bash
pifrost routes list
pifrost routes diff
pifrost routes sync --dry-run
pifrost routes sync
pifrost routes verify             # recheck full live rule fingerprint
pifrost routes effective          # cached OMP role-to-chain view, with timestamp
pifrost routes explain plan --input-tokens 120000 --output-tokens 16000 --tools --reasoning
```

`routes explain` is a **preview**, not an execution test. `routes sync` writes the local manifest and complete policy fingerprint, then refreshes the model catalogue unless disabled. `routes verify` authenticates against the management API and updates verification evidence only for an unchanged full policy. The seven-day physical-compatibility guard fails closed for absent/expired provenance, but **neither** a recent sync nor a local hash proves that Bifrost rules have not since changed. Sync after edits and restart OMP.

## Model capabilities and transport

A logical alias exposes conservative common capability limits (output/context where necessary; images, tools, reasoning, thinking levels, deferred Tool Search, service tiers and safe costs). Simple request-aware routes can expose more context when prewalk establishes that the request fits a particular candidate. Unresolved physical capability limits cannot be invented from permissive defaults.

Capability provenance is field-specific: live Bifrost metadata, published Bifrost datasheets, provider-qualified OMP runtime/catalog policies, narrowly verified exceptions, then conservative fallback. Protocol method support is **provider-qualified**; a similarly named model on another gateway provider need not share OpenAI Chat/Responses serialization or reasoning replay rules. Pifrost uses the packaged OMP policy snapshot and specific tested exceptions when OMP does not expose a public physical-model policy resolver.

Context estimates use OMP-aligned semantic messages, tokenizer families and image-size rules; opaque replay/signature content is retained. Usage anchors apply only to the same confirmed physical model. Avoid speculative cleanup of synthetic DeepSeek reasoning replay or signed/encrypted history; narrowly defined, tested compatibility workarounds may be required for tool continuation.

`pifrost models refresh --force` refreshes cached model facts. `pifrost models doctor --verbose` explains provenance. Catalogue and manifest freshness are separate. Cost and time-of-day pricing observations come from Bifrost metadata; missing monetary totals are **unknown**, not free.

## Observability and troubleshooting

```bash
pifrost doctor
pifrost doctor --verbose
pifrost global status
pifrost global observability
pifrost global observability --vk-id <management-id>
pifrost global mcp-policy
```

Within OMP, `/pifrost doctor` and `/pifrost doctor verbose` show readiness; `/pifrost trace` supports `last N`, `errors`, `role alias` and `verbose`. `/pifrost costs` reports only the bounded session's **gateway-reported subtotal**, with unknown-cost coverage. It is not an invoice.

Traces distinguish logical alias, actual gateway-requested model, confirmed served provider/model, compatibility bypass, fallback, cache-hit, sanitized request IDs and error categories. Unsuccessful upstream attempts without gateway physical-origin evidence remain unverified. A gateway-requested alias alone is **not** proof of a matched rule or a new upstream call.

Observability reports inspect configured complexity classifier, provider-injected research tools and optional Virtual Key content-logging defaults; they do **not** confirm tool execution, actual retention/deletion, compliance or permissions. Gateway/provider failures and `Retry-After` information are diagnostic, not automatic key rotation or custom retry policy.

## Judgment and model kinds

`PIFROST_NATIVE_JUDGE_MODEL=jev-latest` opts in `bifrost-judge/jev-latest` via the Bifrost **TypeSafe** `/typesafe/v1/systemone` contract. The separately exposed `/v1/decisions` endpoint is **not** wire-compatible with OMP's judge API. `pifrost judge status` checks readiness; `judge activate --dry-run` previews the OMP judge-role and enabled-model merge; `judge activate` applies it explicitly. `judge probe` makes a potentially billable request. OMP still owns typed judgment, model choice, scheduling and session usage.

`pifrost models kinds` lists reported Bifrost model kinds without pretending image, audio, embedding, video or other non-chat models are Chat Completions models. Unknown non-chat kinds are not force-registered as chat.

## Repository MCP and Virtual Keys

From a project root:

```bash
pifrost repo init
pifrost repo status
pifrost repo mcp list
pifrost repo mcp add donsetch --tools 'web_search,web_fetch'
pifrost repo mcp remove donsetch
pifrost repo vmcp list
pifrost repo vmcp add 'Development Tools'
pifrost repo mcp instructions off
pifrost repo rotate-key --dry-run
pifrost repo reset --dry-run --delete-remote
```

One project receives one dedicated Bifrost MCP Virtual Key, separate from inference. The CLI configures explicit direct client/tool grants or named Virtual MCP bundles and writes `<repo>/.omp/mcp.json` with a header using `!pifrost secret repo-mcp --id <repo-id>`. The raw key stays in the local Pifrost secret store, not the project JSON. `--tools '*'` grants all current executable tools only when explicitly provided; never treat a grant as proof of live execution or Code Mode availability.

`repo reset` removes Pifrost's local project integration and managed assets without deleting the remote key. `repo reset --delete-remote` removes the exact remote key **before** local state, with destructive confirmation; `--yes` suppresses the prompt only when intentional. `--recover-by-name` with remote deletion attempts tightly scoped orphan recovery. Rotation is always explicit.

Repository instructions may be set to `on`, `off` or `default`. Management/client permission diagnostics are read-only and report unverified status when grants or gateway tools cannot be established.

## Bifrost Skills → OMP Skills bridge

```bash
pifrost repo skills list
pifrost repo skills add <name>
pifrost repo skills sync
pifrost repo skills remove <name>
```

Compatible Bifrost Agent Skills are explicitly installed into `<repo>/.agents/skills/<name>/`. Pifrost owns only skill directories with its marker, stages updates, refuses path traversal/collisions and tracks content hashes to protect local edits. Modified managed files require `--force` on supported changes. Bifrost Skill `allowed_tools` cannot safely be enforced by the packaged OMP Skill loader, so restricted skills are refused rather than silently broadening permissions. Installing a Skill **does not grant MCP permissions**.

## Automatic MCP-to-Skill discovery

Selecting an MCP client or Virtual MCP in `repo init` / `repo mcp add` / `repo vmcp add` can offer an exact-name compatible Skill. Matching is case-insensitive; stable client IDs, explicit per-repo `repo skills bind <client> <skill>` aliases and dismissals handle renames/opt-outs. An interactive offer defaults to **No**. `--yes` does **not** authorize installation; only `--install-matching-skills` or `repo skills add` does. Use `repo skills suggestions` for read-only inspection. MCP grants survive a declined/failed Skill offer; removing a client does not silently delete a previously installed Skill.

## Research providers

DonSeTch and other research backends are separate Bifrost MCP clients; OMP chooses tools, Bifrost executes and governs them, and Pifrost diagnoses bindings and bounded results. `repo research bind` / `prefer` update local identity/guidance only; they do not force a search or configure automatic fallback. A `repo research probe` explicitly performs a read-only sample search that may consume upstream quota. DonSeTch stateful handles require the same upstream instance for subsequent retrieval. See the [research-provider guide](RESEARCH_PROVIDERS.md) for examples, screenshot limits and tested versions.

## Security and configuration

| Identity | Credential / location | Owner |
| --- | --- | --- |
| Global inference | `x-bf-vk` inference Virtual Key; optional `Authorization: Bearer` | OMP provider to Bifrost |
| Administration | OSS Basic username/password or Enterprise scoped management key | **CLI only**, never OMP inference |
| Repository MCP | dedicated project-scoped `x-bf-vk` | OMP MCP gateway config using local resolver |

`~/.config/pifrost/config.json` and `~/.config/pifrost/secrets.json` have private filesystem permissions (`0600`), **not encryption at rest**. Routing manifest: `~/.omp/agent/pifrost.aliases.json`; startup model cache: `~/.omp/agent/pifrost.catalog.json`; MCP config: `<repo>/.omp/mcp.json`. Environment variables include `BIFROST_URL`, `BIFROST_API_KEY`, `BIFROST_VIRTUAL_KEY`, `PIFROST_CONFIG_DIR`, `PIFROST_ALIASES`, `BIFROST_MANAGEMENT_AUTH_MODE`, `BIFROST_ADMIN_USERNAME`, `BIFROST_ADMIN_PASSWORD`, `BIFROST_MANAGEMENT_API_KEY`.

Plain HTTP on a non-loopback address can expose credentials, especially OSS Basic auth. `pifrost doctor` reports **warning-only**; it neither bypasses nor blocks connection. Prefer loopback, private networking or TLS. Never paste a raw Virtual Key or the `secret repo-mcp` resolver output into diagnostics.

## Troubleshooting

### OMP starts with `no-model`

Run `pifrost global status`, `pifrost routes sync`, `pifrost models refresh --force`, `pifrost models doctor` and `omp models bifrost`. Restart OMP after updating profiles.

### OpenCode Go returns `MissingSessionID`

Pifrost forwards `x-bf-session-id` and `x-bf-eh-x-opencode-session` per turn. Check Bifrost forwarding-header allowlists and inspect the request trace without logging the session credential or prompt.

### Bifrost management returns 401

For Bifrost OSS, rerun `pifrost global setup` using management mode `basic` and the current Bifrost dashboard credentials; inference keys are not admin credentials.

### MCP reports `virtual key required` or `virtual key not found`

Check `pifrost repo status`, project `.omp/mcp.json`, repo association and Virtual Key permission. Reinitialize with `pifrost repo init` or rotate explicitly with `pifrost repo rotate-key`; do not reuse the global inference key. Check direct/Virtual MCP grants and actual tool availability separately.

### Route counters show no `omp-*` hits

Use `/pifrost trace verbose` to distinguish `bifrost-native` logical requests from `pifrost-compatibility` physical bypasses. Correlate returned Bifrost request IDs with the **Bifrost route dashboard/logs**. The CLI's `routes explain` output is a preview and not routing proof.

## Development

```bash
npm ci
npm run check
npm test
npm run release:check
npm run smoke:transport       # optional; requires live gateway/model credentials, may incur cost
```

Main-branch CI also checks pinned Bifrost, OMP, DonSeTch and legacy Hound contracts, public datasheets, GitHub installs and compiled OMP host compatibility. Release workflow publishes only from **successful CI on current main SHA** with the matching package/lock/changelog version. The pinned tests and mock Bifrost gateway do not substitute for deployment tests of actual routing counters, quotas or billable model/provider features.

## Attribution

This project is derived from [pi-bifrost-provider](https://github.com/lxdlam/pi-bifrost-provider). See [NOTICE](../NOTICE.md) and [MIT license](../LICENSE). The [changelog](../CHANGELOG.md) records historical compatibility decisions and migration notes.
