import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";

const runFile = promisify(execFile);

test("real CLI watch once stages model refresh, updates only changed policy, and refuses incomplete snapshots", async t => {
  const home = mkdtempSync(join(tmpdir(), "pifrost-watch-cli-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const fakeOmp = join(bin, "omp");
  const marker = join(home, "refresh-count.txt");
  const secretExposed = join(home, "management-exposed.txt");
  writeFileSync(fakeOmp, `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.slice(2).join(" ") !== "models refresh") process.exit(2);
if (process.env.BIFROST_ADMIN_PASSWORD || process.env.BIFROST_MANAGEMENT_API_KEY) {
  fs.writeFileSync(${JSON.stringify(secretExposed)}, "EXPOSED");
}
const config = JSON.parse(fs.readFileSync(process.env.PIFROST_ALIASES,"utf8"));
const models = Object.keys(config.aliases).map(id=>({id,name:id}));
fs.writeFileSync(process.env.PIFROST_CACHE_FILE, JSON.stringify({
  schemaVersion:4, generatedAt:new Date().toISOString(), aliasFingerprint:"c".repeat(64),
  models,diagnostics:[]
}));
fs.appendFileSync(${JSON.stringify(marker)}, "refresh\\n");
`, { mode: 0o700 });
  chmodSync(fakeOmp, 0o700);
  let mode = "normal";
  let predicate = "model == 'omp-advisor'";
  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/api/routing/rules")) {
      res.writeHead(404);res.end();return;
    }
    assert.match(req.headers.authorization ?? "", /^Basic /u);
    res.setHeader("content-type","application/json");
    if (mode === "truncated") {
      res.end(JSON.stringify({ rules: [], total_count: 3 }));
      return;
    }
    if (mode === "badshape") {
      res.end(JSON.stringify({ unexpected: [] }));
      return;
    }
    res.end(JSON.stringify({ rules: [{
      id:"advisor",name:"omp-advisor",enabled:true,scope:"global",
      cel_expression:predicate,targets:[{ provider:"opencode-go",model:"muse-spark-1.3-contributor",weight:1 }],
      fallbacks:["Xiaomi MIMO/mimo-v2.6-flash"]
    }], total_count:1 }));
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing server address");
  const env = { ...process.env,
    PIFROST_CONFIG_DIR:home,
    PIFROST_ALIASES:join(home,"aliases.json"),
    PIFROST_CACHE_FILE:join(home,"catalog.json"),
    PI_CODING_AGENT_DIR:home,
    BIFROST_URL:`http://127.0.0.1:${address.port}/v1`,
    BIFROST_VIRTUAL_KEY:"sk-bf-secret-vk",
    BIFROST_MANAGEMENT_AUTH_MODE:"basic",
    BIFROST_ADMIN_USERNAME:"admin",
    BIFROST_ADMIN_PASSWORD:"test-password",
    PATH:`${bin}:${process.env.PATH}`,
  };
  const cli = async (...args) => runFile(process.execPath, ["cli.mjs",...args],
    { cwd:process.cwd(), env, timeout:25_000 });
  const first = await cli("routes","watch","once");
  assert.match(first.stdout,/Updated 1 Bifrost routes/u);
  assert.equal(readFileSync(marker,"utf8").trim().split("\n").length,1);
  assert.equal(readFileSync(join(home,"aliases.json"),"utf8").includes("opencode-go/muse-spark-1.3-contributor"),true);
  assert.equal(readFileSync(join(home,"catalog.json"),"utf8").includes("omp-advisor"),true);
  const previouslySaved = readFileSync(join(home,"aliases.json"),"utf8");
  const repeat = await cli("routes","watch","once");
  assert.match(repeat.stdout,/Routes unchanged/u);
  assert.equal(readFileSync(marker,"utf8").trim().split("\n").length,1, "unchanged must not rebuild model catalog");
  assert.equal(readFileSync(join(home,"aliases.json"),"utf8"),previouslySaved);
  predicate = "model == 'omp-advisor' && request_type == 'chat'";
  const changed = await cli("routes","watch","once");
  assert.match(changed.stdout,/Updated 1 Bifrost routes/u);
  assert.equal(readFileSync(marker,"utf8").trim().split("\n").length,2);
  const saved = readFileSync(join(home,"aliases.json"),"utf8");
  for (const badMode of ["truncated","badshape"]) {
    mode = badMode;
    const rejected = await cli("routes","watch","once").then(() => null,e => e);
    assert.equal(rejected?.code,1);
    assert.match(rejected.stderr,/gateway-read-failed/u);
    assert.equal(readFileSync(join(home,"aliases.json"),"utf8"),saved,
      "failed partial response cannot alter saved policy");
    assert.equal(readFileSync(marker,"utf8").trim().split("\n").length,2);
  }
  assert.equal(await BunlessExists(secretExposed),false,"inference child must not receive management secrets");
  assert.doesNotMatch(first.stdout+first.stderr+changed.stdout+changed.stderr,/test-password|sk-bf-secret-vk/u);
});

async function BunlessExists(path) {
  const fs = await import("node:fs");
  return fs.existsSync(path);
}
