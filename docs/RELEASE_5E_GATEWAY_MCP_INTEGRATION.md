# Release 5E — Bifrost gateway-native MCP integration diagnostics (v0.29.18)

Release 5E is an optional, diagnostics-first integration phase on OMP 18.12.5 and Bifrost 2.3.2. It does **not** add an MCP executor, external service, background polling, new Virtual Key permissions or any automatic API registration. Bifrost remains authoritative for tool discovery, grants, provider injection, auto-execution, Code Mode nested calls and gateway retries. OMP remains authoritative for agent-owned approvals, progress presentation and session history.

## Deferred tool search: two different contracts

* **Responses-native Tool Search:** On a capability-qualified Responses attempt, Pifrost retains OMP `deferLoading` intent for exactly one function definition and adds a server-executed `tool_search` only if no tool-search definition already exists. An existing client-managed `tool_search` stays untouched. Duplicate names are ambiguous; Pifrost does not silently rewrite those definitions.
* **Gateway-managed discovery:** Bifrost Code Mode, provider-injected research, or other gateway-provided search is not equivalent to a native Responses `tool_search`. The bridge has an explicit `deferredToolExecution: "gateway"` boundary that leaves the gateway-owned discovery payload alone. This is for integrations that can prove gateway ownership, not a new automatic heuristic from names, model claims or stale snapshots. Normal OMP/Responses behaviour defaults to the existing native path.

Gateway-managed Code Mode is not a reason to expose all underlying tool definitions eagerly in OMP. A supported route must still satisfy the original OMP request protocol. Pifrost never invents a physical provider's support from the mere presence of gateway MCP clients.

## OpenAPI-derived MCP tools and authorization

The read-only MCP inventory recognizes explicit OpenAPI connection/source fields and reports `openapi-mcp (gateway registered)`. `pifrost repo mcp list` and effective repository authorization show the same source in context, with the intersection of real tool names, Bifrost `tools_to_execute`, approval-free `tools_to_auto_execute` and granted repository tools.

An OpenAPI operation is not assumed to be safe, idempotent or public based on its name or HTTP method. Authentication, connection setup, operation schemas, action sensitivity and Bifrost administration remain gateway-side. Pifrost never retrieves remote OpenAPI specs to interpret them or changes a registered client's capabilities. A redacted management snapshot proves neither a successful upstream API invocation nor the exact Virtual Key's live authorization.

## Bifrost Code Mode, nested errors and result semantics

Code Mode exposes on-demand gateway meta-tools and may call underlying MCP tools inside Bifrost, outside OMP's per-tool UI. Gateway per-VK and approval-free execution rules are still required. A new **read-only, bounded result inspector** distinguishes native `structuredContent` (authoritative), JSON held in a single text block, double-encoded JSON objects/arrays, multiple text blocks, plain text, top-level `isError`, and possible nested `error` fields. An application field named `error` is only a *possible nested failure*, not proof that the MCP call failed. Results are not rewritten or executed again, and no raw content or secret is emitted in diagnostic summaries.

Provider-injected tools remain Bifrost-owned. Read-only inventory checks for duplicate injection aliases and warns that OMP-visible tool lists and approvals cannot establish gateway authorization. The gateway, not Pifrost, must resolve ambiguous injected names and check per-VK grants.

## MCP progress and limits

Only an explicitly supplied progress token permits progress inspection. Notifications must match `notifications/progress` and the exact token, with finite nonnegative numeric progress values. At most 64 events are retained; labels, text, tool arguments and unrelated notifications are ignored. Progress is recovered from an **already bounded MCP response**; this is not a live subscription. Only the requesting OMP-managed host can decide whether and how to present it; Pifrost does not emit asynchronous progress messages or install a long-running service.

Existing 8 MiB response-size limits, redirect rejection and `MCP_OUTCOME_UNCERTAIN` handling for dispatched `tools/call` remain unchanged. Neither optional diagnostic inspection nor progress creates a second request, replays tools or overrides upstream #8795 retry behaviour.

## Verification, unsupported paths and release boundary

```bash
npm ci
npm run check
npm test
npm run release:check
```

Deterministic tests cover native/gateway deferred-search distinctions, existing tool-search preservation, duplicate definitions, OpenAPI and Code Mode permissions, nested-result shapes, provider injection collision detection, opt-in progress filtering, and unchanged MCP one-shot transport behaviour.

These tests use local/mock responses. **Live Bifrost 2.3.2 deferred-search execution, OpenAPI operation authentication, Code Mode mutations, provider injection and real OMP progress remain unverified unless run separately with explicit approval and disposable resources.** They cannot certify Bifrost's internal retry safety. No live billable or mutating gateway probe is part of CI.

Rollback: use the last verified v0.29.17 release. No migration, stored policy changes or data cleanup is necessary.
