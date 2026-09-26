import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
const readme = readFileSync(new URL("README.md", root), "utf8");

function fail(message) {
  throw new Error(message);
}

if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) fail(`package.json version is not a release semver: ${pkg.version}`);
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

for (const path of [
  "native.ts",
  "agent-attribution.ts",
  "omp-cfg.ts",
  "pricing-time.ts",
  "routing-core.ts",
  "http-client.mjs",
  "doctor-probes.mjs",
  "skills-bridge.mjs",
  "README.md",
  "docs/REFERENCE.md",
  "CHANGELOG.md",
  "scripts/smoke-live.mjs",
  "scripts/validate-release.mjs",
]) {
  if (!pkg.files?.includes(path)) fail(`package.json files is missing ${path}`);
}

const cli = spawnSync(process.execPath, ["cli-entry.mjs", "--version"], {
  cwd: new URL(".", root),
  encoding: "utf8",
});
if (cli.status !== 0) fail(`pifrost --version failed: ${cli.stderr || cli.stdout}`);
if (cli.stdout.trim() !== pkg.version) {
  fail(`CLI version ${cli.stdout.trim()} does not match package.json ${pkg.version}`);
}

const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: new URL(".", root),
  encoding: "utf8",
});
if (packed.status !== 0) fail(`npm pack --dry-run failed: ${packed.stderr || packed.stdout}`);
const payload = JSON.parse(packed.stdout);
const files = new Set(payload?.[0]?.files?.map((entry) => entry.path) ?? []);
for (const path of ["package.json", "native.ts", "routing-core.ts", "http-client.mjs", "doctor-probes.mjs", "skills-bridge.mjs", "pricing-time.ts", "README.md", "docs/REFERENCE.md", "CHANGELOG.md", "scripts/smoke-live.mjs", "scripts/validate-release.mjs"]) {
  if (!files.has(path)) fail(`release tarball is missing ${path}`);
}
if (payload?.[0]?.version !== pkg.version) {
  fail(`release tarball version ${payload?.[0]?.version ?? "missing"} does not match ${pkg.version}`);
}

console.log(`Release package ${pkg.version}: OK (${files.size} files in npm dry-run tarball)`);
