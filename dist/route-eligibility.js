                                                              

                                         
	                      
	                  
	                                     
	                   
	                       
	                             
	                              
	                                 
	                              
	         
		                             
		                                   
		                                  
		                                     
		                                       
		                                       
	  
 

                                           
	                             
	                            
	                   
	                   
	                       
	                        
	                                  
	                           
	                                     
	                     
	                  
	                           
	                                       
 

                                         
	                  
	                  
	                  
	                                     
	                              
 

export function resolveRouteMemberProtocol(
	protocols                               ,
	supportedProtocols                   ,
	options                                                     = {},
)                     {
	const defaultProtocol = options.defaultProtocol ?? "openai-completions";
	if (!protocols?.length) {
		return supportedProtocols.includes(defaultProtocol) ? defaultProtocol : supportedProtocols[0];
	}
	if (
		options.toolSearch === true &&
		protocols.includes("openai-responses") &&
		supportedProtocols.includes("openai-responses")
	) {
		return "openai-responses";
	}
	if (protocols.includes(defaultProtocol) && supportedProtocols.includes(defaultProtocol)) {
		return defaultProtocol;
	}
	return protocols.find((protocol) => supportedProtocols.includes(protocol));
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
	member                        ,
	request                          ,
)                         {
	const reasons           = [];
	const notices           = [];

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


//# sourceURL=/home/runner/work/pifrost/pifrost/route-eligibility.ts