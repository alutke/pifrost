/**
 * Opt-in live Bifrost conformance, not a CI stub. Uses explicitly supplied
 * physical routes, a local/remote real gateway and an inference VK.
 * No request prompt, bearer key or virtual key is printed.
 */
const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live conformance`);
  return value;
};

const base = required("BIFROST_URL").replace(/\/+$/u, "").replace(/\/(?:chat\/completions|responses|models)$/u, "").replace(/\/+$/u, "");
const api = /\/v1$/u.test(base) ? base : `${base}/v1`;
const vk = required("BIFROST_VIRTUAL_KEY");
const bearer = process.env.BIFROST_API_KEY?.trim();
const chatModel = required("PIFROST_CONFORMANCE_CHAT_MODEL");
const responsesModel = required("PIFROST_CONFORMANCE_RESPONSES_MODEL");
const toolModel = process.env.PIFROST_CONFORMANCE_TOOL_MODEL?.trim();
const requireProvenance = process.env.PIFROST_CONFORMANCE_REQUIRE_PROVENANCE === "1";
const headers = {
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-bf-vk": vk,
  ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
};

function eventPayloads(body) {
  const result = [];
  let finished = false;
  for (const line of body.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") { finished = true; continue; }
    if (!data) continue;
    try { result.push(JSON.parse(data)); }
    catch { throw new Error("Invalid gateway SSE JSON"); }
  }
  return { events: result, finished };
}

async function streamProbe(label, path, body, kind) {
  const result = await fetch(`${api}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(90000),
  });
  if (!result.ok) {
    const description = (await result.text()).slice(0, 250).replace(/[\r\n]+/gu, " ");
    throw new Error(`${label}: HTTP ${result.status} ${description}`);
  }
  const type = result.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("text/event-stream")) throw new Error(`${label}: not an SSE response (${type})`);
  const { events, finished } = eventPayloads(await result.text());
  if (!finished) throw new Error(`${label}: missing SSE terminal [DONE], possible truncated response`);
  if (!events.length) throw new Error(`${label}: empty SSE response`);
  if (events.some(event => event.error || event.type === "response.failed")) {
    throw new Error(`${label}: upstream error event`);
  }
  const complete = kind === "responses"
    ? events.some(event => event.type === "response.completed")
    : events.some(event => event.choices?.some(choice => choice.finish_reason));
  if (!complete) throw new Error(`${label}: no completed inference marker`);
  // A terminal frame alone is not evidence of a usable model reply.
  // Forced-tool responses are validated separately using complete JSON args.
  if (label !== "Forced Chat tool") {
    const hasOutput = kind === "responses"
      ? events.some(event =>
          (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta.trim()) ||
          (event.type === "response.completed" && event.response?.output?.some(item =>
            item.content?.some(part => part.type === "output_text" && typeof part.text === "string" && part.text.trim()))))
      : events.some(event => event.choices?.some(choice =>
          typeof choice.delta?.content === "string" && choice.delta.content.trim()));
    if (!hasOutput) throw new Error(`${label}: completed without assistant text`);
  }
  const gatewayProvider = result.headers.get("x-bifrost-routing-info-provider") ??
    result.headers.get("x-bifrost-provider") ?? "unreported";
  const gatewayModel = result.headers.get("x-bifrost-routing-info-model") ??
    result.headers.get("x-bifrost-resolved-model") ?? "unreported";
  if (requireProvenance && (gatewayProvider === "unreported" || gatewayModel === "unreported")) {
    throw new Error(`${label}: missing Bifrost physical provider/model provenance headers`);
  }
  console.log(`[OK] ${label}: events=${events.length} served=${gatewayProvider}/${gatewayModel}`);
  return events;
}

try {
  await streamProbe("Chat", "chat/completions", {
    model: chatModel, messages: [{ role: "user", content: "Reply briefly with READY." }],
    max_tokens: 96,
  }, "chat");
  await streamProbe("Responses", "responses", {
    model: responsesModel, input: [{ role: "user", content: [{ type: "input_text", text: "Reply briefly with READY." }] }],
    max_output_tokens: 96,
  }, "responses");
  if (toolModel) {
    const events = await streamProbe("Forced Chat tool", "chat/completions", {
      model: toolModel,
      messages: [{ role: "user", content: "Call pifrost_probe with value set to ok." }],
      tools: [{ type: "function", function: {
        name: "pifrost_probe", description: "Conformance probe",
        parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      } }],
      tool_choice: "required", max_tokens: 160,
    }, "chat");
    const chunks = new Map();
    for (const event of events) {
      for (const choice of event.choices ?? []) {
        for (const call of choice.delta?.tool_calls ?? []) {
          const key = call.index ?? 0;
          const item = chunks.get(key) ?? { name: "", arguments: "" };
          item.name = call.function?.name ?? item.name;
          item.arguments += call.function?.arguments ?? "";
          chunks.set(key, item);
        }
      }
    }
    const parsed = [...chunks.values()].find(call => {
      if (call.name !== "pifrost_probe") return false;
      try { return JSON.parse(call.arguments).value === "ok"; } catch { return false; }
    });
    if (!parsed) throw new Error("Forced tool: no complete pifrost_probe argument object");
    console.log("[OK] Forced tool: complete streamed arguments");
  } else console.log("[SKIP] Forced tool test: PIFROST_CONFORMANCE_TOOL_MODEL not set");
  console.log("Live transport conformance passed. Tests made explicit real inference requests.");
} catch (error) {
  console.error(`Live transport conformance failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
