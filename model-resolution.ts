export type ModelResolutionKind = "exact" | "prefix-stripped" | "canonical-family";

export interface ModelResolution<T extends { id: string }> {
	model?: T;
	kind?: ModelResolutionKind;
	score?: number;
	reason?: "no-match" | "ambiguous";
	ambiguousIds?: string[];
}

interface ModelIdentity {
	family: string;
	vendor?: string;
}

// Entitlement/preview aliases are equivalent only when independently known to
// expose the same capability surface. Never strip `-free` globally: free routes
// can have materially smaller context/output limits than their paid sibling.
const MODEL_EQUIVALENCE = new Map<string, string>([
	["stealth/ox-alpha", "ox-alpha"],
	["ox-alpha", "ox-alpha"],
	["ox-alpha-free", "ox-alpha"],
	["x-preview-f-free", "ox-alpha"],
]);

/** Normalize only provider/vendor qualifiers; model IDs retain punctuation. */
function qualifierKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[._-]+/gu, " ")
		.replace(/\s+/gu, " ");
}

const AGGREGATOR_QUALIFIERS = new Set([
	"commandcode",
	"commandcode goat",
	"command code",
	"command code goat",
	"opencode",
	"opencode go",
	"opencode zen",
	"open code",
	"open code go",
	"open code zen",
	"openrouter",
	"open router",
]);

const VENDOR_ALIASES = new Map<string, string>([
	["z ai", "zai"],
	["zai", "zai"],
	["zai org", "zai"],
	["zhipu", "zai"],
	["zhipu ai", "zai"],
	["google", "google"],
	["google ai", "google"],
	["gemini", "google"],
	["moonshot", "moonshotai"],
	["moonshot ai", "moonshotai"],
	["moonshotai", "moonshotai"],
	["kimi", "moonshotai"],
	["xiaomi", "xiaomi"],
	["xiaomi mimo", "xiaomi"],
	["mimo", "xiaomi"],
	["deepseek", "deepseek"],
	["deep seek", "deepseek"],
	["openai", "openai"],
	["open ai", "openai"],
	["openai codex", "openai"],
	["open ai codex", "openai"],
	["codex", "openai"],
	["poolside", "poolside"],
	["stealth", "stealth"],
]);

export function normalizeModelReference(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.split("/")
		.map((part) => part.trim().replace(/\s+/gu, " "))
		.filter(Boolean)
		.join("/");
}

function tail(value: string): string {
	const parts = normalizeModelReference(value).split("/").filter(Boolean);
	return parts[parts.length - 1] ?? normalizeModelReference(value);
}

function canonicalVendor(value: string): string {
	const key = qualifierKey(value);
	return VENDOR_ALIASES.get(key) ?? key;
}

function isAggregator(value: string): boolean {
	return AGGREGATOR_QUALIFIERS.has(qualifierKey(value));
}

export function canonicalModelFamily(value: string): string {
	const full = normalizeModelReference(value).replace(/:batch$/u, "");
	const fullAlias = MODEL_EQUIVALENCE.get(full);
	if (fullAlias) return fullAlias;
	const model = tail(full);
	return MODEL_EQUIVALENCE.get(model) ?? model;
}

function identity(value: string): ModelIdentity {
	let parts = normalizeModelReference(value).replace(/:batch$/u, "").split("/").filter(Boolean);
	while (parts.length > 1 && isAggregator(parts[0]!)) parts = parts.slice(1);
	const family = canonicalModelFamily(parts.join("/"));
	let vendor: string | undefined;
	if (parts.length >= 2) {
		const qualifier = parts[parts.length - 2]!;
		if (!isAggregator(qualifier)) vendor = canonicalVendor(qualifier);
	}
	return { family, vendor };
}

function vendorsCompatible(left: ModelIdentity, right: ModelIdentity): boolean {
	return !left.vendor || !right.vendor || left.vendor === right.vendor;
}

export function modelIdentityCandidates(...values: Array<string | undefined>): string[] {
	const result: string[] = [];
	for (const raw of values) {
		if (!raw) continue;
		let current = normalizeModelReference(raw);
		while (current) {
			result.push(current);
			result.push(canonicalModelFamily(current));
			const slash = current.indexOf("/");
			if (slash < 0) break;
			current = current.slice(slash + 1);
		}
	}
	return [...new Set(result.filter(Boolean))];
}

export function equivalentModelId(left: string, right: string): boolean {
	const leftIdentity = identity(left);
	const rightIdentity = identity(right);
	if (leftIdentity.family !== rightIdentity.family || !vendorsCompatible(leftIdentity, rightIdentity)) return false;

	const leftCandidates = new Set(modelIdentityCandidates(left));
	const rightCandidates = modelIdentityCandidates(right);
	return rightCandidates.some((candidate) => leftCandidates.has(candidate)) || leftIdentity.family === rightIdentity.family;
}

function progressivePaths(value: string): string[] {
	const result: string[] = [];
	let current = normalizeModelReference(value);
	while (current) {
		result.push(current);
		const slash = current.indexOf("/");
		if (slash < 0) break;
		current = current.slice(slash + 1);
	}
	return result;
}

function matchScore(reference: string, modelId: string): number {
	const normalizedReference = normalizeModelReference(reference);
	const normalizedModel = normalizeModelReference(modelId);
	if (normalizedReference === normalizedModel) return 1_000;

	const referenceIdentity = identity(reference);
	const modelIdentity = identity(modelId);
	if (referenceIdentity.family !== modelIdentity.family || !vendorsCompatible(referenceIdentity, modelIdentity)) return -1;

	const referencePaths = progressivePaths(reference);
	const modelPaths = progressivePaths(modelId);
	for (let leftIndex = 0; leftIndex < referencePaths.length; leftIndex += 1) {
		for (let rightIndex = 0; rightIndex < modelPaths.length; rightIndex += 1) {
			if (referencePaths[leftIndex] !== modelPaths[rightIndex]) continue;
			const common = referencePaths[leftIndex]!;
			const qualified = common.includes("/");
			return (qualified ? 900 : 700) - leftIndex * 10 - rightIndex * 5;
		}
	}

	return 500;
}

function kindForScore(score: number): ModelResolutionKind {
	if (score >= 1_000) return "exact";
	if (score >= 700) return "prefix-stripped";
	return "canonical-family";
}

function safeTie<T extends { id: string }>(entries: Array<{ model: T; score: number }>): boolean {
	for (let left = 0; left < entries.length; left += 1) {
		for (let right = left + 1; right < entries.length; right += 1) {
			if (!equivalentModelId(entries[left]!.model.id, entries[right]!.model.id)) return false;
		}
	}
	return true;
}

/**
 * Resolve a route reference against live model IDs without assuming that every
 * matching tail denotes the same model. Provider/aggregator prefixes may drift
 * or change punctuation/case; genuinely conflicting vendor-qualified families
 * are rejected as ambiguous rather than selecting the first tail match.
 */
export function resolveModelReference<T extends { id: string }>(
	reference: string,
	models: readonly T[],
): ModelResolution<T> {
	const matches = models
		.map((model) => ({ model, score: matchScore(reference, model.id) }))
		.filter((entry) => entry.score >= 0)
		.sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id));
	if (!matches.length) return { reason: "no-match" };

	const bestScore = matches[0]!.score;
	const best = matches.filter((entry) => entry.score === bestScore);
	if (best.length === 1 || safeTie(best)) {
		const selected = [...best].sort((left, right) => left.model.id.length - right.model.id.length || left.model.id.localeCompare(right.model.id))[0]!;
		return { model: selected.model, score: bestScore, kind: kindForScore(bestScore) };
	}

	return {
		reason: "ambiguous",
		score: bestScore,
		ambiguousIds: best.map((entry) => entry.model.id),
	};
}
