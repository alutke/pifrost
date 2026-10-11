import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePifrostOmpJson, reconcilePifrostOmpSetting } from "../omp-profile-merge.mjs";

test("Pifrost profile preserves custom judge, web, memory and unknown model roles", () => {
  const original = { default: "old/default", judge: "custom/judge", web: "other/search", memory: "other/memory", "future-role": "x/y" };
  const next = reconcilePifrostOmpSetting("modelRoles", original, { default: "bifrost/omp-default", plan: "bifrost/omp-plan" });
  assert.deepEqual(next, { ...original, default: "bifrost/omp-default", plan: "bifrost/omp-plan" });
  assert.deepEqual(original, { default: "old/default", judge: "custom/judge", web: "other/search", memory: "other/memory", "future-role": "x/y" });
  assert.strictEqual(JSON.stringify(next), reconcilePifrostOmpJson("modelRoles", original, '{"default":"bifrost/omp-default","plan":"bifrost/omp-plan"}'));
});

test("Bifrost stays first without removing other OMP providers; enabled namespaces remain enabled", () => {
  const order = ["openrouter", "deepseek", "bifrost", "anthropic"];
  assert.deepEqual(reconcilePifrostOmpSetting("modelProviderOrder", order, ["bifrost"]), ["bifrost", "openrouter", "deepseek", "anthropic"]);
  assert.deepEqual(order, ["openrouter", "deepseek", "bifrost", "anthropic"]);
  assert.deepEqual(reconcilePifrostOmpSetting("enabledModels", ["openai/*", "bifrost/*", "gemini/*"], ["bifrost/*"]), ["openai/*", "bifrost/*", "gemini/*"]);
  assert.deepEqual(reconcilePifrostOmpSetting("enabledModels", [], ["bifrost/*"]), ["bifrost/*"]);
});

test("malformed or unreadable model-role data fails closed instead of erasing user entries", () => {
  for (const existing of [undefined, null, [], true, "not a record", { judge: 1 }]) {
    assert.throws(() => reconcilePifrostOmpSetting("modelRoles", existing, { default: "bifrost/omp-default" }), /Cannot safely merge/);
  }
  assert.throws(() => reconcilePifrostOmpJson("modelRoles", { judge: "x" }, "not JSON"), /not valid JSON/);
  assert.throws(() => reconcilePifrostOmpJson("modelRoles", { judge: "x" }, "[]"), /not a record/);
  assert.throws(() => reconcilePifrostOmpSetting("enabledModels", undefined, ["bifrost/*"]), /not a string array/);
  assert.throws(() => reconcilePifrostOmpSetting("modelProviderOrder", ["openai", 1], ["bifrost"]), /not a string array/);
});

test("non-collection Pifrost settings remain single-value writes", () => {
  assert.equal(reconcilePifrostOmpSetting("retry.modelFallback", true, false), false);
});


test("Release C judge activation keeps existing OMP namespaces and all other roles", () => {
  const roles = { default: "bifrost/omp-default", advisor: "bifrost/omp-advisor", judge: "other/judge", web: "other/search" };
  const enabledModels = ["bifrost/*", "openrouter/*"];
  const nextEnabled = reconcilePifrostOmpSetting("enabledModels", enabledModels, ["bifrost-judge/*"]);
  const nextRoles = reconcilePifrostOmpSetting("modelRoles", roles, { judge: "bifrost-judge/jev-latest" });
  assert.deepEqual(nextEnabled, ["bifrost/*", "openrouter/*", "bifrost-judge/*"]);
  assert.deepEqual(nextRoles, { ...roles, judge: "bifrost-judge/jev-latest" });
  assert.deepEqual(roles, { default: "bifrost/omp-default", advisor: "bifrost/omp-advisor", judge: "other/judge", web: "other/search" });
  assert.deepEqual(enabledModels, ["bifrost/*", "openrouter/*"]);
  assert.throws(() => reconcilePifrostOmpSetting("enabledModels", undefined, ["bifrost-judge/*"]), /Cannot safely merge/);
});
