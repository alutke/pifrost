# Release 2 — OMP lifecycle and reasoning conformance (v0.29.10)

## Scope and design rule

OMP owns agent execution, tool calls, queues, session history, confirmations
and replay serialization. Bifrost owns physical provider execution, routing,
authentication and gateway conversion. Pifrost observes, diagnoses, guards
known unsafe wire payloads and offers explicit opt-in continuation. It must
not manufacture reasoning content, replay tool calls, or introduce a daemon.

## Stalled-turn recovery: safe default

A heuristic can mistake quoted thinking markers or a valid stop for an unfinished
task. Therefore the default is **notice-only**. After a main-agent terminal stop
with the previously verified tool-use/planning signature, Pifrost informs the
user of a *possible* stall and retains one in-memory session observation.

Run `/pifrost stalled status` to inspect the observation.
Run `/pifrost stalled continue` to request one OMP-managed follow-up. This
requires the interactive main OMP agent to be idle, with no queued messages or
running async work, and requires affirmative UI confirmation. Session identity,
idleness, pending work and the one-shot opportunity are rechecked after the
dialog, before any follow-up is enqueued. A cancellation leaves it pending;
a new user prompt or session shutdown discards it. A consumed opportunity
cannot be reused in the same human prompt.

For those who *explicitly* want the old one-shot heuristic continuation,
set `PIFROST_STALLED_TURN_MODE=auto` **before starting OMP**. Even then it
will not continue while OMP has other active, queued or async work. An
unknown, empty or misspelled value defaults to notice-only. Automatic mode
may still lead to downstream non-idempotent tool actions, so it should be
used only with that risk understood.

These paths are separate from `/pifrost recover fork`: the latter handles
verified terminal reasoning-replay failures and creates a user-approved new
session. Stalled-turn continuation stays in the existing OMP session and
uses OMP's own supported follow-up message queue, not a new provider replay.

## Reasoning evidence: three distinct layers

1. **Local final-wire structure** — Pifrost inspects only the output of OMP's
   native replay serializer. `validation=structural-only` means that the
   required *shape* is present. It cannot determine whether native empty
   Chat reasoning fields or unsigned Responses placeholders are accepted by
   the physical provider. `emptyNativeReasoningItems` records their count.
2. **Bifrost gateway execution** — a completed gateway stream records
   `gatewayOutcome=completed`; other outcomes remain `not-observed`.
   This proves Bifrost finished the logical attempt, not that an identical
   physical replay payload was sent unchanged.
3. **Physical-provider replay acceptance** — remains unverified without
   gateway/provider-side evidence or a provider conformance probe. Pifrost
   does not claim a signed, encrypted or reconstructed native reasoning token
   was accepted merely because a JSON field existed.

The existing strict physical-contract guard still rejects required assistant
runs with **missing native replay structure** before HTTP transmission;
unknown or heterogeneous policies remain diagnostic-only. Empty native
markers stay classified but are not blindly rejected, since OMP's supported
synthetic compatibility representation and acceptance conditions vary across
providers. Pifrost does not discard reasoning, invent signatures or alter
saved assistant/tool history.

The reproducible 555-item (100 assistant turns, 210 tool calls/results)
incident is covered by offline regression tests. These tests are **not a
live provider conformance certificate**. Verification requires testing
Bifrost Responses-to-Chat conversion with a real strict provider, comparing
redacted payload *shapes* and request IDs, and confirming the physical
provider's actual acceptance. Do not retain private thinking content.

## Validation and rollback

```bash
npm ci
npm run check
npm test
npm run release:check
pifrost doctor
```

No new services, provider configuration changes, Bifrost rule writes,
session-history migrations or persisted secrets. To restore legacy bounded
automatic behaviour set `PIFROST_STALLED_TURN_MODE=auto` explicitly.
To roll back the whole package, reinstall the preceding pinned v0.29.9
release and restart OMP, noting that it had automatic heuristic continuation.
