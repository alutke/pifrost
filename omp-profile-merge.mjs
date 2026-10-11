/**
 * Non-destructive OMP settings profile reconciliation.
 * Pifrost owns the named Bifrost role entries and its provider preferences,
 * not other OMP roles, enabled namespaces or provider ordering choices.
 *
 * Fail closed if OMP's existing setting cannot be parsed/read. A blind
 * overwrite would erase user-defined roles and model presets.
 */
function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cannot safely merge " + name + ": existing OMP setting is not a record");
  }
  if (!Object.values(value).every(item => typeof item === "string")) {
    throw new Error("Cannot safely merge " + name + ": contains non-string model selectors");
  }
  return value;
}
function list(value, name) {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
    throw new Error("Cannot safely merge " + name + ": existing OMP setting is not a string array");
  }
  return value;
}
export function reconcilePifrostOmpSetting(id, existing, desired) {
  if (id === "modelRoles") {
    const current = record(existing, id);
    const requested = record(desired, id);
    return { ...current, ...requested };
  }
  if (id === "modelProviderOrder") {
    const current = list(existing, id);
    const requested = list(desired, id);
    // Bifrost takes priority, but every other provider retains relative order.
    return [...new Set([...requested, ...current])];
  }
  if (id === "enabledModels") {
    const current = list(existing, id);
    const requested = list(desired, id);
    return [...new Set([...current, ...requested])];
  }
  return desired;
}
export function reconcilePifrostOmpJson(id, existing, content) {
  let desired;
  try { desired = JSON.parse(content); }
  catch { throw new Error("Cannot safely merge " + id + ": proposed setting is not valid JSON"); }
  return JSON.stringify(reconcilePifrostOmpSetting(id, existing, desired));
}
