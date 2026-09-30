const HOUND_COMMIT = "86d1b1329c0eed6133f29e3effe6a40a29f9dcdc";

const expectedTools = [
  "mcp_smart_search",
  "mcp_smart_fetch",
  "mcp_smart_crawl",
  "mcp_screenshot",
  "cache_clear",
  "version",
];

const requiredServerTokens = [
  'Route("/mcp", endpoint=_StreamableHTTPASGIApp())',
  "@server.list_tools()",
  "@server.call_tool(validate_input=False)",
];

async function fetchSource(ref) {
  const url = `https://raw.githubusercontent.com/dondai1234/master-fetch/${ref}/src/master_fetch/server.py`;
  const response = await fetch(url, {
    headers: { "User-Agent": "pifrost-hound-contract-check" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Hound contract ${ref} (HTTP ${response.status})`);
  }
  return await response.text();
}

function validateSource(label, source) {
  for (const tool of expectedTools) {
    const token = `"name": "${tool}"`;
    if (!source.includes(token)) {
      throw new Error(`${label} is missing Hound MCP tool ${tool}`);
    }
  }
  for (const token of requiredServerTokens) {
    if (!source.includes(token)) {
      throw new Error(`${label} is missing Hound Streamable HTTP contract: ${token}`);
    }
  }
  console.log(`Validated ${label}: ${expectedTools.join(", ")}`);
}

validateSource(`pinned Hound ${HOUND_COMMIT}`, await fetchSource(HOUND_COMMIT));
validateSource("current Hound master", await fetchSource("master"));
