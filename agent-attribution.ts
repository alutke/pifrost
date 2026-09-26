export interface PifrostAgentIdentity {
	kind: "main" | "sub";
	id: string;
	name: string;
	depth: number;
	parentId?: string;
}

export interface PifrostAgentRouteUsage {
	route: string;
	requests: number;
}

export interface PifrostAgentUsage {
	kind: "main" | "sub";
	name: string;
	requests: number;
	routes: PifrostAgentRouteUsage[];
}

export interface PifrostAgentSessionSnapshot {
	sessionId: string;
	agent?: PifrostAgentIdentity;
	requests: number;
	routes: PifrostAgentRouteUsage[];
}

export interface PifrostAgentAttributionSnapshot {
	current?: PifrostAgentSessionSnapshot;
	activeSessions: number;
	unattributedRequests: number;
	collapsedAgentIdentities: number;
	agents: PifrostAgentUsage[];
}

interface SessionRecord {
	sessionId: string;
	agent?: PifrostAgentIdentity;
	requests: number;
	routes: Map<string, number>;
	pendingRoutes: Map<string, number>;
	updatedAt: number;
}

interface AggregateRecord {
	kind: "main" | "sub";
	name: string;
	requests: number;
	routes: Map<string, number>;
}

const MAX_ACTIVE_SESSIONS = 256;
const MAX_ROUTES_PER_AGENT = 64;
const MAX_AGENT_AGGREGATES = 128;

const sessions = new Map<string, SessionRecord>();
const aggregates = new Map<string, AggregateRecord>();
let collapsedAgentIdentities = 0;

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizedSessionId(sessionId: string): string {
	const value = nonEmpty(sessionId);
	if (!value) throw new Error("Pifrost agent attribution requires a non-empty session id");
	return value;
}

function normalizedRoute(route: string): string {
	return nonEmpty(route) ?? "<unknown>";
}

function normalizeIdentity(agent: PifrostAgentIdentity): PifrostAgentIdentity {
	const kind = agent.kind === "sub" ? "sub" : "main";
	const id = nonEmpty(agent.id) ?? (kind === "main" ? "Main" : "Sub");
	const name = (nonEmpty(agent.name) ?? kind).toLowerCase();
	const depth = Number.isSafeInteger(agent.depth) && agent.depth >= 0 ? agent.depth : 0;
	const parentId = nonEmpty(agent.parentId);
	return { kind, id, name, depth, ...(parentId ? { parentId } : {}) };
}

function touch(record: SessionRecord): void {
	sessions.delete(record.sessionId);
	sessions.set(record.sessionId, record);
	while (sessions.size > MAX_ACTIVE_SESSIONS) {
		const oldest = sessions.keys().next().value as string | undefined;
		if (!oldest) break;
		sessions.delete(oldest);
	}
}

function sessionRecord(sessionId: string, now: number): SessionRecord {
	const id = normalizedSessionId(sessionId);
	const existing = sessions.get(id);
	if (existing) {
		existing.updatedAt = now;
		touch(existing);
		return existing;
	}
	const created: SessionRecord = {
		sessionId: id,
		requests: 0,
		routes: new Map(),
		pendingRoutes: new Map(),
		updatedAt: now,
	};
	touch(created);
	return created;
}

function aggregateKey(agent: PifrostAgentIdentity): string {
	const wanted = `${agent.kind}:${agent.name}`;
	if (aggregates.has(wanted) || aggregates.size < MAX_AGENT_AGGREGATES) return wanted;
	collapsedAgentIdentities += 1;
	return `${agent.kind}:<other>`;
}

function incrementBounded(map: Map<string, number>, key: string, amount = 1): void {
	if (!map.has(key) && map.size >= MAX_ROUTES_PER_AGENT) {
		map.set("<other>", (map.get("<other>") ?? 0) + amount);
		return;
	}
	map.set(key, (map.get(key) ?? 0) + amount);
}

function addAggregate(agent: PifrostAgentIdentity, route: string, amount: number): void {
	if (amount <= 0) return;
	const key = aggregateKey(agent);
	let aggregate = aggregates.get(key);
	if (!aggregate) {
		aggregate = { kind: agent.kind, name: agent.name, requests: 0, routes: new Map() };
		aggregates.set(key, aggregate);
	}
	aggregate.requests += amount;
	incrementBounded(aggregate.routes, route, amount);
}

function routeUsage(routes: Map<string, number>): PifrostAgentRouteUsage[] {
	return [...routes.entries()]
		.map(([route, requests]) => ({ route, requests }))
		.sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
}

export function bindAgentSession(
	sessionId: string,
	agent: PifrostAgentIdentity,
	now = Date.now(),
): PifrostAgentIdentity {
	const record = sessionRecord(sessionId, now);
	const normalized = normalizeIdentity(agent);
	record.agent = normalized;
	for (const [route, requests] of record.pendingRoutes) addAggregate(normalized, route, requests);
	record.pendingRoutes.clear();
	return normalized;
}

export function recordAgentRequest(sessionId: string, route: string, now = Date.now()): void {
	const record = sessionRecord(sessionId, now);
	const normalized = normalizedRoute(route);
	record.requests += 1;
	incrementBounded(record.routes, normalized);
	if (record.agent) addAggregate(record.agent, normalized, 1);
	else incrementBounded(record.pendingRoutes, normalized);
}

export function releaseAgentSession(sessionId: string): void {
	const id = nonEmpty(sessionId);
	if (id) sessions.delete(id);
}

export function agentAttributionSnapshot(currentSessionId?: string): PifrostAgentAttributionSnapshot {
	const currentId = nonEmpty(currentSessionId);
	const currentRecord = currentId ? sessions.get(currentId) : undefined;
	const agents = [...aggregates.values()]
		.map((aggregate) => ({
			kind: aggregate.kind,
			name: aggregate.name,
			requests: aggregate.requests,
			routes: routeUsage(aggregate.routes),
		}))
		.sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));

	let unattributedRequests = 0;
	for (const record of sessions.values()) {
		for (const requests of record.pendingRoutes.values()) unattributedRequests += requests;
	}

	return {
		...(currentRecord
			? {
					current: {
						sessionId: currentRecord.sessionId,
						...(currentRecord.agent ? { agent: { ...currentRecord.agent } } : {}),
						requests: currentRecord.requests,
						routes: routeUsage(currentRecord.routes),
					},
				}
			: {}),
		activeSessions: sessions.size,
		unattributedRequests,
		collapsedAgentIdentities,
		agents,
	};
}

export function formatAgentAttributionReport(currentSessionId?: string): string {
	const snapshot = agentAttributionSnapshot(currentSessionId);
	const lines = ["OMP agent attribution:"];
	if (snapshot.current?.agent) {
		const agent = snapshot.current.agent;
		lines.push(
			`  current: ${agent.name} [${agent.kind}] id=${agent.id} depth=${agent.depth}${agent.parentId ? ` parent=${agent.parentId}` : ""}`,
		);
		if (snapshot.current.routes.length > 0) {
			lines.push(
				`  current routes: ${snapshot.current.routes.map((item) => `${item.route}=${item.requests}`).join(", ")}`,
			);
		}
	} else {
		lines.push("  current: identity not bound yet");
	}
	lines.push(`  active sessions: ${snapshot.activeSessions}`);
	if (snapshot.unattributedRequests > 0) lines.push(`  unattributed requests awaiting ctx.agent: ${snapshot.unattributedRequests}`);
	if (snapshot.collapsedAgentIdentities > 0) {
		lines.push(`  collapsed agent identities: ${snapshot.collapsedAgentIdentities} (bounded aggregate cardinality)`);
	}
	if (snapshot.agents.length === 0) {
		lines.push("  process usage: no attributed Pifrost requests yet");
	} else {
		lines.push("  process usage:");
		for (const agent of snapshot.agents) {
			if (agent.routes.length === 0) {
				lines.push(`    ${agent.name} [${agent.kind}]: ${agent.requests} request(s)`);
				continue;
			}
			for (const route of agent.routes) {
				lines.push(`    ${agent.name} [${agent.kind}] -> ${route.route}: ${route.requests} request(s)`);
			}
		}
	}
	return lines.join("\n");
}

export function resetAgentAttributionForTests(): void {
	sessions.clear();
	aggregates.clear();
	collapsedAgentIdentities = 0;
}
