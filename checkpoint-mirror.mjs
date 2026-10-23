/** Small atomic disk mirror; the OMP custom branch entry is authoritative. */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync, chmodSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validExecutionCheckpoint, PIFROST_CHECKPOINT_TYPE } from "./execution-checkpoint.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
export function mirrorCheckpoint(state, { baseDir } = {}) {
  if (!validExecutionCheckpoint(state)) throw new Error("Cannot mirror invalid checkpoint");
  const root = baseDir ?? join(homedir(),".config","pifrost","checkpoints");
  const folder = join(root,state.sessionKey);
  mkdirSync(folder,{recursive:true,mode:0o700});
  const bytes=JSON.stringify(state);
  const name=String(state.revision)+"-"+hash(bytes).slice(0,16)+".json";
  const final=join(folder,name);
  const temp=final+"."+randomBytes(8).toString("hex")+".tmp";
  let fd;
  try {
    fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    writeSync(fd,bytes+"\n"); fsyncSync(fd); closeSync(fd); fd=undefined;
    renameSync(temp,final);
    chmodSync(final,0o600);
    return final;
  } catch(e) {
    if(fd!==undefined) closeSync(fd);
    try { unlinkSync(temp); } catch {}
    throw e;
  }
}
/**
 * Keep branch-scoped OMP metadata authoritative, independent of LLM context.
 * Mirror failures never turn an uncommitted file into a reconstructed checkpoint.
 */
export function commitExecutionCheckpoint(state, {appendEntry,mirror = mirrorCheckpoint, onMirrorError=()=>{}} = {}) {
  if(!validExecutionCheckpoint(state)) throw new Error("Checkpoint validation failed before persistence");
  if(typeof appendEntry!=="function") throw new Error("OMP appendEntry unavailable; no checkpoint committed");
  appendEntry(PIFROST_CHECKPOINT_TYPE,state);
  try {mirror(state);} catch(error) {onMirrorError(error);}
  return state;
}
