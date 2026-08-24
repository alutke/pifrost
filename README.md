# Pifrost

Pifrost is a native **OhMyPi 18** provider and terminal control plane for **Maxim Bifrost**.

It has two jobs:

1. expose Bifrost routing aliases such as `omp-default`, `omp-slow`, `omp-plan`, and `omp-vision` to OMP with safe model metadata; and
2. configure the OMP ↔ Bifrost integration from a normal terminal, including global inference credentials, OMP model roles, route synchronization, model-cache refresh, and repository-specific MCP Virtual Keys.

Pifrost is based on [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), but uses the current OMP 18 `pi.registerProvider(name, config)` API rather than the legacy Pi compatibility layer.

---

## Contents

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Credential and security model](#credential-and-security-model)
- [Global configuration](#global-configuration)
- [OMP configuration](#omp-configuration)
- [Routing aliases](#routing-aliases)
- [Model metadata and cache](#model-metadata-and-cache)
- [Repository-specific MCP](#repository-specific-mcp)
- [CLI reference](#cli-reference)
- [OMP slash commands](#omp-slash-commands)
- [Configuration files](#configuration-files)
- [Environment and CLI overrides](#environment-and-cli-overrides)
- [Troubleshooting](#troubleshooting)
- [Updating Pifrost](#updating-pifrost)
- [Development](#development)

---

## Architecture

Pifrost deliberately does **not** become a second prompt router. Bifrost remains the single authority for provider selection and fallback.

```text
OMP
 │
 │  bifrost/omp-default
 │  bifrost/omp-slow
 │  bifrost/omp-plan
 │  ...
 ▼
Pifrost OMP provider
 │
 │ OpenAI Chat Completions transport
 │ Authorization: Bearer <inference API key>
 │ x-bf-vk: <global inference VK>
 ▼
Bifrost /v1
 │
 ├─ routing rules
 ├─ provider fallback
 ├─ provider keys
 └─ model providers
```

Repository-specific MCP is deliberately separate:

```text
<repo>/.omp/mcp.json
 │
 │ x-bf-vk: !pifrost secret repo-mcp --id <repo-id>
 ▼
Pifrost local secret store
 │
 │ dedicated repo MCP Virtual Key
 ▼
Bifrost /mcp
 │
 └─ only MCP clients/tools allowed on that repo VK
```

The global inference Virtual Key and repository MCP Virtual Keys should be different keys with different permissions.

---

## Why Pifrost derives alias metadata

A Bifrost routing rule can expose a logical model such as:

```text
omp-slow
  -> openai/gpt-5.6-luna
  -> CommandCode GOAT/deepseek/deepseek-v4-pro
  -> deepseek/deepseek-v4-pro
```

OMP sees only `bifrost/omp-slow`. Without additional metadata it cannot know the safe context window, maximum output, vision support, or controllable reasoning levels of the fallback chain.

Pifrost calculates a conservative alias capability envelope:

- `contextWindow` = minimum safe context window across every route member
- `maxTokens` = minimum safe output limit across every route member
- image input = enabled only when every route member supports images
- reasoning = enabled only when every route member supports reasoning
- reasoning efforts = intersection of published effort levels
- tool support = true only when every route member advertises tool support
- displayed cost = conservative maximum across route members

If any configured route member cannot be resolved safely, the alias is withheld instead of publishing guessed metadata.

---

## Requirements

- Node.js **22.19 or later**
- OhMyPi **18.0.4 or later** in the 18.x line
- Maxim Bifrost with the OpenAI-compatible Chat Completions endpoint enabled
- a Bifrost inference API/Bearer credential
- a Bifrost **global inference Virtual Key** with access to the physical models used by the `omp-*` routing rules
- outbound HTTPS access to `getbifrost.ai` when refreshing capability metadata

For full CLI automation you should also create a Bifrost **management API key** with permission to read routing rules and manage Virtual Keys/MCP configuration. In Bifrost this is created under **Settings → API Keys**. The management key is not used for inference and is never passed to OMP's provider runtime.

Third-party MCP OAuth can still require browser consent. Pifrost can automate Bifrost-side VK assignment and OMP configuration, but it cannot bypass an upstream provider's OAuth consent requirement.

---

## Installation

### Recommended: install the terminal CLI, then let it install the OMP extension

Using npm:

```bash
npm install --global github:alutke/pifrost
pifrost --version
pifrost init
```

Using Bun:

```bash
bun add --global github:alutke/pifrost
pifrost --version
pifrost init
```

`pifrost init` runs the guided global setup and installs/updates the OMP extension with:

```bash
omp install --force github:alutke/pifrost
```

### Extension only

If you only want the OMP provider and prefer to configure files/environment variables yourself:

```bash
omp install github:alutke/pifrost
```

The standalone terminal commands will only be available if the package is also installed globally or otherwise placed on `PATH`.

---

## Quick start

### 1. Install

```bash
npm install --global github:alutke/pifrost
```

### 2. Run the guided setup

```bash
pifrost init
```

The wizard asks for:

- Bifrost URL, for example `http://bifrost.lan:8180/v1`
- inference API/Bearer key
- global inference Virtual Key
- optional Bifrost management API key

It then:

1. tests `/v1/models` using the inference credentials;
2. tests the management API when a management key is supplied;
3. stores credentials securely under `~/.config/pifrost/`;
4. configures OMP's Bifrost-only role mappings;
5. installs/updates the Pifrost OMP extension;
6. synchronizes enabled `omp-*` Bifrost routing rules when management access is available; and
7. performs a network-backed model refresh to seed the startup cache.

### 3. Verify

```bash
pifrost doctor
```

You can also inspect individual areas:

```bash
pifrost global status
pifrost routes diff
pifrost models doctor
```

### 4. Configure a repository for MCP

From inside a Git repository:

```bash
cd ~/workspace/my-project
pifrost repo init
```

Pifrost lists the MCP clients already configured in Bifrost, lets you choose the clients and allowed tools, creates/updates a dedicated MCP-only Virtual Key, writes `.omp/mcp.json`, stores the secret outside the repository, and tests the Bifrost MCP endpoint.

---

## Credential and security model

Pifrost separates three credential classes.

### 1. Inference API/Bearer key

Used by the Pifrost provider to authenticate to Bifrost's OpenAI-compatible inference API.

```text
Authorization: Bearer <inference API key>
```

### 2. Global inference Virtual Key

Used for model/provider governance on normal OMP LLM calls.

```text
x-bf-vk: <global inference VK>
```

This key should be permitted to access the physical models required by the Bifrost `omp-*` routes.

### 3. Repository MCP Virtual Keys

Each repository can have its own key, for example:

```text
omp-homelab-mcp
omp-dockeddeals-mcp
```

A repo MCP key is created without provider configurations, so it is intended to be **deny-by-default for inference** and only carries explicit `mcp_configs`.

Bifrost's MCP governance is also deny-by-default: a Virtual Key with no MCP client configuration has no MCP tool access. Pifrost writes only the selected MCP client/tool allow-lists.

### Management API key

The management API key is used by terminal commands that modify Bifrost:

- `pifrost routes ...`
- `pifrost repo init`
- `pifrost repo mcp ...`
- `pifrost repo rotate-key`

It is stored in Pifrost's local secret file but is **not loaded into the OMP extension runtime**.

### Secret storage

Pifrost stores secrets in:

```text
~/.config/pifrost/secrets.json
```

The CLI creates this file with mode `0600`.

Normal non-secret configuration is in:

```text
~/.config/pifrost/config.json
```

Pifrost also writes this with mode `0600` to keep the entire configuration directory private by default.

### Repo MCP files contain no secret

A generated `.omp/mcp.json` looks like this:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "bifrost": {
      "type": "http",
      "url": "http://bifrost.lan:8180/mcp",
      "timeout": 120000,
      "headers": {
        "x-bf-vk": "!pifrost secret repo-mcp --id my-project-0123456789"
      }
    }
  }
}
```

OMP supports `!command` resolution for HTTP/SSE MCP headers. Immediately before connecting, OMP executes the command and uses its trimmed stdout as the header value.

This means `.omp/mcp.json` can be committed without embedding the Virtual Key. The local machine must have the `pifrost` CLI on `PATH` and the corresponding repo secret in its local Pifrost secret store.

---

## Global configuration

### Guided setup

```bash
pifrost global setup
```

The command is idempotent. If credentials already exist, the wizard asks whether to keep them instead of displaying their value.

Example with flags:

```bash
pifrost global setup \
  --url http://bifrost.lan:8180/v1 \
  --api-key '...' \
  --virtual-key '...' \
  --management-key '...'
```

For automation/non-interactive use:

```bash
pifrost global setup \
  --url "$BIFROST_URL" \
  --api-key "$BIFROST_API_KEY" \
  --virtual-key "$BIFROST_VIRTUAL_KEY" \
  --management-key "$BIFROST_MANAGEMENT_API_KEY" \
  --yes
```

Available setup flags:

```text
--url <url>
--api-key <key>
--virtual-key <key>
--management-key <key>
--skip-omp
--skip-test
--yes
```

`--skip-omp` stores/tests the Bifrost configuration but does not change OMP settings.

`--skip-test` is useful when provisioning before Bifrost is reachable. A later `pifrost global status` will perform the connection checks.

### Status

```bash
pifrost global status
```

This reports configuration presence without printing secrets and tests the inference and management endpoints when credentials are available.

### Re-apply OMP settings

```bash
pifrost global configure-omp
```

Pifrost backs up the current OMP global configuration into its backup directory before changing settings.

---

## OMP configuration

`pifrost global setup` and `pifrost global configure-omp` use OMP's own schema-aware `omp config set` command rather than directly rewriting YAML.

Pifrost sets:

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

The critical policy is:

```yaml
retry:
  modelFallback: false
```

OMP must not add a second model fallback layer. Bifrost remains the only provider/model fallback authority.

Pifrost does not blindly disable unrelated providers in OMP. `enabledModels: ["bifrost/*"]` and `modelProviderOrder: ["bifrost"]` are used to make the intended Pifrost surface explicit without deleting other stored credentials.

---

## Routing aliases

### List live routes

```bash
pifrost routes list
```

Pifrost reads Bifrost's management routing API. It supports the current canonical path and the older Bifrost governance path for compatibility:

```text
/api/routing/rules
/api/governance/routing-rules
```

It derives aliases from enabled rules where either:

- the rule name itself is `omp-*`; or
- the rule's CEL expression contains an `omp-*` model literal.

Weighted targets are ordered by descending weight and then followed by the rule's explicit fallback list. Every possible route member is retained in the alias chain so capability synthesis remains conservative.

Example:

```text
$ pifrost routes list

Bifrost OMP routes (3)
----------------------
omp-default
  1. opencode-go/kimi-k2.7-code
  2. CommandCode GOAT/moonshotai/Kimi-K2.7-Code
  3. deepseek/deepseek-v4-flash

omp-slow
  1. openai/gpt-5.6-luna
  2. CommandCode GOAT/deepseek/deepseek-v4-pro
  3. deepseek/deepseek-v4-pro
```

### Compare Bifrost with the local manifest

```bash
pifrost routes diff
```

If there are differences, the command prints both chains and exits with status `2`. This makes it useful in scripts or CI.

### Synchronize routes

```bash
pifrost routes sync
```

This:

1. reads live Bifrost routing rules;
2. derives every enabled `omp-*` route;
3. backs up the existing local manifest;
4. atomically writes `~/.omp/agent/pifrost.aliases.json`; and
5. performs a forced model refresh so the derived capability cache matches the new routes.

To update only the manifest:

```bash
pifrost routes sync --no-refresh
```

---

## Model metadata and cache

Bifrost's `/v1/models` response can be intentionally sparse. Pifrost therefore separates **availability** from **capability metadata**:

1. Bifrost `/v1/models`, authenticated with the global inference Bearer credential and inference Virtual Key, determines which physical models are actually available to that OMP identity.
2. Bifrost's public `https://getbifrost.ai/datasheet` supplies context limits, output limits, architecture/modalities and pricing.
3. Bifrost's public `https://getbifrost.ai/datasheet/model-parameters` supplies reasoning/tool metadata where published.

The public model-parameters feed is not complete for every model. Missing capability data is treated conservatively. Pifrost does not guess an alias's safe context/output envelope.

### Cache-first startup

Pifrost keeps a last-known-good non-secret catalog at:

```text
~/.omp/agent/pifrost.catalog.json
```

Once seeded, Pifrost passes those models to `pi.registerProvider()` synchronously. OMP can select `bifrost/omp-*` during startup without waiting for Bifrost `/v1/models` plus the public datasheets.

The cache stores only model metadata and diagnostics. It does **not** contain the inference API key or raw Virtual Key.

Cache identity is bound to:

- normalized Bifrost URL
- SHA-256 fingerprint of the inference Virtual Key
- SHA-256 fingerprint of the active alias manifest

Changing any of those invalidates the cache automatically. A cache older than 30 days is ignored as a safety boundary. A cache becomes refresh-due after six hours by default; refresh-due data is still served immediately and Pifrost refreshes it for a subsequent session.

### Refresh

Normal refresh:

```bash
pifrost models refresh
```

Force network-backed discovery:

```bash
pifrost models refresh --force
```

Equivalent manual OMP command:

```bash
PIFROST_FORCE_REFRESH=1 omp models refresh
```

### Terminal model doctor

```bash
pifrost models doctor
```

This reads the last-known-good catalog and prints each alias's context, output limit, thinking efforts, and image support. It also reports unresolved route members and exits non-zero when the catalog needs attention.

---

## Repository-specific MCP

Repository MCP is where the CLI provides the largest operational improvement: no raw Virtual Key has to be copied into the repository or shell environment.

### Initial setup

Run from anywhere inside the target Git repository:

```bash
pifrost repo init
```

Pifrost determines the repository identity from `remote.origin.url` when available, otherwise from its local repository root. A stable short repo ID is derived using SHA-256, for example:

```text
homelab-16a27f913c
```

It then:

1. queries Bifrost `/api/mcp/clients`;
2. displays configured MCP clients;
3. asks which clients the repository may use;
4. asks which tools are permitted for each client (`*` by default);
5. creates or updates a Bifrost Virtual Key named `omp-<repo>-mcp`;
6. writes the selected `mcp_configs` to that Virtual Key;
7. stores the raw repo Virtual Key only in `~/.config/pifrost/secrets.json`;
8. writes/merges `<repo>/.omp/mcp.json`; and
9. performs an MCP `initialize` request using the repo VK.

### Non-interactive repo setup

Allow every tool from two existing Bifrost MCP clients:

```bash
pifrost repo init --clients home-assistant,railway --tools '*'
```

Allow selected tools from one client:

```bash
pifrost repo init \
  --clients home-assistant \
  --tools get_state,call_service,list_entities
```

The same `--tools` value is applied to every client supplied through `--clients`. Use the interactive wizard when different clients need different tool lists.

### Check repo status

```bash
pifrost repo status
```

This shows:

- repo ID
- Bifrost Virtual Key ID/name
- whether the local secret exists
- `.omp/mcp.json` presence
- configured MCP clients/tools
- live MCP `initialize` HTTP status

### List available Bifrost MCP clients

```bash
pifrost repo mcp list
```

Where Bifrost reports its tool inventory, Pifrost prints the available tool names.

### Add an MCP client to the current repo key

All tools:

```bash
pifrost repo mcp add railway --tools '*'
```

Selected tools:

```bash
pifrost repo mcp add home-assistant --tools get_state,call_service
```

### Remove an MCP client

```bash
pifrost repo mcp remove railway
```

Bifrost's VK allow-list remains authoritative. Removing a client from the VK blocks that client's tools for the repository even though the MCP client still exists globally in Bifrost.

### Rotate the repo MCP Virtual Key

```bash
pifrost repo rotate-key
```

The new value is saved directly into Pifrost's local secret store. `.omp/mcp.json` does not change because it references the stable repo ID rather than the key value.

### Reset local repo integration

```bash
pifrost repo reset
```

This removes the generated `bifrost` entry from `.omp/mcp.json` and removes the local Pifrost repo state/secret.

For safety it does **not** automatically delete the Bifrost Virtual Key. This avoids destroying a server-side key that another checkout or automation might still use. Delete it separately in Bifrost if it is no longer required.

### Test the secret resolver manually

The following command intentionally prints the raw key and is mainly intended for OMP's `!command` mechanism:

```bash
pifrost secret repo-mcp --id <repo-id>
```

Do not put that output into committed files.

---

## CLI reference

```text
pifrost init
    First-time setup. Installs/updates the OMP extension, runs global setup,
    syncs routes when management access exists, and seeds the model cache.

pifrost global setup
    Guided global Bifrost credential and OMP configuration.

pifrost global status
    Validate stored global config and live Bifrost connectivity.

pifrost global configure-omp
    Re-apply Pifrost's OMP role/provider settings using `omp config set`.

pifrost routes list
    Show live Bifrost omp-* route chains.

pifrost routes diff
    Compare live Bifrost routes with pifrost.aliases.json.

pifrost routes sync [--no-refresh]
    Generate pifrost.aliases.json from live routing rules and normally refresh
    the model catalog.

pifrost models refresh [--force]
    Run OMP model refresh. --force bypasses Pifrost's fresh-cache shortcut.

pifrost models doctor
    Inspect the local Pifrost catalog and alias diagnostics.

pifrost repo init [--clients a,b] [--tools '*']
    Create/update a dedicated repo MCP VK and write .omp/mcp.json.

pifrost repo status
    Validate the current repository's MCP integration.

pifrost repo rotate-key
    Rotate the current repo's MCP Virtual Key and update local secrets.

pifrost repo mcp list
    List Bifrost MCP clients and visible tools.

pifrost repo mcp add <client> [--tools '*|a,b']
    Add/update one MCP client in the current repo VK allow-list.

pifrost repo mcp remove <client>
    Remove one MCP client from the current repo VK allow-list.

pifrost repo reset
    Remove local repo Pifrost MCP configuration; leave server-side VK intact.

pifrost secret repo-mcp --id <repo-id>
    Print only the raw repo MCP VK. Used by OMP MCP header command resolution.

pifrost doctor
    Combined global + model + current-repo checks.

pifrost --version
    Print the installed Pifrost version.
```

---

## OMP slash commands

The OMP extension still provides lightweight in-session diagnostics.

### Doctor

```text
/pifrost doctor
```

This is cache-first and reports alias envelopes without forcing the expensive network discovery path.

Example:

```text
Pifrost doctor — /home/user/.omp/agent/pifrost.aliases.json
OK omp-default: context=256K output=32K image=no reasoning=no efforts=none tools=yes
OK omp-slow: context=1M output=128K image=no reasoning=yes efforts=high,max tools=yes
WARN omp-plan: context=n/a output=n/a image=no reasoning=no efforts=none tools=no
  unresolved: some-provider/some-model
```

### Refresh

```text
/pifrost refresh
```

This performs fresh discovery and rewrites the last-known-good catalog. Restart OMP afterward to guarantee that the newly refreshed envelope is the one selected during startup.

For administration, prefer the standalone terminal CLI because it can run before OMP starts and can safely manage credentials/files without tying configuration work to an interactive model session.

---

## Configuration files

### Pifrost global config

```text
~/.config/pifrost/config.json
```

Contains non-secret data such as:

- Bifrost URL
- repo IDs
- repo Virtual Key IDs/names
- selected MCP client/tool metadata

### Pifrost secret store

```text
~/.config/pifrost/secrets.json
```

Contains:

- inference API/Bearer key
- global inference Virtual Key
- optional Bifrost management API key
- repo MCP Virtual Key values

Mode: `0600`.

### Alias manifest

```text
~/.omp/agent/pifrost.aliases.json
```

Can be generated from Bifrost with:

```bash
pifrost routes sync
```

Pifrost also supports project-local/manual alias files in the normal lookup order:

1. `--pifrost-aliases <path>`
2. `PIFROST_ALIASES`
3. `PIFROST_ALIASES_FILE`
4. `.omp/pifrost.aliases.json`
5. `./pifrost.aliases.json`
6. `~/.omp/agent/pifrost.aliases.json`

### Startup catalog

```text
~/.omp/agent/pifrost.catalog.json
```

Non-secret last-known-good model metadata.

### Repository MCP config

```text
<repo>/.omp/mcp.json
```

Contains the Bifrost MCP endpoint and a `!pifrost secret ...` resolver, not the raw key.

### Backups

Global Pifrost/OMP backups are placed under:

```text
~/.config/pifrost/backups/
```

Repository MCP file backups are placed under:

```text
<repo>/.omp/backups/
```

---

## Environment and CLI overrides

The OMP extension resolves global inference configuration in this order:

```text
OMP Pifrost CLI flag
        ↓
process environment
        ↓
~/.config/pifrost config/secret store
```

Supported runtime flags:

```text
--bifrost-url
--bifrost-api-key
--bifrost-virtual-key
--pifrost-aliases
```

Supported environment variables:

```text
BIFROST_URL
BIFROST_API_KEY
BIFROST_VIRTUAL_KEY
BIFROST_MANAGEMENT_API_KEY   # terminal CLI only
PIFROST_CONFIG_DIR           # relocate Pifrost config/secret store
PIFROST_ALIASES
PIFROST_ALIASES_FILE
PIFROST_CACHE_FILE
PIFROST_REFRESH_INTERVAL_MS
PIFROST_FORCE_REFRESH
```

Because Pifrost 0.2 reads its own secure store, normal interactive OMP sessions no longer require `source ~/.config/pifrost/credentials.env` or shell-exported `BIFROST_*` variables.

Environment variables remain useful for ephemeral CI/automation overrides.

---

## Manual alias configuration

The CLI is recommended, but a manual manifest remains supported.

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

Subscription aliases that append `-free` to an otherwise identical underlying model, such as `poolside/laguna-s-2.1-free`, can inherit the underlying Bifrost capability entry where appropriate.

---

## Troubleshooting

### `pifrost: command not found`

Install the standalone CLI globally:

```bash
npm install --global github:alutke/pifrost
```

Then verify:

```bash
command -v pifrost
pifrost --version
```

### OMP says `Pifrost is not configured`

Run:

```bash
pifrost global status
pifrost global setup
```

Pifrost 0.2 should normally read credentials from `~/.config/pifrost/` without shell exports.

### OMP starts with `no-model`

Check the last-known-good catalog:

```bash
pifrost models doctor
```

Then seed/refresh it:

```bash
pifrost models refresh --force
```

Also verify the extension version:

```bash
omp plugin list | grep -A2 -B2 pifrost
```

### Route changes in Bifrost are not reflected in OMP

```bash
pifrost routes diff
pifrost routes sync
```

### `Management API key is missing`

Create a Bifrost management API key with permission to read routing rules and manage Virtual Keys/MCP configuration, then run:

```bash
pifrost global setup
```

You can keep the existing inference credentials and only add the management key.

### Repo MCP returns `virtual key not found`

The local repo secret is stale or no longer exists in Bifrost.

Check:

```bash
pifrost repo status
```

If the server-side key still exists but should be rotated:

```bash
pifrost repo rotate-key
```

Otherwise recreate/reconcile the repo configuration:

```bash
pifrost repo init
```

### Repo MCP returns `virtual key required`

Verify `.omp/mcp.json` uses `x-bf-vk`, not a malformed Authorization header:

```bash
cat .omp/mcp.json
```

The generated entry should use:

```json
"headers": {
  "x-bf-vk": "!pifrost secret repo-mcp --id ..."
}
```

### Repo MCP key is valid but no tools are visible

Check the Bifrost VK's MCP client/tool allow-list:

```bash
pifrost repo status
pifrost repo mcp list
```

Then add the required client/tools:

```bash
pifrost repo mcp add <client> --tools '*'
```

Bifrost denies MCP tools that are not explicitly included in the VK's MCP configuration.

### `!pifrost secret ...` fails from OMP

OMP starts the command from its own process environment. Ensure `pifrost` is globally available on `PATH`:

```bash
command -v pifrost
```

Then test the resolver manually. **This prints the secret**, so do not paste the output into logs/issues:

```bash
pifrost secret repo-mcp --id <repo-id>
```

### MCP OAuth still opens a browser

Expected for providers that require interactive OAuth consent. Pifrost manages the Bifrost/OMP configuration around the MCP client; it does not bypass the upstream provider's authentication policy.

---

## Updating Pifrost

Update the standalone CLI:

```bash
npm install --global github:alutke/pifrost
```

Update the OMP extension:

```bash
omp install --force github:alutke/pifrost
```

Then refresh metadata:

```bash
pifrost models refresh --force
pifrost doctor
```

Or simply run the first-time workflow again; it is designed to be idempotent:

```bash
pifrost init
```

---

## Development

```bash
git clone https://github.com/alutke/pifrost.git
cd pifrost
npm install
npm run check
npm test
node scripts/validate-public-datasheets.mjs
npx tsx scripts/validate-current-routing.ts
```

Useful local CLI invocation without installing globally:

```bash
node cli.mjs --help
node cli.mjs global status
```

The CI pipeline validates:

- TypeScript typechecking
- Node syntax for the standalone CLI
- provider and cache unit tests
- CLI configuration/secret-resolution tests
- current Bifrost public datasheet coverage
- current OMP route envelopes
- installation through the real OMP 18.0.4 plugin loader

---

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

The diagnostic-command concept is inspired by `the-matt-moo/pi-bifrost`; Pifrost does not incorporate that project's prompt classification or Pi-side model-routing architecture.
