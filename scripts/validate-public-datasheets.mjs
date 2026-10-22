const pricingUrl = "https://getbifrost.ai/datasheet";
const parametersUrl = "https://getbifrost.ai/datasheet/model-parameters";

async function json(url) {
  // Read-only public canary: bound transient provider failures but never
  // convert a persistent failure or invalid datasheet into a passing test.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        const error = new Error(`${url} returned HTTP ${response.status}`);
        if (![429,500,502,503,504].includes(response.status)) throw error;
        if (attempt === 3) throw error;
      } else {
        const body = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${url} did not return an object`);
        return body;
      }
    } catch (error) {
      const transient = /(?:fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|timed out|aborted|HTTP (?:429|500|502|503|504))/iu.test(
        error instanceof Error ? error.message : String(error));
      if (!transient || attempt === 3) throw error;
    }
    console.warn(`Transient Bifrost datasheet failure (attempt ${attempt}/3); retrying after bounded backoff`);
    await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`${url} data was not available after bounded retries`);
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
  console.log(`pricing ${family}: ${matches.length ? matches.slice(0, 5).join(", ") : "MISSING"}`);
  if (!matches.length) process.exitCode = 1;
}

for (const family of ["deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna", "gpt-5.6-terra"]) {
  const matches = parameterKeys.filter((key) => key.includes(family));
  console.log(`parameters ${family}: ${matches.length ? matches.slice(0, 5).join(", ") : "MISSING"}`);
  if (!matches.length) process.exitCode = 1;
}

const mimoParameterMatches = parameterKeys.filter((key) => key.includes("mimo-v2.5"));
console.log(`parameters mimo-v2.5: ${mimoParameterMatches.length ? mimoParameterMatches.slice(0, 5).join(", ") : "not published (vendor hint used)"}`);
console.log(`pricing rows: ${pricingKeys.length}`);
console.log(`parameter rows: ${parameterKeys.length}`);
