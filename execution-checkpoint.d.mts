export interface ExecutionCheckpoint {
  schemaVersion:1; sessionKey:string; workspaceKey:string; revision:number; updatedAt:string;
  status:"active"|"complete"|"superseded";
  plan:{reference:string;origin:"operator"|"session";sha256?:string;characters?:number};
  steps:Array<{id:string;status:"attempted"|"verified"|"failed";evidence?:string}>;
  lastObservation:null|{kind:"tool-results-observed";count:number;at:string;note:string};
  pendingVerification:boolean;
  verificationAuthority:"explicit-evidence-only";
}
export const PIFROST_CHECKPOINT_TYPE:"dev.pifrost.execution-checkpoint.v1";
export function createExecutionCheckpoint(o:{sessionId:string;cwd:string;planReference?:string;promptText?:string}):ExecutionCheckpoint;
export function validExecutionCheckpoint(value:unknown,identity?:{sessionId:string;cwd:string}):value is ExecutionCheckpoint;
export function restoreExecutionCheckpoint(branch:readonly unknown[],identity:{sessionId:string;cwd:string}):ExecutionCheckpoint|null;
export function transitionExecutionCheckpoint(state:ExecutionCheckpoint,action:{type:"attempt"|"verify"|"fail"|"complete"|"supersede";step?:string;evidence?:string}):ExecutionCheckpoint;
export function observeExecutionTurn(state:ExecutionCheckpoint,messages:readonly unknown[]):ExecutionCheckpoint;
export function checkpointResumeText(state:ExecutionCheckpoint):string;
export function checkpointSummary(state:ExecutionCheckpoint|null):string;
