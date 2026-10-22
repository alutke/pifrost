import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
/** Pure validator so tests can deliberately mutate each required contract. */
export function validateDocumentation(contents) {
  const errors = [];
  const required = [
    "package.json","package-lock.json","README.md","docs/REFERENCE.md",
    "docs/INTEGRATION_SUPPORT.md","docs/OMP_COMPATIBILITY.md",
    "CHANGELOG.md","docs/OUTPUT_BUDGET.md",
    "docs/RELEASE_4_BUDGET_GOVERNANCE.md","docs/RELEASE_5A_CONTRACT_FOUNDATION.md","docs/RELEASE_5B_INFERENCE_HARDENING.md","docs/RELEASE_5C_CONTEXT_DISCOVERY.md","SECURITY.md",
    "CONTRIBUTING.md",".github/CODEOWNERS",
  ];
  for (const file of required) if (typeof contents[file] !== "string") errors.push("Missing documentation contract: " + file);
  if (errors.length) return errors;
  const parse = file => {
    try { return JSON.parse(contents[file]); }
    catch { errors.push("Malformed release metadata: " + file); return {}; }
  };
  const pkg = parse("package.json"), lock = parse("package-lock.json");
  const version = pkg.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) {
    errors.push("Invalid package semver");
    return errors;
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    errors.push("Package lock release version disagrees with package.json");
  }
  for (const file of ["README.md","docs/REFERENCE.md"]) {
    if (!contents[file].includes("Expected for this release:\n\n```text\n" + version + "\n")) {
      errors.push(file + " has stale expected release");
    }
  }
  const heading = {
    "docs/INTEGRATION_SUPPORT.md": "# Pifrost integration support — v" + version,
    "docs/OMP_COMPATIBILITY.md": "# OMP compatibility — Pifrost v" + version,
    "docs/OUTPUT_BUDGET.md": "# Output-budget policy — Release 4 behaviour, current v" + version,
    "docs/RELEASE_4_BUDGET_GOVERNANCE.md": "# Release 4 — target-scoped budgets and living documentation (v0.29.13)",
    "docs/RELEASE_5A_CONTRACT_FOUNDATION.md": "# Release 5A — OMP and Bifrost contract foundation (v0.29.14)",
    "docs/RELEASE_5B_INFERENCE_HARDENING.md": "# Release 5B — inference wire and output-budget hardening (v0.29.15)",
    "docs/RELEASE_5C_CONTEXT_DISCOVERY.md": "# Release 5C — OMP image accounting and Bifrost catalogue completeness (v" + version + ")",
  };
  for (const [file, prefix] of Object.entries(heading)) {
    if (!contents[file].startsWith(prefix + "\n")) errors.push(file + " has stale current-release heading");
  }
  if (!contents["CHANGELOG.md"].startsWith("## " + version + " — ")) errors.push("Current changelog heading disagrees with package.json");
  const deps = ["@oh-my-pi/pi-ai","@oh-my-pi/pi-catalog","@oh-my-pi/pi-natives","@oh-my-pi/pi-utils","@oh-my-pi/pi-coding-agent"];
  const snapshot = pkg.dependencies?.["@oh-my-pi/pi-ai"];
  for (const name of deps) {
    const versionPin = (pkg.dependencies ?? pkg.devDependencies ?? {})[name] ?? pkg.devDependencies?.[name];
    if (!snapshot || versionPin !== snapshot) errors.push("OMP policy snapshot dependency mismatch: " + name);
  }
  const support = contents["docs/INTEGRATION_SUPPORT.md"];
  for (const evidence of ["OMP " + snapshot,"18.10.4","18.12.1","Live physical provider","billable","mock","Bifrost 2.3.2"]) {
    if (!support.includes(evidence)) errors.push("Support matrix omits evidence boundary: " + evidence);
  }
  if (!contents["SECURITY.md"].includes("privately") || !contents["SECURITY.md"].includes("Virtual Key")) {
    errors.push("Security policy lacks private disclosure / secret hygiene");
  }
  if (!contents["CONTRIBUTING.md"].includes("npm run check") ||
      !contents["CONTRIBUTING.md"].includes("Bifrost")) {
    errors.push("Contribution guidance lacks tests and upstream ownership");
  }
  if (!contents[".github/CODEOWNERS"].includes("* @alutke")) {
    errors.push("Missing project maintainer code ownership");
  }
  return errors;
}

export function checkDocumentation(directory = root) {
  const paths = [
    "package.json","package-lock.json","README.md","docs/REFERENCE.md",
    "docs/INTEGRATION_SUPPORT.md","docs/OMP_COMPATIBILITY.md",
    "CHANGELOG.md","docs/OUTPUT_BUDGET.md",
    "docs/RELEASE_4_BUDGET_GOVERNANCE.md","docs/RELEASE_5A_CONTRACT_FOUNDATION.md","docs/RELEASE_5B_INFERENCE_HARDENING.md","docs/RELEASE_5C_CONTEXT_DISCOVERY.md","SECURITY.md",
    "CONTRIBUTING.md",".github/CODEOWNERS",
  ];
  const files = Object.fromEntries(paths.map(path => [
    path, existsSync(resolve(directory,path)) ? readFileSync(resolve(directory,path),"utf8") : undefined,
  ]));
  return validateDocumentation(files);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const errors=checkDocumentation();
  if (errors.length) {
    for (const error of errors) console.error("documentation: " + error);
    process.exitCode=1;
  } else console.log("Release documentation and owner policies: OK");
}
