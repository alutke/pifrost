# Release 5C — OMP image accounting and Bifrost catalogue completeness (v0.29.16)

Release 5C continues from the verified v0.29.15 baseline. OMP **18.12.5**
remains the packaged policy snapshot; Bifrost **2.3.2** remains the pinned
gateway source contract. Pifrost does not become a physical router or
maintain a separate long-running model service.

## Candidate-aware image pricing

Previously, `omp-context-policy.ts` mirrored OMP 18.8.x image rules and
priced some DeepSeek V4.1 Flash frames using a generic 32px OpenAI or
28px Anthropic policy. With many images this could overestimate input
tokens, trigger premature compaction or falsely exclude a valid member.

The OMP 18.12.5 public
`@oh-my-pi/pi-catalog/compat/image-tokenization` API is now injected in
the native extension:

- `resolveImageTokenization(target)` chooses the model-lineage/wire rule.
  Identity includes real provider and physical model when known, not merely
  the configured Bifrost alias.
- `imageTokens(rule,size,detail)` calculates candidate-specific tokens.
  DeepSeek V4.1 Flash uses the verified 14px/3×3 patch formula, 1024
  visual-token budget and 544×544 minimum image area.
- Standalone Node diagnostics keep a deterministic native-addon-free
  fallback, including a parity port of the DeepSeek V4.1 grid.
- Unknown dimensions are charged a bounded rule maximum where available;
  uncapped OpenAI sizes retain a conservative wire estimate.
- Provider-reported usage anchors are associated only with the exact
  physical serving identity. Unknown/fallback identity does not promote
  an unrelated provider's token usage to authority.

This adjusts Pifrost's **estimate** for prewalk and eligibility, not
the physical provider's enforced context window, output ceiling, session
compaction rules or Bifrost's fallback decisions.

## Model discovery integrity

`fetchBifrostModels` no longer treats a response with an explicit
`next_page_token` as an exhaustive inventory. It follows the gateway's
opaque `page_token`, merging returned models by ID while retaining the
same VK-based discovery authority. Discovery rejects:

- Failed key-level discovery statuses reported by Bifrost.
- A continuation cursor that repeats, is malformed or follows an empty page.
- `has_more=true` without a usable continuation cursor.
- A document that lacks `data[]` or a response with no usable chat models.
- More than 100 pages (integrity guard against a broken gateway loop, not
  a model-count cap).

A failed discovery throws a specific non-secret error; it **does not**
write a partial inventory into the last-known-good model cache. This
does not solve Bifrost issue
[#8759](https://github.com/maximhq/bifrost/issues/8759) if the gateway
silently omits models **without** any cursor or failure status. For that
case, verify against a provider-scoped or known model-list baseline and
fix the discovery process upstream.

## Tests and release gates

```bash
npm ci
npm run check
npm test
npm run release:check
```

The deterministic tests compare the real OMP catalog rule against Pifrost's
portable pricing; price a 25-image context, preserve OpenAI/Claude
differences, and test valid, invalid, empty and cyclic paginated model
inventories. Release CI also checks pinned OMP/Bifrost contracts and
clean GitHub installation with compiled hosts 18.10.4, 18.12.1 and 18.12.5.

No real Bifrost inference request, remote vision token bill, gateway image
payload, paid judge or mutation-capable MCP execution is implied by these
fixtures. A live gateway model-inventory comparison and image-usage
accounting smoke remain optional and may be provider/billing sensitive.
No daemon, automated billable probe, routing-rule changes or new output cap
was added. Roll back by installing the prior tagged v0.29.15 package.
