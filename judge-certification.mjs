/**
 * Release 5F read-only judgment certification evidence.
 * Model inventory and OMP wire/model bounds are different authorities.
 * Never register a provider, trigger a judgment, or claim route success here.
 */
export function nativeJudgeCapabilityEvidence(judge, bounds) {
  if (!judge) return { status: "disabled", boxQuestions: "unavailable", imageBounds: "unavailable" };
  const selected = String(judge.model ?? "").toLowerCase();
  const images = judge.imageEnabled === true;
  const boxes = judge.api === "typesafe" && images && selected === "jev-1.14.0";
  const validBounds = bounds && typeof bounds === "object" && !Array.isArray(bounds);
  const numericFields = ["maxCount", "maxBytes", "maxTotalBytes", "maxPixels", "minPixels", "minSide", "maxSide"];
  const limits = validBounds
    ? Object.fromEntries(numericFields.filter(field => Number.isSafeInteger(bounds[field]) && bounds[field] > 0)
        .map(field => [field, bounds[field]]))
    : undefined;
  const mimeTypes = validBounds && Array.isArray(bounds.mimeTypes)
    ? bounds.mimeTypes.filter(x => typeof x === "string" && /^image\/(?:png|jpeg|webp)$/u.test(x))
    : undefined;
  return {
    status: "configured-not-probed",
    imageInput: images ? "enabled-for-native-OMP" : "disabled",
    imageBounds: images ? validBounds ? "resolved-from-omp" : "unverified" : "unavailable",
    ...(images && validBounds ? { bounds: { ...limits, ...(mimeTypes ? { mimeTypes } : {}) } } : {}),
    boxQuestions: boxes ? "eligible-not-live-verified" : !images || judge.api !== "typesafe" ? "unavailable" : "unverified-version",
    execution: "not-tested",
  };
}

/**
 * A Bifrost /v1/models list can establish visibility only. Azure and
 * Databricks decisions still require separately approved /v1/decisions calls.
 */
export function decisionProviderInventory(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Bifrost decision inventory response has no data array");
  }
  const rows = [];
  for (const provider of ["azure", "databricks"]) {
    const models = payload.data
      .filter(item => item && typeof item.id === "string" &&
        item.id.toLowerCase().startsWith(provider + "/"))
      .map(item => item.id)
      .filter(id => /^[a-z0-9@._:/-]{1,128}$/iu.test(id))
      .slice(0, 30);
    rows.push({ provider, listedModels: [...new Set(models)], status: models.length ? "listed-not-decision-verified" : "not-listed", verifiedExecution: false });
  }
  return { source: "bifrost-read-only-models", providers: rows, decisionEndpoint: "unverified" };
}
