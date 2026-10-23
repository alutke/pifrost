# Release 30B — Adaptive Context Steward (v0.29.22)

## What it fixes

The 22 October incident reached **614,978 input tokens** on a CommandCode GOAT DeepSeek V4.1 Flash default route; adjacent advisor requests used **526K** tokens. Pifrost 30B reduces avoidable growth without hard-capping a model's input or output, removing protocol reasoning, rewriting history, or reimplementing OMP summarisation.

## Native OMP mid-turn management

OMP 18.12.5 owns the whole `compaction` pipeline, including `compaction.midTurnEnabled`, `compaction.autoContinue`, `compaction.methodOrder` and `compaction.modelThresholds`. New Pifrost setup and explicit `pifrost omp context apply` use OMP's schema-aware `omp config set` after reading and backing up the current configuration. No command rewrites arbitrary user-configured thresholds.

For Pifrost's default/task/plan/slow routes, a reliable **catalogue alias context-window hint >=184,616 tokens** qualifies for OMP's fixed `"f120000"` trigger; otherwise select OMP's window-relative `"65%"`. The advisor route uses `"f64000"` only when its alias window hint is >=98,462 tokens, otherwise `"65%"`. This preserves headroom on short-window models and never pretends a cached alias proves the physical model's current limit. Logical Bifrost route updates can change the window: rerun `pifrost models refresh --force` then `pifrost omp context` to inspect the updated policy. Existing exact or matching wildcard user entries take precedence.

An explicit `compaction.enabled=false`, `compaction.midTurnEnabled=false`, `compaction.autoContinue=false`, or `compaction.modelThresholdsEnabled=false` is not silently reversed by provisioning. Unreadable configuration fails closed. Configured OMP mid-turn compaction will happen before the next provider request in an active tool loop, using the user's existing OMP compaction method ordering and active-plan protection.

## Session-owned idle fallback

An additional lightweight budget uses **min(65% of OMP-reported effective context window, 120K)** for Pifrost/Bifrost idle sessions; unknown or overflowing windows are left to OMP recovery. It shares the existing route-eligibility compaction coordinator: **only one** compaction timer or in-flight invocation is allowed per session. The bounded timer uses OMP's own `ctx.setTimeout` and `ctx.compact()`, rather than a daemon, background monitor, synthetic provider call, or direct history rewriting. Pending user messages and running async work prohibit the compaction side effect. Unchanged context after an attempt is cooled until at least 32,768 tokens of further growth.

`PIFROST_CONTEXT_MODE=adaptive` (default) enables this supplementary idle policy; `native` disables the adaptive idle budget and provisioning but leaves the older optional route-eligibility maintenance; `off` disables both Pifrost idle policies and provisioning. OMP's own native settings remain independently authoritative. `PIFROST_COMPACT_BEFORE_CONTEXT_SKIP=0` only turns off the older route-eligibility strategy. The session-owned idle timer is never a tool-loop compactor; **native OMP threshold configuration is required for mid-turn protection**.

## Advisor limitation and preservation

A separate OMP advisor model/session may use the `bifrost/omp-advisor` threshold. If OMP instead constructs a side request by copying a parent history, Pifrost cannot prove that reducing the advisor route threshold isolates that copied history. 30B **does not** truncate advisor payloads or claim to guarantee a <=64K prompt. The read-only preview shows which threshold is actually configured; Bifrost usage must be measured independently after upgrade.

OMP retains all plan/protected-file and tool-result rules. No implicit mass-deletion of historical reasoning, file excerpts, tool pairs or instructions is introduced. Durable execution checkpoints remain Release 30C. Nonproductive-turn recovery remains 30D.

## Operator commands

```bash
pifrost models refresh --force
pifrost omp context
pifrost omp context apply --dry-run
pifrost omp context apply
pifrost omp readiness --verbose
```

Restart the active OMP process after applying persisted changes. The preview is read-only and does not touch configuration. Explicit apply backs up OMP config when available and uses OMP's supported CLI interface; there is no new service.

## Regression and rollback

Deterministic tests cover 615K/1M usage, 526K advisor usage, 128K models, unknown windows, provider-route target selection, user wildcard/exact preservation, disabled host settings, queued work, no-repeat cooldown and no-profile scheduling. Full CI must pass `npm run check`, `npm test`, `npm run release:check`, and compiled OMP 18.10.4/18.12.1/18.12.5 host installation.

Rollback: install v0.29.21, set `PIFROST_CONTEXT_MODE=off` to stop Pifrost's new idle policy if needed, and restore the automatically backed-up OMP config if `omp context apply` or `global configure-omp` was run. Do not remove or overwrite other OMP settings manually.
