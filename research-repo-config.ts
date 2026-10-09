import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStoredConfig } from "./config-store.ts";

/**
 * Resolve the active repository by its own Bifrost Virtual Key reference,
 * without importing CLI-only Git identity code or exposing credentials.
 * Untrusted project files cannot extend the allow-list unless they select a
 * locally configured repo id, which is still restricted to direct MCP names.
 */
export function loadRepoResearchScreenshotTools(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): string[] {
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
	const config = repoId ? (loadStoredConfig(env) as { repos?: Record<string, { research?: { providers?: Array<{ mcpClient?: string; profile?: string; tools?: { screenshot?: string } }> } }> } | undefined)?.repos?.[repoId] : undefined;
	const providers = config?.research?.providers;
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

