import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";

const CLI = resolve(import.meta.dirname, "../cli.mjs");
const client = { client_id: "client-ds", name: "donsetch", tools: ["web_search"] };
const skill = {
  id: "skill-ds", name: "donsetch", latest_version: "1.0.0",
  description: "Use DonSeTch for research", skill_md_body: "## Guidance\\nSearch first.",
  files: [],
};

async function runCli(cwd, env, args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "pifrost-skill-cli-"));
  const work = join(root, "repo");
  const home = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(work);
  mkdirSync(home);
  mkdirSync(configDir);
  assert.equal(spawnSync("git", ["init", "-q", work]).status, 0);
  const id = basename(work).toLowerCase() + "-" +
    createHash("sha256").update(realpathSync(work)).digest("hex").slice(0, 10);
  const vk = { id: "vk-test", name: "omp-" + id + "-mcp", mcp_configs: [] };
  const virtual = { id: 44, name: "Research Tools", enabled: true, tools: [
    { mcp_client_id: "client-ds", tool_names: ["web_search"] },
  ], virtual_key_ids: [] };
  const counters = { skills: 0, installs: 0, grants: 0 };
  let failSkills = false;
  const requests = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://mock");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ method: req.method, path: u.pathname });
    const send = (payload, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (u.pathname === "/mcp" && req.method === "POST" && body.method === "initialize") {
      return send({ jsonrpc: "2.0", id: body.id,
        result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "bifrost-test", version: "1" } } });
    }
    if (u.pathname === "/api/mcp/clients" && req.method === "GET") {
      return send({ clients: [client], total: 1 });
    }
    if (u.pathname === "/api/mcp/virtual-mcps" && req.method === "GET") {
      return send({ virtual_mcps: [virtual], total: 1 });
    }
    if (u.pathname === "/api/governance/virtual-keys/vk-test") {
      if (req.method === "PUT") {
        vk.mcp_configs = body.mcp_configs ?? vk.mcp_configs;
        counters.grants += 1;
      }
      return send({ virtual_key: vk });
    }
    if (u.pathname === "/api/mcp/virtual-mcps/44/virtual-keys/vk-test" && req.method === "POST") {
      virtual.virtual_key_ids = ["vk-test"];
      counters.grants += 1;
      return send({});
    }
    if (u.pathname === "/api/skills" && req.method === "GET") {
      counters.skills += 1;
      return failSkills ? send({ error: "down" }, 503) : send({ skills: [skill], total: 1 });
    }
    if (u.pathname === "/api/skills/skill-ds" && req.method === "GET") {
      counters.installs += 1;
      return send({ skill });
    }
    send({ error: "unexpected test endpoint: " + u.pathname }, 404);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = "http://127.0.0.1:" + server.address().port + "/v1";
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    schemaVersion: 1,
    bifrost: { url, managementAuthMode: "bearer" },
    repos: { [id]: { virtualKeyId: vk.id, virtualKeyName: vk.name, mcpClients: [] } },
  }));
  writeFileSync(join(configDir, "secrets.json"), JSON.stringify({
    schemaVersion: 1,
    inferenceVirtualKey: "vk-inference",
    managementApiKey: "management-key",
    repos: { [id]: { mcpVirtualKey: "vk-secret" } },
  }), { mode: 0o600 });
  const env = { ...process.env, HOME: home, PIFROST_CONFIG_DIR: configDir };
  try {
    return await run({ work, home, configDir, id, vk, virtual, counters, env, requests,
      run: (...args) => runCli(work, env, args),
      failSkills: (next) => { failSkills = next; },
    });
  } finally {
    await new Promise((ok) => server.close(ok));
    rmSync(root, { recursive: true, force: true });
  }
}

test("direct MCP assignment does not install Skills without explicit unattended consent", async () => {
  await fixture(async ({ run, work, counters, vk }) => {
    const first = await run("repo", "mcp", "add", "donsetch", "--yes");
    assert.equal(first.code, 0, first.stderr + first.stdout);
    assert.match(first.stdout, /Skipped \(noninteractive/u);
    assert.equal(existsSync(join(work, ".agents/skills/donsetch")), false);
    assert.equal(vk.mcp_configs.length, 1, "MCP grant was committed independently");
    assert.equal(counters.installs, 0);
  });
});

test("explicit opt-in installs once, tracks provenance and never repeats an unchanged grant", async () => {
  await fixture(async ({ run, work, configDir, id, counters }) => {
    const first = await run("repo", "mcp", "add", "donsetch", "--install-matching-skills");
    assert.equal(first.code, 0, first.stderr + first.stdout);
    assert.match(first.stdout, /Installed donsetch@1\.0\.0/u);
    assert.equal(existsSync(join(work, ".agents/skills/donsetch/SKILL.md")), true);
    const state = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    assert.equal(state.repos[id].mcpSkillDiscovery.links[0].clientId, "client-ds");
    assert.equal(state.repos[id].bifrostSkills[0].name, "donsetch");
    const again = await run("repo", "mcp", "add", "donsetch", "--install-matching-skills");
    assert.equal(again.code, 0, again.stderr);
    assert.equal(counters.installs, 1);
    assert.equal(counters.skills, 1, "catalogue should not be read for unchanged direct grant");
  });
});

test("an optional Skill discovery failure never reverses a successful MCP assignment", async () => {
  await fixture(async ({ run, failSkills, vk }) => {
    failSkills(true);
    const result = await run("repo", "mcp", "add", "donsetch", "--install-matching-skills");
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /WARN Optional MCP Skill discovery unavailable/u);
    assert.equal(vk.mcp_configs.length, 1);
  });
});

test("new Virtual MCP assignment resolves client ID instead of matching the bundle's name", async () => {
  await fixture(async ({ run, work, counters }) => {
    const result = await run("repo", "vmcp", "add", "Research Tools", "--install-matching-skills");
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Installed donsetch@1\.0\.0/u);
    assert.equal(existsSync(join(work, ".agents/skills/donsetch/SKILL.md")), true);
    assert.equal(counters.installs, 1);
  });
});

test("repo init offers once and preserves Skill discovery preferences on subsequent init", async () => {
  await fixture(async ({ run, configDir, id, counters }) => {
    const first = await run("repo", "init", "--clients", "donsetch", "--install-matching-skills");
    assert.equal(first.code, 0, first.stderr + first.stdout);
    assert.match(first.stdout, /Installed donsetch@1\.0\.0/u);
    const once = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    assert.equal(once.repos[id].mcpSkillDiscovery.links.length, 1);
    assert.equal(counters.installs, 1);

    const second = await run("repo", "init", "--clients", "donsetch", "--install-matching-skills");
    assert.equal(second.code, 0, second.stderr + second.stdout);
    assert.equal(counters.installs, 1);
    assert.equal(counters.skills, 1);
    const twice = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    assert.equal(twice.repos[id].mcpSkillDiscovery.links.length, 1);
    assert.equal(twice.repos[id].bifrostSkills[0].name, "donsetch");
  });
});
