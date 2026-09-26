const OMP_18_3_2_COMMIT = "7853b4e499936f9dcc13c9b64adb55f6b342aabf";

const SOURCES = [
  {
    name: "OMP 18.3.2 MCP schema instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_3_2_COMMIT}/packages/coding-agent/src/config/mcp-schema.json`,
    required: [
      "\"instructions\"",
      "Include server-provided instructions in the system prompt",
      "\"type\": \"boolean\"",
    ],
  },
  {
    name: "OMP 18.3.2 MCP runtime instructions contract",
    url: `https://raw.githubusercontent.com/can1357/oh-my-pi/${OMP_18_3_2_COMMIT}/packages/coding-agent/src/mcp/manager.ts`,
    required: [
      "getServerInstructions",
      "connection.config.instructions !== false",
    ],
  },
];

for (const source of SOURCES) {
  const response = await fetch(source.url, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  const body = await response.text();
  const missing = source.required.filter((token) => !body.includes(token));
  if (missing.length) {
    throw new Error(`${source.name}: upstream contract changed; missing ${missing.join(", ")}`);
  }
  console.log(`${source.name}: OK`);
}
