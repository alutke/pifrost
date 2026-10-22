import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const cli = readFileSync(new URL("cli-lib.mjs", root), "utf8");
const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");

test("OMP release 5A dependency and policy snapshots are aligned", () => {
  const version = "18.12.5";
  assert.deepEqual(pkg.omp?.extensions, ["./native.ts"]);
  assert.equal(pkg.pi, undefined);
  for (const name of ["pi-ai", "pi-catalog", "pi-natives", "pi-utils"]) {
    const dependency = "@oh-my-pi/" + name;
    assert.equal(pkg.dependencies[dependency], version);
    assert.equal(lock.packages[""].dependencies[dependency], version);
    assert.equal(lock.packages["node_modules/" + dependency].version, version);
  }
  assert.equal(pkg.devDependencies["@oh-my-pi/pi-coding-agent"], version);
  assert.equal(lock.packages[""].devDependencies["@oh-my-pi/pi-coding-agent"], version);
  assert.equal(lock.packages["node_modules/@oh-my-pi/pi-coding-agent"].version, version);
  assert.match(cli, new RegExp(`PIFROST_OMP_POLICY_SNAPSHOT_VERSION\\s*=\\s*"${version.replaceAll(".", "\\.")}"`, "u"));
});

test("CI validates both supported legacy and current released OMP binaries", () => {
  assert.match(ci, /omp-18\.10\.4/);
  assert.match(ci, /omp-18\.12\.1/);
  assert.match(ci, /omp-18\.12\.5/);
  assert.match(ci, /fdbc8136084c9a10439569157b2af62312e2b0d801cab54c73e89476da798e7e/u);
  assert.match(ci, /sha256sum -c -/);
  assert.match(ci, /Validate minimum and current OMP contracts/);
});

test("Pifrost keeps Bifrost as the fallback authority during the host upgrade", () => {
  const cfg = readFileSync(new URL("omp-cfg.ts", root), "utf8");
  const native = readFileSync(new URL("native.ts", root), "utf8");
  assert.match(cfg, /definition\("retry\.modelFallback", false/);
  assert.match(native, /refreshProvider\(PROVIDER_ID, "online"\)/);
  assert.match(native, /canUseNativeBifrostRoute\(profile, plan\)/);
  assert.match(native, /isCommittedModelOutput\(event\)/);
});
