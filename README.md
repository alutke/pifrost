# Pifrost

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
- [Routing aliases](#routing-aliases)
- [Model metadata and startup cache](#model-metadata-and-startup-cache)
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
 │ OpenAI Chat Completions transport
 │ Authorization: Bearer <inference API key>
 │ x-bf-vk: <global inference Virtual Key>
 ▼
Bifrost /v1
 │
 ├─ routing rules
 ├─ provider fallback
 ├─ provider credentials
 └─ physical model providers
```

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
 └─ only MCP clients/tools allowed on that repo VK
```

The intended identity separation is:

```text
Global LLM inference  -> global inference VK
Bifrost administration -> OSS admin Basic auth OR Enterprise API key
Repository MCP access -> one dedicated MCP VK per repository
```

Do not reuse a repository MCP VK as the global inference VK.

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
- displayed cost = conservative maximum across route members

If a route member cannot be resolved safely, Pifrost withholds the alias instead of fabricating metadata.

### Capability discovery and model identity

Pifrost 0.2.7 resolves capability facts per field rather than assuming one source is complete. The trust order is:

1. rich, explicit metadata returned by the live Bifrost `/v1/models` inventory;
2. the Bifrost public pricing/model-parameter datasheets;
3. an equivalent canonical model-family row in those datasheets;
4. a narrowly scoped vendor-backed capability override for a known upstream omission; and
5. conservative catalog fallback when the model identity and capability are safe to establish.

Diagnostics preserve that origin as `live`, `bifrost-datasheet`, `canonical-family`, `vendor-override`, or `fallback` for each route member and capability.

The generic compatibility defaults used for a sparse physical `/v1/models` entry (`128K` context / `8K` output) are **not** accepted as authoritative route limits. A configured route member that is temporarily absent from `/v1/models` may receive a metadata-only identity anchor, but that anchor carries no trusted capabilities. Pifrost still withholds the logical alias unless safe context and output limits can be established from a stronger source.

Model identity matching tolerates provider/aggregator prefix changes, mixed capitalization, and explicitly known entitlement aliases such as the current Ox Alpha spellings. It does not blindly strip arbitrary `-free` suffixes, and it rejects ambiguous vendor-qualified matches rather than assuming two same-tailed model names are identical.

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
- OhMyPi **18.0.4 or later** in the 18.x line
- Maxim Bifrost with OpenAI-compatible Chat Completions enabled
- a Bifrost inference API/Bearer credential when inference auth is enabled
- a global Bifrost inference Virtual Key that can see the physical models in the `omp-*` routes
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
0.2.7
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
Inference API/Bearer key
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

Pifrost uses OMP's schema-aware CLI and backs up the previous global config. The effective settings are equivalent to:

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

---

## Routing aliases

### List live routes

```bash
pifrost routes list
```

### Diagnose Bifrost routing discovery

```bash
pifrost routes diagnose
```

Pifrost probes both routing management surfaces because Bifrost versions/installations can expose different compatibility behavior:

```text
/api/routing/rules
/api/governance/routing-rules
```

The diagnostic reports response shape, raw rule count, derived alias count, and rules that are not `omp-*` aliases.

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

---

## Repository-specific MCP

Each repository gets its own Bifrost MCP Virtual Key and only the MCP clients/tools explicitly assigned to that key.

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

One client with all its exposed tools:

```bash
pifrost repo init --clients railway --tools '*'
```

Multiple clients:

```bash
pifrost repo init --clients n8n,railway --tools '*'
```

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

### Status

```bash
pifrost repo status
```

A healthy repo reports:

```text
Virtual Key id:   <uuid>
Virtual Key name: omp-<repo>-mcp
Repo secret:      set
MCP initialize:   HTTP 200 OK
MCP clients:      railway[*]
```

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

- removes the Pifrost repo association from the local config/secret store; and
- removes only the generated `bifrost` entry from `<repo>/.omp/mcp.json`.

It deliberately leaves the Bifrost Virtual Key intact.

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
| `pifrost routes diagnose` | Show routing endpoint shapes/counts and alias derivation |
| `pifrost routes diff` | Compare live routes with the local alias manifest |
| `pifrost routes sync` | Rebuild the local alias manifest and refresh models |
| `pifrost models refresh --force` | Perform live model/datasheet discovery |
| `pifrost models doctor` | Inspect effective cached model capabilities |
| `pifrost repo init` | Create/update repo-specific MCP governance and config |
| `pifrost repo status` | Validate the current repo MCP integration |
| `pifrost repo mcp list` | List Bifrost MCP clients/tools |
| `pifrost repo mcp add <client>` | Add an MCP client/tool allow-list to the repo VK |
| `pifrost repo mcp remove <client>` | Remove an MCP client from the repo VK |
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

## Troubleshooting

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
pifrost routes diagnose
```

Pifrost checks both the canonical and compatibility Bifrost routing endpoints. A healthy result may show one empty endpoint and the actual rules on the other.

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

CI validates:

- TypeScript compilation
- standalone Node CLI syntax
- unit/CLI tests
- public Bifrost datasheet coverage
- current OMP routing envelopes
- loading through the real OMP 18.0.4 plugin loader

Management credentials and raw VK values must never be added to provider runtime configuration, model catalogs, route manifests, diagnostics, or committed test fixtures.

---

## Attribution

Pifrost is derived from `lxdlam/pi-bifrost-provider` under the MIT license. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
