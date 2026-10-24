# OMP compatibility — Pifrost v0.29.27

## Tested contract and ownership

- Packaged OpenMyPi libraries and policy snapshot: **18.12.5**. Keep pi-ai, pi-catalog, pi-natives, pi-utils and pi-coding-agent on exactly the same version. Never mix catalogue versions.
- Compiled-host installation checks: historical minimum **18.10.4**, previous **18.12.1**, and current **18.12.5**, both checked by a downloaded binary with pinned SHA-256 digest.
- Release CI validates static public APIs, cold/warm provider registration, model and routing contracts, multi-protocol recovery, reasoning replay, configuration preservation, and plugin installation. Local mocked tests do **not** prove live provider throughput or Bifrost rule hits.
- The OMP **main** canary is separate from release validation. Never use untagged main as the release's runtime policy snapshot.
- OMP retains agent sessions, history, prewalk, compaction, advisor, native judgment and retry orchestration. Bifrost retains physical routing, CEL, credentials, quotas and fallback policy; `retry.modelFallback` stays false in OMP. Pifrost translates interface contracts, exposes conservative metadata and records evidence.

## Workaround register and retirement gates

| Compatibility behaviour | Owner | Release A decision | Retirement condition |
| --- | --- | --- | --- |
| Cache-first startup and bounded cold discovery | Pifrost | Retain; validate both OMP binaries | OMP extension models reliably available before first model-scope resolution on clean installs, demonstrated in native/cold tests |
| Verification timestamp excluded from model-cache semantic fingerprint | Pifrost | Retain | OMP/Bifrost replace need for Pifrost cache identity and preserve policy/credential invalidation |
| Mixed Chat/Responses gateway ingress and pre-output retry | Pifrost boundary | Retain | Bifrost accepts every member wire protocol in the live logical route without unsafe fallback or replay |
| Synthetic `reasoning unavailable` replay hygiene | Pifrost boundary | Retain; check new native replay behaviour | Reproducible upstream fix removes exact placeholder without stripping signed/real reasoning; all replay tests pass |
| Context/token estimation before compatibility exception | Pifrost boundary | Retain, consume 18.12.1 policies | Stable upstream physical policy API provides accurate provider-qualified estimates with proven mixed-route behaviour |
| Native judge registration | Pifrost boundary | Release B enables explicit Jev images and OpenAI Decisions | Validate real gateway judgments before advertising further transports |
| Prompt-triggered Bifrost route reconciliation | Pifrost boundary | Retain unchanged | OMP/Bifrost offer an equivalent supported event-safe route-change notification without a daemon |

## Host compatibility and regression matrix

| Scenario | Required result |
| --- | --- |
| Empty cache, valid Bifrost model response | First OMP frame has selectable Bifrost models |
| Valid cache, offline/discovery failure | Cached models available without rewriting the route |
| Genuine policy or credential change | Cache invalidated; last verified rules not misrepresented |
| Same-protocol logical route | Original `omp-*` alias reaches Bifrost |
| Mixed protocol physical candidates | Retry only before committed text, reasoning or tool output |
| Replay after model switch | Signed reasoning and tool-call pairing preserved |
| Bifrost route updated during active OMP session | New model registry refresh only; no management secrets in inference process |
| CLI/plugin installation on packaged and released binaries | Both historical minimum and current smoke tests succeed |

## Historical: explicitly out of scope for Release A

Native image judgments, cross-provider decision routing, auto-prewalk activation, session consultations and new daemon/watch implementations. Follow-up releases may integrate them only after their contracts and live gateway endpoints have been verified.

## Release C — native orchestration

- `pifrost omp readiness [--verbose|--json]` reads OMP configuration, host version and local Pifrost catalog only; unknown and stale values are reported explicitly.
- OMP retains native auto-prewalk, seance session restoration/isolation, advisor continuation, judge execution and model switching. Bifrost retains physical routing and billing.
- Upstream OMP seance registry resolution is pinned to 18.12.1 and the Pifrost top-level reconciliation hook is exercised against simulated isolated seance prompts. Live historical consultation is not executed by CI.


## Release D — lifecycle and metadata controls (v0.28.0)

`workaround-register.mjs` is the source of truth for retained compatibility exceptions and their explicit retirement gates. Read with `pifrost omp workarounds --verbose` or `--json`. All remain in place until upstream versioned contracts, targeted regressions and representative gateway tests prove removal safe.

An image-count cap is published to OMP only when valid explicit metadata appears on every image-capable route member. Standard Bifrost model lists need not contain such data; absence is not evidence of unlimited support. We do not transfer official upstream vendor limits blindly to a custom Bifrost gateway.


## v0.29.0 — validation and evidence boundaries

- Install/list smoke on OMP 18.10.4 and 18.12.1 confirms packaged plugin discovery, not all feature APIs or live in-session execution. New judgment and image features are targeted to OMP 18.12.1; 18.10.4 installation compatibility does **not** assert newer feature support.
- Additional native extension registration tests use a local fake Bifrost model inventory to exercise Jev and OpenAI Decisions model metadata. They do **not** invoke compiled OMP or physical providers.
- Real native judgment conformance is available only through the explicitly billable `npm run smoke:judgments` workflow with user-supplied Bifrost credentials. No live results were recorded in this release's ordinary CI.
- OMP's non-chat judge role is not filtered by `enabledModels`, so activation no longer modifies that chat-model scope. It updates only `modelRoles`, verifies and safely recovers where possible.
- The static `workaround-register.mjs` remains a retained-only inventory. `scripts/validate-workarounds.mjs` checks identifiers and referenced tests. No automated retirement without targeted tests, reviewed evidence and an explicit change.

See [Integration support matrix](INTEGRATION_SUPPORT.md) for exact claims and limitations.


## Release 4 integration boundaries (v0.29.13)

The Release 4 packaged OMP policy snapshot was pinned to 18.12.1, with
historical minimum install compatibility checked against 18.10.4.
Release 4 changes output-token budgeting, not transport replay or
the host's native execution semantics. A physical exception enforces
limits for the known first physical member; Bifrost-native aliases keep
physical member capacities diagnostic-only. Read
[the updated output budget policy](OUTPUT_BUDGET.md) for fallback
trade-offs and [the current support matrix](INTEGRATION_SUPPORT.md)
for the difference between mocked checks and live conformance.

## Release 5A package and compatibility baseline (v0.29.14)

Pifrost now pins all five OMP packages and runtime policy snapshots to 18.12.5. The new compiled-host installation and plugin-loading gate uses OMP 18.12.5; the 18.10.4 minimum and 18.12.1 historical binaries remain independently tested. OMP manages judgment execution, agent lifecycle, tools, compaction and reasoning serialization. Bifrost 2.3.2 is the pinned HTTP public-contract baseline, with earlier tested contracts retained. A source compatibility check is not a live proof of physical fallback, MCP execution, quota or billed native judgment.

No gateway database upgrade or persistent service is performed by Pifrost. The Bifrost 2.3.1 migration requires an independent backup/rehearsal, and 2.3.2 custom Go plugins require Go 1.27.3. See [Release 5A](RELEASE_5A_CONTRACT_FOUNDATION.md) for operator steps and the separation between code tests and deployment.

## Release 5B — inference wire safety (v0.29.15)

OMP 18.12.5 remains the pinned host/policy snapshot. Pifrost does not rewrite completed chat/Responses content, remove opaque signed reasoning, alter parallel tool-call permissions, or silently lower a supported `xhigh` effort. All compatibility retries are pre-output and evidence-bound. A Bifrost 2.3.2 HTTP 413 request size rejection is terminal. Explicit gateway body/header notices about stripped max-token fields are shown as **unverified physical egress**, not proof of provider enforcement. See [Release 5B](RELEASE_5B_INFERENCE_HARDENING.md).

## Release 5C image policy parity (v0.29.16)

Image pricing resolves through public OMP 18.12.5 catalog lineage rules installed in `native.ts`, not a duplicated Pifrost provider policy. A portable DeepSeek V4.1 parity formula covers Node-only tests and partial compiled hosts. Unknown image dimensions charge the verified per-image rule's bounded maximum where available; other unknown physical policies keep the existing conservative fallback. This change does not automatically relax actual provider or gateway limits, and historical compiled OMP 18.10.4/18.12.1 installation support remains separate from feature conformance. See [Release 5C](RELEASE_5C_CONTEXT_DISCOVERY.md).

## Release 5D OMP 18.12.5 lifecycle boundaries (v0.29.17)

A successful top-level `agent_end` does not by itself prove replay is safe. Pifrost checks unresolved tool IDs, ambiguous results and pending work before emitting its one-shot follow-up. OMP session switch, tree, branch, and compact events invalidate pending approvals. These guards cover Pifrost-originated continuation, **not** Bifrost's independent MCP retry engine. Compiled OMP 18.10.4/18.12.1 compatibility checks verify plugin installation, not live recovery-event parity. See [Release 5D](RELEASE_5D_LIFECYCLE_MCP_SAFETY.md).
