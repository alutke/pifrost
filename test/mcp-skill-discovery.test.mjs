import assert from "node:assert/strict";
import test from "node:test";
import {
  clientsForVirtualMcps, discoverMcpSkillMatches, mcpSkillDrift,
  normalizeMcpSkillDiscovery, recordMcpSkillLink, setMcpSkillAlias,
  setMcpSkillDismissal, withoutMcpSkillLinks,
} from "../mcp-skill-discovery.mjs";

const clients = [
  { id: "ds-id", name: "DonSeTch" },
  { id: "alt-id", name: "Web_Search" },
];
const skills = [
  { id: "ds-skill", name: "donsetch", version: "1.0.0" },
  { id: "web-skill", name: "web-search", version: "1.2.0" },
];

test("case-insensitive exact names discover a Skill without fuzzy normalization", () => {
  const found = discoverMcpSkillMatches(clients, skills);
  assert.equal(found[0].status, "matched");
  assert.equal(found[0].skill.id, "ds-skill");
  assert.equal(found[0].matchedBy, "name");
  assert.equal(found[1].status, "missing"); // punctuation is not normalized
});

test("ambiguous Skill records fail closed and client IDs de-duplicate", () => {
  const matched = discoverMcpSkillMatches([clients[0], clients[0]], [
    skills[0], { id: "other", name: "DonSeTch" },
  ]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].status, "ambiguous");
});

test("explicit alias binds by stable client ID and is unaffected by display-name rename", () => {
  const config = setMcpSkillAlias({}, clients[1], "web-search");
  const renamed = { ...clients[1], name: "New Search Client" };
  assert.equal(discoverMcpSkillMatches([renamed], skills, config)[0].skill.id, "web-skill");
  assert.equal(discoverMcpSkillMatches([renamed], skills, config)[0].matchedBy, "explicit-alias");
  assert.equal(discoverMcpSkillMatches([renamed], skills,
    setMcpSkillAlias(config, renamed, undefined))[0].status, "missing");
});

test("dismissal is explicit and repo-scoped, reversible without changing matching rules", () => {
  const config = setMcpSkillDismissal({}, clients[0], skills[0], true);
  assert.equal(discoverMcpSkillMatches([clients[0]], skills, config)[0].status, "dismissed");
  assert.equal(discoverMcpSkillMatches([clients[0]], skills, {})[0].status, "matched");
  const restored = setMcpSkillDismissal(config, clients[0], skills[0], false);
  assert.equal(discoverMcpSkillMatches([clients[0]], skills, restored)[0].status, "matched");
});

test("Virtual MCP discovery resolves only published member IDs with executable tools", () => {
  const bundles = [
    { enabled: true, tools: [
      { mcpClientId: "ds-id", toolNames: ["web_search"] },
      { mcpClientId: "alt-id", toolNames: [] },
      { mcpClientId: "unknown-id", toolNames: ["x"] },
    ] },
    { enabled: false, tools: [{ mcpClientId: "alt-id", toolNames: ["web_fetch"] }] },
  ];
  assert.deepEqual(clientsForVirtualMcps(bundles, clients), [clients[0]]);
});

test("provenance detects orphaned grants, missing installs and renamed Skill IDs", () => {
  const linked = recordMcpSkillLink({}, clients[0], skills[0]);
  const current = mcpSkillDrift(linked, [], [{ id: "ds-skill", name: "new-donsetch" }], []);
  assert.deepEqual(current.map((item) => item.type),
    ["client-unassigned", "skill-uninstalled", "skill-renamed"]);
  assert.equal(mcpSkillDrift(linked, [clients[0]], [skills[0]], ["donsetch"]).length, 0);
  assert.equal(mcpSkillDrift(withoutMcpSkillLinks(linked, "donsetch"), [], skills, []).length, 0);
});

test("invalid persisted configuration is ignored, not treated as grants or aliases", () => {
  assert.deepEqual(normalizeMcpSkillDiscovery({ aliases: [{}], links: "wrong" }),
    { aliases: [], dismissals: [], links: [] });
  assert.equal(discoverMcpSkillMatches(clients, skills,
    { aliases: [{ clientId: "ds-id", clientName: "DonSeTch", skillName: "web-search" },
      { clientId: "ds-id", clientName: "DonSeTch", skillName: "donsetch" }] })[0].status,
    "ambiguous-alias");
});

test("new configuration never implies permission to execute MCP tools", () => {
  const config = recordMcpSkillLink(setMcpSkillAlias({}, clients[0], "donsetch"), clients[0], skills[0]);
  assert.equal(JSON.stringify(config).includes("tools_to_execute"), false);
  assert.equal(JSON.stringify(config).includes("virtual_key"), false);
});
