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
  if (!current || !object(current.modelRoles)) {
    throw new Error("OMP migration cannot safely read modelRoles.");
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
    // Historical Pifrost role ownership does not prove ownership of
    // enabledModels or modelProviderOrder; never remove user-selected values.

  }
  return {removedRoles:removed,changes,warnings:[
    "Disable the previous Pifrost runtime plugin separately, before restarting OMP.",
    "enabledModels and modelProviderOrder remain untouched even when they include bifrost/*.",
    "Pifrost does not infer ownership of task, retry, fallback, or compaction settings; review those in OMP separately.",
    ...(removed===0?["No exact historical Pifrost role assignments detected; ambiguous settings were left unchanged."]:[]),
  ]};
}
