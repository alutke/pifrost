# Pifrost

**Use Maxim Bifrost as the routing, governance and MCP backend for OhMyPi (OMP).**

Pifrost gives OMP a small set of stable logical models such as <code>bifrost/omp-default</code>, <code>bifrost/omp-plan</code> and <code>bifrost/omp-vision</code>. Those aliases point at routes you own in Bifrost, so you can change providers, models and fallbacks without continually reconfiguring OMP.

Pifrost also provides a terminal CLI for setup, route synchronization, diagnostics, repository-scoped MCP access and the optional Bifrost Skills → OMP Skills bridge.

> **Design rule:** Pifrost is not a second policy router. Bifrost remains authoritative for provider credentials, physical model/provider ordering, routing policy, same-protocol fallback and governance. Pifrost may remove members that cannot satisfy the request contract and may cross a wire-protocol boundary only before any model output is emitted; it never reorders surviving members for quality, cost, quota or preference.

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

For the full implementation and compatibility detail, see the [technical reference](docs/REFERENCE.md). For release-specific changes, see the [changelog](CHANGELOG.md).

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

That gives you five useful properties:

- **Stable OMP roles.** OMP uses logical aliases while Bifrost owns the real model chain.
- **Safer capabilities.** Pifrost advertises only capabilities it can establish safely for the route.
- **Session-aware routing.** OMP conversation identity is forwarded to Bifrost for route/provider-key affinity and to OpenCode Go where required.
- **Agentic OpenRouter attribution.** Pifrost forwards the real OMP/pi application identity through Bifrost so OpenRouter endpoints gated to recognised agentic harnesses (including free Inkling) can be used without bypassing Bifrost.
- **Repository-scoped MCP.** Each repository can have its own Bifrost MCP Virtual Key without committing the raw secret.
- **One diagnostic surface.** <code>pifrost doctor</code> checks the OMP, Bifrost, routing, model and current-repository integration together.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | **22.19+** |
| OhMyPi | **18.4.5+** in the 18.x line |
| Maxim Bifrost | **2.2.4+** |
| Recommended Bifrost | **2.2.4+** for the complete current feature set |

You also need:

- a Bifrost inference Virtual Key that can access the physical models used by your <code>omp-*</code> routes;
- management credentials if you want route synchronization or repository MCP automation; and
- outbound HTTPS access to <code>getbifrost.ai</code> when Pifrost refreshes public model metadata.

### Bifrost OSS vs Enterprise management auth

Pifrost keeps inference and management authentication separate.

- **Bifrost OSS:** use the Bifrost dashboard/admin username and password over HTTP Basic auth.
- **Bifrost Enterprise:** you can use a scoped management Bearer/API key.

HTTP Basic auth is only encoding. If Bifrost is not local, keep it on a trusted private network or put TLS/HTTPS in front of it.

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
0.8.4
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

### How capability safety works

A logical route can contain models with different context windows, output limits, image support, reasoning/tool support and **wire protocols**. Pifrost derives a safe OMP-facing capability envelope from the route instead of blindly advertising the primary model's capabilities.

For straightforward global fallback routes, Pifrost also uses **context-aware prewalk**. Before each request reaches Bifrost it removes members that are known to be incompatible with the final request: context/output limits, image/tool/reasoning constraints and supported wire protocols are all considered.

On the native OMP path, context sizing uses a dependency-free semantic estimate of the actual provider Context rather than serializing OMP's internal objects. Pifrost reuses trustworthy provider usage as a prefix anchor, counts only the unreported tail locally, and otherwise counts the system prompt, tool schemas and semantic message content with conservative headroom. Internal metadata such as tool-result `details`, timestamps and usage records is not treated as model prompt content.

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

### Web research through Hound MCP

Pifrost treats Hound as a normal repository-scoped **Bifrost MCP client**. Pifrost does not install Hound, start it, connect to Hound directly, proxy its HTTP endpoint, or create a synthetic `omp-web` model. Bifrost remains the sole MCP boundary exposed to OMP.

The supported Hound MCP contract is the six tools published by `master-fetch`: `mcp_smart_search`, `mcp_smart_fetch`, `mcp_smart_crawl`, `mcp_screenshot`, `cache_clear` and `version`.

`pifrost repo status` validates Hound through the repository Virtual Key. In classic MCP mode it checks the canonical Hound tools returned by Bifrost `tools/list`. If the Hound client has **Bifrost Code Mode** enabled, the raw Hound tools are intentionally hidden; Pifrost instead verifies the four Code Mode meta-tools, calls `listToolFiles`, and reads the Hound virtual `.pyi` stub with `readToolFile`. Those probes are local and non-destructive: Pifrost does not run a search, fetch a page, crawl a site, or start a browser during status/doctor.

Readiness is reported separately:

- **search ready** — `mcp_smart_search`
- **web research ready** — search + fetch
- **deep research ready** — search + fetch + crawl
- **screenshot callable** — Hound exposes `mcp_screenshot`
- **visual web ready** — screenshot content is preserved as actual multimodal image content end-to-end

Current supported Bifrost MCP releases flatten upstream MCP `ImageContent` into text while relaying tool results. Pifrost therefore reports Hound screenshot as callable but **not multimodal-ready through Bifrost** and emits a warning rather than overstating the capability. Search, fetch, crawl, PDF/OCR extraction and other text/structured Hound functions remain compatible with Bifrost Code Mode.

OMP's native `modelRoles.web` / `retry.fallbackChains.web` remain a separate mechanism. Pifrost reports the Hound MCP path and native web path independently; it does not choose between them for the model.

Pifrost also reports the live Bifrost MCP tool count, OMP's default `discoverable` presentation, approximate eager schema footprint, Bifrost client instruction metadata where exposed, and attached Virtual MCP instruction provenance. Discoverable presentation, Bifrost Code Mode and provider-side `defer_loading`/Tool Search are separate mechanisms.

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

Pifrost repairs the current Bifrost MCP image-flattening behavior at the OMP tool-result boundary only for directly exposed Hound `mcp_screenshot` tools. Markers must pass MIME, canonical Base64, decoded-size, aggregate-count/size and image-signature validation before they become native OMP image blocks. If the active model is text-only, Pifrost uses only the configured OMP `@vision` role for a bounded one-shot interpretation and appends that analysis while retaining the recovered image in session history.

This remains a compatibility layer: Pifrost never connects directly to Hound. Bifrost Code Mode is intentionally not rehydrated because `executeToolCode` does not preserve trustworthy provenance for nested textual image markers; diagnostics report that path as conditional rather than multimodal-ready.
