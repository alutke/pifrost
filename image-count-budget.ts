/** Optional image-count request limit advertised explicitly by a Bifrost gateway. */
export function verifiedImageCountBudget(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 10000
    ? value : undefined;
}
/** Two optional gateway extensions; conflicting or invalid values are ignored. */
export function gatewayImageCountBudget(value: {
  image_count_budget?: unknown;
  per_request_limits?: { images?: unknown };
}): number | undefined {
  const supplied = [value.image_count_budget, value.per_request_limits?.images].filter(x=>x!==undefined);
  if(!supplied.length) return undefined;
  const parsed=supplied.map(verifiedImageCountBudget);
  if(parsed.some(x=>x===undefined) || new Set(parsed).size!==1)return undefined;
  return parsed[0];
}
export interface ImageBudgetMember {
  input: readonly string[];
  imageCountBudget?: number;
  capabilitySources?: { imageCountBudget?: string };
}
/** A mixed gateway route can only promise the minimum of ALL verified eligible members. */
export function conservativeRouteImageCountBudget(members: readonly ImageBudgetMember[]): number | undefined {
  if (!members.length || members.some(m=> !m.input.includes("image") ||
      m.capabilitySources?.imageCountBudget!=="live" || verifiedImageCountBudget(m.imageCountBudget)===undefined)) return undefined;
  return Math.min(...members.map(m=>m.imageCountBudget!));
}
