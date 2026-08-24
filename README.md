# Pifrost

Pifrost is a native **OhMyPi 18** provider extension for Maxim Bifrost. It exposes Bifrost routing aliases such as `omp-default`, `omp-slow`, `omp-plan`, and `omp-vision` with model metadata derived from the physical models behind each route.

Pifrost is based on [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), but uses the current OMP 18 `pi.registerProvider(name, config)` API rather than the legacy Pi provider compatibility layer.

## Why

A Bifrost routing rule can expose a logical model such as:

```text
omp-slow
  -> openai/gpt-5.6-luna
  -> CommandCode GOAT/deepseek/deepseek-v4-pro
  -> deepseek/deepseek-v4-pro
```

OMP sees only `bifrost/omp-slow`. Without additional metadata it cannot know the safe context window, maximum output, vision support, or controllable reasoning levels of the fallback chain.

Pifrost calculates a conservative alias capability envelope:

- `contextWindow` = minimum context window across every route member
- `maxTokens` = minimum output limit across every route member
- image input = enabled only when every route member supports images
- reasoning = enabled only when every route member supports reasoning
- reasoning efforts = intersection of published effort levels
- tool support = reported by `/pifrost doctor` only when every route member advertises it
- displayed cost = conservative maximum across route members

If any configured route member cannot be resolved safely, the alias is withheld instead of publishing guessed metadata.

Pifrost does **not** classify prompts or select providers. Bifrost remains the routing and fallback authority.

## Metadata sources

Bifrost's OpenAI-compatible `/v1/models` response can be intentionally sparse. Pifrost therefore separates **availability** from **capability metadata**:

1. Bifrost `/v1/models`, authenticated with the global inference Bearer credential and inference Virtual Key, determines which physical models are actually available to that OMP identity.
2. Bifrost's public `https://getbifrost.ai/datasheet` supplies context limits, output limits, architecture/modalities and pricing.
3. Bifrost's public `https://getbifrost.ai/datasheet/model-parameters` supplies reasoning/tool metadata when that model is published in the parameters feed.

These are the same public catalog sources Bifrost uses to build its management model catalog. Pifrost does not need or persist Bifrost administrator credentials during normal OMP operation.

The public model-parameters feed is not complete for every model. Missing reasoning metadata is treated conservatively; Pifrost does not invent selectable reasoning levels. Context and maximum-output metadata are mandatory for an alias member.

## Requirements

- OhMyPi 18.0.4 or later in the 18.x line
- Bifrost OpenAI-compatible Chat Completions endpoint
- a Bifrost inference API credential
- a Bifrost inference Virtual Key with access to every `omp-*` route Pifrost should expose
- outbound HTTPS access to `getbifrost.ai` when refreshing Bifrost's public capability datasheets

The LLM Virtual Key is intentionally separate from project-specific MCP Virtual Keys.

## Install

```bash
omp install github:alutke/pifrost
```

Pifrost's CI validates TypeScript, unit tests, the current Bifrost public datasheet coverage used by the target route families, the target OMP routing envelopes, and loading with the real OMP 18.0.4 plugin loader.

## Configure global LLM access

Pifrost uses OpenAI Chat Completions because that is the common transport across heterogeneous Bifrost fallback chains.

Configure the global inference connection in the environment:

```bash
export BIFROST_URL='http://192.168.1.221:8180/v1'
export BIFROST_API_KEY='...'
export BIFROST_VIRTUAL_KEY='...'
```

Pifrost sends:

```text
Authorization: Bearer <BIFROST_API_KEY>
x-bf-vk: <BIFROST_VIRTUAL_KEY>
```

The two credentials remain independent. The inference Virtual Key should be global to OMP model access. Repo-specific MCP access should use separate project Virtual Keys in `.omp/mcp.json`; Pifrost does not configure MCP.

CLI overrides are also available for interactive OMP launches:

```text
--bifrost-url
--bifrost-api-key
--bifrost-virtual-key
--pifrost-aliases
```

## Configure aliases

Copy the example manifest to the global OMP agent directory:

```bash
cp pifrost.aliases.example.json ~/.omp/agent/pifrost.aliases.json
```

Pifrost searches these locations in order:

1. `--pifrost-aliases <path>`
2. `PIFROST_ALIASES`
3. `PIFROST_ALIASES_FILE`
4. `.omp/pifrost.aliases.json`
5. `./pifrost.aliases.json`
6. `~/.omp/agent/pifrost.aliases.json`

Example:

```json
{
  "includePhysicalModels": false,
  "aliases": {
    "omp-default": {
      "name": "OMP Default",
      "chain": [
        "opencode-go/kimi-k2.7-code",
        "CommandCode GOAT/moonshotai/Kimi-K2.7-Code",
        "deepseek/deepseek-v4-flash"
      ]
    },
    "omp-slow": {
      "name": "OMP Slow",
      "chain": [
        "openai/gpt-5.6-luna",
        "CommandCode GOAT/deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-pro"
      ]
    }
  }
}
```

Provider-qualified Bifrost fallback references are accepted. Pifrost resolves the underlying model family for capability lookup while preserving each route member as a distinct entry during the alias intersection.

Subscription aliases that append `-free` to an otherwise identical underlying model, such as `poolside/laguna-s-2.1-free`, inherit the underlying Bifrost datasheet entry when no explicit `-free` pricing row exists.

Set `includePhysicalModels` to `false` when OMP should see only the logical aliases.

## OMP role configuration

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
  enabled: true
  modelFallback: false
```

OMP model fallback should remain disabled so Bifrost is the single owner of provider fallback.

## Cache-first startup

Pifrost keeps a **last-known-good, non-secret catalog** at:

```text
~/.omp/agent/pifrost.catalog.json
```

Once the cache has been seeded, Pifrost passes those models to `pi.registerProvider()` synchronously. OMP can therefore select `bifrost/omp-*` during startup without waiting for Bifrost `/v1/models` plus the public datasheets.

The cache stores only model metadata and diagnostics. It does **not** store the Bifrost API key or Virtual Key. Cache identity is bound to:

- the normalized Bifrost URL
- a SHA-256 fingerprint of the inference Virtual Key
- a SHA-256 fingerprint of the active alias manifest

Changing the Virtual Key, Bifrost URL, or alias manifest invalidates the cache automatically. A cache older than 30 days is also ignored as a safety boundary.

A cache is considered refresh-due after six hours by default. Refresh-due data is still served immediately for startup, and Pifrost refreshes it in the background for the next session. Fresh caches perform no network-backed model discovery on the startup critical path.

Optional tuning:

```text
PIFROST_CACHE_FILE
PIFROST_REFRESH_INTERVAL_MS
PIFROST_FORCE_REFRESH
```

## Refresh models

For an explicit network-backed refresh:

```bash
PIFROST_FORCE_REFRESH=1 omp models refresh
```

This is also the recommended command immediately after installing/upgrading Pifrost when no `pifrost.catalog.json` exists yet. It performs the slower discovery outside the interactive UI and seeds the startup cache.

Inside OMP you can also run:

```text
/pifrost refresh
```

That refreshes the on-disk last-known-good catalog. Restart OMP afterward to guarantee the newly refreshed envelope is the one selected at startup.

OMP still has its own SQLite model cache; Pifrost's small catalog cache exists specifically so extension-registered models are available synchronously before asynchronous runtime discovery completes.

## Doctor

Inside OMP:

```text
/pifrost doctor
```

`doctor` is cache-first and reports the effective alias envelopes without forcing the expensive network discovery path. For example:

```text
Pifrost doctor — /home/pi/.omp/agent/pifrost.aliases.json
OK omp-default: context=256K output=32K image=no reasoning=no efforts=none tools=yes
OK omp-slow: context=1M output=128K image=no reasoning=yes efforts=high,max tools=yes
WARN omp-plan: context=n/a output=n/a image=no reasoning=no efforts=none tools=no
  unresolved: CommandCode GOAT/zai-org/GLM-5.2
```

A warning means Pifrost refused to publish that alias because its configured chain could not be verified completely.

## Updating Bifrost routes

The alias manifest deliberately remains separate from the protected Bifrost management API. Pifrost does not require Bifrost administrator credentials during normal OMP operation.

When a routing rule changes in Bifrost, update the corresponding chain in `pifrost.aliases.json` and run:

```bash
PIFROST_FORCE_REFRESH=1 omp models refresh
```

A migration/setup script may use the Bifrost admin API once to generate the manifest from live routing rules, but the resulting Pifrost runtime requires only the global inference credentials.

## Development

```bash
npm install
npm run check
npm test
node scripts/validate-public-datasheets.mjs
```

CI also validates the target route envelopes and installs the local package with OMP 18.0.4's real plugin loader.

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

The diagnostic-command concept is inspired by `the-matt-moo/pi-bifrost`; Pifrost does not incorporate that project's prompt classification or Pi-side model-routing architecture.
