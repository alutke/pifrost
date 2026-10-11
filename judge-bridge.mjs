/**
 * Release C: optional native OMP judge registration against Bifrost's
 * stable TypeSafe System One endpoint (Bifrost transports/v2.2.6).
 *
 * OMP's TypeSafeJudge owns judgment parsing, retry, caching, concurrency and
 * usage attribution. Bifrost owns provider selection, keys and governance.
 * This module only resolves the opt-in transport boundary.
 */
export const PIFROST_JUDGE_PROVIDER = "bifrost-judge";
export const PIFROST_JUDGE_ENV = "PIFROST_NATIVE_JUDGE_MODEL";

export function nativeJudgeSelection(env = process.env) {
  const raw = env[PIFROST_JUDGE_ENV];
  if (raw === undefined || raw.trim() === "") return undefined;
  const model = raw.trim().replace(/^typesafe\//i, "");
  // Other model kinds and providers must not be impersonated as a TypeSafe
  // native judgment API. Canonical Decisions has a different wire shape.
  if (!/^jev-[a-z0-9][a-z0-9._-]{0,90}$/i.test(model)) {
    throw new Error("PIFROST_NATIVE_JUDGE_MODEL must be a TypeSafe jev model (e.g. jev-latest or typesafe/jev-latest)");
  }
  return { model, selector: PIFROST_JUDGE_PROVIDER + "/" + model };
}

export function nativeJudgeGateway(config, env = process.env) {
  const selected = nativeJudgeSelection(env);
  if (!selected) return undefined;
  if (!config?.virtualKey || !/^sk-bf-[a-z0-9_-]+$/i.test(config.virtualKey)) {
    throw new Error("Optional native judge requires a Bifrost 2.x sk-bf-* Virtual Key; no judge provider was registered");
  }
  let url;
  try { url = new URL(config.url); }
  catch { throw new Error("Cannot register native judge: Bifrost URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash ||
      !/^\/v1\/?$/.test(url.pathname) || url.username || url.password) {
    throw new Error("Cannot register native judge: expected Bifrost /v1 base URL without credentials or query");
  }
  // Native OMP TypeSafeJudge calls baseUrl + /v1/systemone.
  // Bifrost exposes /typesafe/v1/systemone, with native response shape.
  return {
    ...selected,
    provider: PIFROST_JUDGE_PROVIDER,
    baseUrl: url.origin + "/typesafe",
    virtualKey: config.virtualKey,
  };
}

/**
 * Only a caller-explicit inference probe may send billed judgment requests.
 * Validate without logging user state, response payloads or credentials.
 */
export function validateNativeJudgeResponse(body, questions) {
  if (!body || typeof body !== "object" || typeof body.model !== "string" ||
      !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
    throw new Error("Bifrost native judge returned an invalid System One response envelope");
  }
  for (const [id, kind] of Object.entries(questions)) {
    const answer = body.answers[id];
    if (!answer || answer.type !== kind) {
      throw new Error("Bifrost native judge response is missing a " + kind + " answer for " + id);
    }
    if (kind === "noul" && !(typeof answer.noul === "number" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1)) {
      throw new Error("Bifrost native judge response has an invalid noul probability for " + id);
    }
    if (kind === "choice" && (typeof answer.choice !== "string" ||
        !answer.probabilities || typeof answer.probabilities !== "object" ||
        !(typeof answer.confidence === "number" && Number.isFinite(answer.confidence)))) {
      throw new Error("Bifrost native judge response has an invalid choice answer for " + id);
    }
    if (kind === "score" && !(typeof answer.score === "number" && Number.isFinite(answer.score)) ||
        kind === "score" && (!answer.probabilities || typeof answer.probabilities !== "object")) {
      throw new Error("Bifrost native judge response has an invalid score answer for " + id);
    }
  }
  return { model: body.model, answered: Object.keys(questions).length, hasUsage: Boolean(body.usage) };
}

export function nativeJudgeProbeRequest(model) {
  return {
    model,
    state: "The response is delayed and the customer requests a refund.",
    questions: {
      urgent: { type: "noul", instructions: "Is the customer asking for an immediate response?" },
      category: {
        type: "choice",
        instructions: "Choose the reason for this request.",
        criteria: { refund: "Request for refund", technical: "Product technical issue" },
      },
      severity: {
        type: "score",
        instructions: "Rate importance on this two-level scale.",
        criteria: ["routine", "urgent"],
      },
    },
  };
}

export function parseNativeJudgeModelsResponse(body) {
  if (!body || !Array.isArray(body.models)) throw new Error("Bifrost native judge models endpoint returned an invalid response");
  const names = body.models.map(item => item?.name);
  if (!names.every(name => typeof name === "string" && name.trim().length > 0)) {
    throw new Error("Bifrost native judge models response contains invalid entries");
  }
  return [...new Set(names)];
}
