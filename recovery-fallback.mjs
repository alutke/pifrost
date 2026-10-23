/**
 * Optional stage-three switch to an explicitly configured OMP role.
 * Do not infer Bifrost physical-family differences from logical aliases.
 */
export function configuredRecoveryFallbackRole(value) {
  if (typeof value!=="string" || !/^@[a-z][a-z0-9_-]{0,62}$/iu.test(value.trim())) return null;
  return value.trim();
}
export function recoveryFamilyCandidate(current,target,family) {
  if(!current || !target || typeof family!=="function")return false;
  if(current.provider===target.provider && current.id===target.id)return false;
  try {
    const a=family(current),b=family(target);
    return a !== null && a !== undefined && b !== null && b !== undefined && a !== b;
  } catch {return false;}
}
