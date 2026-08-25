#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  commandExists,
  diffAliases,
  installOmpPlugin,
  loadAliasManifest,
  loadState,
  managementAuthFromState,
  runtimeConfigFromState,
  writeAliasManifest,
} from "./cli-lib.mjs";
import { deriveAliasesRobust, discoverRoutingRules } from "./routing-discovery.mjs";

const VERSION = "0.2.3";
const OLD_CLI = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const REPO_CLI = fileURLToPath(new URL("./repo-cli.mjs", import.meta.url));

function spawnCli(script, args, { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
  return result.status ?? 1;
}

function delegate(args, options) {
  return spawnCli(OLD_CLI, args, options);
}

function delegateRepo(args, options) {
  return spawnCli(REPO_CLI, args, options);
}

function requireManagement() {
  const state = loadState();
  const runtime = runtimeConfigFromState(state);
  const auth = managementAuthFromState(state);
  if (!runtime.url) throw new Error("Bifrost URL is missing; run `pifrost global setup`");
  if (!auth) throw new Error("Bifrost management authentication is missing; run `pifrost global setup`");
  return { state, url: runtime.url, auth };
}

async function routingSnapshot() {
  const { url, auth } = requireManagement();
  const discovered = await discoverRoutingRules(url, auth);
  return {
    ...discovered,
    manifest: deriveAliasesRobust(discovered.rules),
  };
}

function printRoutes(manifest) {
  const entries = Object.entries(manifest.aliases).sort(([a], [b]) => a.localeCompare(b));
  console.log(`\n## Bifrost OMP routes (${entries.length})\n`);
  for (const [id, definition] of entries) {
    console.log(id);
    definition.chain.forEach((member, index) => console.log(`  ${index + 1}. ${member}`));
  }
}

async function routesList() {
  const { manifest } = await routingSnapshot();
  printRoutes(manifest);
}

async function routesDiagnose() {
  const { rules, diagnostics, manifest } = await routingSnapshot();
  console.log("\n## Bifrost routing discovery\n");
  for (const item of diagnostics) {
    if (item.ok) console.log(`${item.path}: OK rules=${item.count} ${item.shape}`);
    else console.log(`${item.path}: FAIL${item.status ? ` HTTP ${item.status}` : ""} ${item.error}`);
  }
  console.log(`\nUnique raw rules: ${rules.length}`);
  console.log(`Derived omp-* aliases: ${Object.keys(manifest.aliases).length}`);

  const unmatched = rules.filter((rule) => {
    const one = deriveAliasesRobust([rule]);
    return Object.keys(one.aliases).length === 0;
  });
  if (unmatched.length) {
    console.log("\nRules not recognized as Pifrost aliases:");
    for (const rule of unmatched.slice(0, 30)) {
      console.log(`  - ${rule?.name ?? rule?.id ?? "<unnamed>"}`);
    }
    if (unmatched.length > 30) console.log(`  ... ${unmatched.length - 30} more`);
  }
}

async function routesDiff() {
  const { manifest: remote } = await routingSnapshot();
  const local = loadAliasManifest();
  const differences = diffAliases(local, remote);
  if (!differences.length) {
    console.log("Routes are in sync.");
    return;
  }
  console.log(`\n## Route differences (${differences.length})\n`);
  for (const item of differences) {
    console.log(item.id);
    console.log(`  local:  ${item.local ? item.local.join(" -> ") : "missing"}`);
    console.log(`  remote: ${item.remote ? item.remote.join(" -> ") : "missing"}`);
  }
  process.exitCode = 2;
}

function refreshModels() {
  if (!commandExists("omp")) throw new Error("`omp` is not installed or not on PATH");
  const result = spawnSync("omp", ["models", "refresh"], {
    stdio: "inherit",
    env: { ...process.env, PIFROST_FORCE_REFRESH: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`omp models refresh failed with exit code ${result.status}`);
}

async function routesSync(args) {
  const { manifest, rules, diagnostics } = await routingSnapshot();
  const count = Object.keys(manifest.aliases).length;
  if (!count) {
    const sourceSummary = diagnostics
      .map((item) => `${item.path}=${item.ok ? item.count : `HTTP-${item.status ?? "error"}`}`)
      .join(", ");
    throw new Error(
      `Bifrost returned ${rules.length} routing rule(s), but none could be derived as omp-* aliases (${sourceSummary}). Run \`pifrost routes diagnose\` for details.`,
    );
  }
  const result = writeAliasManifest(manifest);
  console.log(`Wrote ${count} aliases to ${result.path}`);
  if (result.backup) console.log(`Previous manifest backed up to ${result.backup}`);
  if (!args.includes("--no-refresh")) refreshModels();
}

async function init(args) {
  console.log("\n## Pifrost first-time setup\n");
  if (!commandExists("omp")) throw new Error("OMP is required but `omp` is not on PATH");
  console.log("Installing/updating Pifrost OMP extension...");
  installOmpPlugin();

  const setupStatus = delegate(["global", "setup", ...args], { allowFailure: true });
  if (setupStatus !== 0) process.exit(setupStatus);

  const state = loadState();
  if (managementAuthFromState(state)) {
    console.log("Synchronizing Bifrost omp-* routes...");
    await routesSync(["--no-refresh"]);
  } else {
    console.log("Skipping route sync because management authentication is not configured.");
  }

  console.log("Refreshing Pifrost model catalog...");
  refreshModels();
  delegate(["global", "status"]);
}

async function doctor() {
  const oldStatus = delegate(["doctor"], { allowFailure: true });
  console.log("");
  try {
    await routesDiagnose();
  } catch (error) {
    console.error(`Routing discovery: FAIL (${error instanceof Error ? error.message : String(error)})`);
    process.exitCode = 2;
  }
  if (oldStatus !== 0 && !process.exitCode) process.exitCode = oldStatus;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) return delegate(args);
  if (args[0] === "--version" || args[0] === "version") {
    console.log(VERSION);
    return;
  }
  if (args[0] === "init") return init(args.slice(1));
  if (args[0] === "doctor") return doctor();
  if (args[0] === "repo") return delegateRepo(args.slice(1));

  if (args[0] === "routes") {
    if (args[1] === "list") return routesList();
    if (args[1] === "diff") return routesDiff();
    if (args[1] === "sync") return routesSync(args.slice(2));
    if (args[1] === "diagnose") return routesDiagnose();
  }

  return delegate(args);
}

main().catch((error) => {
  console.error(`pifrost: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
