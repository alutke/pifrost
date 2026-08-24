# Pifrost

Pifrost is a native **OhMyPi 18** provider and terminal control plane for **Maxim Bifrost**.

It has two jobs:

1. expose Bifrost routing aliases such as `omp-default`, `omp-slow`, `omp-plan`, and `omp-vision` to OMP with conservative model metadata; and
2. configure and operate the OMP ↔ Bifrost integration from a normal terminal, including global inference credentials, OMP model roles, route synchronization, model-cache refresh, and repository-specific MCP Virtual Keys.

Pifrost is based on [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), but uses the current OMP 18 `pi.registerProvider(name, config)` API rather than the legacy Pi compatibility layer.

> **Important for Bifrost OSS:** scoped management API keys are an Enterprise feature. Bifrost OSS protects dashboard/admin API calls with the configured **admin username and password over HTTP Basic auth**. Pifrost 0.2.1 supports that directly. Enterprise scoped API keys remain supported as Bearer auth.

---

## Contents

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation and upgrade](#installation-and-upgrade)
- [Quick start — Bifrost OSS](#quick-start--bifrost-oss)
- [Quick start — Bifrost Enterprise](#quick-start--bifrost-enterprise)
- [Credential and security model](#credential-and-security-model)
- [Global configuration](#global-configuration)
- [OMP configuration](#omp-configuration)
- [Routing aliases](#routing-aliases)
- [Model metadata and startup cache](#model-metadata-and-startup-cache)
- [Repository-specific MCP](#repository-specific-mcp)
- [CLI reference](#cli-reference)
- [OMP slash commands](#omp-slash-commands)
- [Configuration files and precedence](#configuration-files-and-precedence)
- [Migration from Pifrost 0.2.0](#migration-from-pifrost-020)
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
 │ OpenAI Chat Completions transport
 │ Authorization: Bearer <inference API key>
 │ x-bf-vk: <global inference Virtual Key>
 ▼
Bifrost /v1
 │
 ├─ routing rules
 ├─ provider fallback
 ├─ provider keys
 └─ model providers
```

Management is a separate control-plane path:

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

Repository-specific MCP is separate again:

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

The intended separation is therefore:

```text
Global LLM access     -> global inference VK
Bifrost administration -> OSS admin Basic auth OR Enterprise API key
Repository MCP access -> one dedicated MCP VK per repository
```

Do not reuse a repository MCP VK as the global inference VK.

---

## Why Pifrost derives alias metadata

A Bifrost routing rule can expose a logical model such as:

```text
omp-slow
  -> openai/gpt-5.6-luna
  -> CommandCode GOAT/deepseek/deepseek-v4-pro
  -> deepseek/deepseek-v4-pro
```

OMP sees only `bifrost/omp-slow`. Without additional metadata it cannot know the safe context window, maximum output, image support, or controllable reasoning levels of every member of the fallback chain.

Pifrost calculates a conservative alias capability envelope:

- `contextWindow` = minimum safe context window across every route member
- `maxTokens` = minimum safe output limit across every route member
- image input = enabled only when every route member supports images
- reasoning = enabled only when every route member supports reasoning
- reasoning efforts = intersection of published effort levels
- tool support = true only when every route member advertises tool support
- displayed cost = conservative maximum across route members

If a configured route member cannot be resolved safely, Pifrost withholds the alias instead of publishing guessed metadata.

### Metadata sources

Pifrost separates live availability from capability metadata:

1. authenticated Bifrost `/v1/models` determines which physical models are visible to the global inference identity;
2. `https://getbifrost.ai/datasheet` supplies context, output, modality and pricing metadata; and
3. `https://getbifrost.ai/datasheet/model-parameters` supplies parameter/tool/reasoning metadata when published.

The public model-parameters feed is not complete for every model. Missing capabilities are treated conservatively.

---

## Requirements

- Node.js **22.19 or later**
- OhMyPi **18.0.4 or later** in the 18.x line
- Maxim Bifrost with OpenAI-compatible Chat Completions enabled
- a Bifrost inference API/Bearer credential if inference auth is enabled
- a Bifrost global inference Virtual Key with access to the physical models used by your `omp-*` routes
- outbound HTTPS access to `getbifrost.ai` when refreshing capability metadata

For route synchronization and repo MCP automation, Pifrost also needs management authentication:

- **Bifrost OSS:** the configured dashboard/admin username and password
- **Bifrost Enterprise:** optionally, a scoped management API key

### Bifrost OSS admin authentication

Bifrost OSS's own API Keys page states that dashboard and admin API calls use Basic auth with the configured admin credentials. The corresponding Bifrost configuration is under:

```json
{
  "governance": {
    "auth_config": {
      "admin_username": "env.BIFROST_ADMIN_USERNAME",
      "admin_password": "env.BIFROST_ADMIN_PASSWORD",
      "is_enabled": true
    }
  }
}
```

Those are the credentials Pifrost asks for in OSS mode.

### Transport security warning

HTTP Basic auth is **encoding, not encryption**. On an unencrypted `http://` connection, the admin username/password travel across the network in a recoverable form.

Use one of the following:

- Bifrost on localhost;
- a trusted private/LAN network whose risk you explicitly accept; or preferably
- HTTPS/TLS in front of Bifrost.

Pifrost never sends the management credentials to an LLM provider, but network transport security remains your responsibility.

---

## Installation and upgrade

### Recommended installation

Install the terminal CLI globally, then let it install/update the OMP extension:

```bash
npm install --global github:alutke/pifrost
hash -r
pifrost --version
```

Expected for this release:

```text
0.2.1
```

Bun is also supported:

```bash
bun add --global github:alutke/pifrost
hash -r
pifrost --version
```

### Install the OMP extension only

```bash
omp install github:alutke/pifrost
```

The standalone `pifrost` shell command is available only when the package itself is on `PATH`.

### Upgrade

```bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost
pifrost --version
```

Then validate:

```bash
pifrost doctor
```

---

## Quick start — Bifrost OSS

This is the normal path for the open-source Bifrost build.

### 1. Confirm Bifrost dashboard security exists

In Bifrost, open:

```text
Settings -> Security
```

Ensure an admin username/password is configured. These are also the credentials used to sign in to the protected dashboard/admin API.

You do **not** need to create a scoped API key. The OSS API Keys page shows scoped keys as an Enterprise feature.

### 2. Run Pifrost setup

```bash
pifrost init
```

The wizard asks for:

```text
Bifrost URL
Inference API/Bearer key
Global inference Virtual Key
Configure management auth?                 -> Yes
Management auth mode                       -> basic
Bifrost admin username
Bifrost admin password
```

For example, a Bifrost URL may be:

```text
http://192.168.1.221:8180/v1
```

Pifrost then:

1. installs/updates the Pifrost OMP extension;
2. tests `/v1/models` using the inference credentials;
3. tests the management API using HTTP Basic auth;
4. stores the credentials under `~/.config/pifrost/`;
5. configures OMP's Bifrost model roles;
6. reads the live `omp-*` routing rules from Bifrost;
7. writes `~/.omp/agent/pifrost.aliases.json`; and
8. performs a network-backed model refresh to seed the last-known-good startup catalog.

### 3. Verify

```bash
pifrost global status
pifrost routes diff
pifrost models doctor
```

A healthy global status should include:

```text
Management auth:        basic (OSS admin credentials)
Admin username:         set
Admin password:         set
Management connection:  OK
```

### 4. Configure a repository for MCP

From inside the repository:

```bash
cd ~/workspace/my-project
pifrost repo init
```

Pifrost lists the MCP clients configured in Bifrost, lets you select clients/tools, creates or updates a dedicated repo MCP Virtual Key, writes `.omp/mcp.json`, stores the raw key outside the repository, and tests `/mcp`.

---

## Quick start — Bifrost Enterprise

Enterprise deployments can use a scoped management API key instead of admin Basic auth.

```bash
pifrost init
```

Choose:

```text
Management auth mode -> bearer
Enterprise scoped management API key -> <key>
```

Or configure non-interactively:

```bash
pifrost global setup \
  --url 'https://bifrost.example.com/v1' \
  --api-key "$BIFROST_API_KEY" \
  --virtual-key "$BIFROST_VIRTUAL_KEY" \
  --management-auth bearer \
  --management-key "$BIFROST_MANAGEMENT_API_KEY" \
  --yes
```

The 0.2.0 `managementApiKey` storage format remains supported and is interpreted as Bearer auth automatically.

---

## Credential and security model

Pifrost separates four credential classes.

### 1. Inference API/Bearer key

Used by the OMP provider to authenticate to Bifrost's inference API:

```text
Authorization: Bearer <inference API key>
```

This is stored as `inferenceApiKey` in Pifrost's secret store.

### 2. Global inference Virtual Key

Used for Bifrost model/provider governance:

```text
x-bf-vk: <global inference VK>
```

This is stored as `inferenceVirtualKey`.

### 3. Management authentication

#### OSS

```text
Authorization: Basic base64(admin_username:admin_password)
```

Stored as:

```json
{
  "managementAdminUsername": "...",
  "managementAdminPassword": "..."
}
```

The non-secret config records:

```json
{
  "bifrost": {
    "managementAuthMode": "basic"
  }
}
```

#### Enterprise

```text
Authorization: Bearer <scoped management API key>
```

Stored as:

```json
{
  "managementApiKey": "..."
}
```

with:

```json
{
  "bifrost": {
    "managementAuthMode": "bearer"
  }
}
```

Management credentials are used only by the **standalone Pifrost CLI**. `config-store.ts` intentionally exposes only inference URL/API-key/Virtual-Key data to the OMP provider extension.

### 4. Repository MCP Virtual Keys

Each repository gets an independent Bifrost Virtual Key, for example:

```text
omp-homelab-mcp
omp-dockeddeals-mcp
```

Pifrost creates repo keys without provider configurations and with explicit `mcp_configs`, so they are intended for narrow MCP access rather than global inference.

### Local storage

Pifrost stores configuration in:

```text
~/.config/pifrost/config.json
~/.config/pifrost/secrets.json
```

Both files are written with mode `0600`; the directory is created privately.

`0600` prevents other ordinary users on the same Unix host from reading the file. It is **not encryption at rest**. If your host threat model requires encrypted credential storage, prefer environment variables supplied by your secret manager rather than persistent Pifrost secrets.

### Never commit repo secrets

Generated repo configuration contains command indirection rather than a secret:

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

OMP executes the `!pifrost secret ...` command locally and uses stdout as the header value. The raw repo VK therefore does not need to be present in the repository or a project `.env` file.

---

## Global configuration

### Interactive setup

```bash
pifrost global setup
```

The setup is safe to rerun. Existing secrets are not displayed; the wizard asks whether to keep them.

### OSS non-interactive setup

Prefer environment variables for passwords in automation so the password does not appear in shell history or the process command line:

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

Supported explicit flags are:

```text
--management-auth basic
--management-username <username>
--management-password <password>
```

`--management-password` exists for scripting, but interactive input or a secret-provided environment variable is safer than putting a password in shell history.

### Enterprise non-interactive setup

```bash
pifrost global setup \
  --url 'https://bifrost.example.com/v1' \
  --api-key "$BIFROST_API_KEY" \
  --virtual-key "$BIFROST_VIRTUAL_KEY" \
  --management-auth bearer \
  --management-key "$BIFROST_MANAGEMENT_API_KEY" \
  --yes
```

### Skip selected setup actions

```bash
pifrost global setup --skip-test
pifrost global setup --skip-omp
```

Use `--skip-test` only when the endpoint is temporarily unavailable or you are deliberately staging configuration. Normal setup should validate credentials immediately.

### Status

```bash
pifrost global status
```

Checks:

- config directory
- Bifrost URL
- inference credentials
- management auth mode
- inference connectivity
- management API connectivity
- OMP availability
- alias manifest presence

---

## OMP configuration

Pifrost configures OMP using OMP's own schema-aware CLI rather than rewriting YAML directly:

```bash
pifrost global configure-omp
```

It backs up the existing global OMP config first and sets:

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

`retry.modelFallback` must remain `false` when Bifrost owns provider/model fallback. Otherwise OMP and Bifrost can both retry through separate chains.

---

## Routing aliases

### List live routes

```bash
pifrost routes list
```

This reads enabled Bifrost routing rules and prints their physical chain.

Pifrost tries the current endpoint first:

```text
/api/routing/rules
```

and falls back to the older endpoint used by earlier Bifrost versions:

```text
/api/governance/routing-rules
```

### Compare live Bifrost with the local manifest

```bash
pifrost routes diff
```

Exit status:

- `0` = routes match
- `2` = differences found
- `1` = operational/configuration error

### Synchronize routes

```bash
pifrost routes sync
```

This:

1. reads live `omp-*` routing rules from Bifrost;
2. derives the route chains;
3. backs up the previous manifest;
4. writes `~/.omp/agent/pifrost.aliases.json`; and
5. refreshes the model catalog.

Skip the final refresh when desired:

```bash
pifrost routes sync --no-refresh
```

Pifrost does not modify the Bifrost routing rules themselves. Bifrost remains the source of truth.

---

## Model metadata and startup cache

Pifrost keeps a non-secret last-known-good catalog at:

```text
~/.omp/agent/pifrost.catalog.json
```

The cache contains model metadata and alias diagnostics only. It does not store any inference or management credential.

Cache identity is bound to:

- normalized Bifrost URL
- SHA-256 fingerprint of the global inference Virtual Key
- SHA-256 fingerprint of the alias manifest

Changing any of those invalidates the cache.

### Why the local catalog exists

Without the synchronous local catalog, OMP can start before dynamic Bifrost discovery finishes and initially report `no-model`. The cached catalog lets the extension register models immediately, while live discovery can happen outside the interactive startup critical path.

### Refresh

```bash
pifrost models refresh --force
```

Equivalent low-level OMP form:

```bash
PIFROST_FORCE_REFRESH=1 omp models refresh
```

### Diagnose

```bash
pifrost models doctor
```

The report includes context, max output, thinking levels, image support, and unresolved route members.

Default cache behavior:

- refresh due after about six hours
- maximum last-known-good age: 30 days

Advanced environment options:

```text
PIFROST_CACHE_FILE
PIFROST_REFRESH_INTERVAL_MS
PIFROST_FORCE_REFRESH
```

---

## Repository-specific MCP

### Initialize the current repository

```bash
cd /path/to/repo
pifrost repo init
```

Pifrost:

1. identifies the Git repository using its root and sanitized `origin` identity;
2. creates a stable local repo ID;
3. lists Bifrost MCP clients;
4. asks which clients/tools should be exposed;
5. creates or updates `omp-<repo>-mcp` in Bifrost;
6. stores the raw repo VK in `~/.config/pifrost/secrets.json`;
7. writes/merges `<repo>/.omp/mcp.json`; and
8. tests Bifrost `/mcp` with the repo key.

### Non-interactive repo initialization

```bash
pifrost repo init --clients home-assistant --tools '*'
```

Multiple clients:

```bash
pifrost repo init --clients home-assistant,railway --tools '*'
```

For interactive setup, you can specify a different tool list per selected client.

### Inspect repo status

```bash
pifrost repo status
```

### List Bifrost MCP clients

```bash
pifrost repo mcp list
```

### Add a client to this repo VK

```bash
pifrost repo mcp add railway --tools '*'
```

Or restrict tools:

```bash
pifrost repo mcp add railway --tools project_list,service_list,deployment_logs
```

### Remove a client

```bash
pifrost repo mcp remove railway
```

### Rotate the repo VK

```bash
pifrost repo rotate-key
```

Pifrost updates the local secret store with the returned raw key.

Pifrost deliberately does **not** silently rotate a pre-existing Virtual Key just because its raw value is unavailable locally. Rotation is an explicit security-sensitive action.

### Reset local repo integration

```bash
pifrost repo reset
```

This removes Pifrost's local repo association and the generated `bifrost` entry from `.omp/mcp.json`. It intentionally leaves the Bifrost Virtual Key intact so deletion remains an explicit server-side action.

### Tool safety

A repository VK should expose only the MCP clients/tools needed by that repository. If OMP is running with permissive/yolo approvals, every exposed tool becomes more consequential. Keep the Bifrost MCP allow-list narrow.

---

## CLI reference

| Command | Purpose |
| --- | --- |
| `pifrost init` | Install/update the OMP extension and perform guided first-time setup |
| `pifrost global setup` | Configure inference and management credentials |
| `pifrost global status` | Validate global config and live connectivity |
| `pifrost global configure-omp` | Apply the recommended OMP provider/model-role settings |
| `pifrost routes list` | Show live Bifrost `omp-*` route chains |
| `pifrost routes diff` | Compare live routes with the local Pifrost manifest |
| `pifrost routes sync` | Regenerate the local alias manifest from Bifrost |
| `pifrost models refresh --force` | Perform live model/datasheet discovery and refresh the startup cache |
| `pifrost models doctor` | Inspect the current local model catalog and unresolved members |
| `pifrost repo init` | Create/update repo-specific MCP governance and OMP config |
| `pifrost repo status` | Validate the current repo's MCP integration |
| `pifrost repo mcp list` | List MCP clients visible through the Bifrost management API |
| `pifrost repo mcp add <client>` | Add an MCP client/tool allow-list to the current repo VK |
| `pifrost repo mcp remove <client>` | Remove an MCP client from the current repo VK |
| `pifrost repo rotate-key` | Explicitly rotate the repo MCP VK |
| `pifrost repo reset` | Remove local repo integration without deleting the server VK |
| `pifrost doctor` | Run global, model and current-repo diagnostics |
| `pifrost secret repo-mcp --id <id>` | Internal secret resolver used by OMP `!command` MCP headers |
| `pifrost --version` | Show installed Pifrost version |

### Global setup flags

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

---

## OMP slash commands

Inside an OMP session:

```text
/pifrost doctor
/pifrost refresh
```

`/pifrost doctor` is cache-first and reports alias diagnostics.

`/pifrost refresh` performs network-backed model refresh and updates the last-known-good catalog. Restart OMP afterward if you want to guarantee that a newly changed capability envelope is the startup-selected one.

---

## Configuration files and precedence

### Pifrost global files

```text
~/.config/pifrost/config.json
~/.config/pifrost/secrets.json
```

Example non-secret config:

```json
{
  "schemaVersion": 1,
  "bifrost": {
    "url": "http://192.168.1.221:8180/v1",
    "managementAuthMode": "basic"
  },
  "repos": {}
}
```

Example secret structure:

```json
{
  "schemaVersion": 1,
  "inferenceApiKey": "<secret>",
  "inferenceVirtualKey": "<secret>",
  "managementAdminUsername": "<secret>",
  "managementAdminPassword": "<secret>",
  "repos": {
    "repo-id": {
      "mcpVirtualKey": "<secret>"
    }
  }
}
```

### Alias manifest

```text
~/.omp/agent/pifrost.aliases.json
```

Pifrost also searches project/local override locations supported by the provider, including `PIFROST_ALIASES` and `.omp/pifrost.aliases.json`.

### Startup catalog

```text
~/.omp/agent/pifrost.catalog.json
```

This file is non-secret.

### Repository MCP config

```text
<repo>/.omp/mcp.json
```

The generated Bifrost header contains command indirection, not the raw VK.

### Inference configuration precedence

For the OMP provider runtime:

```text
OMP CLI flag
  -> environment variable
  -> ~/.config/pifrost store
```

Supported inference environment variables:

```text
BIFROST_URL
BIFROST_API_KEY
BIFROST_VIRTUAL_KEY
PIFROST_ALIASES
PIFROST_CONFIG_DIR
```

### Management configuration precedence

For the standalone Pifrost CLI:

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

If no explicit management mode is supplied:

- an Enterprise management API-key environment variable implies `bearer`;
- admin username/password environment variables imply `basic`;
- an old stored `managementApiKey` implies `bearer` for 0.2.0 compatibility.

Management credentials are never returned by `loadStoredRuntimeConfig()` and therefore are not injected into the OMP provider runtime.

---

## Migration from Pifrost 0.2.0

Pifrost 0.2.0 incorrectly presented an Enterprise scoped management API key as the general management-authentication path.

Pifrost 0.2.1 corrects this.

### If you use Bifrost OSS

Upgrade:

```bash
npm install --global github:alutke/pifrost
hash -r
omp install --force github:alutke/pifrost
```

Then rerun:

```bash
pifrost global setup
```

Choose:

```text
Management auth mode -> basic
```

and enter the same admin username/password used for the Bifrost dashboard/admin API.

### If you already stored a 0.2.0 management API key

Pifrost preserves backward compatibility. A stored:

```json
{
  "managementApiKey": "..."
}
```

continues to resolve as Bearer management auth unless you rerun setup and choose Basic mode.

### If you use Bifrost Enterprise

No migration is required. Bearer/scoped API-key mode remains supported.

---

## Troubleshooting

### `pifrost --version` still shows an older release

```bash
npm install --global github:alutke/pifrost
hash -r
which pifrost
pifrost --version
```

If using Bun, inspect the Bun global bin path instead.

### `Management connection: FAIL (HTTP 401...)` on Bifrost OSS

Run:

```bash
pifrost global setup
```

Choose:

```text
basic
```

and use the Bifrost dashboard/admin username and password.

A direct diagnostic is:

```bash
curl -u 'ADMIN_USERNAME:ADMIN_PASSWORD' \
  http://BIFROST_HOST:8180/api/governance/virtual-keys?limit=1\&offset=0
```

Do not paste your real password into shared logs or issue reports.

If Basic auth still fails, verify Bifrost's `governance.auth_config` and that you are using the active dashboard credentials.

### The Bifrost API Keys page only says “Scope Based API Keys” / Enterprise

That is expected in OSS. Do not invent a management API key. Use `basic` management mode with the admin credentials.

### `Management auth mode must be basic or bearer`

Valid choices are:

```text
basic   -> Bifrost OSS admin username/password
bearer  -> Bifrost Enterprise scoped API key
```

Aliases such as `oss`, `admin`, `enterprise`, and `api-key` are accepted interactively/through the CLI parser and normalized to the two canonical modes.

### OMP starts with `no-model`

Check:

```bash
pifrost global status
pifrost models refresh --force
pifrost models doctor
omp models bifrost
```

The local `pifrost.catalog.json` should be populated so aliases can be registered synchronously at startup.

### `/models` eventually works but OMP startup is initially slow

Confirm you are on Pifrost 0.1.3 or newer and that the startup catalog exists:

```bash
ls -lh ~/.omp/agent/pifrost.catalog.json
```

Refresh once outside the interactive UI:

```bash
pifrost models refresh --force
```

### `pifrost routes ...` reports management auth missing

Configure management access:

```bash
pifrost global setup
```

OSS uses Basic admin credentials; Enterprise may use a scoped Bearer key.

### MCP returns `virtual key required`

The MCP client did not send a VK header. A Pifrost-managed repo file should contain:

```json
"x-bf-vk": "!pifrost secret repo-mcp --id ..."
```

Check:

```bash
pifrost repo status
```

### MCP returns `virtual key not found`

The client is now sending a VK, but Bifrost does not recognize its value. Reinitialize the repo or explicitly rotate the repo key:

```bash
pifrost repo init
# or
pifrost repo rotate-key
```

### MCP client is valid but no tools are available

Check the repo's Bifrost MCP allow-list:

```bash
pifrost repo mcp list
pifrost repo status
```

Then add the required client/tools explicitly.

### Route manifest is stale

```bash
pifrost routes diff
pifrost routes sync
```

### OAuth MCP clients

Pifrost manages Bifrost-side VK/tool assignment and OMP configuration. It cannot bypass upstream OAuth consent. OAuth MCP servers may still require a browser authorization flow and callback handling.

---

## Development

```bash
npm install
npm run check
npm test
node scripts/validate-public-datasheets.mjs
node scripts/validate-target-routes.mjs
```

CI validates:

- TypeScript compilation
- Node syntax for the standalone CLI
- unit/CLI tests
- Bifrost public datasheet coverage
- target OMP routing envelopes
- loading with the real OMP 18.0.4 plugin loader

### Release discipline

Management credentials must never be added to provider runtime configuration, model catalogs, route manifests, diagnostics, or test fixtures that could expose real values.

---

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

The diagnostic-command concept is inspired by `the-matt-moo/pi-bifrost`; Pifrost does not incorporate that project's prompt classification or Pi-side model-routing architecture.
