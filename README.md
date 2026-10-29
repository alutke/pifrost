# Pifrost

**Optional Bifrost resources for native OhMyPi (OMP).**

Pifrost provides a small CLI for Bifrost models, repository MCP access and Skills. **OMP owns model selection, role mapping, inference, tool execution, retries, reasoning and compaction.** Pifrost does not load an inference or execution extension by default.

> **Development status:** The 0.30 simplification is on `release/0.30-simplification` ([PR #101](https://github.com/alutke/pifrost/pull/101)), not yet merged or released. The package is versioned 0.30.0 on this draft branch; it has not been published. This document describes the branch's new command interface, not production 0.29.x behaviour.

## Start here

```bash
# Review the unmerged development branch (not recommended for production yet)
npm install --global github:alutke/pifrost#release/0.30-simplification
pifrost init
pifrost status
```

Initial setup stores Bifrost credentials securely in the local Pifrost configuration. It does **not** install OMP extensions, remap OMP roles, change fallbacks or automatically register gateway models.

**Use OMP normally:** simply run `omp` to use its existing direct providers and subscriptions. No Pifrost dependency is added to ordinary coding sessions.

## Optional Bifrost models

```bash
pifrost models                  # Native integration status
pifrost models list             # Read-only Bifrost /v1/models inventory
pifrost models enable           # Opt in to Chat Completions gateway models
pifrost models enable --api responses  # Explicit Responses ingress
pifrost models disable          # Remove only the Pifrost-owned provider
```

When enabled, OMP discovers Bifrost models through its native `models.yml` provider and allows manual selection through **`/model`**. No automatic changes to OMP's default model, role mapping or fallback policy. One transport protocol applies to the configured provider; model-specific incompatibilities must be diagnosed rather than hidden by automatic conversion. Provider keys are resolved via local commands rather than embedded in YAML.

### Authentication and profiles

Native OMP Bifrost models use an explicit mode: **Virtual Key only** sends `x-bf-vk` without an Authorization header; **Bearer only** uses Authorization; **Bearer + Virtual Key** sends both when separately configured. The same environment-first secret resolution applies in the CLI and native OMP provider. Management credentials are separate, and repository MCP/Skills management **does not require** an inference Virtual Key.

Set `OMP_PROFILE=work` (or `PI_PROFILE=work`) before running Pifrost when you use a named OMP profile. `PI_CONFIG_DIR` is also respected, and `PI_CODING_AGENT_DIR` applies only to the default profile. Models and the /pifrost palette are installed into the selected profile, never silently copied between profiles.

## Optional /pifrost menu inside OMP

Enable the small **command-only** integration explicitly:

```bash
pifrost omp commands status
pifrost omp commands enable
omp  # restart an existing OMP session
```

Now enter **`/pifrost`** to open the menu, or type a direct subcommand:

| In OMP | What it does |
| --- | --- |
| `/pifrost` | Compact menu: Status, Models, MCPs, Skills, Migration, Help |
| `/pifrost help` | Full list of in-OMP commands |
| `/pifrost status` | Check the Bifrost connection and configuration |
| `/pifrost models` | Check optional native model integration |
| `/pifrost models list` | List models visible through Bifrost |
| `/pifrost models enable [completions\|responses]` | Opt in to Bifrost model discovery (confirm) |
| `/pifrost models disable` | Remove managed Bifrost model discovery (confirm) |
| `/pifrost repo` | Current repository's MCP/Skills setup |
| `/pifrost mcp` | Repository MCP inventory |
| `/pifrost mcp add railway list-projects,get-logs` | Grant explicit tool allow-list (confirm) |
| `/pifrost mcp remove railway` | Remove repo client grant (confirm) |
| `/pifrost vmcp` | Virtual MCP bundle inventory |
| `/pifrost vmcp add "Infrastructure Tools"` | Grant named bundle (confirm) |
| `/pifrost vmcp remove "Infrastructure Tools"` | Remove named bundle (confirm) |
| `/pifrost skills` | Available Bifrost Skills |
| `/pifrost skills add "Skill Name"` | Install Skill to repository (confirm) |
| `/pifrost skills sync ["Skill Name"]` | Synchronise managed Skills (confirm) |
| `/pifrost skills remove "Skill Name"` | Remove managed Skill (confirm) |
| `/pifrost migrate` | Preview legacy model-role cleanup; never changes it |
| `/pifrost commands` | Check command-palette installation |

The command extension **registers one slash command only**. It contains **no** LLM provider, model-role mapping, event listeners, recovery or execution hooks. It does not expose secrets, execute arbitrary Pifrost subcommands or use a shell to parse arguments. Mutations require an interactive confirmation and are unavailable in headless sessions. No agent messages are injected.

Disable it independently of repository MCPs and Skills:

```bash
pifrost omp commands disable
# restart OMP
```

The CLI refuses to replace a locally edited command extension, and backs up existing managed content.

## Repository MCPs

Inside a Git repository:

```bash
pifrost repo init
pifrost repo status
pifrost repo mcp list
pifrost repo mcp add railway --tools list-projects,get-logs
pifrost repo vmcp list
pifrost repo vmcp add 'Infrastructure Tools'
```

A repository-specific Bifrost Virtual Key grants only explicitly selected tools and bundles. Pifrost writes a native OMP `.omp/mcp.json` entry with a command-resolved secret; raw repository keys remain in private local storage. OMP executes MCP tools, while Bifrost enforces their permissions.

Use `pifrost repo mcp remove <client>` and `pifrost repo vmcp remove <bundle>` to revoke grants. `repo rotate-key` rotates a repository key explicitly, without touching inference credentials.

## Repository Skills

```bash
pifrost repo skills list
pifrost repo skills suggestions
pifrost repo skills add 'Skill Name'
pifrost repo skills sync
pifrost repo skills remove 'Skill Name'
```

Skills are opt-in per repository, installed into `.agents/skills` with ownership and content-hash checks. Sync refuses to overwrite a locally modified Skill unless explicitly forced. Bifrost restrictions that OMP cannot enforce are not silently weakened.

## Safe migration from 0.29.x

```bash
pifrost migrate status
pifrost migrate disable-extension --dry-run
pifrost migrate disable-extension
pifrost migrate apply
```

These actions are separate. Disabling the legacy Pifrost OMP plugin does not uninstall Pifrost or remove repository MCP/Skills configuration. Role cleanup backs up existing OMP settings and removes **only exact old Pifrost roles**. It explicitly preserves `enabledModels` and `modelProviderOrder` even when they include Bifrost models or providers. `pifrost migrate rollback` restores the original configuration only if it has not changed since migration.

**Do not run migration blindly on a production OMP installation.** Review the preview and backups first. The 0.30 branch is still undergoing integration certification.

## CLI reference

Run `pifrost` for a compact, task-focused overview, `pifrost help --all` for the full supported list, or `pifrost <command> --help` for accepted arguments and side effects. Compatibility commands for the old Pifrost routing, custom judgement, automated recovery and context orchestration are intentionally retired; use native OMP controls instead.

If a command fails, it should explain what was unavailable and where to resolve it, without printing secret values.

## Configuration and security

| Location | Purpose |
| --- | --- |
| `~/.config/pifrost/config.json` | Non-secret gateway and repository configuration |
| `~/.config/pifrost/secrets.json` | Private gateway and Virtual Key credentials |
| `~/.omp/agent/models.yml` | Optional, marked Bifrost native model provider |
| `~/.omp/agent/extensions/pifrost-commands.js` | Optional command-only slash extension |
| `<repo>/.omp/mcp.json` | Repository MCP integration with resolved secret |
| `<repo>/.agents/skills/` | Managed Skill snapshots |

Bifrost management credentials, global inference credentials and per-repository MCP keys are separate. Never commit local secrets into a repository.

## Development and validation

```bash
npm ci
npm run check
npm test
npm run release:check
```

CI tests CLI contracts, model integration configuration, migration safety, optional slash-command ownership/dispatch, MCP/Skills integrity and packaged OMP compatibility. CI does **not** by itself establish live Bifrost/provider model compatibility; confirm with separately approved gateway tests before publishing.

Expected for this release:

```text
0.30.0
```

This is the draft candidate version, not a published release.
