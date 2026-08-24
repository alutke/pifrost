const pricingUrl = "https://getbifrost.ai/datasheet";
const parametersUrl = "https://getbifrost.ai/datasheet/model-parameters";

async function json(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${url} did not return an object`);
  return body;
}

const [pricing, parameters] = await Promise.all([json(pricingUrl), json(parametersUrl)]);
const pricingKeys = Object.keys(pricing).map((key) => key.toLowerCase());
const parameterKeys = Object.keys(parameters).map((key) => key.toLowerCase());

const requiredPricingFamilies = [
  "kimi-k2.7-code",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "mimo-v2.5",
  "glm-5.2",
  "laguna-s-2.1",
];

for (const family of requiredPricingFamilies) {
  const matches = pricingKeys.filter((key) => key.includes(family));
  console.log(`pricing ${family}: ${matches.length ? matches.slice(0, 8).join(", ") : "MISSING"}`);
  if (!matches.length) process.exitCode = 1;
}

for (const family of ["deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna", "gpt-5.6-terra"]) {
  const matches = parameterKeys.filter((key) => key.includes(family));
  console.log(`parameters ${family}: ${matches.length ? matches.slice(0, 8).join(", ") : "MISSING"}`);
  if (!matches.length) process.exitCode = 1;
}

const mimoParameterMatches = parameterKeys.filter((key) => key.includes("mimo-v2.5"));
console.log(`parameters mimo-v2.5: ${mimoParameterMatches.length ? mimoParameterMatches.slice(0, 8).join(", ") : "not published (allowed)"}`);

for (const key of [
  "opencode-go/mimo-v2.5",
  "openrouter/xiaomi/mimo-v2.5",
  "openrouter/xiaomi/mimo-v2.5-pro",
  "gpt-5.6-luna",
  "deepseek/deepseek-v4-pro",
]) {
  if (pricing[key]) {
    const row = pricing[key];
    console.log(`ROW pricing ${key}: ${JSON.stringify({
      context_length: row.context_length,
      max_input_tokens: row.max_input_tokens,
      max_output_tokens: row.max_output_tokens,
      architecture: row.architecture,
      provider: row.provider,
      base_model: row.base_model,
    })}`);
  }
}

for (const key of ["gpt-5.6-luna", "deepseek/deepseek-v4-pro", "azure/deepseek-v4-pro"]) {
  if (parameters[key]) {
    const row = parameters[key];
    console.log(`ROW parameters ${key}: ${JSON.stringify({
      supports_reasoning: row.supports_reasoning,
      supports_reasoning_effort: row.supports_reasoning_effort,
      reasoning_effort_levels: row.reasoning_effort_levels,
      reasoning_effort_renames: row.reasoning_effort_renames,
      supports_function_calling: row.supports_function_calling,
      is_reasoning_model: row.is_reasoning_model,
      always_reasoning: row.always_reasoning,
      reasoning_required: row.reasoning_required,
    })}`);
  }
}

console.log(`pricing rows: ${pricingKeys.length}`);
console.log(`parameter rows: ${parameterKeys.length}`);
