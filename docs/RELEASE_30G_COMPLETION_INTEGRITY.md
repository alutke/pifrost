# Release 30G — Completion integrity and leaked-planning recovery (v0.29.27)

## Incident and scope

On 24 October 2026, Rugby Manager Online Release C.1 stopped after determinism corpus work while the model announced "Start with CI edit" and "Now CI wiring". The successful CommandCode GOAT DeepSeek V4.1 Flash response returned a normal `stop`, included repeated `</thinking>` tags, contained no new tool call and left CI, evidence, independent review and Git integration unfinished. Adjacent Muse Spark advisor calls did not perform the missing main-agent work.

In v0.29.26, `inspectOutput` recognised leaked reasoning only with specific planning phrases in the final 300 characters. A response ending "Now CI wiring" and repeated thinking closers therefore returned `NONE`. Additionally, 30D/30F allowed only `REASONING_ONLY_STOP` and `EMPTY_STOP` for auto continuation, and 30F v2 journal validation rejected any other reason. Fixing only the detector would not have resumed work.

This release fixes **all three layers**: shared conservative classification, checkpoint recovery eligibility, and immutable recovery-episode validation. The existing version-30F retry architecture remains authoritative.

## Classification and false positives

`completion-integrity.mjs` exposes `isLeakedPlanningStop`, used by both 30A diagnostics and the older one-shot stalled-turn detector. A leaked-planning signal requires explicit thinking-leak artifacts (two or more closing think tags, paired think delimiters, or a ¶think prefix) **plus** an actionable planning lead and action in a bounded recent clause. The intent must be near the end, with no intervening verified-completion statement or final-report heading. The exact five-closer incident is a regression fixture. Quoted model examples, ordinary explanations containing future-tense advice, and clean complete answers do not qualify.

This is a high-confidence heuristic, not a semantic task-completion oracle. Models can still stop prematurely without leaked markers. The classifying function neither reads nor writes history, tools, credentials or model routing metadata.

The four settlement reason codes remain `REASONING_ONLY_STOP`, `EMPTY_STOP`, `LEAKED_THINKING_STOP`, and `NONE`. A response with any tool call is never classified as a terminal no-action leak.

## OMP safety ownership

A suspicious stop is eligible only when the existing 30F planner independently establishes a current active 30C checkpoint, the latest matching OMP assistant settlement, paired and certain current-turn tool results, an unfinished checkpoint, and no cancellation, queued work, other stop-hook owner, or duplicate settlement. Release 30G does **not** automatically continue solely because a task is incomplete.

The continuation remains OMP-native `session_stop` (no replayed tool, provider call or rewritten session message), with unchanged bounded episodes and progress-evidence gates. The default mode remains `auto`; `PIFROST_RECOVERY_MODE=notice` reports without continuing and `off` disables. A physically different provider/family is **never** selected by inference; an alternate family remains optional and explicit.

New v2 records use the existing hashed schema and accept `LEAKED_THINKING_STOP`. Legacy v1 records remain valid, immutable, and use the original validation. No raw prompts or reasoning are persisted.

## Validation

Run:

```bash
npm ci
node --test test/release-30g-completion-integrity.test.mjs test/release-30f-episodes.test.mjs test/intelligent-stall-recovery.test.mjs test/execution-observation.test.mjs
npm run check
npm test
npm run release:check
```

The 30G test covers the real incident, normal responses, quoted reasoning examples, explicit final reports, tool-bearing outputs, provider errors, legacy leaked signatures, a branch-validated v2 recovery episode, duplicate settlement, pending/uncertain work, `notice`/`off`, stale session identity and missing checkpoints. Existing 30D/30F tests cover exhaustion, known side effects, branch integrity, and independent progress episodes.

A green GitHub CI run on the **current main SHA** is required before the repository's existing release workflow publishes `v0.29.27`. Local pure/unit tests and mock gateway tests do not establish live physical DeepSeek/Bifrost behavior; the supplied incident contains no native OMP branch journal, so no claim is made that the old hook actually executed or that all future premature stops are recoverable.

## Operational commands

```bash
npm install --global github:alutke/pifrost#v0.29.27
hash -r
omp install --force github:alutke/pifrost#v0.29.27
pifrost --version
pifrost doctor
```

Restart OMP to reload the extension, then use `/pifrost recovery diagnose`, `/pifrost recovery status`, and `/pifrost checkpoint status` to inspect recovery readiness. For a stopped current session, `/pifrost checkpoint resume` prepares an operator-reviewed prompt; do not reset, clean, rewrite or replay unverified workspace side effects.
