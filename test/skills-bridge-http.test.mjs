import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchBifrostSkillBundle,
  listBifrostSkills,
} from "../skills-bridge.mjs";

test("Bifrost Skills bridge follows released management and public serving contracts", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });

    if (request.url?.startsWith("/api/skills?")) {
      assert.equal(request.headers.authorization, `Basic ${Buffer.from("admin:secret").toString("base64")}`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        skills: [{
          id: "skill-1",
          name: "release-notes",
          description: "Prepare release notes",
          latest_version: "1.2.3",
          file_count: 1,
        }],
        total: 1,
        limit: 100,
        offset: 0,
      }));
      return;
    }

    if (request.url === "/api/skills/skill-1") {
      assert.equal(request.headers.authorization, `Basic ${Buffer.from("admin:secret").toString("base64")}`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        skill: {
          id: "skill-1",
          name: "release-notes",
          description: "Prepare release notes",
          latest_version: "1.2.3",
          metadata: { owner: "platform" },
          skill_md_body: "# Workflow\nGenerate release notes.",
          files: [{
            path: "templates/note.md",
            source_type: "text",
            mime_type: "text/markdown",
            file_size_bytes: 8,
          }],
        },
      }));
      return;
    }

    if (request.url === "/api/skills/serve/release-notes/files/templates/note.md") {
      assert.equal(request.headers.authorization, undefined);
      response.setHeader("content-type", "text/markdown");
      response.end("template");
      return;
    }

    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;
  const auth = { mode: "basic", username: "admin", password: "secret" };

  try {
    const skills = await listBifrostSkills(url, auth);
    assert.deepEqual(skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      fileCount: skill.fileCount,
    })), [{
      id: "skill-1",
      name: "release-notes",
      version: "1.2.3",
      fileCount: 1,
    }]);

    const bundle = await fetchBifrostSkillBundle(url, auth, skills[0]);
    assert.equal(bundle.skill.name, "release-notes");
    assert.equal(bundle.skill.version, "1.2.3");
    assert.match(bundle.markdown, /^---\nname: "release-notes"/);
    assert.match(bundle.markdown, /# Workflow\nGenerate release notes\.$/);
    assert.deepEqual(bundle.files.map((file) => [file.path, file.data.toString("utf8")]), [
      ["templates/note.md", "template"],
    ]);
    assert.equal(
      bundle.sourceUrl,
      `http://127.0.0.1:${address.port}/api/skills/serve/release-notes/download.zip`,
    );
    assert.equal(requests.every((entry) => entry.method === "GET"), true);
  } finally {
    server.close();
  }
});
