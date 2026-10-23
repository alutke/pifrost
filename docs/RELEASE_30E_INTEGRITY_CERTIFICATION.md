# Release 30E — Reasoning Integrity, Observability & Certification (v0.29.25)

## Scope and verified foundations

30E hardens the merged 30A–30D execution chain; it does **not** introduce another continuation loop, service, history compactor, tool replayer or routing layer. Pifrost remains OMP's extension and Bifrost remains the authority for physical route selection.

The triggering 22 October incident included a Bifrost `success` / `stop` with **614,978 prompt tokens** and **16 reasoning-only output tokens**, without a useful answer or tool call. The accompanying advisor requests were approximately 526K tokens. These observations demonstrate the need for model-output and OMP-progress correlation, not proof of a particular physical-model context limit.

## 30E changes

1. **Fail-closed provider-wire replay certification.** Both Responses and Chat completion replay transformations now undergo structural postcondition checks before use. The verifier permits only the exact unsigned synthetic-message removals or prefix substitutions already defined by Pifrost's conservative OMP fallback hygiene. It forbids modified tool-call arguments/IDs, outputs, order, provider request metadata, user content, signed/opaque reasoning and arbitrary text changes. When certification fails or an unknown future OMP shape appears, the original bridged payload passes unchanged into the existing reasoning-compatibility guard. Never strip required reasoning merely to make an API request succeed.
2. **Opaque replay preservation.** Assistant history blocks bearing identity, encrypted content, signed text or reasoning signatures are ineligible for synthetic marker cleanup. This also applies to Chat history. The existing streaming filter continues to defer ambiguous marker-only reasoning until actual subsequent text/tool evidence; signatures remain intact.
3. **Strict journal integrity.** A malformed checkpoint prevents recovery from reverting to an older apparently valid snapshot. Any unknown or malformed attempt record after the active plan's journal anchor blocks automatic retry. Duplicate tool-call IDs/results are ambiguous. A stop-hook assistant output must match the latest persisted OMP assistant record before it can authorize continuation; a stale session tree or concurrent branch edit fails closed.
4. **Actual OMP lineage contract.** The optional stage-three fallback treats `ctx.models.family(model)` as an opaque equality token rather than assuming it must be a string. No provider family or physical model is guessed.
5. **Redacted diagnosis.** `/pifrost recovery diagnose` reports active-branch checkpoint status, explicitly recorded step counts, bounded recovery attempts, last assistant stop classification and OMP-estimated context pressure. It returns no user prompt text, path, session identifier, raw tool results, provider headers, secrets, raw SSE, signed reasoning, or Bifrost keys. Everything remains advisory: `taskCompleted = unverified`.

## Operator usage

```text
/pifrost recovery status
/pifrost recovery diagnose
/pifrost checkpoint status
/pifrost checkpoint resume
```

`PIFROST_RECOVERY_MODE` remains `auto` by default and supports `notice` and `off`. Optional `PIFROST_RECOVERY_FALLBACK_ROLE=@slow` still requires an OMP-verifiable different-family role. All retries remain journal-bound before execution. Existing `PIFROST_CONTEXT_MODE` and OMP compaction/user policy remain authoritative.

## Certification matrix

Redacted, deterministic fixture tests cover:

- Responses: unsigned synthetic reasoning preservation, safe marker removal when policy explicitly allows, signed/opaque reasoning retention, tool-call IDs and output pairing invariants, mutated provider fields, genuinely mixed text, nested OMP placeholders, and original-payload fallback.
- Chat: corroborated assistant prefix cleanup, unchanged tool and user history, signed assistant preservation.
- Execution: 614,978-token reasoning-only classification, current OMP branch isolation, invalid checkpoint rejection, corrupt recovery-attempt quarantine, repeated tool-call ID rejection, assistant journal/event mismatch, and session continuation budget.
- OMP: `session_stop` default-on recovery with no duplicate `agent_end` actor, 30C checkpoint restoration, and compatible OMP-family model fallbacks.
- Observability: diagnostic schema contains only enumerated codes and numeric counts, and never copies text from injected secrets, opaque signatures, prompts, model outputs or local paths.

Full repository CI additionally tests Node/Bun suites, TypeScript, static architecture and package validation, pinned Bifrost contracts and clean compiled OMP plugin installs for 18.10.4/18.12.1/18.12.5. These tests are structural and simulated; live end-to-end physical CommandCode/DeepSeek or OpenCode/Muse traffic requires an authenticated gateway environment and is not claimed solely from CI.

## Known limitations

Reasoning-content fields and signatures are provider-specific. Structural postconditions can show that Pifrost did not damage wire data, **not** that opaque provider reasoning is semantically authentic. A Bifrost-successful completion does not prove the task is finished. 30D intentionally declines auto-continuation when evidence is insufficient; if an OMP host rewrites or summarizes a response so that event and journal differ, the recovery path becomes advisory instead of guessing.

## Rollback

Install v0.29.24 (previous merged release) or set `PIFROST_RECOVERY_MODE=off` to disable recovery. This release does not migrate, prune or rewrite existing OMP session journals or checkpoint files. The wire replay guard is entirely in-process. No background service is introduced.
