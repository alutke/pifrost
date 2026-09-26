import assert from "node:assert/strict";
import test from "node:test";

import {
	agentAttributionSnapshot,
	bindAgentSession,
	formatAgentAttributionReport,
	recordAgentRequest,
	releaseAgentSession,
	resetAgentAttributionForTests,
} from "../agent-attribution.ts";

test.beforeEach(() => resetAgentAttributionForTests());

test("attributes logical Pifrost routes to OMP agent identity", () => {
	bindAgentSession("main-session", {
		kind: "main",
		id: "Main",
		name: "main",
		depth: 0,
	});
	recordAgentRequest("main-session", "omp-default");
	recordAgentRequest("main-session", "omp-default");
	recordAgentRequest("main-session", "omp-plan");

	const snapshot = agentAttributionSnapshot("main-session");
	assert.equal(snapshot.current?.agent?.id, "Main");
	assert.equal(snapshot.current?.requests, 3);
	assert.deepEqual(snapshot.current?.routes, [
		{ route: "omp-default", requests: 2 },
		{ route: "omp-plan", requests: 1 },
	]);
	assert.deepEqual(snapshot.agents[0], {
		kind: "main",
		name: "main",
		requests: 3,
		routes: [
			{ route: "omp-default", requests: 2 },
			{ route: "omp-plan", requests: 1 },
		],
	});
});

test("backfills requests that race ahead of session_start identity", () => {
	recordAgentRequest("task-session", "omp-task");
	recordAgentRequest("task-session", "omp-task");
	assert.equal(agentAttributionSnapshot().unattributedRequests, 2);

	bindAgentSession("task-session", {
		kind: "sub",
		id: "0-Task",
		name: "task",
		depth: 1,
		parentId: "Main",
	});

	const snapshot = agentAttributionSnapshot("task-session");
	assert.equal(snapshot.unattributedRequests, 0);
	assert.equal(snapshot.current?.agent?.parentId, "Main");
	assert.equal(snapshot.agents.find((item) => item.name === "task")?.requests, 2);
});

test("keeps concurrent subagent accounting isolated and removes session identity on shutdown", () => {
	bindAgentSession("a", { kind: "sub", id: "0-Explore", name: "explore", depth: 1, parentId: "Main" });
	bindAgentSession("b", { kind: "sub", id: "1-Task", name: "task", depth: 1, parentId: "Main" });

	recordAgentRequest("a", "omp-smol");
	recordAgentRequest("a", "omp-smol");
	recordAgentRequest("b", "omp-task");

	let snapshot = agentAttributionSnapshot();
	assert.equal(snapshot.activeSessions, 2);
	assert.equal(snapshot.agents.find((item) => item.name === "explore")?.requests, 2);
	assert.equal(snapshot.agents.find((item) => item.name === "task")?.requests, 1);

	releaseAgentSession("a");
	snapshot = agentAttributionSnapshot("a");
	assert.equal(snapshot.current, undefined);
	assert.equal(snapshot.activeSessions, 1);
	assert.equal(snapshot.agents.find((item) => item.name === "explore")?.requests, 2);
});

test("formats current agent lineage and per-agent route usage", () => {
	bindAgentSession("advisor-session", {
		kind: "sub",
		id: "2-Advisor",
		name: "advisor",
		depth: 1,
		parentId: "Main",
	});
	recordAgentRequest("advisor-session", "omp-advisor");

	const report = formatAgentAttributionReport("advisor-session");
	assert.match(report, /advisor \[sub\] id=2-Advisor depth=1 parent=Main/);
	assert.match(report, /advisor \[sub\] -> omp-advisor: 1 request\(s\)/);
});
