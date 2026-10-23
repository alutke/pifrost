# Release 30D — Intelligent Stall Recovery (v0.29.24)

## Problem and observed failure

The 22 October 2026 Bifrost request for the unfinished Rugby Manager Release C work returned gateway `success`, `stop_reason: stop`, **614,978 prompt tokens** and **16 reasoning-only completion tokens**, with no visible final answer or tool action. OMP's previous continuation attempts did not guarantee plan completion. Large advisor requests near 526K tokens were adjacent evidence, not proof that they themselves failed.

30D adds a **bounded OMP-native `session_stop` recovery policy**, rather than a separate provider retry loop. It relies on 30A for nonproductive stop recognition, 30B for effective OMP compaction, and 30C for a branch-scoped durable checkpoint.

## Control-plane ownership and default policy

The only new automatic checkpoint-aware continuation happens at OMP's `session_stop` hook, after OMP's own retry/async/compaction handling and **before** the main turn settles. It never runs for subagents or advisors. OMP limits these advisories to eight; Pifrost limits its own to **three at most**, of which the third requires an expressly configured alternate role. Legacy one-shot `agent_end` continuation is retained **only when no active 30C checkpoint exists**, so two extension paths never resume the same task.

A continuation needs **all** of:
- An active, valid 30C checkpoint in the current OMP branch.
- A matching main session identity and bounded, contiguous recovery-attempt journal.
- A real terminal assistant `stop` containing only missing/reasoning-placeholder content, not an ordinary final answer.
- Current-turn tool results whose calls are paired and whose outcomes are known; pending/unknown side effects block continuation.
- No queued messages, active async work, user cancellation or conflicting prior stop-hook continuation.

An active plan or unverified step **alone is insufficient** to trigger a continuation; an HTTP gateway `success` **alone is insufficient** to claim progress or completion.

## Bounded stages

| Stage | Condition | Action |
|---|---|---|
| 1 — native | First eligible nonproductive terminal stop | Return OMP's `{ continue: true, additionalContext }` with concise instructions to reconcile the OMP plan, workspace, tests and checkpoint |
| 2 — context | A second eligible stop after the first continuation | Return a further focused OMP-native continuation and rely on OMP's already configured **30B mid-turn compaction** when the resolved model threshold is crossed; do not invoke compaction recursively inside the stop handler |
| 3 — alternate family | A third eligible stop **only if explicitly opted in** | Resolve a configured OMP role, verify OMP reports a different family, persist the consumed attempt, then use OMP's `setModel` and one native continuation |

If the third stage has no authorized, demonstrably distinct model family, stop and warn. No direct provider routing is performed by Pifrost: **Bifrost retains physical provider/model failover**. No model change is attempted in default settings. No tool outputs, user plan or raw reasoning are copied into recovery metadata.

Stage 2 **does not guarantee** actual compaction when OMP's configured threshold has not been met; no unsupported forced mid-turn compaction is performed. The separate 30B idle scheduler and native compaction triggers remain the owners of context reduction.

## Durable, branch-scoped retry budget

Attempt records are written through `pi.appendEntry("dev.pifrost.recovery-attempt.v1", data)`, **before** asking OMP to continue. They contain only a session hash, starting 30C checkpoint entry id, current assistant entry id, attempt ordinal, stage and reason code. OMP's live `getBranch()` remains authoritative.

Retries are idempotent for the same assistant entry and persist across process restart. Rewinding the session tree to an older branch removes later attempt records **and** later execution work, so a stale mirror cannot silently re-authorize tool execution. Corrupt or out-of-order records fail closed. No daemon or service is involved.

A model-switch attempt counts against the budget even if model selection subsequently fails; it never triggers an untracked additional retry.

## Settings and operator commands

The default is `auto`, inherited from `PIFROST_STALLED_TURN_MODE` unless independently overridden:

```bash
export PIFROST_RECOVERY_MODE=auto      # auto | notice | off
# Optional third stage only; no implicit family switching:
export PIFROST_RECOVERY_FALLBACK_ROLE=@slow
```

`notice` reports eligible nonproductive stops without requesting additional work; `off` disables both this policy and legacy Pifrost automatic recovery. Unknown explicit modes are treated as `notice`.

Inside OMP:

```text
/pifrost recovery status
/pifrost checkpoint status
/pifrost checkpoint resume
/pifrost stalled status
```

`/pifrost recovery status` reports attempts from the current branch journal; `/pifrost checkpoint resume` prepares a safe operator-reviewed prompt in the editor but **does not send it**.

## Safety and limitations

- **No automatic tool replay** or provider-request replay. The next model turn is explicitly instructed to inspect current workspace and side effects.
- **No autonomous execution if the user interrupted**, if a tool outcome is uncertain, if OMP is continuing independently, or if the history does not prove a current checkpoint and paired tool activity.
- A final assistant answer with meaningful text is never classified as a reasoning-only stall, even if the checkpoint contains unverified work.
- OMP-native `session_stop` can be blocked by other extensions. Pifrost will not override their explicit blocking decisions.
- No claim that a checkpoint, model stop, CI exit code or terminal output alone proves finished work.
- A third-stage alternative requires a user-specified OMP role with a **distinct OMP-reported family**; aliases whose physical family cannot be determined will not be switched.
- Existing historical sessions lacking a 30C checkpoint retain the prior bounded one-shot compatibility recovery, not the new three-stage state machine.

## Acceptance, verification and rollback

The deterministic suite includes the 614,978-token stop signature; three-stage exhaustion; missing, corrupt and rewound branch records; duplicate assistant settlement; normal final answers; unpaired/uncertain tools; user cancellation; asynchronous work; configured `notice`/`off`; and family mismatches. Full repository CI must pass TypeScript, Node/Bun tests, release-package validation, Bifrost compatibility, and compiled OMP 18.10.4/18.12.1/18.12.5 plugin installation.

Rollback to v0.29.23 or set `PIFROST_RECOVERY_MODE=off` before launching OMP. New recovery custom entries are non-model metadata and do not alter prior session transcripts. The 30C checkpoint mirror remains untouched.
