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

// MiMo is currently present in the pricing/architecture catalog but not in the
// model-parameters feed. Pifrost therefore uses its authoritative context/output/
// modality data and conservatively does not invent selectable reasoning efforts.
const mimoParameterMatches = parameterKeys.filter((key) => key.includes("mimo-v2.5"));
console.log(`parameters mimo-v2.5: ${mimoParameterMatches.length ? mimoParameterMatches.slice(0, 8).join(", ") : "not published (allowed)"}`);

console.log(`pricing rows: ${pricingKeys.length}`);
console.log(`parameter rows: ${parameterKeys.length}`);
