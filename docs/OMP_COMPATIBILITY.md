# OMP compatibility baseline — Pifrost 0.25.0 (Release A)

## Tested contract and ownership

- Packaged OpenMyPi libraries and policy snapshot: **18.12.1**. Keep pi-ai, pi-catalog, pi-natives, pi-utils and pi-coding-agent on exactly the same version. Never mix catalogue versions.
- Supported compiled-host smoke tests: historical minimum **18.10.4** and validated current **18.12.1**, both checked by a downloaded binary with pinned SHA-256 digest.
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

## Explicitly out of scope for Release A

Native image judgments, cross-provider decision routing, auto-prewalk activation, session consultations and new daemon/watch implementations. Follow-up releases may integrate them only after their contracts and live gateway endpoints have been verified.

## Release C — native orchestration

- `pifrost omp readiness [--verbose|--json]` reads OMP configuration, host version and local Pifrost catalog only; unknown and stale values are reported explicitly.
- OMP retains native auto-prewalk, seance session restoration/isolation, advisor continuation, judge execution and model switching. Bifrost retains physical routing and billing.
- Upstream OMP seance registry resolution is pinned to 18.12.1 and the Pifrost top-level reconciliation hook is exercised against simulated isolated seance prompts. Live historical consultation is not executed by CI.


## Release D — lifecycle and metadata controls (v0.28.0)

`workaround-register.mjs` is the source of truth for retained compatibility exceptions and their explicit retirement gates. Read with `pifrost omp workarounds --verbose` or `--json`. All remain in place until upstream versioned contracts, targeted regressions and representative gateway tests prove removal safe.

An image-count cap is published to OMP only when valid explicit metadata appears on every image-capable route member. Standard Bifrost model lists need not contain such data; absence is not evidence of unlimited support. We do not transfer official upstream vendor limits blindly to a custom Bifrost gateway.
