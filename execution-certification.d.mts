export interface ExecutionDiagnosis {
 schemaVersion:1;checkpoint:string;stepsVerified:number;stepsAttempted:number;stepsFailed:number;
 pendingVerification:boolean|null;recoveryMode:string;recoveryAttemptCount:number|null;
 recoveryAttemptLimit:number;journalTrust:string;lastAssistantStop:string;
 contextTokens:number|null;contextSeverity:string;contextWindowVerified:false;taskCompleted:"unverified";
}
export function diagnoseExecutionBranch(options:{
 branch:readonly unknown[];sessionId:string;cwd:string;contextTokens?:number|null;
 contextWindow?:number|null;mode?:string;
}):Readonly<ExecutionDiagnosis>;
export function formatExecutionDiagnosis(report:ExecutionDiagnosis):string;
