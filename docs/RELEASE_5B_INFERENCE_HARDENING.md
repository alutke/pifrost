# Release 5B — inference wire and output-budget hardening (v0.29.15)

Release 5B follows Release 5A's OMP **18.12.5** and Bifrost HTTP **2.3.2**
source contracts. OMP still owns session history, native tool execution,
signed reasoning, transport serialization and model policy. Bifrost still
owns actual physical routing, compatibility conversion, quotas, credentials
and physical fallback. No new daemon, model-routing engine or implicit cap.

## Changes

1. HTTP 413 `request_too_large` is diagnosed as `REQUEST_TOO_LARGE`.
   Pifrost never retries it as a protocol or physical compatibility fallback;
   the operator must reduce context or attachment size.
2. For both supported OpenAI wire protocols, preserve existing native tool IDs,
   reasoning signatures, instruction fields and lifecycle events. Max-token
   fields are only limited to verified Pifrost-side budgets; absent fields
   are not created or converted to arbitrary vendor-specific limits.
3. Bifrost 2.3.1+ supports response `extra_fields` either in JSON/SSE
   bodies or as `x-bifrost-*` response headers. The cost bridge reads
   bounded gateway identity, requested alias, conversion and explicit
   dropped-compatibility-parameter evidence without storing user content.
4. If a `max_tokens`, `max_completion_tokens` or `max_output_tokens`
   parameter appears in the gateway's dropped compatibility parameter list,
   `/pifrost trace verbose` reports
   `gateway-dropped-output-cap=yes egress-limit=unverified`.
   Merely observing a request-side cap **does not prove** that Bifrost
   passed it to the physical provider.
5. Preserve `xhigh` when OMP's verified physical model policy supports
   that setting. No blanket downgrade to `high` is imposed.
6. Regression fixtures cover Chat/Responses response bodies, streamed
   lifecycle and function call IDs, empty tool result payloads, native
   reasoning, explicit limits, gateway body/header modes and 413 denial.

## Correctness and known limits

The security-sensitive last-mile case in upstream Bifrost issue
[#8765](https://github.com/maximhq/bifrost/issues/8765) is owned by
Bifrost's compatibility/datasheet layer. A physical model may receive a
provider default when a parameter was stripped upstream. A Pifrost trace
warning is diagnostic only; an **end-to-end conformance test must inspect
gateway egress or the physical provider's accepted limits**.

An unrelated Bifrost MCP issue, [#8795](https://github.com/maximhq/bifrost/issues/8795),
reports potentially duplicate non-idempotent executions. Pifrost's
inference wire tests do not solve that gateway MCP problem. Do not
automatically execute side-effecting MCP tools through an unverified
gateway retry path. Phase 5D adds lifecycle and MCP conformance.

Successful mocked requests and source checks do not establish physical
provider acceptance, an exact billed token count, or real Bifrost route
selection. Pifrost retains its previous pre-output-only attempt policy:
post-output failures are terminal.

## Verification

```bash
npm ci
npm run check
npm test
npm run release:check
```

Live transport checks remain opt-in, require gateway credentials and may
incur charges:

```bash
export BIFROST_URL=http://127.0.0.1:8180/v1
export BIFROST_VIRTUAL_KEY=YOUR_TEST_VIRTUAL_KEY
npm run smoke:transport
```

Read-only diagnostics after installing the tagged release:

```bash
pifrost --version
pifrost doctor --verbose
pifrost omp readiness --verbose
```

Reinstall v0.29.14 from the prior verified tag to roll back the Pifrost
package. Pifrost 5B does not change the gateway database.
