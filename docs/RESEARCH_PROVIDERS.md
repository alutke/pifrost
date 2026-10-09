# Pifrost Research Provider Framework (0.11)

## Ownership and limitations

- OMP selects MCP tools and handles the agent's research workflow.
- Bifrost governs Virtual Key grants, MCP client connectivity, Code Mode and all search/fetch/crawl/screenshot executions.
- Pifrost owns provider identity bindings, capability discovery, diagnostic reports and bounded compatibility handling only.

Pifrost does **not** install, start, query directly, proxy or retry DonSeTch/Hound. It does not replace OMP model routing or silently fall back between research providers.

## Deploy and configure

Install and operate DonSeTch independently using its official project guidance. Its documented local HTTP endpoint is `donsetch mcp --http --port 8765` at `http://localhost:8765/mcp`. If Bifrost runs on another host, configure a privately reachable endpoint and `DONSETCH_HTTP_TOKEN` plus Bifrost-side credentials; use network controls as appropriate.

Once the upstream DonSeTch MCP client has been registered *in Bifrost*:

```sh
pifrost repo mcp add donsetch --tools '*'
pifrost repo research bind ds donsetch --profile donsetch
pifrost repo research prefer ds
pifrost repo research status
pifrost repo research probe ds
```

`bind` resolves and retains the actual Bifrost client ID, enabling stable bindings across display-name changes. `prefer` influences diagnostics and guidance, **not runtime execution**. `unbind` removes only a local binding; the Bifrost client and Virtual Key policy are unchanged. Clear a preference with `pifrost repo research prefer none`.

For another MCP search backend:

```sh
pifrost repo mcp add search-server --tools 'search_web,read_url'
pifrost repo research bind alt search-server --profile generic --search-tool search_web --fetch-tool read_url
pifrost repo research prefer alt
```

Optional additional mappings: `--crawl-tool` and `--screenshot-tool`. The Bifrost management discovery must confirm that explicitly mapped tool names actually exist. Unknown clients do not become a search provider merely because a tool happens to be named `search`.

## Readiness and observation

A capability is callable only when the exact MCP client/tool exists, is in the effective repository VK grant, is not excluded by known client `tools_to_execute` policy, and is verified on the repository gateway's live tool surface. `tools_to_auto_execute` is separate approval-free policy, not a substitute for execution permission. Absence of tools/list evidence is *unverified*, not ready. A search-only server is partial research capability, not an error.

Classic MCP checks directly exposed Bifrost tools. Code Mode inspects `listToolFiles` and `readToolFile` and validates actual functions in virtual Python stubs, never invoking `executeToolCode`. Pifrost distinguishes operational search, search+fetch web research and search+fetch+crawl deep research. OMP-native web search is reported separately.

`pifrost repo research probe [id]` explicitly issues a bounded, read-only sample search via the repo Bifrost MCP Virtual Key. It is Classic-MCP-only and does not exercise fetch, crawl, screenshots, change writes or authentication changes. Probe output summarizes status only, without retaining search evidence. Application failures are reported, not retried.

## DonSeTch-specific behavior

DonSeTch v4.7.0 exposes `web_search`, `web_fetch`, `web_crawl` and `web_screenshot`. MCP results may fold the state envelope into a leading `[meta] { JSON }` text block. Application-level errors may be `ok:false` while MCP `isError:false`; Pifrost's result classifier examines the envelope for diagnostic correctness and preserves original content and citations.

DonSeTch `S…` result handles and `L…` link handles are stateful. Use the same upstream instance for follow-up handle fetches or use original URLs across instances. Pifrost does not store, translate or load balance handles. DonSeTch itself manages its internal search backends and ranking.

## Screenshot safety

Existing Bifrost MCP versions can flatten upstream ImageContent into encoded text. Pifrost rehydrates only trusted, directly attributed screenshot tool results. It validates MIME, magic bytes, byte count and image limits, and will not treat an application-level DonSeTch `ok:false` as a valid screenshot. The built-in DonSeTch identity is recognised, and explicit generic screenshot bindings use an exact per-repo allow-list derived from the repo's Bifrost MCP configuration. A tool name from another MCP server or `executeToolCode` is not trusted. OMP text-only agents may use only their configured `@vision` role.

## Security, compatibility and lifecycle

Bifrost retains all client credentials and authorization state. Pifrost's non-loopback HTTP credential diagnosis remains **warning-only in doctor**; no opt-in, block or switch is introduced. DonSeTch is separately deployed and **AGPL-3.0**: review applicable network-use/redistribution obligations for its modified or hosted code. Hound was MIT and remains supported for migration continuity.

Required CI pins DonSeTch's release MCP contract at v4.7.0. A separate scheduled advisory canary follows DonSeTch master; unstable unreleased changes do not gate ordinary releases. Hound's legacy compatibility tests remain. No automatic cross-provider failover or additional MCP proxy has been introduced.
