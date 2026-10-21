# Release F — cross-provider contract hardening (v0.29.8)

## Goal

Release F strengthens the existing multi-provider OMP/Bifrost support rather
than inventing another client-side physical router or reducing model features.
Bifrost retains authoritative provider selection, virtual-key authorization,
fallback order, cost accounting and session affinity. OMP retains native
reasoning history construction, context compaction, tool execution and
completion processing.

## Verified ingress protocol fallback

For opaque Bifrost logical aliases where the member catalog suggests both
Chat Completions and Responses, Pifrost may probe the alternate **gateway
ingress** protocol. Such a probe is only permitted when *all* of the following
hold:

1. The immediately previous gateway attempt returned HTTP 400 or 422.
2. That attempt's error text explicitly matches a narrowly recognized
   unsupported-protocol message.
3. Any classified failure does not identify a stronger non-protocol cause
   (missing reasoning, output budget, authorization, etc.).
4. No model output was committed by that attempt.

The retry decision is based on evidence captured from the **same** HTTP
response. A text-only error, local serialization error, 403 model denial,
429 limit, 5xx gateway error or provider idle timeout never triggers an
alternate-protocol attempt. In all cases both ingress paths use the
**original Bifrost alias** and OMP session ID: Pifrost does not choose or
impersonate a different physical provider.

This is intentionally an existing limited ingress-protocol negotiation
step, not a general transient/recovery retry loop. Release E session
recovery remains entirely explicit and user-approved.

## Provider and serialization regression matrix

Automated regression coverage includes OpenCode Go, CommandCode GOAT,
DeepSeek direct, Xiaomi MiMo, OpenRouter, OpenAI Codex, Azure OpenAI,
GitHub Copilot and OpenCode Zen. These are synthetic, offline tests that
assert entitlement-specific provider normalization and token limits, exact
qualified request model names, gateway VK header persistence, OMP model
policies, tool-call/result matching and preservation of signed/encrypted
reasoning across both Chat and Responses.

No tool arguments, original messages, user content, model thinking or
provider secrets are stored in diagnostics. Historical/opaque provider
replay policy is never inferred merely from a product name. An unknown
capacity remains unverified, and Release B's no-arbitrary-role-cap
principle still applies.

## Verification and limits

CI covers TypeScript, unit and Bun native tests, architecture invariants,
release archive and clean GitHub installation, and pinned OMP/Bifrost
contracts. It cannot confirm which physical model your *live* Bifrost
virtual key will select. After installing, use `/pifrost trace verbose`
and Bifrost request logs to verify an actual connection or incident.
Virtual-key allowlist changes, physical reasoning conversion bugs and
upstream provider limits still belong to Bifrost/providers.
