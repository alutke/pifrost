export type RecoveryStage = "native"|"context"|"model";
export interface RecoveryAttemptRecord {
  schemaVersion:1|2;
  sessionKey:string;
  anchor:string;
  ordinal:number;
  stage:RecoveryStage;
  assistantEntryId:string;
  reason:string;
  episodeKey?:string;
  proof?:{kind:"initial"|"paired-tool"|"verified-step"|"user-resume";entryId:string;fingerprint:string};
}
export interface RecoveryResult {
  action:"none"|"notice"|"continue"|"exhausted";
  reason:string;
  attempts:number;
  stage?:RecoveryStage;
  additionalContext?:string;
  record?:RecoveryAttemptRecord;
  contextPressure?:boolean;
  episodeKey?:string;
}
export const PIFROST_RECOVERY_ATTEMPT_TYPE:"dev.pifrost.recovery-attempt.v1";
export const DEFAULT_RECOVERY_CONTINUATIONS:2;
export const MAX_RECOVERY_CONTINUATIONS:3;
export function intelligentRecoveryMode(explicit?:string,previous?:string):"auto"|"notice"|"off";
export function locateRecoveryScope(branch:readonly unknown[],sessionId:string,cwd:string):
  {anchor:string;checkpoint:import("./execution-checkpoint.mjs").ExecutionCheckpoint}|null;
export function readRecoveryAttempts(branch:readonly unknown[],scope:{anchor:string},sessionId:string,cwd?:string):
  RecoveryAttemptRecord[]|null;
export function planIntelligentRecovery(options:{
  event:{
    session_id?:string;stop_hook_active?:boolean;signal?:AbortSignal;turn_id?:number;
    last_assistant_message?:unknown;messages?:readonly unknown[];
  };
  branch:readonly unknown[];sessionId:string;cwd:string;mode?:"auto"|"notice"|"off";
  uncertainTools?:boolean;queued?:boolean;running?:boolean;interrupted?:boolean;
  contextTokens?:number|null;contextWindow?:number|null;allowModelFallback?:boolean;
}):RecoveryResult;
export function formatIntelligentRecoveryStatus(options:{
  branch:readonly unknown[];sessionId:string;cwd:string;mode:string;
}):string;
