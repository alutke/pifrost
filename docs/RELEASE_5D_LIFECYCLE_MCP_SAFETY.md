# Release 5D — OMP lifecycle recovery and MCP replay safety (v0.29.17)

Release 5D retains OMP 18.12.5 as the packaged host contract and Bifrost HTTP 2.3.2 as the source-level gateway baseline. Pifrost does not install a service, modify Bifrost's retry engine, create a new router or silently alter MCP permissions.

## OMP one-shot lifecycle safeguards

The existing high-confidence stalled-planning detector only ever queues one OMP-owned follow-up per human request. Automatic recovery remains enabled by default but refuses any unresolved tool-call IDs, tool responses indicating an ambiguous transport failure, cancelled/interrupted turns, or a possible history rewrite. Previous cancellations and successful mutations are not retried. A pending *manual* continuation is invalidated on OMP session compaction, tree navigation, branching and switching (including switching back to a prior session); a consumed one-shot budget is not reset by those events. Queued prompts and active asynchronous jobs always take priority. `PIFROST_STALLED_TURN_MODE=notice` retains a human-approved continuation, and `off` disables it.

## Bifrost MCP retry-risk boundary

Upstream Bifrost issue [#8795](https://github.com/maximhq/bifrost/issues/8795) reports that gateway-managed ordinary MCP tool retries can replay a **committed** non-idempotent operation after a socket reset or HTTP 503, even with destructiveHint=true and idempotentHint=false. Pifrost cannot prevent this inside the gateway. The only complete fix is Bifrost-side replay classification, ambiguous-outcome handling and conformance testing.

Pifrost's own direct MCP `tools/call` makes exactly one HTTP request. A lost response, invalid success envelope or HTTP 5xx after dispatch now reports **MCP_OUTCOME_UNCERTAIN** with no automatic retry or sensitive arguments. Do not interpret a transport error as a failed mutation. Inspect upstream state first before manually deciding whether to repeat.

## Grant and annotation diagnostics

`pifrost repo mcp list` and the effective repository grant diagnostics report approval-free tools that are non-idempotent (`idempotentHint=false`) or whose replay safety is unverified. The risk summary is based on the intersection of tool definitions, Bifrost `tools_to_execute`, `tools_to_auto_execute`, and active repository grants; read-only and idempotent annotations are distinguished. Annotations are **advisory** and cannot prove the gateway correctly respects them. The user should restrict auto-execution for non-idempotent tools until Bifrost fixes #8795. Manual tool execution, read-only tools, and explicit grants remain available. Pifrost only diagnoses; it does not silently rewrite policies.

## Disposable fault tests and evidence boundaries

A Node loopback HTTP server accepts a JSON-RPC tools/call request, commits a fixture record, then destroys the socket; the test asserts exactly one Pifrost wire invocation and an uncertain-outcome error. A second fixture commits and returns HTTP 503. A third verifies read-only `tools/list` still returns normal results and preserves tool annotations. Permission, wildcard and idempotence hints are covered separately.

These fixtures prove only Pifrost's outbound behaviour. **They do not run Bifrost's Go `ExecuteWithRetry` and do not establish gateway-internal correctness**. OMP lifecycle tests are deterministic; actual host cancellation/compaction and deployed gateway writes require separately approved live conformance. Never run live side-effect testing against production resources.

## Verification and rollback

```bash
npm ci
npm run check
npm test
npm run release:check
```

CI continues to check OMP 18.10.4 / 18.12.1 / 18.12.5 compiled installer compatibility, pinned Bifrost source contracts, reproducible package installation, diagnostics, and release metadata. Live provider/MCP calls are not automatically run.

Roll back Pifrost to the previous verified v0.29.16 release if necessary. This release makes no database migration and no changes to Bifrost's MCP automatic retry configuration.
