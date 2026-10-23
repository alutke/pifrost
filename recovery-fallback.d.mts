export function configuredRecoveryFallbackRole(value:unknown):string|null;
export function recoveryFamilyCandidate<T extends {provider:string;id:string}>(
 current:T|undefined, target:T|undefined, family:(model:T)=>unknown
):boolean;
