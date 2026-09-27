import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const outDir = resolve(root, "dist");
const sources = ["config-store.ts", "routing-core.ts", "cache-schema.ts"];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const source of sources) {
  const inputPath = resolve(root, source);
  const outputPath = resolve(outDir, basename(source, ".ts") + ".js");
  const input = readFileSync(inputPath, "utf8");
  const output = stripTypeScriptTypes(input, {
    mode: "strip",
    sourceUrl: inputPath,
  });
  writeFileSync(outputPath, output, "utf8");
}

