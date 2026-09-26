import assert from "node:assert/strict";
import test from "node:test";

import {
	assertPifrostCfgSession,
	formatPifrostOmpProfile,
	normalizePifrostOmpSetting,
	parsePifrostOmpSettingContent,
	PIFROST_OMP_SETTINGS,
	writePifrostOmpSetting,
	type PifrostCfgSession,
} from "../omp-cfg.ts";

function fakeSession(overrides: Partial<PifrostCfgSession> = {}): PifrostCfgSession {
	const cwd = process.cwd();
	return {
		settings: { getCwd: () => cwd } as PifrostCfgSession["settings"],
		cwd,
		sessionId: "session-test",
		hasUI: true,
		settingsApproval: true,
		taskDepth: 0,
		agentKind: "main",
		...overrides,
	};
}

test("Pifrost cfg allow-list maps dotted and slash setting ids only", () => {
	assert.equal(normalizePifrostOmpSetting("retry.modelFallback")?.url, "cfg://retry/modelFallback");
	assert.equal(normalizePifrostOmpSetting("retry/modelFallback")?.id, "retry.modelFallback");
	assert.equal(normalizePifrostOmpSetting("TASK/ENABLELSP")?.id, "task.enableLsp");
	assert.equal(normalizePifrostOmpSetting("advisor.enabled"), undefined);
	assert.equal(PIFROST_OMP_SETTINGS.length, 6);
});

test("parses cfg:// leaf content and evaluates Pifrost compatibility without requiring OMP runtime imports", () => {
	const retry = normalizePifrostOmpSetting("retry.modelFallback");
	assert.ok(retry);
	const retryStatus = parsePifrostOmpSettingContent(
		retry,
		[
			"retry.modelFallback: false",
			"type: boolean",
			"default: true",
			"source: project config",
		].join("\n"),
	);
	assert.equal(retryStatus.value, false);
	assert.equal(retryStatus.source, "project config");
	assert.equal(retryStatus.matches, true);

	const enabled = normalizePifrostOmpSetting("enabledModels");
	assert.ok(enabled);
	const enabledStatus = parsePifrostOmpSettingContent(
		enabled,
		[
			'enabledModels: ["other/*","bifrost/*"]',
			"type: array",
			"default: []",
			"source: session override",
		].join("\n"),
	);
	assert.equal(enabledStatus.matches, true);
	assert.match(formatPifrostOmpProfile([retryStatus, enabledStatus]), /source: project config/);
});

test("modelRoles compatibility permits unrelated roles but requires every Pifrost-owned role", () => {
	const roles = normalizePifrostOmpSetting("modelRoles");
	assert.ok(roles);
	const desired = roles.value as Record<string, string>;
	const compatible = parsePifrostOmpSettingContent(
		roles,
		`modelRoles: ${JSON.stringify({ ...desired, extra: "other/model" })}\ntype: object\ndefault: {}\nsource: global config`,
	);
	assert.equal(compatible.matches, true);

	const missing = { ...desired };
	delete missing.advisor;
	const incompatible = parsePifrostOmpSettingContent(
		roles,
		`modelRoles: ${JSON.stringify(missing)}\ntype: object\ndefault: {}\nsource: global config`,
	);
	assert.equal(incompatible.matches, false);
});

test("cfg bridge rejects unsafe write contexts before lazily importing OMP runtime modules", async () => {
	const setting = normalizePifrostOmpSetting("task.enableLsp");
	assert.ok(setting);

	assert.throws(
		() => assertPifrostCfgSession(fakeSession({ taskDepth: 1 }), true),
		/top-level OMP session/,
	);
	assert.throws(
		() => assertPifrostCfgSession(fakeSession({ agentKind: "sub", taskDepth: 0 }), true),
		/top-level OMP session/,
	);
	await assert.rejects(
		writePifrostOmpSetting(fakeSession({ settingsApproval: false }), setting, "true"),
		/interactive top-level OMP UI/,
	);
	await assert.rejects(
		writePifrostOmpSetting(
			fakeSession({
				cwd: "/definitely/not/the/settings/cwd",
			}),
			setting,
			"true",
		),
		/settings scope mismatch/,
	);
});
