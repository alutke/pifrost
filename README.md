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

For the full implementation, Release A compatibility-exception register and verification limits, see the [technical reference](docs/REFERENCE.md). For release-specific changes, see the [changelog](CHANGELOG.md).

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

## Release C: optional native judgment and model kinds

OMP already owns the `judge` role, typed decisions, per-session usage, caching and batch scheduling. Bifrost 2.2.6 serves an OMP-compatible TypeSafe System One endpoint at `/typesafe/v1/systemone` and its canonical typed endpoint at `/v1/decisions`. **Pifrost does not implement another judge or reroute its requests.** Release C exposes a separate native provider only when explicitly opted into a TypeSafe jev model.

To register a judge model (disabled by default), set the environment for the OMP process, then restart OMP:

~~~bash
export PIFROST_NATIVE_JUDGE_MODEL=jev-latest
pifrost judge status
~~~

This registers `bifrost-judge/jev-latest` as an OMP model of `kind: judge`, using the existing Bifrost inference Virtual Key. A modern `sk-bf-*` Bifrost 2.x Virtual Key and Bifrost 2.2.6+ native TypeSafe integration are required; the configured Virtual Key must be permitted to use the TypeSafe model. No separate TypeSafe credentials are stored by Pifrost.

The user-selected `modelRoles.judge` is **not** changed just by registration. After confirming the gateway offers the model, explicitly enable it:

~~~bash
pifrost judge activate
pifrost judge status
~~~

`activate` reads both the OMP role map and `enabledModels` before making changes. It adds the `bifrost-judge/*` namespace (required because a default Pifrost setup enables only `bifrost/*`) and merges only the `judge` role, preserving all other roles, model patterns and presets. To test real provider execution, invoke **one billed probe** explicitly:

~~~bash
pifrost judge probe
# Alternatively, test the canonical Bifrost Decisions API (different wire schema):
pifrost judge probe --decisions
~~~

The probes validate yes/no, choice and score answers, print no prompt or raw provider response and do **not** change OMP's judgment workflow. A working model-list GET alone does not prove live inference success.

To see how the live gateway classifies its advertised models without creating new OMP runners, run `pifrost models kinds` (read-only GET `/v1/models`). This reports chat, unknown and explicitly non-chat kinds, without guessing specialized API compatibility.

Pifrost's existing chat aliases remain chat-only. Non-chat `judge`, image, search, speech, dictation, embedding, rerank and video model kinds must use their appropriate OMP-native transports, not be converted to Pifrost chat aliases. Release C excludes explicitly non-chat gateway models from the chat inventory and reports no unsupported execution capability.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | **22.19+** |
| OhMyPi | **18.10.4+** for Pifrost 0.17.0 installation |
| Pifrost OMP policy snapshot | **18.10.4**, with versioned model-policy contracts; host integration validated separately |
| Maxim Bifrost | **2.2.4+** |
| Recommended Bifrost | **2.3.0+** for requested-route provenance, per-target first-token deadlines, reasoning conversion and injected-tool list schema |

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
0.22.0
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

Pifrost's recommended OMP configuration maps OMP roles to Bifrost aliases:

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

**Release B configuration safety:** `pifrost global configure-omp` and the approval-aware in-session `/pifrost cfg` profile merge Pifrost roles into the current OMP `modelRoles` mapping. Custom `judge`, `web`, `memory` and future roles survive. Existing enabled-model namespaces and other provider-order entries remain intact. If OMP cannot read an existing collection, Pifrost refuses to overwrite it.

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

### CLI safety and usability: 0.22.0

Pifrost now validates each of its registered CLI commands **before** it reads or changes local or remote state. `pifrost repo mcp add CLIENT` requires `--tools tool1,tool2` or the explicit `--allow-all-tools` switch. Similarly, scripted `pifrost repo init --clients CLIENT` requires a selected tool scope; wildcard grants are no longer implicit. A typo, missing flag value or invalid option fails with short contextual help. Use `pifrost COMMAND --help` or `pifrost help COMMAND` for focused help.

`pifrost doctor` and `pifrost global status` distinguish required failures from optional warnings. A failed required check exits 2; syntax errors exit 1; warnings/unknown checks exit 0 by default and exit 2 with `--strict`. Read-only commands support `--json` (schema v1, status, exitCode and output text); this is for scripts and does not expose a credential helper. `pifrost secret repo-mcp` remains machine-only.

Use `--dry-run` to preview `global setup`, `init`, `routes sync`, `routes verify`, `repo init`, `repo reset`, `repo rotate-key`, `repo mcp add/remove`, `repo vmcp add/remove`, and `repo skills add/remove/sync` before changes. Actual operations remain explicit. `repo skills suggestions` is read-only unless `--install-matching-skills` is supplied. The CLI warns when secrets are supplied in argv; interactive prompts fail closed when input echo cannot be disabled. For Windows secure setup, provide supported environment variables rather than typing secrets in a visible prompt.

Large `routes list` and `repo mcp list` inventories support `--filter TEXT`, `--limit N`, and `--verbose`; Skill and research status views lead with concise readiness. In OMP, use `/pifrost trace last 5 errors`, `/pifrost trace role omp-default`, or `/pifrost trace verbose` for full headers and reasoning counters. `/pifrost help` lists the OMP commands. Probe commands explicitly warn about potential billed requests.

Example least-privilege grant:

~~~bash
pifrost repo mcp add donsetch --tools web_search,web_fetch --dry-run
pifrost repo mcp add donsetch --tools web_search,web_fetch
~~~

For explicit all-tool consent use `--allow-all-tools` instead of `--tools '*'`. These are gateway access changes; they do not prove the tools can execute until verified against Bifrost.

### Terminal readability and accessibility: 0.21.0

The default terminal experience is now intentionally concise and plain-text-first, with no reliance on colour, emoji, animation or TTY features. Use `pifrost help` for a task-oriented starter guide and `pifrost help --all` for the complete command reference. Unknown commands display a short recovery hint rather than the entire help page.

`pifrost doctor`, `pifrost global status`, `pifrost repo status` and `pifrost models doctor` show actionable summaries by default, with warnings before healthy checks. Add **`--verbose`** for the previous technical detail, including MCP/Skills, model capability provenance and Bifrost compatibility contracts. `pifrost routes explain` clearly separates eligible/excluded candidates and their reasons; `/pifrost trace` is grouped by model, route, gateway and usage.

Inside OMP, `/pifrost doctor` is a compact model-readiness view; `/pifrost doctor verbose` shows full per-alias provenance and attribution. `/pifrost refresh` gives a concise readiness result. Existing `/pifrost config`, `/pifrost costs` and diagnostic commands retain their behaviour. All outputs work when redirected to files or read aloud.

The display layer does not change routing policy, governance, inference execution, configuration writes or diagnostic exit codes.

### Cross-release hardening: 0.20.0

Pifrost compiles only exact unconditional OMP model-alias CEL predicates into local compatibility routes. Arbitrary request-type, budget, complexity, scoped and query conditions remain Bifrost-owned, including on heterogeneous Chat/Responses chains. An alternative late physical-request rewrite was removed from the live direct inference path. Model output commitment for failover and trace now uses one common predicate: empty text/thinking starts are not generated output.

`pifrost routes sync` records an order-independent fingerprint of the complete Bifrost rule inventory. `pifrost routes diff` detects changes to conditions or pins even when the model chain is unchanged. `pifrost routes verify` fetches rules with management authentication and, only when the full policy is unchanged, refreshes the local verification timestamp. **Restart OMP after verify/sync** to refresh active compatibility profiles. A seven-day fail-closed guard remains where live revision verification is unavailable from the OMP inference boundary; this is intentional and not proof that live rules cannot drift within the window.

`/pifrost costs` reports `cost=unknown` for roles with no gateway cost response, and `reported-subtotal` for incomplete cost coverage. Bifrost privacy reports distinguish global log-store enablement, per-Virtual-Key content defaults, hidden object storage and unverified external connectors. They do not constitute a compliance finding.

CI adds mock HTTP gateway integration and missing-output/failover tests. Actual Bifrost rule hits and live connected provider results still require a deployment acceptance check.

### Release D: optional gateway intelligence and privacy visibility

Use the **read-only, opt-in** command `pifrost global observability` to inspect the Bifrost complexity classifier configuration (keywords, decision model, semantic fallback and session stickiness) alongside configured provider-injected web research tools. These are configuration observations, **not evidence** that a classifier or tool ran or that a given Virtual Key was authorised.

For privacy, `pifrost global observability --vk-id <management-id>` reads the selected Virtual Key's **management metadata** to combine its tri-state `disable_content_logging` override with gateway-wide content-logging defaults. It reports log retention, hidden object storage and per-request override policy. Without an inspected key the effective default is **unverified**. It never prints raw configuration, VK values, secrets, prompts or credentials and makes no configuration changes. Per-request controls may further change effective storage.

Within OMP, `/pifrost costs` groups only gateway-reported monetary totals over the latest 20 session attempts by logical role, showing fallback and cache counts plus how many attempts have **unknown** cost. This in-memory subtotal is not an invoice or full-history spend report; `/pifrost trace` still shows individual gateway request IDs and costs.

Warp, A2A, new agent runtimes, inference-triggered classification and automatically activated research injection are deliberately **not** part of Release D. Bifrost and OMP retain execution ownership.

### Release C: gateway reliability, failure and routing attribution

Release C extends `/pifrost trace` without taking control of Bifrost or OMP request execution. It captures the confirmed gateway trace ID, HTTP status, classified credential/access/quota/timeout/upstream errors, bounded Retry-After hints, response cache metadata, and whether streamed model output had begun. It provides read-only next-step guidance for credential rotation, quota investigations and Bifrost timeout policies. No keys, provider response bodies or secrets are stored in traces.

The trace distinguishes a **gateway-requested alias** from a **confirmed matched Bifrost rule**. Bifrost's routing dashboard/logs remain authoritative for rule matches and cost. Pifrost compatibility exceptions explicitly explain why physical requests may not increment `omp-*` routing statistics; successful cached responses are marked as such and are not evidence of a new live upstream call. No retries or automatic key rotations are introduced.

### Release B: upstream compatibility (OMP 18.10.4 / Bifrost 2.3.0)

Release B updates Pifrost's pinned OMP runtime/catalog policies together and validates the 18.10.4 compiled binary. It adds pinned Bifrost 2.3.0 contract validation for original-route headers, gateway-native TTFT deadlines and reasoning-aware Chat-to-Responses conversion.

Bifrost 2.3's `injected_tools` list is now recognised by read-only `pifrost global mcp-policy` and `pifrost doctor`; older `web_search` objects remain supported. Diagnostics neither enable nor execute tools. Bifrost still owns routing and MCP access controls.

**Upstream-first compatibility:** OMP owns reasoning-aware compaction and the session/replay lifecycle. Pifrost retains its narrowly scoped physical-model context estimates, wire compatibility preflight, Bifrost-specific nested-cost decoding and observed synthetic reasoning cleanup until live tests establish safe upstream parity. Bifrost 2.3 TTFT and reasoning compatibility policy are inspected, not automatically changed.

Upgrade OMP to **18.10.4 or newer before installing Pifrost v0.17.0**, then synchronise routes as described below. An OMP restart is required.

**Installation compatibility:** OMP 18.4.8's compiled GitHub plugin installer cannot resolve the dependency graph used by OMP 18.10.4's catalog (notably `@oh-my-pi/pi-utils`), even though local linked-extension checks may succeed. Pifrost v0.17.0 does not support that older GitHub installation path. If OMP cannot be upgraded, retain **Pifrost v0.16.0** with its earlier pinned OMP libraries instead. The compiled OMP 18.10.4 clean GitHub install is now a required main-branch release gate.

### Release A: Bifrost-native route attribution

For a synchronized simple `omp-*` rule, Pifrost now keeps the **logical model** on the wire when every member is eligible and the members share one compatible Chat Completions encoding. Bifrost executes its **live** routing rule, including its actual provider/key policies and fallback chain; Pifrost does not send a copied `fallbacks` list.

When a request requires a different wire protocol, excludes an incompatible model, or crosses an encoder boundary, Pifrost retains its restricted pre-output compatibility adapter. These physical-model attempts do **not** match the original `omp-*` rule in Bifrost. The exception is explicit in `/pifrost trace` as `route-mode=pifrost-compatibility`, with the compatibility reason and the gateway's originally requested model where supported.

Exception paths rely on locally synchronized Bifrost rule membership and therefore require `pifrost routes sync` within the past seven days. Missing or expired sync provenance fails with a clear recovery instruction rather than silently executing an arbitrary old physical chain. **A recent sync is not proof the route has not changed since**: always run `pifrost routes sync` after changing Bifrost routes, then restart OMP. Model metadata refresh alone does not reload routing rules.

Upgrade:

~~~bash
npm install --global github:alutke/pifrost#v0.22.0
hash -r
omp install --force github:alutke/pifrost#v0.22.0
pifrost routes sync
pifrost doctor
~~~

### How capability safety works

A logical route can contain models with different context windows, output limits, image support, reasoning/tool support and **wire protocols**. Pifrost derives a safe OMP-facing capability envelope from the route instead of blindly advertising the primary model's capabilities.

For straightforward global fallback routes, Pifrost also uses **context-aware prewalk**. Before each request reaches Bifrost it removes members that are known to be incompatible with the final request: context/output limits, image/tool/reasoning constraints and supported wire protocols are all considered.

On the native OMP path, context sizing uses a semantic estimate of the actual provider Context rather than serializing OMP's internal objects. When a candidate exposes an OMP tokenizer family, text is counted through the matching OMP native tokenizer; unknown families retain the conservative local byte estimate. Image blocks use OMP-aligned, model/dimension-aware token rules. Prewalk computes the estimate separately for each physical candidate, and provider usage is reused as a prefix anchor only when it came from the same physical upstream model. Internal metadata such as tool-result `details`, timestamps and routing records is not treated as model prompt content. Opaque replay content that OMP sends back to providers—reasoning signatures, redacted thinking and native Anthropic server-tool payloads—is counted too when a local recount is required. The image-policy compatibility layer is a monitored snapshot of the validated OMP contract; scheduled upstream canaries detect policy drift.

Pifrost natively executes both **OpenAI Responses** and **OpenAI Chat Completions** route members. Eligible members stay in their original Bifrost order and are grouped only when adjacent members use the same protocol. Each protocol group is dispatched through OMP's native transport for that wire API; same-protocol fallbacks remain inside Bifrost's native `fallbacks` chain. If a protocol group fails before producing model output, Pifrost may advance to the next protocol group. Once any real output has been emitted, Pifrost never replays that turn on another model or protocol. This is protocol compatibility/failover, not policy routing: Pifrost never promotes a later member because of quality, price, quota or provider preference.

That means a mixed route such as `Muse Responses -> CommandCode Chat -> DeepSeek Chat` genuinely tries Muse first through Bifrost `/v1/responses`, then falls back to the Chat group only if Muse fails before output. OpenCode Go attempts retain OMP's native OpenCode provider policy while using the provider-qualified Bifrost model id on the wire, and Pifrost forwards the OMP session identity through `x-bf-eh-x-opencode-session`.

Reasoning/tool compatibility is evaluated on two separate axes. A model may support reasoning while tools are offered, yet still require reasoning to be suppressed when an explicit `tool_choice` selector is serialized; Pifrost does not treat those as the same capability. OMP's model-default output ceiling is also distinguished from a caller-explicit cap in prewalk diagnostics, so failures report whether the reserve was requested or inherited.

Protocol metadata is resolved conservatively with provider-specific transport policy ahead of generic family metadata: live Bifrost methods first, then OMP's provider-qualified compiled `api-routes`, then Bifrost datasheet endpoints and bundled catalog metadata. The compiled policy matters for gateway-only models that are intentionally absent from OMP's static snapshot and for models whose sibling providers expose a different wire API. Unknown protocol metadata is not guessed or rejected merely for being incomplete. The same prewalk runs for eligible simple routes even when every member has the same context window.

Complex, weighted, scoped, pinned or policy-dependent routes remain Bifrost-owned and use the conservative static envelope.

The detailed rules, metadata provenance and compatibility behaviour are in the [technical reference](docs/REFERENCE.md).

## Day-to-day commands

| Command | Use it when... |
| --- | --- |
| <code>pifrost doctor</code> | You want the quickest overall health check |
| <code>pifrost global status</code> | You are checking Bifrost connectivity or credentials |
| <code>pifrost routes list</code> | You want to see the live <code>omp-*</code> routes |
| <code>pifrost routes diff</code> | You changed routing and want to see local drift |
| <code>pifrost routes sync</code> | You want OMP aliases/catalogue refreshed from Bifrost |
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

Pifrost 0.11 provides **provider-neutral research discovery and diagnostics**. DonSeTch is the preferred built-in profile, Hound remains available as a legacy profile, and any other MCP research server can be mapped explicitly. Pifrost never starts or directly calls the research server, rewrites tool calls or adjusts inference routing: OMP selects tools; Bifrost enforces execution via the repository Virtual Key.

DonSeTch's four tools are `web_search`, `web_fetch`, `web_crawl` and `web_screenshot`. Missing optional capabilities do not invalidate a useful search-only MCP.

```bash
# First register DonSeTch as an MCP client in Bifrost.
pifrost repo mcp add donsetch --tools '*'
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

### Automatic MCP Skill offers

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
pifrost repo mcp add donsetch               # Offers a matching Skill, if published
pifrost repo mcp add donsetch --install-matching-skills  # Explicit unattended consent
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

~~~bash
pifrost global status
pifrost routes sync
pifrost models refresh --force
pifrost models doctor
omp models bifrost
~~~

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

Additional release and compatibility validation is documented in the [technical reference](docs/REFERENCE.md#development).

## Documentation

- [Technical reference](docs/REFERENCE.md) — architecture, capability derivation, compatibility matrix, advanced routing, MCP details and full CLI behaviour
- [Changelog](CHANGELOG.md) — release history and migration notes
- [NOTICE](NOTICE.md) — upstream attribution
- [MIT license](LICENSE)

## Attribution

Pifrost is derived from <code>lxdlam/pi-bifrost-provider</code> under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

### Bifrost rich-content recovery

Pifrost repairs the current Bifrost MCP image-flattening behavior at the OMP tool-result boundary only for directly exposed, attributable screenshot tools (legacy Hound `mcp_screenshot`, DonSeTch `web_screenshot`, and explicitly configured generic screenshot bindings). Markers must pass MIME, canonical Base64, decoded-size, aggregate-count/size and image-signature validation before they become native OMP image blocks. If the active model is text-only, Pifrost uses only the configured OMP `@vision` role for a bounded one-shot interpretation and appends that analysis while retaining the recovered image in session history.

This remains a compatibility layer: Pifrost never connects directly to Hound or DonSeTch. Bifrost Code Mode is intentionally not rehydrated because `executeToolCode` does not preserve trustworthy provenance for nested textual image markers; diagnostics report that path as conditional rather than multimodal-ready.

### Physical request compatibility (v0.12.3)

Pifrost creates physical Chat/Responses policies for every provider-qualified Bifrost route (including unrecognised third-party provider namespaces). Physical requests retain the original route's `requestModelId` but never inherit the logical alias's reasoning or tool dialect. A logical route remains a conservative selection envelope, not a physical adapter policy.

For a dynamic route, native OMP builds a request-compatibility signature for each eligible provider and model. Adjacent members can share a Bifrost-managed same-protocol fallback request only if their provider, identity, reasoning replay, tool and role fields, and relevant wire policy agree. Differing or unknown signatures create a distinct pre-output attempt in the configured route order. No retries occur after model text, thinking or tool output. A stderr diagnostic reports each split without leaking request content. Bifrost remains authoritative for ordering, credentials, quotas and compatible same-protocol fallbacks.

Verified hard output-limit exceptions are stored in `endpoint-contracts.ts` with upstream evidence, not inferred for other entitlements. Actual output limits remain the lower of confirmed and live capabilities. Cache schema v18 invalidates earlier capability policy snapshots.

Do not delete synthetic DeepSeek reasoning replay placeholders: some DeepSeek-compatible adapters require non-empty replay content. Pifrost's exact CommandCode DeepSeek V4.1 summary-omission workaround is transport-only. For production provider verification, use Bifrost request logs and run representative reasoning-on/off, tools, multi-turn history, compaction, and fallback tests; the repository's automated provider matrix is an offline compatibility test, **not** a claim of live access to every external provider.
