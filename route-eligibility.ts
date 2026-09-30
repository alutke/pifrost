export type RouteToolChoiceKind = "auto" | "forced" | "named";

export interface RouteEligibilityMember {
	contextWindow: number;
	maxTokens: number;
	input: readonly ("text" | "image")[];
	reasoning: boolean;
	supportsTools: boolean;
	supportsToolSearch?: boolean;
	supportsServiceTier?: boolean;
	serviceTiers?: readonly string[];
	protocols?: readonly string[];
	compat: {
		supportsToolChoice?: boolean;
		supportsForcedToolChoice?: boolean;
		supportsNamedToolChoice?: boolean;
		supportsReasoningWithTools?: boolean;
		supportsBetweenToolsThinking?: boolean;
		disableReasoningOnToolChoice?: boolean;
	};
}

export interface RouteRequestCapabilities {
	estimatedInputTokens: number;
	outputReserveTokens: number;
	hasImages: boolean;
	usesTools: boolean;
	usesReasoning: boolean;
	usesToolSearch: boolean;
	usesBetweenToolsThinking: boolean;
	toolChoicePresent: boolean;
	toolChoiceKind?: RouteToolChoiceKind;
	serviceTier?: string;
	protocol?: string;
	protocolAvailable: boolean;
	supportedProtocols?: readonly string[];
}

export interface RouteEligibilityResult {
	eligible: boolean;
	reasons: string[];
	notices: string[];
	effectiveOutputReserveTokens: number;
	requiredContextTokens: number;
}

/**
 * Canonical capability eligibility evaluator shared by runtime prewalk and CLI
 * diagnostics. It is deliberately policy-neutral: route order, provider
 * preference, cost and quota are never considered here.
 *
 * Between-tools thinking is not an exclusion criterion. Bifrost 2.2.4+ owns
 * model-specific downgrade/omission for fallbacks that do not support
 * reasoning.type=between_tools, preserving the configured physical fallback
 * chain while Pifrost remains responsible only for request/protocol safety.
 */
export function evaluateRouteMemberEligibility(
	member: RouteEligibilityMember,
	request: RouteRequestCapabilities,
): RouteEligibilityResult {
	const reasons: string[] = [];
	const notices: string[] = [];

	if (!request.protocolAvailable) {
		const advertised = member.protocols?.length ? member.protocols.join(",") : "unknown";
		const supported = request.supportedProtocols?.length ? request.supportedProtocols.join(",") : "none";
		reasons.push(`protocol ${advertised} incompatible with ${supported}`);
	}

	const effectiveOutputReserveTokens = Math.min(request.outputReserveTokens, member.maxTokens);
	const requiredContextTokens = request.estimatedInputTokens + effectiveOutputReserveTokens;
	if (member.contextWindow < requiredContextTokens) {
		reasons.push(`context ${member.contextWindow} < required ${requiredContextTokens}`);
	}

	if (request.hasImages && !member.input.includes("image")) reasons.push("no image input");
	if (request.usesTools && !member.supportsTools) reasons.push("no tool support");

	if (request.toolChoicePresent && member.compat.supportsToolChoice === false) {
		reasons.push("no tool_choice support");
	}
	if (request.toolChoiceKind === "forced" && member.compat.supportsForcedToolChoice === false) {
		reasons.push("no forced tool_choice support");
	}
	if (request.toolChoiceKind === "named" && member.compat.supportsNamedToolChoice === false) {
		reasons.push("no named tool_choice support");
	}

	if (request.usesReasoning && !member.reasoning) reasons.push("no reasoning support");
	if (request.usesReasoning && request.usesTools && member.compat.supportsReasoningWithTools === false) {
		reasons.push("cannot combine reasoning with tools");
	}

	if (request.usesToolSearch) {
		if (member.supportsToolSearch !== true) reasons.push("no tool-search/deferred-tool support");
		if (request.protocol !== "openai-responses") reasons.push("tool search requires Responses transport");
	}

	if (
		request.usesBetweenToolsThinking &&
		member.compat.supportsBetweenToolsThinking !== true
	) {
		notices.push("between-tools thinking will be downgraded or omitted by Bifrost for this fallback");
	}

	const serviceTier = request.serviceTier?.trim();
	if (serviceTier && serviceTier !== "auto") {
		if (member.supportsServiceTier !== true) reasons.push("no service-tier support");
		if (member.serviceTiers?.length && !member.serviceTiers.includes(serviceTier)) {
			reasons.push(`service tier ${serviceTier} unavailable`);
		}
	}

	if (
		request.usesReasoning &&
		request.toolChoicePresent &&
		member.compat.disableReasoningOnToolChoice === true
	) {
		reasons.push("reasoning incompatible with tool_choice");
	}

	return {
		eligible: reasons.length === 0,
		reasons,
		notices,
		effectiveOutputReserveTokens,
		requiredContextTokens,
	};
}
