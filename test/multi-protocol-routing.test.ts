import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@oh-my-pi/pi-ai";

import type { DynamicRoutePlan } from "../dynamic-routing.ts";
import type { AliasDiagnostic } from "../index.ts";
import {
	bifrostAttemptExtraBody,
	createPifrostAttemptModelSpec,
	createPifrostNativeRouteModelSpec,
	pifrostAttemptMaxTokens,
	pifrostDirectMaxTokens,
	normalizePifrostReasoningOptions,
	physicalPolicyIdentity,
	shouldOmitOpaqueReasoningSummary,
	gatewayProtocolOrder,
	isGatewayProtocolRejection,
	runPifrostProtocolPlan,
	type PifrostAttemptStream,
	type PifrostProtocolOutput,
} from "../multi-protocol-routing.ts";

function logicalModel(): Model {
	return {
		id: "omp-default",
		name: "omp-default",
		provider: "bifrost",
		api: "openai-completions",
		baseUrl: "http://bifrost/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		compatConfig: {
			supportsReasoningEffort: true,
			supportsToolChoice: true,
			supportsUsageInStreaming: true,
		},
		compat: {
			supportsDeveloperRole: true,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: true,
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
			disableReasoningOnToolChoice: false,
		},
		identity: {
			provider: "bifrost",
			model: "omp-default",
		},
	} as unknown as Model;
}

function member(reference: string, protocol: "openai-completions" | "openai-responses") {
	return {
		reference,
		resolvedModelId: reference,
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		input: ["text"] as ("text" | "image")[],
		reasoning: true,
		supportsTools: true,
		protocols: [protocol],
		compat: {
			supportsToolChoice: true,
			supportsForcedToolChoice: true,
			supportsNamedToolChoice: true,
			supportsReasoningWithTools: true,
		},
	};
}

function plan(): DynamicRoutePlan {
	const muse = member("opencode-go/muse-spark-1.3-contributor", "openai-responses");
	const command = member("CommandCode GOAT/deepseek/deepseek-v4.1-flash", "openai-completions");
	const deepseek = member("deepseek/deepseek-flash", "openai-completions");
	return {
		logicalModel: "omp-default",
		estimatedInputTokens: 10_000,
		outputReserveTokens: 64_000,
		outputReserveExplicit: false,
		requiredContextTokens: 74_000,
		attempts: [
			{ protocol: "openai-responses", primary: muse.reference, fallbacks: [], members: [muse] },
			{
				protocol: "openai-completions",
				primary: command.reference,
				fallbacks: [deepseek.reference],
				members: [command, deepseek],
			},
		],
		excluded: [],
	};
}

function assistant(model: string, api: "openai-completions" | "openai-responses", stopReason: "stop" | "error"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api,
		provider: "bifrost",
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function eventStream(events: readonly AssistantMessageEvent[]): PifrostAttemptStream {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
	};
}

function failedAttempt(model: string, api: "openai-completions" | "openai-responses"): PifrostAttemptStream {
	const partial = assistant(model, api, "stop");
	const error = assistant(model, api, "error");
	error.errorMessage = "synthetic pre-output failure";
	return eventStream([
		{ type: "start", partial },
		{ type: "error", reason: "error", error },
	]);
}

function successfulAttempt(model: string, api: "openai-completions" | "openai-responses"): PifrostAttemptStream {
	const partial = assistant(model, api, "stop");
	return eventStream([
		{ type: "start", partial },
		{ type: "done", reason: "stop", message: partial },
	]);
}

function outputCollector() {
	const events: AssistantMessageEvent[] = [];
	let failure: unknown;
	const output: PifrostProtocolOutput = {
		push(event) {
			events.push(event);
		},
		fail(error) {
			failure = error;
		},
		forwardLocalWorkFrom() {},
	};
	return {
		events,
		output,
		failure: () => failure,
	};
}

test("native Bifrost route uses physical Chat encoder but sends logical model without client fallbacks", () => {
	const model = logicalModel();
	model.headers = { "x-bf-vk": "test-virtual-key" };
	const attempt = plan().attempts[1]!;
	const spec = createPifrostNativeRouteModelSpec(model, attempt);
	assert.equal(spec.api, "openai-completions");
	assert.equal(spec.requestModelId, "omp-default");
	assert.equal(spec.provider, "commandcode");
	assert.equal(spec.baseUrl, "http://bifrost/v1");
	assert.equal(spec.headers?.["x-bf-vk"], "test-virtual-key");
	assert.equal((spec.compat as Record<string, unknown>)?.extraBody, undefined);
	assert.deepEqual(attempt.fallbacks, ["deepseek/deepseek-flash"], "source rule is not modified");
});

test("attempt specs use native protocol endpoints and preserve same-protocol Bifrost fallbacks", () => {
	const logical = logicalModel();
	const route = plan();
	const responses = createPifrostAttemptModelSpec(logical, route.attempts[0]!);
	const chat = createPifrostAttemptModelSpec(logical, route.attempts[1]!);

	assert.equal(responses.api, "openai-responses");
	assert.equal(responses.provider, "opencode-go");
	assert.equal(responses.id, "muse-spark-1.3-contributor");
	assert.equal(responses.requestModelId, "opencode-go/muse-spark-1.3-contributor");
	assert.equal(responses.baseUrl, "http://bifrost/v1");
	assert.equal(chat.api, "openai-completions");
	assert.equal(chat.id, "deepseek/deepseek-v4.1-flash");
	assert.equal(chat.requestModelId, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	assert.equal(chat.provider, "commandcode");
	assert.deepEqual(
		((chat.compat as Record<string, unknown> | undefined)?.extraBody as Record<string, unknown> | undefined)?.fallbacks,
		["deepseek/deepseek-flash"],
	);
	assert.equal(bifrostAttemptExtraBody(route.attempts[0]!), undefined);
});

test("synthetic approved pre-output transition falls through to the Chat protocol group", async () => {
	const logical = logicalModel();
	const route = plan();
	const dispatched: Array<{ protocol: string; model: string }> = [];
	const collected = outputCollector();

	await runPifrostProtocolPlan(logical, route, collected.output, (attempt) => {
		dispatched.push({ protocol: attempt.protocol, model: attempt.primary });
		return attempt.protocol === "openai-responses"
			? failedAttempt(attempt.primary, "openai-responses")
			: successfulAttempt(attempt.primary, "openai-completions");
	}, { retryPreOutputError: () => true });

	assert.equal(collected.failure(), undefined);
	assert.deepEqual(dispatched, [
		{ protocol: "openai-responses", model: "opencode-go/muse-spark-1.3-contributor" },
		{ protocol: "openai-completions", model: "CommandCode GOAT/deepseek/deepseek-v4.1-flash" },
	]);
	assert.deepEqual(collected.events.map((event) => event.type), ["start", "done"]);
	const done = collected.events.at(-1);
	assert.equal(done?.type, "done");
	if (done?.type === "done") {
		assert.equal(done.message.model, "omp-default");
		assert.equal(done.message.api, "openai-completions");
		assert.equal(done.message.upstreamModel, "CommandCode GOAT/deepseek/deepseek-v4.1-flash");
	}
});

test("once a Responses attempt emits model output Pifrost never replays on Chat", async () => {
	const logical = logicalModel();
	const route = plan();
	const dispatched: string[] = [];
	const collected = outputCollector();

	await runPifrostProtocolPlan(logical, route, collected.output, (attempt) => {
		dispatched.push(attempt.protocol);
		if (attempt.protocol === "openai-completions") {
			return successfulAttempt(attempt.primary, "openai-completions");
		}
		const partial = assistant(attempt.primary, "openai-responses", "stop");
		partial.content = [{ type: "thinking", thinking: "" }];
		const error = assistant(attempt.primary, "openai-responses", "error");
		error.errorMessage = "failed after output began";
		return eventStream([
			{ type: "start", partial },
			{ type: "thinking_start", contentIndex: 0, partial },
			{ type: "thinking_delta", contentIndex: 0, delta: "generated", partial },
			{ type: "error", reason: "error", error },
		]);
	});

	assert.equal(collected.failure(), undefined);
	assert.deepEqual(dispatched, ["openai-responses"]);
	assert.deepEqual(collected.events.map((event) => event.type), ["start", "thinking_start", "thinking_delta", "error"]);
	const error = collected.events.at(-1);
	assert.equal(error?.type, "error");
	if (error?.type === "error") {
		assert.equal(error.error.model, "omp-default");
		assert.equal(error.error.upstreamModel, "opencode-go/muse-spark-1.3-contributor");
	}
});

test("attempt output cap is clamped to the weakest same-protocol Bifrost fallback", () => {
	const route = plan();
	const chat = route.attempts[1]!;
	chat.members[0] = { ...chat.members[0]!, maxTokens: 384_000 };
	chat.members[1] = { ...chat.members[1]!, maxTokens: 131_072 };

	assert.equal(pifrostAttemptMaxTokens(chat, 262_144), 131_072);
	assert.equal(pifrostAttemptMaxTokens(chat, 64_000), 64_000);
	assert.equal(pifrostAttemptMaxTokens(chat), 131_072);
});

test("confirmed fallback output maximum overrides inflated catalog metadata", () => {
	const route = plan();
	const attempt = route.attempts[1]!;
	attempt.members = [{
		...attempt.members[0]!,
		reference: "CommandCode GOAT/deepseek/deepseek-v4.1-flash",
		maxTokens: 712_434,
		maxTokensSource: "bifrost-datasheet",
	}];
	assert.equal(pifrostAttemptMaxTokens(attempt, 712_434), 393_216);
});

test("single-member Responses attempt preserves a supported larger requested ceiling", () => {
	const route = plan();
	const responses = route.attempts[0]!;
	responses.members[0] = { ...responses.members[0]!, maxTokens: 384_000 };

	assert.equal(pifrostAttemptMaxTokens(responses, 262_144), 262_144);
});


test("non-dynamic dispatch caps oversized explicit token requests", () => {
	assert.equal(pifrostDirectMaxTokens(65_536, 32_768), 32_768);
	assert.equal(pifrostDirectMaxTokens(8_192, 32_768), 8_192);
	assert.equal(pifrostDirectMaxTokens(384_000, 384_000), 384_000);
	assert.equal(pifrostDirectMaxTokens(undefined, 32_768), 32_768);
});

test("explicit reasoning off remains off, but implicit mandatory efforts use a floor", () => {
	const mandatory = { reasoning: true, thinking: { requiresEffort: true, efforts: ["low", "high"] } } as unknown as Model;
	assert.equal(normalizePifrostReasoningOptions(mandatory, { disableReasoning: true })?.disableReasoning, true);
	assert.equal(normalizePifrostReasoningOptions(mandatory, { forceReasoningOff: true })?.forceReasoningOff, true);
	assert.equal(normalizePifrostReasoningOptions(mandatory, { reasoning: "high" as never })?.reasoning, "high");
	assert.equal(normalizePifrostReasoningOptions(mandatory, undefined)?.reasoning, "low");
	assert.equal(normalizePifrostReasoningOptions({ reasoning: false } as Model, undefined), undefined);
});

test("CommandCode reasoning compatibility is resolved using physical identity", () => {
	const route = "CommandCode GOAT/deepseek/deepseek-v4.1-flash";
	assert.deepEqual(physicalPolicyIdentity(route), {
		id: "deepseek/deepseek-v4.1-flash", provider: "commandcode", requestModelId: route,
	});
	const spec = createPifrostAttemptModelSpec(logicalModel(), {
		protocol: "openai-responses", primary: route, fallbacks: [], members: [member(route, "openai-responses")],
	});
	assert.equal(spec.id, "deepseek/deepseek-v4.1-flash");
	assert.equal(spec.provider, "commandcode");
	assert.equal(spec.requestModelId, route);
	assert.equal(spec.api, "openai-responses");
	assert.equal(spec.baseUrl, "http://bifrost/v1");
	assert.equal(physicalPolicyIdentity("opencode-go/muse-spark-1.3-contributor")?.provider, "opencode-go");
});


test("opaque CommandCode DeepSeek Responses summary is omitted without disabling real reasoning", () => {
	assert.equal(shouldOmitOpaqueReasoningSummary("CommandCode GOAT/deepseek/deepseek-v4.1-flash"), true);
	assert.equal(shouldOmitOpaqueReasoningSummary("CommandCode GOAT/deepseek/deepseek-v4-flash"), false);
	assert.equal(shouldOmitOpaqueReasoningSummary("deepseek/deepseek-v4.1-flash"), false);
	assert.equal(shouldOmitOpaqueReasoningSummary("CommandCode GOAT/inclusionai/ling-3.1-flash:free"), false);
});


test("approved same-protocol pre-output transition uses second physical policy safely", async () => {
	const logical = logicalModel();
	const m1 = member("opencode-go/model-a", "openai-completions");
	const m2 = member("CommandCode GOAT/model-b", "openai-completions");
	const attempts = [m1, m2].map(m => ({protocol: "openai-completions" as const,
		primary:m.reference, fallbacks:[], members:[m]}));
	const route = {...plan(),attempts};
	const visited:string[]=[];
	const collected=outputCollector();
	await runPifrostProtocolPlan(logical,route,collected.output,a=>{
		visited.push(a.primary);
		return a.primary===m1.reference ? failedAttempt(a.primary,"openai-completions") : successfulAttempt(a.primary,"openai-completions");
	}, { retryPreOutputError: () => true });
	assert.deepEqual(visited,[m1.reference,m2.reference]);
	assert.deepEqual(collected.events.map(e=>e.type),["start","done"]);
});

test("same-protocol incompatible fallback cannot replay after first reasoning output", async () => {
	const logical=logicalModel();
	const m1=member("opencode-go/model-a","openai-responses");
	const m2=member("CommandCode GOAT/model-b","openai-responses");
	const route={...plan(),attempts:[m1,m2].map(m=>({protocol:"openai-responses" as const,primary:m.reference,fallbacks:[],members:[m]}))};
	const visited:string[]=[];
	const collected=outputCollector();
	await runPifrostProtocolPlan(logical,route,collected.output,a=>{
		visited.push(a.primary);
		const partial=assistant(a.primary,"openai-responses","stop");
		partial.content=[{type:"thinking",thinking:"progress"}];
		const failure=assistant(a.primary,"openai-responses","error");
		failure.errorMessage="upstream failure after reasoning";
		return eventStream([{type:"start",partial},{type:"thinking_start",contentIndex:0,partial},
			{type:"thinking_delta",contentIndex:0,delta:"progress",partial},
			{type:"error",reason:"error",error:failure}]);
	});
	assert.deepEqual(visited,[m1.reference]);
	assert.deepEqual(collected.events.map(e=>e.type),["start","thinking_start","thinking_delta","error"]);
});


test("physical Chat and Responses attempts preserve gateway authentication without importing logical reasoning policy", () => {
	const logical = logicalModel();
	logical.headers = {
		"x-bf-vk": "sk-bf-regression-fixture",
		"User-Agent": "pifrost/test OMP",
		"x-bf-eh-http-referer": "https://github.com/alutke/pifrost",
	};
	const originalHeaders = logical.headers;
	for (const api of ["openai-completions", "openai-responses"] as const) {
		const target = member("CommandCode GOAT/deepseek/deepseek-v4.1-flash", api);
		const spec = createPifrostAttemptModelSpec(logical, {
			protocol: api, primary: target.reference, fallbacks: [], members: [target],
		});
		assert.deepEqual(spec.headers, originalHeaders, api);
		assert.notStrictEqual(spec.headers, originalHeaders, "headers must be copied to avoid mutation");
		assert.equal(spec.provider, "commandcode");
		assert.equal(spec.requestModelId, target.reference);
		assert.equal((spec.compat as Record<string, unknown>).supportsDeveloperRole, false);
		assert.equal((spec.compat as Record<string, unknown>).extraBody, undefined);
	}
	assert.deepEqual(logical.headers, originalHeaders);
});

test("logical alias mapping preserves actual physical origin after cross-protocol fallback", async () => {
	const received: AssistantMessageEvent[] = [];
	const output: PifrostProtocolOutput = {
		push(event) { received.push(event); },
		fail(error) { throw error; },
		forwardLocalWorkFrom() {},
	};
	await runPifrostProtocolPlan(logicalModel(), plan(), output, (attempt, index) => {
		if (index === 0) {
			const protocol = attempt.protocol === "openai-responses" ? "openai-responses" : "openai-completions";
			const failed = assistant(attempt.primary, protocol, "error");
			return eventStream([{ type: "start", partial: failed }, { type: "error", reason: "error", error: failed }]);
		}
		const physical = {
			...assistant(attempt.primary, attempt.protocol === "openai-responses" ? "openai-responses" : "openai-completions", "stop"),
			upstreamProvider: "deepseek",
			upstreamModel: "deepseek-v4",
		};
		return eventStream([{ type: "start", partial: physical }, { type: "done", reason: "stop", message: physical }]);
	}, { retryPreOutputError: () => true });
	const terminal = received.find((event) => event.type === "done");
	assert.ok(terminal && terminal.type === "done");
	assert.equal(terminal.message.provider, "bifrost");
	assert.equal(terminal.message.model, "omp-default");
	assert.equal(terminal.message.upstreamProvider, "deepseek");
	assert.equal(terminal.message.upstreamModel, "deepseek-v4");
	assert.deepEqual(received.map((e) => e.type), ["start", "done"]);
});


test("empty text/thinking starts and zero-length deltas do not prevent fallback", async () => {
  const logical=logicalModel(), route=plan(), visited:string[]=[];
  const collected=outputCollector();
  await runPifrostProtocolPlan(logical,route,collected.output,attempt=>{
    visited.push(attempt.primary);
    if(attempt.protocol==="openai-completions") return successfulAttempt(attempt.primary,"openai-completions");
    const partial=assistant(attempt.primary,"openai-responses","stop");
    partial.content=[{type:"thinking",thinking:""}];
    const failure=assistant(attempt.primary,"openai-responses","error");
    return eventStream([
      {type:"start",partial},
      {type:"thinking_start",contentIndex:0,partial},
      {type:"thinking_delta",contentIndex:0,delta:"",partial},
      {type:"error",reason:"error",error:failure}
    ]);
  }, { retryPreOutputError: () => true });
  assert.equal(visited.length,2);
  assert.deepEqual(collected.events.map(e=>e.type),["start","done"]);
});

test("empty starts followed by tool-call completion prevent fallback", async () => {
  const logical=logicalModel(), route=plan(), visited:string[]=[];
  const collected=outputCollector();
  await runPifrostProtocolPlan(logical,route,collected.output,attempt=>{
    visited.push(attempt.primary);
    const partial=assistant(attempt.primary,"openai-responses","stop");
    const failure=assistant(attempt.primary,"openai-responses","error");
    return eventStream([{type:"start",partial},{type:"toolcall_start",contentIndex:0,partial},
      {type:"toolcall_end",contentIndex:0,toolCall:{type:"toolCall",id:"call",name:"tool",arguments:{}},partial},
      {type:"error",reason:"error",error:failure}]);
  });
  assert.equal(visited.length,1);
  assert.deepEqual(collected.events.map(e=>e.type),["start","toolcall_start","toolcall_end","error"]);
});

function gatewayPlan(model: Model, first: "openai-completions" | "openai-responses"): DynamicRoutePlan {
	const second: "openai-completions" | "openai-responses" = first === "openai-responses" ? "openai-completions" : "openai-responses";
	const protocols: Array<"openai-completions" | "openai-responses"> = [first, second];
	return {
		logicalModel: model.id, estimatedInputTokens: 0,
		outputReserveTokens: 0, outputReserveExplicit: false, requiredContextTokens: 0, excluded: [],
		attempts: protocols.map(protocol => ({
			protocol, primary: model.id, fallbacks: [], members: [],
		})),
	};
}

test("Muse-first Advisor and reversed routes select the right Bifrost ingress without copying targets", () => {
	const advisor: AliasDiagnostic = {
		id: "omp-advisor", name: "OMP Advisor", chain: ["opencode-go/muse-spark-1.3-contributor", "Xiaomi MIMO/mimo-v2.6-flash"],
		resolved: [], unresolved: [], image: true, reasoning: true, reasoningEfforts: [], tools: true,
		members: [
			{ reference: "opencode-go/muse-spark-1.3-contributor", status: "resolved", protocols: ["openai-responses"] },
			{ reference: "Xiaomi MIMO/mimo-v2.6-flash", status: "resolved", protocols: ["openai-completions"] },
		],
	};
	assert.deepEqual(gatewayProtocolOrder(advisor), ["openai-responses", "openai-completions"]);
	assert.deepEqual(gatewayProtocolOrder({ ...advisor, members: [...advisor.members!].reverse() }),
		["openai-completions", "openai-responses"]);
	assert.deepEqual(gatewayProtocolOrder({ ...advisor, members: [advisor.members![0]!] }), ["openai-responses"]);
	assert.equal(gatewayProtocolOrder({ ...advisor, members: [advisor.members![1]!] }), undefined);
	assert.equal(gatewayProtocolOrder(undefined), undefined);
});

test("gateway protocol rejection retries the same logical alias once before output", async () => {
	const logical = logicalModel();
	const collected = outputCollector();
	const invoked: string[] = [];
	await runPifrostProtocolPlan(logical, gatewayPlan(logical, "openai-responses"), collected.output, attempt => {
		invoked.push(attempt.protocol + ":" + attempt.primary);
		if (attempt.protocol === "openai-completions") return successfulAttempt(logical.id, "openai-completions");
		const error = assistant(logical.id, "openai-responses", "error");
		error.errorMessage = "400 Model does not support this protocol.";
		return eventStream([
			{ type: "start", partial: assistant(logical.id, "openai-responses", "stop") },
			{ type: "error", reason: "error", error },
		]);
	}, { retryPreOutputError: isGatewayProtocolRejection });
	assert.deepEqual(invoked, ["openai-responses:" + logical.id, "openai-completions:" + logical.id]);
	assert.equal(collected.failure(), undefined);
	assert.deepEqual(collected.events.map(item => item.type), ["start", "done"]);
	assert.equal(collected.events.at(-1)?.type, "done");
});

test("gateway ingress does not retry authentication, quota or generic errors", async () => {
	const logical = logicalModel();
	for (const failure of ["401 invalid virtual key", "429 rate limited", "504 idle timeout", "400 invalid request"]) {
		const collected = outputCollector();
		const invoked: string[] = [];
		await runPifrostProtocolPlan(logical, gatewayPlan(logical, "openai-responses"), collected.output, attempt => {
			invoked.push(attempt.protocol);
			const error = assistant(logical.id, "openai-responses", "error");
			error.errorMessage = failure;
			return eventStream([{ type: "error", reason: "error", error }]);
		}, { retryPreOutputError: isGatewayProtocolRejection });
		assert.deepEqual(invoked, ["openai-responses"]);
		assert.equal(collected.events.at(-1)?.type, "error");
		assert.equal(collected.failure(), undefined);
	}
	assert.equal(isGatewayProtocolRejection("Model does not support this protocol."), true);
	assert.equal(isGatewayProtocolRejection("403 forbidden"), false);
});

test("gateway ingress never replays once a model emitted visible text", async () => {
	const logical = logicalModel();
	const collected = outputCollector();
	const invoked: string[] = [];
	await runPifrostProtocolPlan(logical, gatewayPlan(logical, "openai-responses"), collected.output, attempt => {
		invoked.push(attempt.protocol);
		const partial = assistant(logical.id, "openai-responses", "stop");
		const error = assistant(logical.id, "openai-responses", "error");
		error.errorMessage = "400 Model does not support this protocol.";
		return eventStream([
			{ type: "start", partial },
			{ type: "text_delta", contentIndex: 0, delta: "partial", partial },
			{ type: "error", reason: "error", error },
		]);
	}, { retryPreOutputError: isGatewayProtocolRejection });
	assert.deepEqual(invoked, ["openai-responses"]);
	assert.deepEqual(collected.events.map(item => item.type), ["start", "text_delta", "error"]);
});

test("a thrown protocol error may retry but a generic thrown error cannot", async () => {
	const logical = logicalModel();
	const matching = outputCollector();
	const invoked: string[] = [];
	await runPifrostProtocolPlan(logical, gatewayPlan(logical, "openai-completions"), matching.output, attempt => {
		invoked.push(attempt.protocol);
		if (attempt.protocol === "openai-completions") throw new Error("Model does not support this protocol.");
		return successfulAttempt(logical.id, "openai-responses");
	}, { retryPreOutputError: isGatewayProtocolRejection });
	assert.deepEqual(invoked, ["openai-completions", "openai-responses"]);
	assert.deepEqual(matching.events.map(item => item.type), ["start", "done"]);
	const generic = outputCollector();
	const genericInvoked: string[] = [];
	await runPifrostProtocolPlan(logical, gatewayPlan(logical, "openai-completions"), generic.output, attempt => {
		genericInvoked.push(attempt.protocol);
		throw new Error("Gateway offline");
	}, { retryPreOutputError: isGatewayProtocolRejection });
	assert.deepEqual(genericInvoked, ["openai-completions"]);
	assert.match(String(generic.failure()), /Gateway offline/u);
});

test("the generic attempt runner fails closed with no explicit transition policy", async () => {
  const logical = logicalModel(), route = plan(), collected = outputCollector();
  const dispatched: string[] = [];
  await runPifrostProtocolPlan(logical, route, collected.output, attempt => {
    dispatched.push(attempt.primary);
    return failedAttempt(attempt.primary, "openai-responses");
  });
  assert.equal(dispatched.length, 1);
  assert.equal(collected.events.at(-1)?.type, "error");
});

test("R1-07 failed live route attestation blocks upstream dispatch without retry", async () => {
  const logical=logicalModel(), route=plan(), collected=outputCollector();
  let dispatched=0, checked=0;
  await runPifrostProtocolPlan(logical,route,collected.output,attempt=>{
    dispatched++;
    return successfulAttempt(attempt.primary,"openai-responses");
  }, {
    beforeAttempt: async()=>{ checked++; throw new Error("live-route-drift"); },
    retryPreOutputError:()=>true,
  });
  assert.equal(checked,1);
  assert.equal(dispatched,0);
  assert.match(String(collected.failure()),/live-route-drift/u);
});
test("R1-08 every allowed physical fallback rechecks live route before dispatch", async () => {
  const logical=logicalModel(), route=plan(), collected=outputCollector();
  let checked=0, dispatched=0;
  await runPifrostProtocolPlan(logical,route,collected.output,attempt=>{
    dispatched++;
    return dispatched===1
      ? failedAttempt(attempt.primary,"openai-responses")
      : successfulAttempt(attempt.primary,"openai-completions");
  }, { beforeAttempt:async()=>{checked++;},retryPreOutputError:()=>true });
  assert.equal(checked,2);
  assert.equal(dispatched,2);
});
