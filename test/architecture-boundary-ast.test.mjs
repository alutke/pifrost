import assert from "node:assert/strict";
import test from "node:test";
import { importedSpecifiers, checkImportBoundaries } from "../scripts/architecture-boundary-ast.mjs";

test("R3-04 AST import scanner detects multi-line, type-only, export, dynamic and literal require",()=>{
  const source = [
    '/* import "./fake-control.mjs" */',
    'import type { Dangerous } from',
    '  "./cli-lib.mjs";',
    'export { handler } from "./route-cli.mjs";',
    'const x = await import("./mcp-rpc.mjs");',
    'const y = require("./judge-control.mjs");',
    'type T = import("@oh-my-pi/pi-natives").Encoding;',
    'const literal = "import { foo } from \\"./not-import.mjs\\"";',
  ].join("\n");
  assert.deepEqual(importedSpecifiers(source,"native.ts"),[
    "./cli-lib.mjs","./route-cli.mjs","./mcp-rpc.mjs","./judge-control.mjs","@oh-my-pi/pi-natives",
  ]);
  const issues=checkImportBoundaries({ "native.ts":source },new Set([
    "cli-lib.mjs","route-cli.mjs","mcp-rpc.mjs","judge-control.mjs",
  ]));
  assert.equal(issues.length,4);
  assert.ok(!issues.join(" ").includes("fake-control"));
});
test("R3-05 import boundary catches unapproved runtime model catalogue import but permits native.ts",()=>{
  const source='import type { A } from "@oh-my-pi/pi-catalog/compat/resolve";';
  assert.equal(checkImportBoundaries({"runtime-route-state.ts":source},new Set()).length,1);
  assert.deepEqual(checkImportBoundaries({"native.ts":source},new Set()),[]);
});
test("R3-06 import boundary ignores comment-based spoofed checks",()=>{
  const spoofed='// from "./cli-lib.mjs"\nconst doc = \'import "./cli-lib.mjs"\';';
  assert.deepEqual(checkImportBoundaries({"native.ts":spoofed},new Set(["cli-lib.mjs"])),[]);
  assert.equal(checkImportBoundaries({"native.ts":spoofed+'\nimport "./cli-lib.mjs";'},new Set(["cli-lib.mjs"])).length,1);
});
