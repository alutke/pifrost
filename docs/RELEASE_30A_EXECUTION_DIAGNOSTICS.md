# Pifrost 30A — execution diagnostics and host compatibility foundation

**Scope:** diagnostic-only first phase of proposed v0.30.0. This phase does **not** implement 30B adaptive compaction, 30C checkpoints, 30D multi-stage recovery or 30E reasoning-history repair.

## Incident evidence: 22 October 2026

The supplied Bifrost logs show a successful **CommandCode GOAT / DeepSeek V4.1 Flash** Responses request with **614,978 input tokens**, **16 output tokens** (all reported as reasoning), `stop_reason: stop`, no tool calls and only an empty-content reasoning entry with a synthetic-looking `reasoning unavailable` summary. Gateway success proves request completion, **not** completion of OMP's outstanding Release C plan.

Two adjacent **OpenCode Go / Muse Spark contributor** advisor calls contain **526,402** and **526,832** prompt tokens. One returns a tool call and one returns text. Both demonstrate a large advisor history but do not prove advisor failure. All models are **gateway-reported**, not provider-verified physical attribution.

Pifrost 0.29.20 already has a conservative one-shot stalled-turn recovery. Its previous detector requires leaked planning text near the end of the response; a reasoning-only response does not satisfy that high-confidence signature. Release 30A adds **observation**, not automatic resumption of this new signature.

## New modules

- `execution-observation.mjs`: pure classification of Bifrost log responses and OMP `agent_end` observations, with explicit `REASONING_ONLY_STOP`, `EMPTY_STOP`, `LEAKED_THINKING_STOP` and `NONE` reason codes. Context readings distinguish absolute size from verified model-window pressure. It never echoes raw prompts, credentials, keys or logs.
- `execution-readiness.mjs`: read-only OMP lifecycle, context maintenance, mid-turn continuation, model-threshold and fallback ownership assessment. Missing/unknown settings remain unknown.
- `pifrost omp readiness [--verbose|--json]`: includes a structured `execution` report. A matching host-policy version indicates documented interface compatibility, **not** proof that a live event fires.
- OMP top-level `agent_end`: one advisory warning per session for a high-confidence no-action stop after tool activity, when no continuation is pending. The warning does not enqueue a new turn or alter history.
- Sanitized, dependency-free test fixtures cover the observed DeepSeek response, both kinds of advisor outputs, missing usage metadata, reasoning markup, incomplete tool activity, host skew and fallback ownership.

## Operating constraints and ownership

OMP retains `agent_end`, `session_stop`, `context`, compaction, advisor and native retries; Bifrost retains provider dispatch and routing. Pifrost 30A never changes `retry.modelFallback`, `compaction.*`, a model route, or a tool response.

`compaction.enabled=false` or conflicting OMP model fallback results in an explicit readiness warning. A token count at or above 120K is an **observational large-request indicator only**, not a compaction trigger, effective window estimate, model cap or assertion that quality has deteriorated. Runtime `ctx.getContextUsage()` is OMP's estimate and may differ from Bifrost's billing usage.

The `session_stop` and `session.compacting` surfaces referenced by the proposal are **not installed or intercepted by this phase**; their read-only compatibility report is scoped to the packaged policy snapshot. Unknown host versions must remain unverified.

## Verification

Run `node --test test/execution-observation.test.mjs test/execution-readiness.test.mjs test/omp-orchestration-readiness.test.mjs`, then `npm run check`, `npm test` and `npm run release:check` in a complete development checkout.

Tests use sanitized, representative snapshots; they do not replay an entire 615K prompt or prove how OMP's current runtime represents every reasoning chunk. A fully instrumented live OMP/Bifrost confirmation is deferred to the integrated reliability phases and must be separately authorised if it incurs provider charges.

## Rollback

Revert the 30A commits. There are no migrations, new services, changed routes, new recovery retries, persisted logs or settings writes.
