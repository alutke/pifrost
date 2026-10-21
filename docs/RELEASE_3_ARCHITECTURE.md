# Release 3 — architecture boundaries and runtime transport security (v0.29.12)

## Ownership and scope

- **OMP** owns agent lifecycle, session history, model transport serializers, native compaction and tool execution.
- **Bifrost** owns live provider routing, credentials, quotas, same-protocol fallback, conversion and MCP governance.
- **Pifrost** owns route metadata snapshots, read-only compatibility checks, diagnostics and translation.

Release 3 strengthens the boundaries without adding any daemon, new router or
artificial token ceiling.

## Per-installation catalogue generations

Previously, native.ts used five process-global mutable maps for dynamic
routes, output budget members, alias diagnostics, opaque reasoning policy and
gateway protocol ordering. Refresh updated the maps sequentially. That made
it possible for a request to read a mixed generation and for two OMP provider
installations in one process to see each other's routing metadata.

`runtime-route-state.ts` now creates an independent store **inside each
extension installation**. Catalog updates compute five maps, build a complete
snapshot, then publish them with one pointer swap. If building the new state
fails, the previous generation remains active. At request entry,
`streamSimple` captures a single generation; the request reuses its own
snapshot for all transport planning and traces even when a concurrent
catalog refresh publishes later. OMP's optional compact-before-skip
coordinator reads the same installation's current dynamic route metadata.

This is not a new source of routing authority. Native Bifrost passthrough
remains preferred and physical compatibility exceptions continue requiring
live Bifrost attestation before each attempt (Release 1). A captured
metadata generation is not a revision-pinned physical provider guarantee.

The remaining large CLI and transport modules have not been mechanically
split merely to meet a line-count target: doing so without behavioral proof
would increase integration risk. Further module splitting should follow
runtime contract tests and observed cohesion.

## Executable architecture checks

The source import boundary check now parses real TypeScript/JavaScript
import/export AST nodes (including type-only, dynamic literal imports and
re-exports), instead of a simple regular expression over source strings.
It catches forbidden runtime dependencies on control-plane modules and
imports of bundled OMP catalog/native packages outside `native.ts`.
Mutation-style tests cover deliberate violations and comment-based spoofing.
Other source-level invariants still complement the behavior tests; passing
the architecture checker is **not** independent certification of provider
behavior.

## HTTP/MCP security

- MCP JSON-RPC and streamed SSE responses are limited to **8 MiB by default**
  with an override `maxResponseBytes` for specific calls. Limits apply
  to actual streamed bytes, even if Content-Length is absent or dishonest.
- Management `requestJson` and authenticated MCP POST disallow HTTP
  redirects. This avoids forwarding HTTP Basic credentials, bearer tokens
  or Bifrost Virtual Keys to an untrusted redirect destination.
- Both preserve the existing JSON-RPC id filtering, timeout handling and
  authentication headers. The limit applies to response bodies, not
  inference-token output or model/provider context capacity.
- Credential-bearing endpoints should still use TLS or a trusted local
  network. This release does not claim all potential network security
  threats have been eliminated.

## Regression and verification

```bash
npm ci
npm run check
npm test
npm run release:check
pifrost doctor
```

New negative tests cover cross-instance isolation, atomic refresh,
in-flight requests retaining previous generations, AST import boundary
bypasses, redirect credential attempts, bounded SSE bodies and
correct JSON-RPC response envelope selection. Existing Bifrost/OMP
contract and packaged-host integration tests remain release gates.

Live provider and MCP installations can impose lower request/response limits,
which should be validated for genuine large tool results. If an MCP result
exceeds the cap, the operation fails with a size error rather than
buffering unbounded data or silently returning truncated JSON.
