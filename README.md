# Pifrost

**Use Maxim Bifrost as the routing, governance and MCP backend for OhMyPi (OMP).**

Pifrost gives OMP a small set of stable logical models such as <code>bifrost/omp-default</code>, <code>bifrost/omp-plan</code> and <code>bifrost/omp-vision</code>. Those aliases point at routes you own in Bifrost, so you can change providers, models and fallbacks without continually reconfiguring OMP.

Pifrost also provides a terminal CLI for setup, route synchronization, diagnostics, repository-scoped MCP access and the optional Bifrost Skills → OMP Skills bridge.

> **Design rule:** Pifrost is not a second policy router. Bifrost remains authoritative for provider credentials, physical model/provider ordering, routing policy, same-protocol fallback and governance. Pifrost may remove members that cannot satisfy the request contract and may cross a wire-protocol boundary only before any model output is emitted; it never reorders surviving members for quality, cost, quota or preference.

> **Upstream-first compatibility principle:** Prefer stable, current, versioned OhMyPi and Bifrost interfaces over permanent Pifrost copies of their runtime behaviour. Pifrost owns only translation, evidence-based compatibility checks and diagnostics at their boundary. Every workaround must have a reproducible upstream defect or contract gap, a regression test, clear ownership and a revalidation/removal condition. Do not add a parallel agent runtime, provider router, session-history writer or MCP executor. Preserve Bifrost's configured provider order and OMP's agent/session ownership.


## Start here

If you already run OMP and Bifrost, the normal setup is:

~~~bash
npm install --global github:alutke/pifrost
hash -r

pifrost init
pifrost doctor
~~~

<code>pifrost init</code> installs/updates the OMP extension, asks for your Bifrost connection details, applies the recommended OMP model-role configuration, synchronizes your <code>omp-*</code> routes and seeds the local model catalogue.

If <code>pifrost doctor</code> is healthy, you are done.

Inside OMP, use <code>/pifrost trace</code> to inspect the most recent request-level routing provenance for the current session, including the model Bifrost actually served and whether a fallback fired.

**Stalled-turn safeguard (v0.29.11):** Pifrost **automatically requests one OMP-owned continuation by default** when a tool-using main turn stops with a high-confidence leaked planning signature. It does not replay completed tools, provider streams, history or Bifrost routes. To turn it off, set `PIFROST_STALLED_TURN_MODE=off` before starting OMP; `notice` retains the manual `/pifrost stalled continue` approval path. Queue, async-work and one-shot safety guards remain in place. [Configuration and limitations](docs/REFERENCE.md#stalled-turn-mode-configuration-v02911).

For current integration details and verification limits, see the [technical reference](docs/REFERENCE.md). For release-specific changes and earlier compatibility decisions, see the [changelog](CHANGELOG.md).

## What Pifrost solves

Without Pifrost, OMP needs to know about the physical models behind your Bifrost setup. That couples the coding agent to provider-specific names and makes route changes awkward.

With Pifrost:

~~~text
OMP role
  │
  │  bifrost/omp-default
  ▼
Pifrost
  │
  │  safe model metadata + request identity
  ▼
Bifrost
  │
  ├─ routing rules
  ├─ provider/key selection
  ├─ fallback
  ├─ budgets / quotas
  └─ MCP governance
       │
       ▼
Physical model providers and MCP servers
~~~

That gives you six useful properties:

- **Stable OMP roles.** OMP uses logical aliases while Bifrost owns the real model chain.
- **Safer capabilities.** Pifrost advertises only capabilities it can establish safely for the route.
- **Session-aware routing.** OMP conversation identity is forwarded to Bifrost for route/provider-key affinity and to OpenCode Go where required.
- **Agentic OpenRouter attribution.** Pifrost forwards the real OMP/pi application identity through Bifrost so OpenRouter endpoints gated to recognised agentic harnesses (including free Inkling) can be used without bypassing Bifrost.
- **Repository-scoped MCP.** Each repository can have its own Bifrost MCP Virtual Key without committing the raw secret.
- **One diagnostic surface.** <code>pifrost doctor</code> checks the OMP, Bifrost, routing, model and current-repository integration together.

## Optional native judgments and non-chat discovery

OMP executes native judgments; Bifrost controls upstream decisions and keys. Pifrost registers an **optional** Bifrost-backed judge, selected before OMP starts. This is separate from ordinary chat routing.

```bash
# Select one native judgment dialect
export PIFROST_NATIVE_JUDGE_MODEL=jev-1.14.0
# Alternatively: export PIFROST_NATIVE_JUDGE_MODEL=openai/gpt-6-luna
pifrost judge status
pifrost judge activate --dry-run
pifrost judge activate
```

Activation updates only `modelRoles.judge`, validates the write and performs guarded recovery on failure. It does **not** modify `enabledModels` because OMP does not apply chat-model scoping to native judgment roles. An available model listing does not prove the judgment endpoint works.

`pifrost judge probe` is billable. Experimental image judgments require `PIFROST_NATIVE_JUDGE_IMAGES=1` and can be tested with `pifrost judge probe --image`. `pifrost models kinds` provides non-chat discovery without treating judges as chat models.

Read the [tested integration support matrix](docs/INTEGRATION_SUPPORT.md) and [judgment reference](docs/REFERENCE.md#release-b--native-multimodal-judgments-v0260) for supported host versions, limitations and deployment-level validation.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | **22.19+** |
| OhMyPi | **18.10.4+** minimum; validated with **18.12.5** |
| Pifrost OMP policy snapshot | **18.12.5**, with versioned model-policy contracts; host integration validated separately |
| Maxim Bifrost | **2.2.4+** |
| Recommended Bifrost | **2.3.2** for requested-route provenance, per-target first-token deadlines, reasoning conversion and injected-tool list schema |

You also need:

- a Bifrost inference Virtual Key that can access the physical models used by your <code>omp-*</code> routes;
- management credentials if you want route synchronization or repository MCP automation; and
- outbound HTTPS access to <code>getbifrost.ai</code> when Pifrost refreshes public model metadata.

### Bifrost OSS vs Enterprise management auth

Pifrost keeps inference and management authentication separate.

- **Bifrost OSS:** use the Bifrost dashboard/admin username and password over HTTP Basic auth.
- **Bifrost Enterprise:** you can use a scoped management Bearer/API key.
- **Fresh Bifrost 2.2.6+ installs:** finish Bifrost's setup-token flow before normal management automation. Pifrost can use `--setup-token` or `BIFROST_SETUP_TOKEN` for an ephemeral bootstrap check, but never writes the setup token to its config or secrets store.

HTTP Basic auth is only encoding. If Bifrost is not local, keep it on a trusted private network or put TLS/HTTPS in front of it. `pifrost doctor` warns when credentials are configured against a non-loopback `http://` endpoint; the warning is advisory only and never blocks setup or requests.

## First-time setup

### 1. Install the CLI

~~~bash
npm install --global github:alutke/pifrost
hash -r
pifrost --version
~~~


### Current release

Expected for this release:

```text
0.29.23
```

Bun also works:

~~~bash
bun add --global github:alutke/pifrost
hash -r
pifrost --version
~~~

### 2. Run the setup wizard

~~~bash
pifrost init
~~~

For Bifrost OSS, the wizard asks for:

~~~text
Bifrost URL
Inference API/Bearer key (optional on Bifrost 2.x)
Global inference Virtual Key
Configure management auth? -> Yes
Management auth mode        -> basic
Bifrost admin username
Bifrost admin password
~~~

A typical self-hosted URL looks like:

~~~text
http://192.168.1.221:8180/v1
~~~

On Bifrost 2.x, an <code>sk-bf-*</code> Virtual Key can authenticate inference directly, so a separate inference Bearer/API key can be left blank when your deployment allows it.

### 3. Verify the installation

~~~bash
pifrost doctor
~~~

For narrower checks:

~~~bash
pifrost global status
pifrost global mcp-policy
pifrost routes list
pifrost routes effective
pifrost models doctor
~~~

## Model roles and routing aliases

Pifrost's recommended OMP configuration maps OMP roles to Bifrost aliases; create the physical routes in Bifrost:

| OMP role | Pifrost/Bifrost model |
| --- | --- |
| default | <code>bifrost/omp-default</code> |
| smol | <code>bifrost/omp-smol</code> |
| task | <code>bifrost/omp-task</code> |
| advisor | <code>bifrost/omp-advisor</code> |
| slow | <code>bifrost/omp-slow</code> |
| plan | <code>bifrost/omp-plan</code> |
| designer | <code>bifrost/omp-designer</code> |
| vision | <code>bifrost/omp-vision</code> |
| commit | <code>bifrost/omp-commit</code> |
| tiny | <code>bifrost/omp-tiny</code> |

The alias names describe the OMP role; **Pifrost does not decide which physical model should fulfil that role**. Define and change the corresponding routing rules in Bifrost.

**Configuration safety:** `pifrost global configure-omp` and the approval-aware in-session `/pifrost cfg` profile merge Pifrost roles into the current OMP `modelRoles` mapping. Custom `judge`, `web`, `memory` and future roles survive. Existing enabled-model namespaces and other provider-order entries remain intact. If OMP cannot read an existing collection, Pifrost refuses to overwrite it.

Bifrost can also configure provider-managed MCP web-search injection. Inspect what Bifrost reports, without allowing Pifrost to execute injected tools:

~~~bash
pifrost global mcp-policy
pifrost doctor
~~~

This uses the redacted provider-management endpoint. A missing injection field on an older Bifrost release means *unverified*, not disabled. Client metadata cannot establish effective Virtual Key permissions or prove runtime execution.

`pifrost doctor` also reports OMP's own `extendedContext`, `compaction.modelThresholds` and compaction settings where readable. OMP owns actual tier/threshold selection. The optional Pifrost idle compact-before-skip scheduler can be disabled with `PIFROST_COMPACT_BEFORE_CONTEXT_SKIP=0`; this is separate from OMP's `compaction.enabled` setting.

After changing Bifrost <code>omp-*</code> routes, synchronize Pifrost:

~~~bash
pifrost routes diff
pifrost routes sync
pifrost doctor
~~~

For a role-to-physical-route view from the current Pifrost catalogue snapshot:

~~~bash
pifrost routes effective
~~~

The command prints the catalogue timestamp and age. If the snapshot is stale it warns you to run `pifrost models refresh --force` rather than presenting old Bifrost membership as live state.

To explain why physical members would be eligible or excluded for a hypothetical request:

~~~bash
pifrost routes explain plan --input-tokens 120000 --output-tokens 16000 --tools --reasoning
pifrost routes explain plan --tool-search --service-tier ultrafast
pifrost routes explain plan --tools --reasoning --tool-choice required
~~~

The explanation uses the same shared eligibility engine as runtime prewalk: context/output reserve, image/tool support, tool-choice variants, reasoning-with-tools, Tool Search/Responses transport, between-tools thinking and service-tier availability. Between-tools thinking is advisory rather than a hard exclusion: Bifrost 2.2.4+ downgrades or omits that mode for physical fallbacks that do not support it.

### Runtime routing and request safety

- **Normal path:** For a simple, synchronized, unconditional and wire-compatible `omp-*` route, Pifrost sends the **logical alias** to Bifrost. Its current routing rule controls physical providers, weights/keys and same-protocol fallback. Do not infer a rule match merely because Bifrost saw the alias.
- **Compatibility exception:** For excluded members, incompatible encoders or mixed Chat/Responses APIs, Pifrost may issue ordered physical requests. This bypasses the logical Bifrost rule and is explicitly labelled in `/pifrost trace`; no retries occur after real model output begins.
- **Governance:** Complex/weighted/scoped/conditional rules remain Bifrost-owned. Pifrost does not optimize routing for price, quality or quota. Bifrost-native aliases containing Responses-only members use a matching gateway ingress protocol; an alternate ingress is retried only after a specific pre-output protocol rejection. Each request keeps the same logical alias and is routed afresh by Bifrost. Mixed-protocol gateway fallbacks still require supported Bifrost protocol conversion or compatible fallback models.
- **Freshness:** Physical compatibility paths require recent synchronized rule provenance (seven-day guard), but a recent timestamp alone does **not** prove no intervening changes. After editing rules, run `pifrost routes sync`, then restart OMP. `pifrost routes verify` independently checks the complete live rule fingerprint.
- **Capabilities:** OMP-facing limits and modalities are conservative. Context-aware prewalk uses observed physical capabilities, output budget, tool/reasoning compatibility and wire protocol without reordering eligible members.

For model selection analysis use `pifrost routes explain plan --input-tokens 120000 --output-tokens 16000 --tools --reasoning`. This is a **simulation**, not confirmation of a Bifrost rule hit.

### CLI and session diagnostics

```bash
pifrost help                   # Quick usage
pifrost help --all             # Full command list
pifrost repo mcp add --help    # Command-specific options and side effects
pifrost doctor --verbose      # Expanded diagnostic view
pifrost doctor --json         # Redacted, versioned health report
pifrost doctor --strict       # Fail on warnings as well as required failures
pifrost routes sync --dry-run  # Preview without writing
```

Read-only health checks return exit code **2** on required failure (or warnings with `--strict`); invalid invocation exits **1**. MCP grants must name `--tools` explicitly; `--tools '*'` is a deliberate all-tools grant, not a default. Use `--dry-run` before supported mutations; consult command-specific `--help` because not every command accepts every flag.

Inside OMP: `/pifrost doctor`, `/pifrost doctor verbose`, `/pifrost trace`, `/pifrost trace errors`, `/pifrost trace last 5`, `/pifrost trace role omp-default`, `/pifrost trace verbose`, `/pifrost costs`, `/pifrost refresh` and `/pifrost config`. Trace and cost totals are session-bounded; missing cost is **unknown**, not zero. Bifrost logs and route counters remain authoritative for actual execution.

### Automatic route updates without a service (v0.24.0)

Pifrost now checks for changed Bifrost routes **when a main-agent user prompt begins in OMP**. It uses no daemon, cron job, systemd unit, recurring timer, or separate launcher. A check is performed at most once per 60 seconds **of prompt activity**, not while OMP is idle. The short-lived Pifrost CLI reads the gateway management credentials; those credentials are not copied into the OMP inference provider.

If Bifrost's **full** routing policy changes (including CEL rules, weights, pins and model membership), Pifrost confirms the new policy, synchronizes the alias manifest, and refreshes only OMP's Bifrost model registry for subsequent model selections. Unchanged routing never triggers a model refresh. Temporary management API failures do not block your prompt.

This cannot change an already-running response, and a currently selected model may need reselecting if its capabilities changed. To opt out, start OMP using `PIFROST_AUTO_SYNC=0 omp`. For a one-time check use `pifrost routes reconcile`. No background service is installed or started.

## Day-to-day commands

| Command | Use it when... |
| --- | --- |
| <code>pifrost doctor</code> | You want the quickest overall health check |
| <code>pifrost global status</code> | You are checking Bifrost connectivity or credentials |
| <code>pifrost routes list</code> | You want to see the live <code>omp-*</code> routes |
| <code>pifrost routes diff</code> | You changed routing and want to see local drift |
| <code>pifrost routes sync</code> | You want OMP aliases/catalogue refreshed from Bifrost |
| <code>pifrost routes reconcile</code> | One-shot safe policy check and synchronize only when changed |
| <code>pifrost models refresh --force</code> | Model metadata is stale or incomplete |
| <code>pifrost models doctor</code> | You want to inspect the capabilities OMP will actually see |
| <code>pifrost global configure-omp</code> | You want to reapply Pifrost's recommended OMP settings |
| <code>pifrost repo init</code> | You want Bifrost MCP access for the current repository |
| <code>pifrost repo status</code> | You want to verify the current repository's MCP/Skills state |

Run <code>pifrost --help</code> for the complete CLI surface.

## Repository-scoped MCP

Pifrost can create a dedicated Bifrost MCP Virtual Key for each repository and generate the matching OMP project configuration.

From the repository root:

~~~bash
pifrost repo init
~~~

The interactive flow lets you choose direct Bifrost MCP clients/tools and/or named Virtual MCP bundles.

Examples:

~~~bash
# One direct client, all of its exposed tools
pifrost repo init --clients railway --tools '*'

# Multiple direct clients
pifrost repo init --clients n8n,railway --tools '*'

# Named Bifrost Virtual MCP bundles
pifrost repo init --virtual-mcps 'Development Tools,Infrastructure'

# Mix direct grants and a Virtual MCP bundle
pifrost repo init \
  --clients railway \
  --tools get-logs \
  --virtual-mcps 'Development Tools'
~~~

Pifrost writes the repository's OMP MCP configuration to:

~~~text
<repo>/.omp/mcp.json
~~~

The raw repository Virtual Key is **not** written there. The generated header uses a local secret resolver:

~~~json
{
  "headers": {
    "x-bf-vk": "!pifrost secret repo-mcp --id <repo-id>"
  }
}
~~~

The secret itself stays in <code>~/.config/pifrost/secrets.json</code>.

Useful MCP operations:

~~~bash
pifrost repo status
pifrost repo mcp list
pifrost repo mcp add railway --tools 'list-projects,list-services,get-logs'
pifrost repo mcp remove railway

pifrost repo vmcp list
pifrost repo vmcp add 'Development Tools'
pifrost repo vmcp remove 'Development Tools'
~~~

### Research providers through Bifrost MCP

Pifrost provides **provider-neutral research discovery and diagnostics**. DonSeTch is the preferred built-in profile, Hound remains available as a legacy profile, and any other MCP research server can be mapped explicitly. Pifrost never starts or directly calls the research server, rewrites tool calls or adjusts inference routing: OMP selects tools; Bifrost enforces execution via the repository Virtual Key.

DonSeTch's four tools are `web_search`, `web_fetch`, `web_crawl` and `web_screenshot`. Missing optional capabilities do not invalidate a useful search-only MCP.

```bash
# First register DonSeTch as an MCP client in Bifrost.
pifrost repo mcp add donsetch --tools 'web_search,web_fetch,web_crawl,web_screenshot'
pifrost repo research bind ds donsetch --profile donsetch
pifrost repo research prefer ds
pifrost repo research status

# Explicit, bounded and read-only external search probe (Classic MCP).
pifrost repo research probe ds

# Explicit generic mapping; requires no Pifrost code changes.
pifrost repo research bind alt another-mcp --profile generic --search-tool search_web --fetch-tool read_url
```

`pifrost repo status` and `pifrost doctor` show per-provider readiness, client execute policies, Classic versus Code Mode binding evidence, independent OMP native web search, and missing capability warnings. The preferred provider is **guidance only**: it does not force a tool call, route results or provide automatic cross-provider fallback.

Code Mode detection inspects Bifrost virtual `.pyi` stubs without invoking remote providers or executing sandbox code. Screenshot recovery requires a directly attributable tool and validated image bytes; nested Code Mode screenshots remain conditional. DonSeTch's folded `[meta]` result envelope and application-level `ok:false` errors are interpreted for diagnostics, without rewriting evidence.

DonSeTch handles (`S…` and `L…`) are stateful, so later fetches using handles require the same upstream process; use URLs across replicas. DonSeTch is **AGPL-3.0**: review obligations for its separate deployment and any modifications. See [Research providers](docs/RESEARCH_PROVIDERS.md) for architecture, setup, safety and migration guidance.

### MCP server instructions

If you want Bifrost MCP tools available without adding the MCP server's <code>initialize.instructions</code> text to OMP prompts:

~~~bash
pifrost repo mcp instructions off
~~~

Restore it with:

~~~bash
pifrost repo mcp instructions on
# or return to OMP's default behaviour
pifrost repo mcp instructions default
~~~

## Bifrost Skills → OMP Skills

Pifrost can bridge compatible Bifrost Skills into OMP's project-level Agent Skills directory.

~~~bash
pifrost repo skills list
pifrost repo skills add <name>
pifrost repo skills sync
pifrost repo skills remove <name>
~~~

This is opt-in per repository. Pifrost only updates/removes skill directories that it owns and refuses to silently weaken Bifrost tool restrictions that OMP cannot enforce.

See the [technical reference](docs/REFERENCE.md#bifrost-skills--omp-skills-bridge) for the compatibility rules.

### MCP Skill offers

When you explicitly select a Bifrost MCP client through `pifrost repo init` or
`pifrost repo mcp add`, Pifrost checks the Bifrost Skills catalogue for a
**case-insensitive, exact-name** match. Selected Virtual MCP assignments also check
the bundle's underlying clients by stable Bifrost client IDs. This is an
optional CLI-only discovery step; it does not contact or execute the MCP server.

The default interactive answer is **No**. In unattended scripts discovery
reports possible matches without installing; `--install-matching-skills` is
the explicit opt-in. Existing `--yes` never authorizes Skill installation.
Re-selecting a client in `repo init` rechecks a missing matching Skill, while
already installed or dismissed Skills do not prompt again. Reapplying unchanged
`repo mcp add` grants does not repeat the offer. A Skill failure does not undo
a successful MCP grant.

```bash
pifrost repo mcp add donsetch --tools web_search  # Offers a matching Skill, if published
pifrost repo mcp add donsetch --tools web_search --install-matching-skills  # Explicit unattended consent
pifrost repo skills suggestions              # Review current matches and drift
pifrost repo skills bind research web-search # Set a per-repo explicit name alias
pifrost repo skills unbind research
pifrost repo skills dismiss donsetch         # Don't ask for this MCP/Skill again
pifrost repo skills undismiss donsetch
```

No fuzzy matching is performed, and aliases do not affect Bifrost MCP grants.
`repo status` and `doctor` report orphaned MCP/Skill links and upstream
renames by stable Skill ID. Installed Skills remain independent when their MCP
is removed. Local file modifications are detected using SHA-256 payload hashes
in the Pifrost ownership marker; `skills sync/add/remove --force` is required
to deliberately replace or discard edited managed content. Legacy markers
remain readable but their content integrity cannot be established until an
explicit refresh. See [technical reference](docs/REFERENCE.md#automatic-mcp-to-skill-discovery).

## Optional live inference conformance

The unit and compiled-host CI suites validate request contracts without contacting paid providers. To verify the **actual** Bifrost/provider path, run this explicitly after configuring your target test routes and global inference credentials:

~~~bash
export BIFROST_URL=http://127.0.0.1:8180/v1
export BIFROST_VIRTUAL_KEY=your-inference-virtual-key
export PIFROST_CONFORMANCE_CHAT_MODEL='provider/chat-model'
export PIFROST_CONFORMANCE_RESPONSES_MODEL='provider/responses-model'
# Optional: a model that supports required function calls
export PIFROST_CONFORMANCE_TOOL_MODEL='provider/tool-capable-chat-model'
npm run smoke:transport
~~~

This performs **real billable model calls** and checks both streaming wire formats, terminal completion, and optionally fragmented tool-call arguments. It never prints the VK or prompts. Set `BIFROST_API_KEY` separately only when your gateway requires bearer auth in addition to the VK. Results cannot be inferred from CI; keep exact provider IDs and command outputs as the live acceptance record.

## Upgrading

The normal upgrade sequence is:

~~~bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost

pifrost --version
pifrost routes sync
pifrost doctor
~~~

Upgrade notes belong in the [changelog](CHANGELOG.md), so the README does not become a history book.

## Security model

Pifrost deliberately separates three identities:

~~~text
Global LLM inference   -> global inference Virtual Key
Bifrost administration -> OSS Basic auth or Enterprise management key
Repository MCP access  -> dedicated Virtual Key per repository
~~~

Do not reuse a repository MCP Virtual Key as the global inference key.

Local Pifrost configuration lives under:

~~~text
~/.config/pifrost/config.json
~/.config/pifrost/secrets.json
~~~

Pifrost creates these with private filesystem permissions (<code>0600</code>). That protects them from other local users; it is **not encryption at rest**.

Management credentials are used by the standalone CLI and are not injected into the OMP provider runtime.

## Troubleshooting

### Start with the doctor

~~~bash
pifrost doctor
~~~

It is intentionally the first diagnostic command: it checks the installed OMP/Bifrost boundary, inference access, management access, routing, model metadata and current-repository integration.

### OMP starts with <code>no-model</code>

A successful `pifrost routes verify` updates its verification timestamp without
invalidating an otherwise unchanged model cache. On a genuine cold cache miss,
the extension resolves models before registering the OMP provider; it never
reuses a catalogue from different routing policy or Virtual Key credentials.

~~~bash
pifrost global status
pifrost routes diff
pifrost routes verify --dry-run
omp models bifrost
pifrost models doctor
~~~

If discovery fails, check Bifrost availability and credentials, then run
`pifrost models refresh --force`. A fresh model inventory is required after
genuine changes to route members, policy or credentials; a second OMP launch
must not be necessary after an ordinary verification.

### Bifrost OSS management returns 401

Rerun:

~~~bash
pifrost global setup
~~~

Choose <code>basic</code> management auth and use the active Bifrost dashboard/admin credentials.

### OpenCode Go returns <code>MissingSessionID</code>

Pifrost forwards OMP's conversation ID through Bifrost for OpenCode Go. If your Bifrost deployment uses a client-header allowlist, make sure it permits Pifrost's dynamic <code>x-bf-eh-*</code> forwarding headers.

The full header contract and diagnostic detail are in the [technical reference](docs/REFERENCE.md#opencode-go-returns-missingsessionid).

### Repository MCP fails

~~~bash
pifrost repo status
~~~

If the Virtual Key no longer exists in Bifrost, either reinitialize the repository or explicitly rotate it:

~~~bash
pifrost repo init
# or
pifrost repo rotate-key
~~~

## Configuration locations

| Path | Purpose |
| --- | --- |
| <code>~/.config/pifrost/config.json</code> | Global non-secret configuration |
| <code>~/.config/pifrost/secrets.json</code> | Local secrets |
| <code>~/.omp/agent/pifrost.aliases.json</code> | Synchronized logical route manifest |
| <code>~/.omp/agent/pifrost.catalog.json</code> | Startup model catalogue |
| <code>&lt;repo&gt;/.omp/mcp.json</code> | Repository-specific OMP MCP configuration |

## Development

~~~bash
npm ci
npm run check
npm test
~~~

Release CI additionally runs upstream contract, package-install and transport checks; see [development](docs/REFERENCE.md#development).

## Documentation

- [Technical reference](docs/REFERENCE.md) — architecture, capability derivation, compatibility matrix, advanced routing, MCP details and full CLI behaviour
- [Research-provider guide](docs/RESEARCH_PROVIDERS.md) — DonSeTch, generic MCP backends and probes
- [Changelog](CHANGELOG.md) — dated release history and migration notes
- [NOTICE](NOTICE.md) — upstream attribution
- [MIT license](LICENSE)

## Attribution

Pifrost is MIT-licensed and derived from [pi-bifrost-provider](https://github.com/lxdlam/pi-bifrost-provider). See [NOTICE](NOTICE.md) and [LICENSE](LICENSE). Historical compatibility and release-specific detail remains in the [changelog](CHANGELOG.md).

OMP integration diagnostics: `pifrost omp readiness` checks native prewalk, `/seance` and advisor settings read-only. See [Release C guide](docs/REFERENCE.md#release-c--omp-orchestration-readiness-v0270).


### Output-budget protection (v0.29.4)

Per-request output caps now apply across logical OMP roles and physical
provider attempts using known provider/member capabilities **without arbitrary
role-based defaults**. Pifrost retains the full model output allowance unless
a supported physical/provider limit or an explicitly opted-in operator cap
requires reduction. Use `/pifrost trace verbose` to see requested versus
applied tokens, source and unknown-member coverage. Optional cap variables
include `PIFROST_OUTPUT_CAP_TOKENS` and role-specific `PIFROST_OUTPUT_CAP_DEFAULT`,
`_TASK`, `_ADVISOR`, etc.; `0` disables only the optional cap. See [Output budget policy](docs/OUTPUT_BUDGET.md).


### Physical-provider compatibility (v0.29.5)

Gateway-owned, pinned and conditional Bifrost routes retain their original
routing rules and permissions. For a locally lowered compatibility exception,
Pifrost now requires a synced full rule-policy fingerprint and complete OMP
physical wire contract for eligible models. Native Bifrost Chat passthrough
requires compatible encoders across the whole reachable chain, including
possible session-affinity members. `/pifrost trace verbose` distinguishes
cached primary from gateway-reported serving model, without guessing whether
a difference came from affinity or fallback. No extra output caps or background
processes. See [Route compatibility](docs/ROUTE_COMPATIBILITY.md).


### Reasoning replay integrity (v0.29.6)

OMP owns the serialization and provider-approved non-substantive reasoning replay markers. Pifrost passes a common strict replay requirement to OMP only where all known physical members agree, then validates strict history shape before upstream submission. Native reasoning, encrypted signatures, and tool call IDs remain unmodified; no arbitrary reasoning policy is imposed on unknown routes. See [Reasoning integrity](docs/REASONING_INTEGRITY.md).


### Controlled OMP session recovery (v0.29.7)

Pifrost now provides `/pifrost recover status` to inspect the latest classified
inference failure and `/pifrost recover fork` for an explicitly confirmed clean
session when a strict reasoning-history replay failed before output started.
A fork starts a **new OMP session** from a user-authored continuation brief,
linked to the previous session for navigation. It does not copy the original
assistant or tool history, invent reasoning, repeat tool calls, switch routes,
or change output-token limits. Busy/queued sessions and active async jobs block
a fork. Earlier failed fallbacks that later succeeded cannot trigger one.
See [Controlled recovery](docs/CONTROLLED_RECOVERY.md).


### Release F — cross-provider hardening (v0.29.8)

Pifrost's opaque Bifrost alias ingress fallback from Responses to Chat is now
strictly gated by evidence from the **same gateway request**. Only a recognised
pre-output protocol error with HTTP 400/422 can justify a second protocol
probe. Authorization (401/403), quota (402/429), timeout (408/504), upstream
5xx, reasoning-history and output-token errors never cause an additional
protocol attempt. The original alias, session identity, live Bifrost rule,
reasoning settings, tool call IDs and model output ceilings are preserved.

Nine provider entitlement namespaces have regression coverage for physical
model identity, actual caps, Chat/Responses shapes, native reasoning and tool
result pairing. No service, automatic model switching or arbitrary role caps.
See [Cross-provider hardening](docs/CROSS_PROVIDER_HARDENING.md).


### Release 1 — execution safety (v0.29.9)

Physical compatibility exceptions now require a fresh read-only, double-snapshot
attestation from Bifrost's management plane before a single upstream request is
dispatched. The attestation verifies the full live routing-policy fingerprint and
the exact ordered physical-member digest against OMP's currently loaded route
profile. No daemon or service is installed; the short-lived `pifrost routes attest
omp-default --json` CLI command owns management credentials, never the OMP
inference provider. Management unavailability, rule edits, mismatched members and
stale responses fail **closed for physical exceptions only**. Native Bifrost
logical routes remain operational when management access is unavailable.

A common transition policy now applies to both opaque gateway ingress and
physical compatibility attempts. Opaque ingress may negotiate protocol only
after a confirmed HTTP 400/422 unsupported-protocol rejection. Physical encoder
transitions are permitted only after a verified upstream HTTP 502/503, before
any generated model output, and never after an auth, quota, invalid reasoning,
output-budget, permission, timeout or unverified error. OMP/Bifrost retain
their native retry and provider selection responsibilities. Details:
[Release 1 execution safety](docs/RELEASE_1_EXECUTION_SAFETY.md).

### Release 2 — lifecycle and reasoning conformance (v0.29.10)

Stalled-turn recovery is advisory by default. `/pifrost stalled status` and `/pifrost stalled continue` provide a bounded, explicitly confirmed continuation, with idle/queue/job/session checks repeated after approval. `PIFROST_STALLED_TURN_MODE=auto` is an opt-in. Replay diagnostics distinguish structural presence of reasoning markers from completed Bifrost gateway processing; neither proves what a converted physical-provider payload contained. Empty native Chat replay fields and unsigned/empty Responses markers are counted without inventing reasoning or restricting heterogeneous models. See [Release 2](docs/RELEASE_2_LIFECYCLE_REASONING.md).

### Stalled-turn default (v0.29.11)

The default for `PIFROST_STALLED_TURN_MODE` is now `auto` (one safe OMP follow-up after a high-confidence stalled turn). To **disable** detection, notices and continuation completely, set `PIFROST_STALLED_TURN_MODE=off` and restart OMP. `PIFROST_STALLED_TURN_MODE=notice` keeps the manual confirmation workflow from v0.29.10. Accepted disable synonyms: `0`, `false`, `no`, `disabled`, `disable`. An invalid non-empty setting defaults to `notice` rather than unexpectedly auto-running tools.

### Release 3 — architecture isolation and HTTP/MCP safety (v0.29.12)

Every OMP extension installation now owns an independently refreshed, atomic route-catalogue snapshot. A stream captures exactly one generation before dispatch, preventing concurrent refreshes from mixing routing metadata. Executable TypeScript AST import-boundary tests complement existing architecture checks. Authenticated control-plane and MCP calls now refuse HTTP redirects; MCP JSON/SSE is byte-bounded at 8 MiB by default, independent of model output token limits. No daemon, new provider router or user-visible model capability cap was introduced. [Technical contract](docs/RELEASE_3_ARCHITECTURE.md).

### Release 4 — output capacity and documentation governance (v0.29.13)

Output budgets for locally dispatched compatibility attempts now use the selected physical target's actual ceiling instead of the weakest fallback member. Native and opaque logical Bifrost aliases keep physical members diagnostic-only rather than imposing arbitrary gateway-wide caps. Exact physical endpoint limits and explicit user/operator caps still apply; a weaker fallback may reject a larger request and remains Bifrost's responsibility. Release-aware documentation checks keep support-matrix headings, package versions and pinned OMP dependencies consistent. New [security policy](SECURITY.md), [contributing guidance](CONTRIBUTING.md) and [.github/CODEOWNERS](.github/CODEOWNERS) accompany this release. [Release 4 details](docs/RELEASE_4_BUDGET_GOVERNANCE.md).

### Release 5A — OMP/Bifrost contract refresh (v0.29.14)

Pifrost pins OMP 18.12.5 across its five dependent packages and verifies historical OMP 18.10.4/18.12.1 plus current 18.12.5 installation contracts. Bifrost 2.3.2 is the pinned source/HTTP contract baseline, retaining earlier contracts. The Pifrost update itself neither deploys nor migrates Bifrost: assess the Bifrost 2.3.1 database migrations and Go 1.27.3 plugin rebuild requirements separately. Read [Release 5A](docs/RELEASE_5A_CONTRACT_FOUNDATION.md) and the [integration support matrix](docs/INTEGRATION_SUPPORT.md). Live provider/route/MCP execution still requires independent conformance.

### Release 5B — inference protocol and output-limit hardening (v0.29.15)

Pifrost treats HTTP 413 as terminal, preserves the full supported Chat/Responses wire contract and `xhigh` reasoning choices, and reports Bifrost-confirmed conversion and dropped `max_*` output limits in `/pifrost trace verbose`. The reported gateway egress gap is diagnostic; Pifrost does not compensate for missing Bifrost datasheet parameters or add default output caps. See [Release 5B](docs/RELEASE_5B_INFERENCE_HARDENING.md).

### Release 5C — model-aware image accounting and complete discovery (v0.29.16)

Pifrost now delegates image-token pricing to the pinned OMP 18.12.5 public model-lineage policy, including measured DeepSeek V4.1 Flash image billing. Node-only/older-host diagnostics retain a tested portable fallback. Gateway model discovery follows explicit pagination cursors and rejects incomplete provider-key inventories instead of caching a partial model list as complete. No image-count limit or model output cap is invented. See [Release 5C](docs/RELEASE_5C_CONTEXT_DISCOVERY.md).

### Release 5D — lifecycle recovery and MCP replay-risk evidence (v0.29.17)

OMP planning-stall recovery now refuses unresolved or uncertain tool outcomes and invalidates pending approvals when compaction or session history changes. Pifrost's own MCP tools/call calls never retry after ambiguous failure; `MCP_OUTCOME_UNCERTAIN` means a mutation may have committed. Repository MCP diagnostics flag approval-free non-idempotent or unknown tools affected by [Bifrost #8795](https://github.com/maximhq/bifrost/issues/8795). **Bifrost internal retries are not fixed by this release.** See [Release 5D](docs/RELEASE_5D_LIFECYCLE_MCP_SAFETY.md).

### Release 5E — gateway MCP integration safeguards (v0.29.18)

Pifrost distinguishes native Responses tool search from Bifrost-owned Code Mode and injected discovery, warns about OpenAPI-derived operation permissions and provider injection collisions, and offers bounded read-only Code Mode result-shape and opt-in MCP progress diagnostics. No grants, Bifrost execution engine or OMP history are changed. See [Release 5E](docs/RELEASE_5E_GATEWAY_MCP_INTEGRATION.md); live gateway conformance remains separately gated.

### Release 5F — judgment, caching and cost certification (v0.29.19)

`pifrost judge status` reports pinned OMP image bounds and verified Jev 1.14 box eligibility. `pifrost judge providers` checks Azure/Databricks catalog visibility without inference. The Responses bridge records 12-hour cache intent and Bifrost-reported 30m/12h counters without changing global cache policy. `/pifrost trace` identifies reported cost and physical-model evidence rather than guessing. Optional billed `pifrost judge probe --image --box` and `npm run smoke:cache` are separately gated. See [Release 5F](docs/RELEASE_5F_CERTIFICATION.md).
