/**
 * Migration from 0.29 role-map takeover to 0.30 native OMP ownership.
 * Never changes non-Pifrost roles or task/retry/compaction settings.
 */
export const OLD_PIFROST_ROLES = Object.freeze({
  default:"bifrost/omp-default", smol:"bifrost/omp-smol",
  task:"bifrost/omp-task", advisor:"bifrost/omp-advisor",
  slow:"bifrost/omp-slow", plan:"bifrost/omp-plan",
  designer:"bifrost/omp-designer", vision:"bifrost/omp-vision",
  commit:"bifrost/omp-commit", tiny:"bifrost/omp-tiny",
});
const object=v=>v&&typeof v==="object"&&!Array.isArray(v);

export function planLegacyOmpCleanup(current) {
  if (!current || !object(current.modelRoles) ||
      !Array.isArray(current.enabledModels) || !Array.isArray(current.modelProviderOrder)) {
    throw new Error("OMP migration cannot safely read modelRoles, enabledModels and modelProviderOrder.");
  }
  const roles={...current.modelRoles};
  let removed=0;
  for(const [role,id] of Object.entries(OLD_PIFROST_ROLES)){
    if(roles[role]===id){delete roles[role];removed++;}
  }
  const changes=[];
  if(removed) {
    changes.push({key:"modelRoles",method:Object.keys(roles).length?"set":"reset",
      before:current.modelRoles,after:roles});
    // Only remove the historical Pifrost-installed wildcard/provider order
    // when we have corroborating evidence that Pifrost owned modelRoles.
    const models=current.enabledModels.filter(x=>x!=="bifrost/*");
    if(models.length!==current.enabledModels.length)changes.push({
      key:"enabledModels",method:models.length?"set":"reset",before:current.enabledModels,after:models});
    const order=current.modelProviderOrder.filter(x=>x!=="bifrost");
    if(order.length!==current.modelProviderOrder.length)changes.push({
      key:"modelProviderOrder",method:order.length?"set":"reset",
      before:current.modelProviderOrder,after:order});
  }
  return {removedRoles:removed,changes,warnings:[
    "The old Pifrost OMP plugin/extension may still be installed. Disable or uninstall it through OMP's plugin manager.",
    "Pifrost does not infer ownership of task, retry, fallback, or compaction settings; review those in OMP separately.",
    ...(removed===0?["No exact historical Pifrost role assignments detected; ambiguous settings were left unchanged."]:[]),
  ]};
}
