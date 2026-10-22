# Release E — controlled recovery (v0.29.7)

A hard reasoning-history failure can leave a long OMP session unable to send
its previous assistant turns to a strict DeepSeek-family provider. Release D
preserves and validates the native reasoning-replay structure. Release E adds a
**user-controlled escape hatch**; it does not retry the rejected request.

## Commands in OMP

- `/pifrost recover` or `/pifrost recover status`: show the latest terminal
  inference failure and whether starting a fresh session is relevant.
- `/pifrost recover fork`: for a classified `REASONING_REPLAY_INVALID`
  failure **before any model output**, ask for an explicit continuation brief,
  show a confirmation dialog, and use OMP's native `newSession` API to open
  a clean session. Only the brief is submitted to the new session.
- `/pifrost trace verbose`: inspect provider routing, evidence, reasoning
  replay counters and Bifrost request identifiers.

The original OMP session is saved and linked through `parentSession`, but no
historical assistant/model reasoning, tool results, tool arguments, OMP signed
replay items, conversation transcript, or secrets are copied to the new
context. The *workspace itself is not reset*. The continuation prompt
instructs OMP to inspect current files and git state before non-idempotent
operations. User-supplied task context replaces speculative AI summaries.

## Safety boundary

The latest attempt's outcome is authoritative for the UX. If an initial
provider attempt fails but a later attempt succeeds, there is no recovery
notice or fork. If model output already started, Pifrost will not offer the
history-fork action; partial effects must be reviewed instead.

Fork is unavailable while OMP is streaming, messages are queued, async jobs
are running, the session isn't saved, or the command is invoked outside an
interactive top-level OMP session. Every state-changing step is explicitly
approved and idle/queue/job status is checked again after input and after
confirmation. A cancelled/new-session rejection leaves the original intact.

Virtual-key `MODEL_NOT_PERMITTED`, `OUTPUT_LIMIT_EXCEEDED`, routing-contract
and protocol errors receive diagnosis, not a history fork: these are
configuration/provider problems. Unknown failures do not trigger recovery.

Notices are once per terminal failure trace. Session-local notice state is
bounded and discarded on shutdown; there is no disk persistence, timer,
background daemon, automatic fallback, provider retry, tool re-execution, or
change to Bifrost's management policy.

## Original October 20 incident

The 555-item, 210-tool-call Responses request lacked native reasoning items
and received upstream `reasoning_content` HTTP 400. If this still occurs,
`/pifrost recover` identifies the replay failure. `fork` can start a fresh
session from a concise, operator-verified task brief **without re-sending all
555 historical items**. The user remains responsible for identifying
completed operations: Pifrost does not infer unseen work.

This release does not repair Bifrost Responses-to-Chat conversion and does
not automatically solve provider permissions or output-token errors.

## Default-on automatic continuation

`PIFROST_STALLED_TURN_MODE` defaults to `auto`. A *successful* main-agent
turn that demonstrably stops in leaked planning can enqueue **one**
OMP-owned continuation if its tool results are settled and no messages, async
jobs, cancellation, history rewrite or uncertain tool outcomes remain. The
continuation checks existing workspace state before external actions; it never
blindly replays tools or the HTTP inference request.

Use `PIFROST_STALLED_TURN_MODE=auto` (or `true`, `1`, `yes`, `on`) to
explicitly enable the default; `notice` requires manual approval and `off`
disables automatic continuation. Upstream token-range HTTP errors
and virtual-key permission failures are not successful stalled turns, so they
receive diagnosis rather than unsafe automatic re-execution.
