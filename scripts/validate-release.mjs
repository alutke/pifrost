import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
const readme = readFileSync(new URL("README.md", root), "utf8");
const native = readFileSync(new URL("native.ts", root), "utf8");
const transportModel = readFileSync(new URL("transport-model.ts", root), "utf8");

function fail(message) {
  throw new Error(message);
}

function commandError(label, result) {
  return `${label} failed (status=${result.status ?? "unknown"}): ${result.stderr || result.stdout || "no output"}`;
}

if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) fail(`package.json version is not a release semver: ${pkg.version}`);
if (lock?.lockfileVersion !== 3) fail(`package-lock.json must use lockfileVersion 3; got ${lock?.lockfileVersion ?? "missing"}`);
if (lock?.version !== pkg.version || lock?.packages?.[""]?.version !== pkg.version) {
  fail(`package-lock.json version does not match package.json ${pkg.version}`);
}

const requiredDirectRuntimeDependencies = [
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-catalog",
  "@oh-my-pi/pi-natives",
  "@oh-my-pi/pi-utils",
];
for (const dependency of requiredDirectRuntimeDependencies) {
  const declared = pkg.dependencies?.[dependency];
  if (typeof declared !== "string" || !declared.trim()) {
    fail(`package.json must declare ${dependency} as a direct runtime dependency`);
  }
  if (lock?.packages?.[""]?.dependencies?.[dependency] !== declared) {
    fail(`package-lock.json root dependency for ${dependency} must match package.json`);
  }
}
if (!changelog.match(new RegExp(`^## ${pkg.version.replaceAll(".", "\\.")} — \\d{4}-\\d{2}-\\d{2}$`, "mu"))) {
  fail(`CHANGELOG.md has no dated release heading for ${pkg.version}`);
}

const releaseMarker = "Expected for this release:\n\n\`\`\`text\n";
const releaseOffset = readme.indexOf(releaseMarker);
const expectedRelease = releaseOffset >= 0
  ? readme.slice(releaseOffset + releaseMarker.length).split("\n", 1)[0]?.trim()
  : undefined;
if (expectedRelease !== pkg.version) {
  fail(`README expected release is ${expectedRelease ?? "missing"}, package.json is ${pkg.version}`);
}

const catalogFallback = readFileSync(new URL("catalog-fallback.ts", root), "utf8");
if (/@oh-my-pi\/pi-catalog\/build/u.test(native)) {
  fail("runtime package must not import @oh-my-pi/pi-catalog/build; compiled OMP 18.4.x cannot resolve that subpath");
}
for (const [name, source] of [["transport-model.ts", transportModel], ["catalog-fallback.ts", catalogFallback]]) {
  if (/from\s+["']@oh-my-pi\/pi-catalog(?:\/|["'])/u.test(source)) {
    fail(`${name} must not import pi-catalog at runtime; host imports belong in native.ts`);
  }
}
if (!/from\s+["']@oh-my-pi\/pi-catalog["']/u.test(native) ||
    !/@oh-my-pi\/pi-catalog\/compat\/resolve/u.test(native) ||
    !/@oh-my-pi\/pi-catalog\/compat\/behavior/u.test(native)) {
  fail("native.ts must own the supported OMP catalog root, compat/resolve and compat/behavior imports");
}

for (const path of [
  "native.ts",
  "transport-model.ts",
  "multi-protocol-routing.ts",
  "context-estimator.ts",
  "agent-attribution.ts",
  "omp-cfg.ts",
  "pricing-time.ts",
  "routing-core.ts",
  "route-eligibility.ts",
  "protocol-capability.ts",
  "cache-schema.ts",
  "http-client.mjs",
  "mcp-rpc.mjs",
  "hound-diagnostics.mjs",
  "bifrost-rich-content.ts",
  "bifrost-cost-bridge.ts",
  "request-provenance.ts",
  "mcp-client-shape.mjs",
  "route-cli.mjs",
  "doctor-probes.mjs",
  "diagnostic-result.mjs",
  "cli-preconditions.mjs",
  "skills-bridge.mjs",
  "README.md",
  "docs/REFERENCE.md",
  "CHANGELOG.md",
  "tsconfig.runtime.json",
  "scripts/build-runtime.mjs",
  "scripts/smoke-live.mjs",
  "scripts/validate-release.mjs",
]) {
  if (!pkg.files?.includes(path)) fail(`package.json files is missing ${path}`);
}

if (pkg.scripts?.["build:runtime"] !== "node --no-warnings scripts/build-runtime.mjs") {
  fail("build:runtime must use the Node-only runtime builder");
}
for (const lifecycle of ["prepare", "prepack", "preinstall", "install", "postinstall", "build"]) {
  if (pkg.scripts?.[lifecycle]) {
    fail(`Git-install package must not define consumer build lifecycle script: ${lifecycle}`);
  }
}

rmSync(new URL("dist/", root), { recursive: true, force: true });
const cleanRuntimeBuild = spawnSync(process.execPath, ["--no-warnings", "scripts/build-runtime.mjs"], {
  cwd: new URL(".", root),
  encoding: "utf8",
  env: {
    ...process.env,
    // The runtime build must not depend on node_modules/.bin tools such as tsc.
    PATH: process.env.PATH,
  },
});
if (cleanRuntimeBuild.status !== 0) fail(commandError("clean Node-only runtime build", cleanRuntimeBuild));
for (const path of ["dist/config-store.js", "dist/routing-core.js", "dist/route-eligibility.js", "dist/cache-schema.js"]) {
  if (!existsSync(new URL(path, root))) fail(`clean runtime build did not create ${path}`);
}

const distDiff = spawnSync("git", ["diff", "--exit-code", "--", "dist/"], {
  cwd: new URL(".", root),
  encoding: "utf8",
});
if (distDiff.status !== 0) {
  fail(`committed dist/ is stale relative to TypeScript sources:\n${distDiff.stdout || distDiff.stderr}`);
}

const cliEntry = pkg.bin?.pifrost;
if (typeof cliEntry !== "string" || !cliEntry.trim()) fail("package.json bin.pifrost is missing");
const cli = spawnSync(process.execPath, [cliEntry, "--version"], {
  cwd: new URL(".", root),
  encoding: "utf8",
});
if (cli.status !== 0) fail(commandError("repository pifrost --version", cli));
if (cli.stdout.trim() !== pkg.version) {
  fail(`CLI version ${cli.stdout.trim()} does not match package.json ${pkg.version}`);
}

const workspace = mkdtempSync(join(tmpdir(), "pifrost-release-"));
let packedFileCount = 0;
try {
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", workspace], {
    cwd: new URL(".", root),
    encoding: "utf8",
  });
  if (packed.status !== 0) fail(commandError("npm pack", packed));

  let payload;
  try {
    payload = JSON.parse(packed.stdout);
  } catch (error) {
    fail(`npm pack returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\n${packed.stdout}`);
  }

  const artifact = payload?.[0];
  const files = new Set(artifact?.files?.map((entry) => entry.path) ?? []);
  packedFileCount = files.size;

  for (const path of [
    "package.json",
    "native.ts",
    "transport-model.ts",
    "capability-bridge.ts",
    "context-estimator.ts",
    "routing-core.ts",
    "route-eligibility.ts",
    "protocol-capability.ts",
    "cache-schema.ts",
    "dist/config-store.js",
    "dist/routing-core.js",
    "dist/route-eligibility.js",
    "dist/cache-schema.js",
    "http-client.mjs",
    "mcp-rpc.mjs",
    "hound-diagnostics.mjs",
    "bifrost-rich-content.ts",
    "mcp-client-shape.mjs",
    "route-cli.mjs",
    "doctor-probes.mjs",
    "diagnostic-result.mjs",
    "cli-preconditions.mjs",
    "skills-bridge.mjs",
    "pricing-time.ts",
    "README.md",
    "docs/REFERENCE.md",
    "CHANGELOG.md",
    "scripts/build-runtime.mjs",
    "scripts/smoke-live.mjs",
    "scripts/validate-release.mjs",
  ]) {
    if (!files.has(path)) fail(`release tarball is missing ${path}`);
  }

  if (artifact?.version !== pkg.version) {
    fail(`release tarball version ${artifact?.version ?? "missing"} does not match ${pkg.version}`);
  }

  const filename = artifact?.filename;
  if (typeof filename !== "string" || !filename) fail("npm pack did not report a tarball filename");
  const tarball = join(workspace, filename);
  if (!existsSync(tarball)) fail(`npm pack tarball does not exist: ${tarball}`);

  const installRoot = join(workspace, "installed");
  const home = join(workspace, "home");
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(installRoot, "package.json"), '{\n  "private": true\n}\n', "utf8");

  const installed = spawnSync(
    "npm",
    ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: new URL(".", root), encoding: "utf8" },
  );
  if (installed.status !== 0) fail(commandError("tarball npm install", installed));

  const installedPackageRoot = join(installRoot, "node_modules", pkg.name);
  const installedPackage = JSON.parse(readFileSync(join(installedPackageRoot, "package.json"), "utf8"));
  if (installedPackage.version !== pkg.version) {
    fail(`installed package version ${installedPackage.version ?? "missing"} does not match ${pkg.version}`);
  }

  const installedPiUtils = join(installRoot, "node_modules", "@oh-my-pi", "pi-utils", "package.json");
  if (!existsSync(installedPiUtils)) {
    fail("installed package is missing direct runtime dependency @oh-my-pi/pi-utils");
  }
  const installedPiNatives = join(installRoot, "node_modules", "@oh-my-pi", "pi-natives", "package.json");
  if (!existsSync(installedPiNatives)) {
    fail("installed package is missing direct runtime dependency @oh-my-pi/pi-natives");
  }

  const installedEntry = installedPackage.bin?.pifrost;
  if (typeof installedEntry !== "string" || !installedEntry.trim()) {
    fail("installed package bin.pifrost is missing");
  }

  const installedCli = join(installedPackageRoot, installedEntry.replace(/^\.\//u, ""));
  const installedEnv = {
    ...process.env,
    HOME: home,
    PIFROST_CONFIG_DIR: join(home, ".config", "pifrost"),
  };

  const installedVersion = spawnSync(process.execPath, [installedCli, "--version"], {
    cwd: installRoot,
    encoding: "utf8",
    env: installedEnv,
  });
  if (installedVersion.status !== 0) fail(commandError("installed pifrost --version", installedVersion));
  if (installedVersion.stdout.trim() !== pkg.version) {
    fail(`installed CLI version ${installedVersion.stdout.trim()} does not match ${pkg.version}`);
  }

  const installedHelp = spawnSync(process.execPath, [installedCli, "--help"], {
    cwd: installRoot,
    encoding: "utf8",
    env: installedEnv,
  });
  if (installedHelp.status !== 0) fail(commandError("installed pifrost --help", installedHelp));
  if (!installedHelp.stdout.includes(`Pifrost ${pkg.version}`)) {
    fail("installed pifrost --help did not render the expected versioned help banner");
  }

  const githubSha = process.env.GITHUB_SHA?.trim();
  if (githubSha) {
    const gitPrefix = join(workspace, "git-global");
    const gitHome = join(workspace, "git-home");
    mkdirSync(gitPrefix, { recursive: true });
    mkdirSync(gitHome, { recursive: true });

    const gitInstalled = spawnSync(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        gitPrefix,
        "--no-audit",
        "--no-fund",
        `github:alutke/pifrost#${githubSha}`,
      ],
      {
        cwd: installRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: gitHome,
          npm_config_cache: join(workspace, "npm-cache"),
        },
      },
    );
    if (gitInstalled.status !== 0) {
      fail(commandError("GitHub global git-dependency install", gitInstalled));
    }

    const gitPackageRoot = join(gitPrefix, "lib", "node_modules", pkg.name);
    if (!existsSync(join(gitPackageRoot, "package.json"))) {
      fail(`GitHub global install reported success but did not leave ${gitPackageRoot}`);
    }
    const gitPackage = JSON.parse(readFileSync(join(gitPackageRoot, "package.json"), "utf8"));
    if (gitPackage.version !== pkg.version) {
      fail(`GitHub global install version ${gitPackage.version ?? "missing"} does not match ${pkg.version}`);
    }

    const gitBin = join(gitPrefix, "bin", "pifrost");
    if (!existsSync(gitBin)) {
      fail(`GitHub global install did not create executable link ${gitBin}`);
    }
    const gitVersion = spawnSync(gitBin, ["--version"], {
      cwd: installRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: gitHome,
        PATH: `${join(gitPrefix, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    if (gitVersion.status !== 0) {
      fail(commandError("GitHub-global pifrost --version", gitVersion));
    }
    if (gitVersion.stdout.trim() !== pkg.version) {
      fail(`GitHub-global CLI version ${gitVersion.stdout.trim()} does not match ${pkg.version}`);
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log(
  `Release package ${pkg.version}: OK (${packedFileCount} files; packed and GitHub-global install paths validated)`,
);
