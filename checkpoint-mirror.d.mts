import type {ExecutionCheckpoint} from "./execution-checkpoint.mjs";
export function mirrorCheckpoint(state:ExecutionCheckpoint,options?:{baseDir?:string}):string;
export function commitExecutionCheckpoint(state:ExecutionCheckpoint,options:{appendEntry:(type:string,data:ExecutionCheckpoint)=>unknown;mirror?:(state:ExecutionCheckpoint)=>unknown;onMirrorError?:(error:unknown)=>void;}):ExecutionCheckpoint;
