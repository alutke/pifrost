# Pifrost

Pifrost is a native provider extension for Pi / OhMyPi that connects to Maxim Bifrost and exposes **Bifrost routing aliases with correctly derived model metadata**.

It is based on [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider). The upstream provider already handled Bifrost model discovery, authentication, Chat Completions transport and runtime model refresh. Pifrost adds conservative capability synthesis for aliases such as `omp-default`, `omp-slow`, `omp-plan`, and `omp-vision`.

## Why

Bifrost routing rules can use a logical model name such as:

```text
omp-slow
  -> openai/gpt-5.6-luna
  -> CommandCode GOAT/deepseek/deepseek-v4-pro
  -> deepseek/deepseek-v4-pro
```

Pi only sees the logical model name. Without extra metadata it cannot know the safe context window, maximum output, vision support or reasoning levels behind that route.

Pifrost discovers the physical models from Bifrost and calculates an alias capability envelope:

- `contextWindow` = minimum context window across every route member
- `maxTokens` = minimum output limit across every route member
- image input = enabled only when every route member supports images
- reasoning = enabled only when every route member supports reasoning
- reasoning efforts = intersection of supported effort levels
- tools = reported by `/pifrost doctor` only when every route member advertises tool support
- displayed cost = conservative maximum across route members

If **any configured route member cannot be resolved**, the alias is withheld instead of publishing unsafe metadata.

Pifrost does **not** classify prompts or select providers. Bifrost remains the routing and fallback authority.

## Install from GitHub

```bash
pi install git:github.com/alutke/pifrost
```

For OhMyPi, use the same Pi extension installation mechanism supported by your OMP build.

## Configure Bifrost

Pifrost keeps the OpenAI Chat Completions transport because it is the common protocol supported by heterogeneous Bifrost chains, including providers that do not expose the Responses API.

Connection can be configured interactively:

```text
/login bifrost
```

or with environment variables:

```bash
export BIFROST_URL=http://192.168.1.221:8180
export BIFROST_API_KEY='...'
export BIFROST_VIRTUAL_KEY='sk-bf-...'
```

`BIFROST_API_KEY` is sent as `Authorization: Bearer ...` and `BIFROST_VIRTUAL_KEY` is independently sent as `x-bf-vk`.

## Configure aliases

Copy the example manifest to the global OMP agent directory:

```bash
cp pifrost.aliases.example.json ~/.omp/agent/pifrost.aliases.json
```

Pifrost searches these locations in order:

1. `--pifrost-aliases <path>`
2. `PIFROST_ALIASES`
3. `.omp/pifrost.aliases.json`
4. `./pifrost.aliases.json`
5. `~/.omp/agent/pifrost.aliases.json`

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

Provider-qualified Bifrost fallback strings are intentionally accepted. Pifrost can resolve a value such as:

```text
CommandCode GOAT/deepseek/deepseek-v4-pro
```

against the discovered physical model ID:

```text
deepseek/deepseek-v4-pro
```

This is useful when several Bifrost providers expose the same underlying model.

Set `includePhysicalModels` to `false` when OMP should see only the logical aliases. This prevents the full Bifrost physical catalog from appearing alongside the role aliases.

## OMP role configuration

A typical OMP configuration remains simple:

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

OMP fallback should remain disabled so Bifrost is the single owner of provider fallback.

## Doctor

Run:

```text
/pifrost doctor
```

Example output:

```text
Pifrost doctor — /home/pi/.omp/agent/pifrost.aliases.json
OK omp-default: context=256K output=32K image=no reasoning=no efforts=none tools=yes
OK omp-slow: context=1M output=128K image=no reasoning=yes efforts=high,max tools=yes
WARN omp-plan: context=n/a output=n/a image=no reasoning=no efforts=none tools=no
  unresolved: CommandCode GOAT/zai-org/GLM-5.2
```

A warning means Pifrost refused to publish that alias because its configured chain could not be verified completely.

## Updating Bifrost routes

The alias manifest deliberately remains separate from the protected Bifrost management API. Pifrost does not require Bifrost administrator credentials just to discover metadata.

When a routing rule changes in Bifrost, update the corresponding chain in `pifrost.aliases.json` and restart/refresh the Pi model registry. `/pifrost doctor` then validates that every chain member can still be resolved.

A future Bifrost read-only alias metadata endpoint could remove this small amount of duplication without exposing management credentials.

## Development

```bash
npm install
npm run check
npm test
```

CI runs TypeScript checking and the unit suite on every push and pull request.

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

The diagnostic-command concept is inspired by `the-matt-moo/pi-bifrost`; Pifrost does not incorporate that project's prompt classification or Pi-side model-routing architecture.
