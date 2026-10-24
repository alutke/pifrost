# Release 30F — Progress-aware recovery episodes (v0.29.26)

## Failure and architecture decision (ADR-30F)

**Observed:** after paired tool work, an OMP main-agent `session_stop` returned a successful but nonproductive `REASONING_ONLY_STOP` at ~31,242 estimated input tokens. Release 30D reported `model-fallback-not-authorized` after spending two checkpoint-wide continuation attempts. The existing 30D source computed `attempts = previous.length` for every `dev.pifrost.recovery-attempt.v1` since the current checkpoint anchor. This is a demonstrated **checkpoint-lifetime retry budget**, not an episodic budget. The reported failure alone cannot establish whether the two earlier attempts were consecutive or followed meaningful progression; that requires the original OMP branch journal, which was not supplied with the incident.

**Ownership constraints:** OMP owns agent lifecycle, session history, model selection, tools, retries, plans and compaction. Bifrost owns physical provider routing, quotas, credentials and gateway failover. Pifrost may inspect a current branch and request one bounded OMP-native `session_stop` continuation but cannot replay a tool, rewrite messages or select a physical model.

**Considered alternatives:**
- Increase three-attempt allowance or retry forever — rejected because nonproductive loops and unknown side effects would be amplified.
- Unconditional reset on `session_stop`, arbitrary elapsed time, high/low context estimate, or incomplete plan — rejected because none proves progression.
- Model-family switching without opt-in — rejected; Bifrost aliases do not demonstrate physical model identity.
- External watchdog, daemon or custom agent executor — rejected for ownership, complexity and replay risk.
- **Selected:** journal-evidenced recovery episodes, with consecutive attempts capped by the existing policy and an immutable append-only v2 journal. This decision preserves old v1 attempts without rewriting them.

## State and safety model

An episode begins with the first qualifying stop or with later branch-validated progression after a recorded attempt. A fresh episode cannot begin merely because the next hook fired. Valid progress evidence is:
1. A new OMP user message (explicit operator/user-initiated continuation).
2. A newly verified checkpoint step with a bounded evidence reference.
3. A distinct, fully paired, non-error OMP journal tool call/result not identical to an earlier exact operation.

A tool result is **evidence of activity, not of successful writes, deployed code, completed plans or correct side effects**. Exact repeated tool operations do not replenish retries. An unpaired or duplicated call/result, uncertain timeout or corrupted journal blocks automatic continuation. New v2 records contain only a hashed session identity, checkpoint anchor, assistant journal entry, episode key, ordinal/stage/reason code, and hashed proof with its OMP journal entry reference. No raw prompts, reasoning, tool args/results, credentials or provider identities are added to the journal.

The active OMP branch is authoritative. Pifrost never uses the checkpoint disk mirror to re-authorise work. A missing or invalid record under the active anchor fails closed; a branch rewind removes the corresponding evidence and does not copy authorisations from another branch. Existing v1 records remain readable as the original initial episode, including previously spent capacity. A new v2 episode requires evidence subsequent to the most recent earlier attempt. New sessions have independent hashes and checkpoint anchors.

Within one episode, stage 1 is same-model OMP-native continuation; stage 2 offers compact reconcile-first guidance and respects existing OMP-native context/compaction settings; stage 3 remains disabled without `PIFROST_RECOVERY_FALLBACK_ROLE=@role` and a verifiably distinct OMP model-family token. The physical provider behind a Bifrost alias is never inferred. There is no new context-window or token ceiling. A failed or unavailable third stage does not terminate or destroy the OMP task.

On any authorised continuation, OMP must inspect the current plan and workspace before another tool mutation. No tool is repeated automatically. Model-completion success and plan-incomplete metadata do not prove task completion.

## Example: long coding task

- Plan milestone A runs paired tests, then stalls: episode 1, attempt 1.
- The next stop has no intervening work: episode 1, attempt 2.
- OMP runs a distinct paired code-verification tool, with a successful tool-result pairing. It stalls again: **episode 2, attempt 1** — the earlier attempts remain in the journal.
- A later verification milestone is explicitly marked verified, followed by a separate stall: **episode 3, attempt 1**.
- OMP produces meaningful final output and verified checkpoint milestones: no further auto-continuation.

If the intervening action merely repeats an identical failed tool operation, no new episode is created. If the same response stalls repeatedly, the episode exhausts safely. Unverified side effects always require reconciliation.

## Operator controls and recovery after exhaustion

```text
/pifrost recovery status
/pifrost recovery diagnose
/pifrost checkpoint status
/pifrost checkpoint resume
/pifrost stalled status
```

A safety stop is a warning, **not** proof of a failed user task. The terminal message identifies withheld fallback, preserves session/checkpoint status, and suggests diagnosis and `checkpoint resume`. The latter inserts a resume prompt into OMP's editor only when supported; it does **not** automatically send or execute it. Inspect `git status`, files, relevant tests and remote mutation results before submitting. A genuine new user continuation in the same OMP session may start another safe episode after validation. No fresh session is required solely because a recovery episode exhausted.

## Backward compatibility, certification and performance

- `dev.pifrost.recovery-attempt.v1` is never rewritten, deleted, or silently reset.
- New records use `dev.pifrost.recovery-episode.v2`; the same current-branch validation enforces exact stage order and proof identity.
- OMP 18.10.4 / 18.12.1 / 18.12.5 remain the supported host contract targets. Test certification requires the full repository CI including Node, Bun, compiled OMP installations, Bifrost protocol tests, and package verification.
- Deterministic fixtures cover the 31K context case, consecutive exhaustion, two separated episodes, repeated tool signatures, invalid or stale journals, manual resumes, v1 compatibility, and closed checkpoints.
- Performance is dominated by OMP's authoritative `getBranch()` and scanning bounded metadata plus recent tool pairing; there is no background process, separate context replay, model API call, or periodic worker. Any CI/benchmark figures should be reported as measured rather than inferred.
- A simulated OMP hook is **not** an authenticated Bifrost live-provider certification. Live provider tests require credentials and an isolated workload.

## Risks, review and rollback

A fully paired tool can still be nonproductive; proof limits repeated identical actions but cannot semantically validate every side effect. Compacted or truncated native journals may no longer demonstrate progression and must fail closed. Explicit operator reconciliation remains the safe escape hatch. Model-family identity is determined only through OMP's family API.

**Rollback:** set `PIFROST_RECOVERY_MODE=off` or install the previous tag `v0.29.25`. OMP session history, signed reasoning, all previous checkpoint records and raw tool results are unmodified. V2 custom journal metadata is inert to older Pifrost versions and does not execute or replay anything.
