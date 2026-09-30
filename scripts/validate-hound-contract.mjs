const HOUND_VERSION = "v12.4.1";
const HOUND_COMMIT = "1dab81b7fc03721688cfb7775fc1222c7f9805ba";

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

validateSource(
  `supported Hound ${HOUND_VERSION} (${HOUND_COMMIT})`,
  await fetchSource(HOUND_COMMIT),
);

if (process.env.PIFROST_HOUND_UPSTREAM_CANARY === "1") {
  validateSource("current Hound master canary", await fetchSource("master"));
}
