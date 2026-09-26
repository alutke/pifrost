import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BIFROST_SKILL_MARKER,
  bifrostSkillCompatibility,
  composeBifrostSkillMarkdown,
  findOmpSkillCollisions,
  installBifrostSkillBundle,
  normalizeBifrostSkill,
  readBifrostSkillMarker,
  removeManagedBifrostSkill,
  repoBifrostSkillStatus,
  resolveBifrostSkillNames,
  safeSkillFilePath,
} from "../skills-bridge.mjs";

function withTemp(run) {
  const root = mkdtempSync(join(tmpdir(), "pifrost-skill-test-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  try { run({ root, home, repo }); } finally { rmSync(root, { recursive: true, force: true }); }
}
function bundle(version = "1.2.3") {
  const raw = {
    id: "skill-1",
    name: "release-notes",
    description: "Prepare release notes",
    latest_version: version,
    metadata: { owner: "platform" },
    extra_frontmatter: { hide: true, globs: ["CHANGELOG.md", "docs/**"] },
    skill_md_body: "# Workflow\nDo the work.",
    files: [],
  };
  return {
    skill: { ...normalizeBifrostSkill(raw), raw },
    markdown: composeBifrostSkillMarkdown(raw),
    files: [{ path: "templates/note.md", data: Buffer.from("template") }],
    sourceUrl: "http://bifrost/api/skills/serve/release-notes/download.zip",
  };
}

test("Bifrost skill composition remains valid OMP Agent Skills frontmatter", () => {
  const markdown = bundle().markdown;
  assert.match(markdown, /^---\nname: "release-notes"\ndescription: "Prepare release notes"/);
  assert.match(markdown, /globs:\n  - "CHANGELOG.md"\n  - "docs\/\*\*"/);
  assert.match(markdown, /metadata:\n  owner: "platform"/);
  assert.match(markdown, /---\n# Workflow\nDo the work\.$/);
});

test("skills with Bifrost allowed_tools fail closed because OMP does not enforce the policy", () => {
  const raw = { id: "skill-1", name: "restricted", description: "restricted", latest_version: "1.0.0", allowed_tools: "Read,Glob" };
  assert.deepEqual(bifrostSkillCompatibility(raw), {
    compatible: false,
    reason: "Bifrost allowed_tools cannot be enforced by the OMP 18.3 skill loader",
  });
});

test("skill name resolution is case-insensitive but persists canonical Bifrost name", () => {
  const skills = [normalizeBifrostSkill({ id: "a", name: "release-notes", description: "", latest_version: "1.0.0" })].filter(Boolean);
  assert.equal(resolveBifrostSkillNames(skills, ["RELEASE-NOTES"])[0]?.name, "release-notes");
  assert.throws(() => resolveBifrostSkillNames(skills, ["missing"]), /Unknown Bifrost skill/);
});

test("rejects path traversal and absolute skill files", () => {
  assert.equal(safeSkillFilePath("templates/note.md"), "templates/note.md");
  for (const value of ["../secret", "a/../secret", "/etc/passwd", "C:\\temp\\x", "a//b"]) {
    assert.throws(() => safeSkillFilePath(value), /Unsafe Bifrost skill file path/);
  }
});

test("installs atomically into .agents/skills and only removes Pifrost-owned skills", () => {
  withTemp(({ repo, home }) => {
    const installed = installBifrostSkillBundle(repo, bundle("1.2.3"), { home });
    assert.match(installed.path, /\.agents[/\\]skills[/\\]release-notes$/);
    assert.equal(readBifrostSkillMarker(repo, "release-notes")?.version, "1.2.3");
    assert.equal(readFileSync(join(installed.path, "templates/note.md"), "utf8"), "template");

    installBifrostSkillBundle(repo, bundle("1.2.4"), { home });
    assert.equal(readBifrostSkillMarker(repo, "release-notes")?.version, "1.2.4");
    assert.equal(repoBifrostSkillStatus(repo, [{ name: "release-notes", version: "1.2.4" }])[0]?.state, "installed");

    assert.equal(removeManagedBifrostSkill(repo, "release-notes").removed, true);
    assert.equal(removeManagedBifrostSkill(repo, "release-notes").alreadyMissing, true);

    const foreign = join(repo, ".agents/skills/release-notes");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "---\nname: release-notes\n---\nforeign\n");
    assert.throws(() => removeManagedBifrostSkill(repo, "release-notes"), /not owned by Pifrost/);
  });
});

test("detects authored OMP skill collisions outside Pifrost managed directory", () => {
  withTemp(({ repo, home }) => {
    const foreign = join(repo, ".agent/skills/other-directory");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "---\nname: \"release-notes\"\ndescription: foreign\n---\n");
    assert.deepEqual(findOmpSkillCollisions(repo, "release-notes", { home }), [foreign]);
    assert.throws(() => installBifrostSkillBundle(repo, bundle(), { home }), /OMP skill collision/);
  });
});

test("detects skills shipped by installed OMP npm/link plugins", () => {
  withTemp(({ repo, home }) => {
    const pluginSkill = join(home, ".omp/plugins/node_modules/example-plugin/skills/release-notes");
    mkdirSync(pluginSkill, { recursive: true });
    writeFileSync(join(pluginSkill, "SKILL.md"), "---\nname: release-notes\ndescription: plugin\n---\n");
    assert.deepEqual(findOmpSkillCollisions(repo, "release-notes", { home }), [pluginSkill]);
  });
});

test("ownership marker stays separate from SKILL.md", () => {
  withTemp(({ repo, home }) => {
    const installed = installBifrostSkillBundle(repo, bundle(), { home });
    assert.match(readFileSync(join(installed.path, BIFROST_SKILL_MARKER), "utf8"), /"provider": "bifrost"/);
    assert.doesNotMatch(readFileSync(join(installed.path, "SKILL.md"), "utf8"), /pifrost-bifrost-skill/);
  });
});
