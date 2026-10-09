import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStoredConfig } from "./config-store.ts";

/**
 * Resolve the active repository by its own Bifrost Virtual Key reference,
 * without importing CLI-only Git identity code or exposing credentials.
 * Untrusted project files cannot extend the allow-list unless they select a
 * locally configured repo id, which is still restricted to direct MCP names.
 */
type ResearchBinding = { id?: string; mcpClient?: string; profile?: string; tools?: { screenshot?: string } };
type RepoResearch = { preferred?: string; providers?: ResearchBinding[] };
function activeRepoResearch(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): RepoResearch | undefined {
	let current = resolve(cwd);
	let repoId: string | undefined;
	for (let depth = 0; depth < 24; depth++) {
		const file = resolve(current, ".omp/mcp.json");
		if (existsSync(file)) {
			try {
				const obj: unknown = JSON.parse(readFileSync(file, "utf8"));
				const ref = (obj as { mcpServers?: { bifrost?: { headers?: Record<string, string> } } })
					?.mcpServers?.bifrost?.headers?.["x-bf-vk"];
				const match = typeof ref === "string"
					? /^!pifrost secret repo-mcp --id ([a-zA-Z0-9_-]+)$/u.exec(ref)
					: undefined;
				if (match) repoId = match[1];
			} catch { /* other project MCP configs do not authorize recovery */ }
			break;
		}
		const parent = resolve(current, "..");
		if (parent === current) break;
		current = parent;
	}
	const config = repoId ? (loadStoredConfig(env) as { repos?: Record<string, { research?: RepoResearch }> } | undefined)?.repos?.[repoId] : undefined;
	return config?.research;
}

/** Repo-scoped metadata only. Does not communicate with Bifrost MCP. */
export function loadRepoResearchScreenshotTools(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): string[] {
	const providers = activeRepoResearch(env, cwd)?.providers;
	const allow: string[] = [];
	for (const provider of Array.isArray(providers) ? providers : []) {
		const name = provider?.mcpClient;
		const tool = provider?.tools?.screenshot ?? (provider?.profile === "donsetch"
			? "web_screenshot" : provider?.profile === "hound" ? "mcp_screenshot" : undefined);
		if (!name || !tool ||
			!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(name) ||
			!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(tool)) continue;
		for (const separator of ["_", "-"]) allow.push(("mcp__bifrost_" + name + separator + tool).toLowerCase());
	}
	return [...new Set(allow)];
}


/** Agent-facing hint only when there is an explicit local preference. */
export function preferredRepoResearchGuidance(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): string | undefined {
	const research = activeRepoResearch(env, cwd);
	if (!research?.preferred || !Array.isArray(research.providers)) return undefined;
	const binding = research.providers.find((row) => row?.id?.toLowerCase() === research.preferred?.toLowerCase());
	const client = binding?.mcpClient;
	// Do not inject arbitrary config text into the agent's system prompt.
	if (!client || !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(client)) return undefined;
	return "Research MCP preference: when relevant and actually available through Bifrost, prefer the " +
		client + " MCP client for web research. This is guidance, not enforced routing; " +
		"user requests, actual MCP tool availability and Bifrost authorization take precedence.";
}
