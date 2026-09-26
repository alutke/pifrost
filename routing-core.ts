type AnyRecord = Record<string, any>;

export interface RoutingPin {
	source: "target" | "fallback";
	reference?: string;
	keyId?: string;
	providerKeyName?: string;
}

export interface RoutingFeatureSummary {
	enabledRules: number;
	scopes: string[];
	chainRules: number;
	weightedRules: number;
	complexityRules: number;
	pinnedRules: number;
	multiScopeAliases: number;
}

export interface DerivedAlias {
	name: string;
	chain: string[];
	routingPins?: RoutingPin[];
	dynamicRouting?: {
		mode: "context-aware";
		source: "bifrost-simple-rule";
	};
}

export interface DerivedAliasManifest {
	includePhysicalModels: false;
	aliases: Record<string, DerivedAlias>;
}

function nonEmpty(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function unique<T>(values: Array<T | undefined>): T[] {
	return [...new Set(values.filter((value): value is T => value !== undefined))];
}

function aliasFromText(value: unknown): string | undefined {
	const text = nonEmpty(value);
	if (!text) return undefined;
	const exact = text.match(/^(omp-[A-Za-z0-9._-]+)$/u);
	if (exact) return exact[1];
	return text.match(/(?:^|["'\s/:=,(])(omp-[A-Za-z0-9._-]+)(?=$|["'\s),])/u)?.[1];
}

function aliasFromStructuredQuery(value: unknown, depth = 0): string | undefined {
	if (depth > 20 || value == null) return undefined;
	if (typeof value === "string") return aliasFromText(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = aliasFromStructuredQuery(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value === "object") {
		const record = value as AnyRecord;
		const direct = aliasFromStructuredQuery(record.value, depth + 1);
		if (direct) return direct;
		for (const [key, item] of Object.entries(record)) {
			if (key === "value") continue;
			const found = aliasFromStructuredQuery(item, depth + 1);
			if (found) return found;
		}
	}
	return undefined;
}

export function aliasIdFromRule(rule: AnyRecord | undefined): string | undefined {
	if (!rule) return undefined;
	for (const candidate of [rule.name, rule.alias, rule.logical_model, rule.logicalModel]) {
		const found = aliasFromText(candidate);
		if (found) return found;
	}
	const expression = aliasFromText(rule.cel_expression) ?? aliasFromText(rule.celExpression);
	if (expression) return expression;
	return aliasFromStructuredQuery(rule.query) ?? aliasFromStructuredQuery(rule.conditions);
}

export function targetReference(target: AnyRecord | undefined): string | undefined {
	const model = nonEmpty(target?.model) ?? nonEmpty(target?.model_id) ?? nonEmpty(target?.modelId);
	if (!model) return undefined;
	const provider = nonEmpty(target?.provider) ?? nonEmpty(target?.provider_name) ?? nonEmpty(target?.providerName);
	if (!provider) return model;
	if (model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return model;
	return `${provider}/${model}`;
}

function fallbackReference(fallback: unknown): string | undefined {
	if (typeof fallback === "string") return nonEmpty(fallback);
	return targetReference(fallback as AnyRecord | undefined);
}

function rawRuleTargets(rule: AnyRecord): AnyRecord[] {
	return Array.isArray(rule.targets)
		? rule.targets
		: Array.isArray(rule.routing_targets)
			? rule.routing_targets
			: [];
}

function routingPin(entry: AnyRecord | undefined, source: RoutingPin["source"]): RoutingPin | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	const keyId = nonEmpty(entry.key_id) ?? nonEmpty(entry.keyId);
	const providerKeyName = nonEmpty(entry.provider_key_name) ?? nonEmpty(entry.providerKeyName);
	if (!keyId && !providerKeyName) return undefined;
	const reference = targetReference(entry);
	return {
		source,
		...(reference ? { reference } : {}),
		...(keyId ? { keyId } : {}),
		...(providerKeyName ? { providerKeyName } : {}),
	};
}

export function routingRulePins(rule: AnyRecord | undefined): RoutingPin[] {
	if (!rule) return [];
	const targetPins = rawRuleTargets(rule).map((entry) => routingPin(entry, "target"));
	const fallbacks = Array.isArray(rule.fallbacks)
		? rule.fallbacks
		: Array.isArray(rule.fallback_models)
			? rule.fallback_models
			: [];
	const fallbackPins = fallbacks.map((entry: unknown) => routingPin(entry as AnyRecord, "fallback"));
	const result = new Map<string, RoutingPin>();
	for (const pin of [...targetPins, ...fallbackPins]) {
		if (pin) result.set(JSON.stringify(pin), pin);
	}
	return [...result.values()];
}

export function routingRuleMembers(rule: AnyRecord | undefined): string[] {
	if (!rule) return [];
	const targets = [...rawRuleTargets(rule)].sort(
		(left, right) => Number(right?.weight ?? 0) - Number(left?.weight ?? 0),
	);
	const fallbacks = Array.isArray(rule.fallbacks)
		? rule.fallbacks
		: Array.isArray(rule.fallback_models)
			? rule.fallback_models
			: [];
	return unique([
		...targets.map(targetReference),
		...fallbacks.map((fallback: unknown) => fallbackReference(fallback)),
	]);
}

const DYNAMIC_ROUTING_FORBIDDEN_IDENTIFIERS = Object.freeze([
	"headers",
	"params",
	"budget_used",
	"tokens_used",
	"complexity_tier",
	"virtual_key_id",
	"virtual_key_name",
	"user_id",
	"team_id",
	"team_name",
	"customer_id",
	"customer_name",
	"provider",
	"request",
]);

function structuredQueryFields(value: unknown, result = new Set<string>(), depth = 0): Set<string> {
	if (depth > 20 || value == null) return result;
	if (Array.isArray(value)) {
		for (const item of value) structuredQueryFields(item, result, depth + 1);
		return result;
	}
	if (typeof value !== "object") return result;
	const record = value as AnyRecord;
	if (typeof record.field === "string") result.add(record.field.toLowerCase());
	for (const item of Object.values(record)) structuredQueryFields(item, result, depth + 1);
	return result;
}

export function isContextDynamicRuleSafe(rule: AnyRecord | undefined, aliasId: string): boolean {
	if (!rule || rule.enabled === false || aliasIdFromRule(rule) !== aliasId) return false;
	const scope = (nonEmpty(rule.scope) ?? "global").toLowerCase();
	const scopeId = nonEmpty(rule.scope_id) ?? nonEmpty(rule.scopeId);
	if (scope !== "global" || scopeId) return false;
	if (rule.chain_rule === true || rule.chainRule === true) return false;
	if (routingRulePins(rule).length > 0) return false;
	if (rawRuleTargets(rule).length !== 1 || !targetReference(rawRuleTargets(rule)[0])) return false;

	const fields = new Set([
		...structuredQueryFields(rule.query),
		...structuredQueryFields(rule.conditions),
	]);
	if ([...fields].some((field) => !["model", "request_type"].includes(field))) return false;

	const conditionText = [
		rule.cel_expression,
		rule.celExpression,
		JSON.stringify(rule.query ?? ""),
		JSON.stringify(rule.conditions ?? ""),
	].filter(Boolean).join(" ").toLowerCase();
	for (const identifier of DYNAMIC_ROUTING_FORBIDDEN_IDENTIFIERS) {
		if (new RegExp(`\\b${identifier}\\b`, "u").test(conditionText)) return false;
	}
	return true;
}

export function deriveAliasesFromRules(rules: readonly AnyRecord[] | undefined): DerivedAliasManifest {
	const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
	const aliases: Record<string, DerivedAlias> = {};
	const aliasRules = new Map<string, AnyRecord[]>();

	for (const rule of enabled) {
		const id = aliasIdFromRule(rule);
		if (!id) continue;
		const members = routingRuleMembers(rule);
		if (!members.length) continue;

		const bucket = aliasRules.get(id) ?? [];
		bucket.push(rule);
		aliasRules.set(id, bucket);

		const existing = aliases[id]?.chain ?? [];
		const pinMap = new Map<string, RoutingPin>();
		for (const pin of [...(aliases[id]?.routingPins ?? []), ...routingRulePins(rule)]) {
			pinMap.set(JSON.stringify(pin), pin);
		}
		aliases[id] = {
			name: id,
			chain: unique([...existing, ...members]),
			...(pinMap.size ? { routingPins: [...pinMap.values()] } : {}),
		};
	}

	const allReachableMembers = unique(enabled.flatMap(routingRuleMembers));
	const allPinMap = new Map<string, RoutingPin>();
	for (const pin of enabled.flatMap(routingRulePins)) allPinMap.set(JSON.stringify(pin), pin);
	const allReachablePins = [...allPinMap.values()];

	for (const [id, related] of aliasRules) {
		if (related.some((rule) => rule.chain_rule === true || rule.chainRule === true)) {
			const pinMap = new Map<string, RoutingPin>();
			for (const pin of [...(aliases[id]?.routingPins ?? []), ...allReachablePins]) {
				pinMap.set(JSON.stringify(pin), pin);
			}
			aliases[id] = {
				name: id,
				chain: unique([...(aliases[id]?.chain ?? []), ...allReachableMembers]),
				...(pinMap.size ? { routingPins: [...pinMap.values()] } : {}),
			};
		} else if (related.length === 1 && isContextDynamicRuleSafe(related[0], id)) {
			aliases[id] = {
				...aliases[id]!,
				dynamicRouting: { mode: "context-aware", source: "bifrost-simple-rule" },
			};
		}
	}

	return { includePhysicalModels: false, aliases };
}

export function routingFeatureSummary(rules: readonly AnyRecord[] | undefined): RoutingFeatureSummary {
	const enabled = (rules ?? []).filter((rule) => rule?.enabled !== false);
	const scopes = unique(enabled.map((rule) => nonEmpty(rule.scope) ?? "global")).sort();
	const aliasCounts = new Map<string, number>();
	let chainRules = 0;
	let weightedRules = 0;
	let complexityRules = 0;
	let pinnedRules = 0;

	for (const rule of enabled) {
		const id = aliasIdFromRule(rule);
		if (id) aliasCounts.set(id, (aliasCounts.get(id) ?? 0) + 1);
		if (rule.chain_rule === true || rule.chainRule === true) chainRules += 1;

		const targets = rawRuleTargets(rule);
		if (targets.length > 1 || targets.some((target) => Number(target?.weight ?? 1) !== 1)) weightedRules += 1;
		if (/complexity_tier/iu.test(String(rule.cel_expression ?? rule.celExpression ?? JSON.stringify(rule.query ?? "")))) {
			complexityRules += 1;
		}
		if (routingRulePins(rule).length > 0) pinnedRules += 1;
	}

	return {
		enabledRules: enabled.length,
		scopes,
		chainRules,
		weightedRules,
		complexityRules,
		pinnedRules,
		multiScopeAliases: [...aliasCounts.values()].filter((count) => count > 1).length,
	};
}
