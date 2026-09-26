import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("package uses the current OMP 18.3 extension manifest and release line", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.omp?.extensions, ["./native.ts"]);
  assert.equal(pkg.pi, undefined);
  assert.equal(pkg.dependencies["@oh-my-pi/pi-ai"], "18.3.2");
  assert.equal(pkg.dependencies["@oh-my-pi/pi-catalog"], "18.3.2");
  assert.equal(pkg.devDependencies["@oh-my-pi/pi-coding-agent"], "18.3.2");
});
