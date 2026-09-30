const HOUND_COMMIT = "86d1b1329c0eed6133f29e3effe6a40a29f9dcdc";
const sourceUrl =
  `https://raw.githubusercontent.com/dondai1234/master-fetch/${HOUND_COMMIT}/src/master_fetch/server.py`;

const expectedTools = [
  "mcp_smart_search",
  "mcp_smart_fetch",
  "mcp_smart_crawl",
  "mcp_screenshot",
  "cache_clear",
  "version",
];

const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "pifrost-hound-contract-check" },
});
if (!response.ok) {
  throw new Error(`Failed to fetch pinned Hound contract (HTTP ${response.status})`);
}
const source = await response.text();

for (const tool of expectedTools) {
  const token = `"name": "${tool}"`;
  if (!source.includes(token)) {
    throw new Error(`Pinned Hound MCP contract is missing ${tool}`);
  }
}

for (const token of [
  'Route("/mcp", endpoint=_StreamableHTTPASGIApp())',
  'method == "tools/list"',
  'method == "tools/call"',
]) {
  if (!source.includes(token)) {
    throw new Error(`Pinned Hound Streamable HTTP contract is missing: ${token}`);
  }
}

console.log(`Validated Hound MCP contract at ${HOUND_COMMIT}: ${expectedTools.join(", ")}`);
