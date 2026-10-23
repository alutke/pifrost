# Release 30C — Durable Execution Checkpoints (v0.29.23)

## Summary

30C adds a **branch-scoped, recoverable task checkpoint** without expanding the LLM prompt, bypassing OMP's session manager, or replaying tools. OMP owns session history, compaction and branching. Pifrost persists bounded, non-model `custom` journal entries (`dev.pifrost.execution-checkpoint.v1`) and an independent, atomic 0600 disk mirror under `~/.config/pifrost/checkpoints/<session-hash>/` for incident review.

The mirror is **not authoritative for active progress**. The current OMP `getBranch()` custom entries determine the latest checkpoint. If the user branches back before a verification entry, that verification is not restored on the rewound branch. A session with a different ID or workspace cannot adopt the checkpoint. A missing/unreadable journal fails closed rather than adopting an orphaned mirror.

## Automatic behaviour

- On the main agent's `before_agent_start` event, Pifrost creates a checkpoint for long instructions (1,500+ characters) or an explicit release/phase implementation request. It records a SHA-256 digest and length of the original instruction; **never the raw prompt or secrets**. The original text stays within OMP's own session journal. There is no extra network request, service or daemon.
- On the main agent's `agent_end` event, tool-result messages since the most recent checkpoint entry are counted, and any new activity is marked **pending verification**. A successful process exit or model-generated statement never counts as verified.
- Compaction uses a short checkpoint reference through OMP's `session.compacting` hook. OMP still owns the summarisation method, plan protection, history and actual context mutation.
- Session start, branch, tree navigation, compaction and session switch restore from the **active branch**. Old state does not leak across rewinds or separate sessions.
- The ledger is bounded (64 steps, 20 KB per snapshot, safe short references) and written atomically to disk after it is appended to the OMP journal. If the disk mirror fails, the journal remains authoritative and a warning is emitted. No write is attempted to the project repository by default.

## Explicit operator controls

All the following are interactive top-level OMP commands:

```text
/pifrost checkpoint status
/pifrost checkpoint begin docs/release-c.md
/pifrost checkpoint attempt C1a
/pifrost checkpoint verify C1a ci:1234
/pifrost checkpoint fail C1b
/pifrost checkpoint complete
/pifrost checkpoint supersede
/pifrost checkpoint resume
```

The `verify` operation requires **operator-provided evidence reference**; it does not itself execute a build or validate a CI run. `complete` rejects any unverified step or later unacknowledged tool activity. `resume` only places a safety-oriented reconciliation prompt in the OMP editor when idle, with no queued messages or async jobs. It **does not send** the prompt or execute any writes/tools. `begin` explicitly replaces the active task checkpoint with a new plan reference.

Automatic checkpoints capture only the fact that there was tool activity and the original prompt digest. They cannot infer which phase is complete, which tests passed, or what the correct remaining task is. Use `attempt`/`verify` for evidence-backed progress. The precise code/tests and repository diff must still be inspected before action.

## Reliability and safety

- No tool-call arguments, tool results, files, unredacted prompt text, API keys or execution transcript are copied into the checkpoint.
- Only session identity and workspace **hashes** appear in the ledger and mirror filename.
- Each recorded verification remains an **explicit operator attestation**, not an independent guarantee that tests truly passed.
- Tool-result observation does not imply the side effect was committed successfully. Missing or uncertain results remain unverified.
- The session journal is the primary source and can be replayed on restart without a long-running process.
- Checkpoint status and prompt injection are **advisory**, with explicit constraints to avoid turning a task summary into authority over the current workspace or user instructions.
- The checkpoint mirrors are not encrypted; protect the user's local home directory. They contain short operator-entered identifiers/evidence references, so users must not put credentials in these fields.

## Verification

The deterministic suite covers large prompt hashing, branch rewind and session-id changes, restored progress after simulated restart/compaction, unverified tool results, evidence requirements, 0600 atomic disk mirror, journal write failures and no automatic replay. Full repository CI additionally checks TypeScript, the packaged plugin and historical/current compiled OMP hosts.

Limitations: there is no automatic inference of verified files, milestones or test outcomes in 30C, and no autonomous reconstruction of work whose entire journal has been deleted. Automatic progress resumption and model fallback are part of 30D.

## Rollback

Install the preceding v0.29.22 Pifrost package. Existing OMP journal entries use a private custom namespace and can remain in the session without modifying its model transcript. The mirror files under the private checkpoints directory are optional evidence; do not delete them while investigating an interrupted session. No configuration migrations, services or provider permissions are added.
