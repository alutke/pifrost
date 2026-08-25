export const CAPABILITY_SOURCE_ORDER = [
	"live",
	"bifrost-datasheet",
	"canonical-family",
	"vendor-override",
	"fallback",
] as const;

export type CapabilitySource = (typeof CAPABILITY_SOURCE_ORDER)[number];

export type CapabilityField =
	| "context"
	| "output"
	| "image"
	| "reasoning"
	| "thinking"
	| "tools"
	| "cost"
	| "streaming";

export type CapabilitySources = Partial<Record<CapabilityField, CapabilitySource>>;

export interface CapabilityCandidate<T> {
	value: T;
	source: CapabilitySource;
	detail?: string;
}

export function capabilitySourceRank(source: CapabilitySource): number {
	const index = CAPABILITY_SOURCE_ORDER.indexOf(source);
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** Select the most authoritative available capability fact. */
export function pickCapability<T>(
	...candidates: Array<CapabilityCandidate<T> | undefined>
): CapabilityCandidate<T> | undefined {
	return candidates
		.filter((candidate): candidate is CapabilityCandidate<T> => candidate !== undefined)
		.sort((left, right) => capabilitySourceRank(left.source) - capabilitySourceRank(right.source))[0];
}

export function sourceSummary(sources: CapabilitySources | undefined): string {
	if (!sources) return "none";
	return Object.entries(sources)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([field, source]) => `${field}=${source}`)
		.join(" ") || "none";
}
