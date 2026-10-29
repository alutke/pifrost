# Pifrost 0.30 integration support — 0.30.0

This document describes the *unpublished* release candidate. It distinguishes automated validation from live conformance evidence and intentionally does not certify a paid provider model.

## Ownership

| Capability | Owner | Pifrost role |
| --- | --- | --- |
| Model defaults, modelRoles and provider selection | OMP | Never modify automatically |
| Reasoning, tool-call serialization, streaming, retry and compaction | OMP and selected provider | No model interception |
| Optional Bifrost model discovery | OMP native models.yml | Opt-in marked provider configuration |
| Bifrost model routing and logging | Bifrost | Expose model IDs through native OMP |
| MCP grant authorization | Bifrost Virtual Keys | Per-repository grant setup and private credential resolver |
| MCP tool execution | OMP / Bifrost | No custom runner |
| Skill discovery and repository installation | Bifrost / OMP | Optional integrity-checked bridge |
| Slash-command interface | OMP | One opt-in /pifrost command |

## OMP support

Configuration design targets **OMP 18.12.5** and documents compatibility with OMP's native command-resolved model keys, .omp/mcp.json and .omp/agent/extensions discovery.

- **Default profile**: PI_CODING_AGENT_DIR if supplied, otherwise PI_CONFIG_DIR/agent (normally ~/.omp/agent)
- **Named profiles**: OMP_PROFILE or fallback PI_PROFILE; PI_CONFIG_DIR/profiles/NAME/agent, ignoring PI_CODING_AGENT_DIR
- Both models.yml and models.yaml are legitimate OMP inputs; Pifrost refuses to create a competing configuration file.
- Older OMP 18.10.4/18.12.1 binaries may support different native behaviour. Do not assume current feature parity without an actual compatibility check.

## Bifrost support

Management authentication may be OSS Basic or Enterprise Bearer auth; **an inference Virtual Key is not required** for MCP and Skills administration. Bifrost inference auth is configured separately: Virtual Key-only (x-bf-vk header), Bearer-only (Authorization header), or both. Native OMP resolves these values from protected local Pifrost commands, honouring environment overrides.

Bifrost model discovery uses a native OMP OpenAI model-list provider. Chat Completions and Responses are selected explicitly, not translated or automatically negotiated by Pifrost. Tool calls, thinking / reasoning fidelity, context capacity, errors and fallback are delegated to OMP and Bifrost. Physical provider compatibility remains an end-to-end live-testing requirement.

Repository MCP permissions are enforced by the Bifrost Virtual Key, not by Pifrost's CLI. The repository Skill bridge validates path safety, ownership, file hashes and collisions.

## Evidence and limitations

| Evidence | Status |
| --- | --- |
| Static 0.30 architectural and command contracts | Automated in CI |
| CLI, MCP/Skills, profile and secret regression tests | Automated in CI |
| OMP native configuration and optional palette installation | Automated and/or mocked in CI |
| Package composition and production dependency audit | Automated in CI |
| Real Bifrost Chat streaming/reasoning/tool calls | **Not live certified** |
| Real Bifrost Responses streaming/reasoning/tool calls | **Not live certified** |
| Named-profile installation on a real user OMP environment | Automated path tests; user environment not certified |
| Live remote MCP Virtual Key management and Skill serving | Needs separately authorised gateway test |

Live inference and Skills/MCP operations may be billable or alter gateway grants. CI does not automatically run them without explicit credentials and authorisation. Tests do not assert real provider identity, inference quality, latency, price or correctness of Bifrost billing. No workaround or automatic retry should be inferred from legacy 0.29 documentation.

## Release criteria

Release is NO-GO until blocking security/migration findings are resolved, CI passes on the final commit, and an operator accepts the limits of any live conformance not executed. The 0.30 branch should not be merged into main or tagged automatically before that review.

Historical Pifrost 0.29 routing, output-budget and recovery design remains in Git history for reference, not as an operational 0.30 contract.
