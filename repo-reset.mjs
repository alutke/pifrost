import {
  PifrostHttpError,
  bifrostManagementBase,
  listVirtualKeys,
  managementHeaders,
  requestJson,
} from "./cli-lib.mjs";

export function canonicalRepoVirtualKeyName(repo) {
  const safe = String(repo?.name ?? "repo")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "repo";
  return `omp-${safe}-mcp`;
}

/**
 * Delete one exact Bifrost Virtual Key by id.
 * A 404 is treated as an idempotent success because the desired end-state
 * (the remote key being absent) has already been reached.
 */
export async function deleteVirtualKey(url, managementAuth, id) {
  if (!id || typeof id !== "string") throw new Error("Bifrost Virtual Key id is required");
  const base = bifrostManagementBase(url);
  try {
    await requestJson(`${base}/api/governance/virtual-keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: managementHeaders(managementAuth),
    });
    return { deleted: true, alreadyMissing: false, id };
  } catch (error) {
    if (error instanceof PifrostHttpError && error.status === 404) {
      return { deleted: false, alreadyMissing: true, id };
    }
    throw error;
  }
}

/**
 * Explicit recovery path for a repo whose local Pifrost association was
 * removed before its remote VK. This never uses fuzzy matching: only the exact
 * canonical Pifrost name is eligible, and ambiguous duplicates are rejected.
 */
export async function recoverRepoVirtualKeyByName(url, managementAuth, repo) {
  const expectedName = canonicalRepoVirtualKeyName(repo);
  const matches = (await listVirtualKeys(url, managementAuth, expectedName)).filter(
    (candidate) => candidate?.name === expectedName,
  );

  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} Bifrost Virtual Keys named ${expectedName}; refusing ambiguous remote deletion. Delete/rename duplicates in Bifrost first.`,
    );
  }
  if (matches.length === 0) {
    return { expectedName, id: undefined, alreadyMissing: true };
  }

  const id = matches[0]?.id;
  if (!id || typeof id !== "string") {
    throw new Error(`Bifrost returned ${expectedName} without a Virtual Key id; refusing deletion`);
  }
  return { expectedName, id, alreadyMissing: false };
}

/**
 * Resolve, confirm and delete the repo VK for a full reset. This helper does
 * not touch local state; callers should remove local config only after it
 * returns a non-cancelled result. That ordering prevents a failed management
 * request from orphaning a remote key again.
 */
export async function deleteRepoVirtualKeyForReset({
  url,
  managementAuth,
  repo,
  repoConfig,
  recoverByName = false,
  yes = false,
  confirm,
}) {
  let virtualKeyId = repoConfig?.virtualKeyId;
  let virtualKeyName = repoConfig?.virtualKeyName ?? canonicalRepoVirtualKeyName(repo);

  if (!virtualKeyId) {
    if (!recoverByName) {
      throw new Error(
        "Current repo has no stored Bifrost Virtual Key id. Local state was not changed. If local state was previously removed, re-run with `--delete-remote --recover-by-name` to look up only the exact canonical Pifrost VK name.",
      );
    }
    const recovered = await recoverRepoVirtualKeyByName(url, managementAuth, repo);
    virtualKeyName = recovered.expectedName;
    virtualKeyId = recovered.id;
    if (recovered.alreadyMissing) {
      return {
        cancelled: false,
        name: virtualKeyName,
        id: undefined,
        deleted: false,
        alreadyMissing: true,
        recoveredByName: true,
      };
    }
  }

  if (!yes) {
    if (typeof confirm !== "function") {
      throw new Error("Remote Virtual Key deletion requires confirmation or explicit `--yes`");
    }
    const approved = await confirm({ name: virtualKeyName, id: virtualKeyId });
    if (!approved) {
      return {
        cancelled: true,
        name: virtualKeyName,
        id: virtualKeyId,
        deleted: false,
        alreadyMissing: false,
        recoveredByName: recoverByName && !repoConfig?.virtualKeyId,
      };
    }
  }

  const result = await deleteVirtualKey(url, managementAuth, virtualKeyId);
  return {
    cancelled: false,
    name: virtualKeyName,
    id: virtualKeyId,
    deleted: result.deleted,
    alreadyMissing: result.alreadyMissing,
    recoveredByName: recoverByName && !repoConfig?.virtualKeyId,
  };
}
