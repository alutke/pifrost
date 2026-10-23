export function configuredRecoveryFallbackRole(value:unknown):string|null;
export function recoveryFamilyCandidate(current:{provider:string;id:string}|undefined,
 target:{provider:string;id:string}|undefined, family:(model:{provider:string;id:string})=>unknown):boolean;
