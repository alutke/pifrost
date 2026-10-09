/**
 * Read-only matching and local user choices for the Bifrost MCP -> Agent Skill bridge.
 * Neither MCP grants nor Bifrost Skills are managed here. The CLI applies selections
 * through the existing repository VK flow and skills-bridge installer.
 */
const key = (value) => String(value ?? "").trim().toLowerCase();
const ident = (client) => key(client?.id) || key(client?.name);
const clean = (value) => typeof value === "string" ? value.trim() : "";

export function normalizeMcpSkillDiscovery(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rows = (name, required) => Array.isArray(raw[name])
    ? raw[name].filter((item) => item && typeof item === "object" &&
      required.every((field) => clean(item[field])))
    : [];
  return {
    aliases: rows("aliases", ["clientId", "clientName", "skillName"]),
    dismissals: rows("dismissals", ["clientId", "skillId"]),
    links: rows("links", ["clientId", "clientName", "skillId", "skillName"]),
  };
}

function clientMatches(row, client) {
  // Stable Bifrost IDs win. Name fallback permits older repository configurations
  // lacking client IDs, without mapping a different known ID accidentally.
  if (clean(client?.id) && clean(row.clientId)) return key(row.clientId) === key(client.id);
  return key(row.clientName) === key(client?.name);
}

export function discoverMcpSkillMatches(clients, skills, configuration = {}) {
  const config = normalizeMcpSkillDiscovery(configuration);
  const seen = new Set();
  const results = [];
  for (const client of clients ?? []) {
    if (!clean(client?.name) || !ident(client) || seen.has(ident(client))) continue;
    seen.add(ident(client));
    const aliases = config.aliases.filter((row) => clientMatches(row, client));
    const targets = [...new Set(aliases.map((row) => key(row.skillName)))];
    if (targets.length > 1) {
      results.push({ client, status: "ambiguous-alias" });
      continue;
    }
    const name = targets[0] ?? key(client.name);
    const matches = (skills ?? []).filter((skill) => key(skill?.name) === name);
    if (matches.length !== 1) {
      results.push({ client, status: matches.length ? "ambiguous" : "missing", matchedName: name });
      continue;
    }
    const skill = matches[0];
    const dismissed = config.dismissals.some((row) =>
      clientMatches(row, client) && key(row.skillId) === key(skill.id));
    results.push({ client, skill, status: dismissed ? "dismissed" : "matched",
      matchedBy: targets.length ? "explicit-alias" : "name" });
  }
  return results;
}

export function clientsForVirtualMcps(bundles, clients) {
  const byId = new Map((clients ?? []).filter((item) => clean(item?.id))
    .map((item) => [key(item.id), item]));
  const result = [];
  for (const bundle of bundles ?? []) {
    if (!bundle?.enabled) continue;
    for (const entry of bundle.tools ?? []) {
      if (!Array.isArray(entry.toolNames) || !entry.toolNames.length) continue;
      const client = byId.get(key(entry.mcpClientId));
      if (client && !client.disabled) result.push(client);
    }
  }
  return [...new Map(result.map((item) => [ident(item), item])).values()];
}

export function setMcpSkillAlias(configuration, client, skillName) {
  const config = normalizeMcpSkillDiscovery(configuration);
  const aliases = config.aliases.filter((item) => !clientMatches(item, client));
  if (clean(skillName)) aliases.push({
    clientId: clean(client.id) || clean(client.name),
    clientName: clean(client.name),
    skillName: clean(skillName),
  });
  return { ...config, aliases };
}

export function setMcpSkillDismissal(configuration, client, skill, dismissed = true) {
  const config = normalizeMcpSkillDiscovery(configuration);
  const dismissals = config.dismissals.filter((item) =>
    !(clientMatches(item, client) && key(item.skillId) === key(skill.id)));
  if (dismissed) dismissals.push({
    clientId: clean(client.id) || clean(client.name),
    clientName: clean(client.name),
    skillId: clean(skill.id),
  });
  return { ...config, dismissals };
}

export function recordMcpSkillLink(configuration, client, skill) {
  const config = normalizeMcpSkillDiscovery(configuration);
  const links = config.links.filter((item) =>
    !(clientMatches(item, client) && key(item.skillId) === key(skill.id)));
  links.push({
    clientId: clean(client.id) || clean(client.name),
    clientName: clean(client.name),
    skillId: clean(skill.id),
    skillName: clean(skill.name),
    linkedAt: new Date().toISOString(),
  });
  return { ...config, links };
}

export function withoutMcpSkillLinks(configuration, skillName) {
  const config = normalizeMcpSkillDiscovery(configuration);
  return { ...config, links: config.links.filter((item) => key(item.skillName) !== key(skillName)) };
}

/** Advisory provenance only: never removes or grants access. */
export function mcpSkillDrift(configuration, activeClients, availableSkills = [], installedNames = []) {
  const config = normalizeMcpSkillDiscovery(configuration);
  const currentClients = activeClients ?? [];
  const installed = new Set(installedNames.map(key));
  const findings = [];
  for (const link of config.links) {
    const attached = currentClients.some((client) => clientMatches(link, client));
    if (!attached) findings.push({ type: "client-unassigned", ...link });
    if (!installed.has(key(link.skillName))) findings.push({ type: "skill-uninstalled", ...link });
    const byId = (availableSkills ?? []).find((skill) => key(skill.id) === key(link.skillId));
    if (byId && key(byId.name) !== key(link.skillName)) {
      findings.push({ type: "skill-renamed", ...link, currentName: byId.name });
    } else if (!byId && availableSkills?.length) {
      findings.push({ type: "skill-id-missing", ...link });
    }
  }
  return findings;
}
