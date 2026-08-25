import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  canonicalRepoVirtualKeyName,
  deleteRepoVirtualKeyForReset,
  deleteVirtualKey,
  recoverRepoVirtualKeyByName,
} from "../repo-reset.mjs";

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  try {
    return await fn(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const AUTH = { mode: "basic", username: "admin", password: "secret" };
const REPO = { name: "DockedDeals", id: "dockeddeals-123", root: "/tmp/dockeddeals" };

test("canonicalRepoVirtualKeyName matches Pifrost repo naming", () => {
  assert.equal(canonicalRepoVirtualKeyName(REPO), "omp-dockeddeals-mcp");
  assert.equal(canonicalRepoVirtualKeyName({ name: "My Project!" }), "omp-my-project-mcp");
});

test("deleteVirtualKey uses DELETE and treats success as deleted", async () => {
  let seen;
  await withServer((request, response) => {
    seen = { method: request.method, url: request.url, authorization: request.headers.authorization };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ message: "deleted" }));
  }, async (url) => {
    const result = await deleteVirtualKey(url, AUTH, "vk/with space");
    assert.deepEqual(result, { deleted: true, alreadyMissing: false, id: "vk/with space" });
  });
  assert.equal(seen.method, "DELETE");
  assert.equal(seen.url, "/api/governance/virtual-keys/vk%2Fwith%20space");
  assert.match(seen.authorization, /^Basic /u);
});

test("deleteVirtualKey treats HTTP 404 as already absent", async () => {
  await withServer((_request, response) => {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "Virtual key not found" } }));
  }, async (url) => {
    const result = await deleteVirtualKey(url, AUTH, "missing-vk");
    assert.deepEqual(result, { deleted: false, alreadyMissing: true, id: "missing-vk" });
  });
});

test("reset helper requires confirmation and cancellation performs no DELETE", async () => {
  let deletes = 0;
  let confirmations = 0;
  await withServer((request, response) => {
    if (request.method === "DELETE") deletes += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({}));
  }, async (url) => {
    const result = await deleteRepoVirtualKeyForReset({
      url,
      managementAuth: AUTH,
      repo: REPO,
      repoConfig: { virtualKeyId: "vk-1", virtualKeyName: "omp-dockeddeals-mcp" },
      confirm: async ({ name, id }) => {
        confirmations += 1;
        assert.equal(name, "omp-dockeddeals-mcp");
        assert.equal(id, "vk-1");
        return false;
      },
    });
    assert.equal(result.cancelled, true);
  });
  assert.equal(confirmations, 1);
  assert.equal(deletes, 0);
});

test("reset helper --yes path skips confirmation and deletes stored id", async () => {
  let deletes = 0;
  await withServer((request, response) => {
    if (request.method === "DELETE") deletes += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ message: "deleted" }));
  }, async (url) => {
    const result = await deleteRepoVirtualKeyForReset({
      url,
      managementAuth: AUTH,
      repo: REPO,
      repoConfig: { virtualKeyId: "vk-1", virtualKeyName: "omp-dockeddeals-mcp" },
      yes: true,
      confirm: async () => {
        throw new Error("confirm should not be called with --yes");
      },
    });
    assert.equal(result.cancelled, false);
    assert.equal(result.deleted, true);
    assert.equal(result.alreadyMissing, false);
  });
  assert.equal(deletes, 1);
});

test("reset helper refuses missing local id unless explicit recover-by-name is enabled", async () => {
  const snapshot = { name: "DockedDeals", marker: "preserve-me" };
  await assert.rejects(
    deleteRepoVirtualKeyForReset({
      url: "http://127.0.0.1:1/v1",
      managementAuth: AUTH,
      repo: REPO,
      repoConfig: snapshot,
      yes: true,
    }),
    /no stored Bifrost Virtual Key id/u,
  );
  assert.deepEqual(snapshot, { name: "DockedDeals", marker: "preserve-me" });
});

test("recover-by-name only accepts the exact canonical key and deletes it", async () => {
  const seen = [];
  await withServer((request, response) => {
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
    seen.push(`${request.method} ${parsed.pathname}`);
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && parsed.pathname === "/api/governance/virtual-keys") {
      response.end(JSON.stringify({
        virtual_keys: [
          { id: "vk-exact", name: "omp-dockeddeals-mcp" },
          { id: "vk-near", name: "omp-dockeddeals-mcp-old" },
        ],
      }));
      return;
    }
    if (request.method === "DELETE" && parsed.pathname === "/api/governance/virtual-keys/vk-exact") {
      response.end(JSON.stringify({ message: "deleted" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  }, async (url) => {
    const recovered = await recoverRepoVirtualKeyByName(url, AUTH, REPO);
    assert.deepEqual(recovered, {
      expectedName: "omp-dockeddeals-mcp",
      id: "vk-exact",
      alreadyMissing: false,
    });

    const result = await deleteRepoVirtualKeyForReset({
      url,
      managementAuth: AUTH,
      repo: REPO,
      repoConfig: undefined,
      recoverByName: true,
      yes: true,
    });
    assert.equal(result.deleted, true);
    assert.equal(result.id, "vk-exact");
    assert.equal(result.recoveredByName, true);
  });
  assert.equal(seen.filter((entry) => entry === "DELETE /api/governance/virtual-keys/vk-exact").length, 1);
  assert.equal(seen.some((entry) => entry.includes("vk-near") && entry.startsWith("DELETE")), false);
});

test("recover-by-name treats an already absent canonical key as a successful remote end-state", async () => {
  await withServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ virtual_keys: [] }));
  }, async (url) => {
    const result = await deleteRepoVirtualKeyForReset({
      url,
      managementAuth: AUTH,
      repo: REPO,
      repoConfig: undefined,
      recoverByName: true,
      yes: true,
    });
    assert.equal(result.alreadyMissing, true);
    assert.equal(result.deleted, false);
    assert.equal(result.id, undefined);
  });
});

test("recover-by-name refuses ambiguous exact duplicates", async () => {
  await withServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      virtual_keys: [
        { id: "vk-1", name: "omp-dockeddeals-mcp" },
        { id: "vk-2", name: "omp-dockeddeals-mcp" },
      ],
    }));
  }, async (url) => {
    await assert.rejects(
      recoverRepoVirtualKeyByName(url, AUTH, REPO),
      /refusing ambiguous remote deletion/u,
    );
  });
});

test("server failure propagates so callers can preserve local state", async () => {
  const local = { virtualKeyId: "vk-1", virtualKeyName: "omp-dockeddeals-mcp", marker: "unchanged" };
  await withServer((_request, response) => {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "database unavailable" } }));
  }, async (url) => {
    await assert.rejects(
      deleteRepoVirtualKeyForReset({
        url,
        managementAuth: AUTH,
        repo: REPO,
        repoConfig: local,
        yes: true,
      }),
      /HTTP 500/u,
    );
  });
  assert.equal(local.marker, "unchanged");
  assert.equal(local.virtualKeyId, "vk-1");
});
