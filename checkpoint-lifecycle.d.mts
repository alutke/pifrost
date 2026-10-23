import type {ExecutionCheckpoint} from "./execution-checkpoint.mjs";
export interface CheckpointHostContext {
  cwd:string;
  agent:{kind:"main"|"sub"};
  sessionManager:{getSessionId():string;getBranch():readonly unknown[]};
}
export interface CheckpointLifecycle {
  read(ctx:CheckpointHostContext):ExecutionCheckpoint|null;
  restore(ctx:CheckpointHostContext):ExecutionCheckpoint|null;
  begin(ctx:CheckpointHostContext,reference?:string,promptText?:string):ExecutionCheckpoint;
  autoBegin(ctx:CheckpointHostContext,prompt:string):ExecutionCheckpoint|null;
  transition(ctx:CheckpointHostContext,action:{type:"attempt"|"verify"|"fail"|"complete"|"supersede";step?:string;evidence?:string}):ExecutionCheckpoint;
  afterTurn(ctx:CheckpointHostContext):ExecutionCheckpoint|null;
  compactionContext(ctx:CheckpointHostContext):string|null;
  status(ctx:CheckpointHostContext):string;
  resumeText(ctx:CheckpointHostContext):string;
}
export function createCheckpointLifecycle(options:{
 appendEntry:(type:string,data:ExecutionCheckpoint)=>unknown;
 mirror?:(state:ExecutionCheckpoint)=>unknown;
 onMirrorError?:(error:unknown)=>void;
}):CheckpointLifecycle;
