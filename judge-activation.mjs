import { isDeepStrictEqual } from "node:util";
import { reconcilePifrostOmpSetting } from "./omp-profile-merge.mjs";

/** Native judge roles are not filtered by OMP enabledModels; update only modelRoles. */
export function planJudgeRoleActivation(read, selector) {
  if (typeof selector!=="string" || !/^bifrost-judge\/[a-z0-9._-]+$/i.test(selector))
    throw new Error("Unrecognised native judge selector");
  const result=read("modelRoles");
  if (result?.status!=="ok") throw new Error("Cannot read OMP modelRoles safely");
  const previous=result.value;
  if (!previous || typeof previous!=="object" || Array.isArray(previous) ||
      Object.values(previous).some(x=>typeof x!=="string"))
    throw new Error("Invalid modelRoles: expected string selectors");
  return { previous: structuredClone(previous),
    next: reconcilePifrostOmpSetting("modelRoles",previous,{judge:selector}) };
}

/** Guarded write, read-back and best-effort rollback. Never overwrite a concurrent edit. */
export function applyJudgeRoleActivation({read,write,selector,backup}) {
  const {previous,next}=planJudgeRoleActivation(read,selector);
  if(isDeepStrictEqual(previous,next))return {changed:false};
  if(!isDeepStrictEqual(planJudgeRoleActivation(read,selector).previous,previous))
    throw new Error("OMP modelRoles changed before write; retry");
  const backupPath=backup();
  try {
    write("modelRoles",next);
    const current=planJudgeRoleActivation(read,selector).previous;
    if(!isDeepStrictEqual(current,next))throw new Error("OMP role write failed read-back validation");
    return {changed:true,backup:backupPath};
  }catch(error){
    let restored=false;
    try{
      const current=planJudgeRoleActivation(read,selector).previous;
      if(isDeepStrictEqual(current,next)){
        write("modelRoles",previous);
        restored=isDeepStrictEqual(planJudgeRoleActivation(read,selector).previous,previous);
      }else if(isDeepStrictEqual(current,previous))restored=true;
    }catch{}
    throw new Error("Judge role update failed; "+(restored?"previous role restored.":"automatic rollback unsafe or failed.")+
      (backupPath?" Backup: "+backupPath:" Inspect OMP configuration.")+
      " Cause: "+(error instanceof Error?error.message:String(error)));
  }
}
