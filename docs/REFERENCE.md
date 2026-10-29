# Pifrost 0.30 — Current CLI and OMP reference

The 0.30 release candidate is CLI-first. OMP owns inference, model roles, reasoning, context, agent execution, retries, and tool calls. Pifrost provides optional native Bifrost model discovery, repository MCP Virtual Keys and Skills, and an opt-in slash-command palette.

Expected for this release:

```text
0.30.0
```

## Everyday CLI

| Command | Purpose |
| --- | --- |
| pifrost init | Configure gateway and management credentials; leave OMP unchanged |
| pifrost status | Read-only connection and configuration status |
| pifrost models | Native model discovery status |
| pifrost models list | Bifrost model IDs |
| pifrost models enable | Opt in to native OMP Bifrost Chat provider |
| pifrost models enable --api responses | Opt in to Responses provider |
| pifrost models disable | Remove only owned native provider |
| pifrost mcp | Repository MCP clients |
| pifrost skills | Bifrost Skills |
| pifrost help --all | Full supported command catalogue |
| pifrost help models enable | Contextual command help |

## Repository operations

| Command family | Supported operations |
| --- | --- |
| pifrost repo | init, status, rotate-key, reset |
| pifrost repo mcp | list, add CLIENT --tools NAMES, remove CLIENT, instructions |
| pifrost repo vmcp | list, add BUNDLE, remove BUNDLE |
| pifrost repo skills | list, add NAME, sync [NAME], remove NAME, suggestions, bind, unbind, dismiss, undismiss |

A repository Virtual Key limits granted MCP tools and bundles, and is resolved from private local storage by the native .omp/mcp.json configuration. Skills install to .agents/skills and retain integrity/ownership checks. Repository management uses management credentials, never requiring an inference Virtual Key.

## Optional in-OMP command palette

Run pifrost omp commands enable, then restart OMP. In OMP, /pifrost opens the menu. Direct commands: /pifrost status, models, models list, models enable, models disable, repo, mcp, mcp add/remove, vmcp, vmcp add/remove, skills, skills add/sync/remove, migrate, commands and help. All changes require interactive confirmation. Disable with pifrost omp commands disable.

The palette registers only one slash command. It contains no automatic inference router, reasoning interceptor, recovery agent, tool registration or session hook. Gateway errors do not echo secrets into OMP.

## Migration

Run pifrost migrate status first. Inspect active legacy plugins with pifrost migrate disable-extension --dry-run; disable only clearly identified npm Pifrost plugins with pifrost migrate disable-extension. Run pifrost migrate apply to back up OMP settings and remove exact historical Pifrost modelRoles values. Existing enabledModels and modelProviderOrder, including Bifrost choices, are never touched. Rollback refuses to overwrite OMP settings changed since migration.

## Native model auth and profiles

Virtual Key-only mode sends x-bf-vk without Authorization. Bearer-only mode sends Authorization. When both are configured both headers are used. OMP command-resolved secrets use BIFROST_VIRTUAL_KEY and BIFROST_API_KEY environment variables first, then private saved credentials. Management authentication is separate from inference authentication.

OMP_PROFILE takes precedence over PI_PROFILE. Named profiles resolve under PI_CONFIG_DIR/profiles/NAME/agent and ignore PI_CODING_AGENT_DIR. The default profile uses PI_CODING_AGENT_DIR or PI_CONFIG_DIR/agent. Configure and start OMP under the same profile.

## Verification boundaries

Version 0.30.0 is not published. Tests and package checks do not prove real Bifrost inference, tool calls, streaming or model capability mapping. Those require authorised live OMP/Bifrost conformance checks. The current compatibility target is OMP 18.12.5; older binaries require validation.

See the README, docs/INTEGRATION_SUPPORT.md, SECURITY.md and CHANGELOG.md. The complete CLI contract is defined by cli-command-schema.mjs; previous 0.29 commands are historical and not part of 0.30.
