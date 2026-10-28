/** Opt-in OMP command-only integration. No runtime provider or event hooks. */
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ompAgentDir } from "./cli-lib.mjs";

const SOURCE=new URL("./omp-commands.js",import.meta.url);
const marker="PIFROST-COMMAND-PALETTE-V1";
const hash=text=>createHash("sha256").update(text).digest("hex");
export function commandPaths(env=process.env) {
  const directory=join(ompAgentDir(env),"extensions");
  return {file:join(directory,"pifrost-commands.js"),
    record:join(directory,".pifrost-commands.manifest.json")};
}
function regular(path) {
  if(existsSync(path)&&!lstatSync(path).isFile())
    throw Error("Refusing to modify non-regular file: "+path);
}
function readRecord(record) {
  regular(record);
  if(!existsSync(record))return undefined;
  let r;
  try{r=JSON.parse(readFileSync(record,"utf8"));}
  catch{throw Error("Invalid command-palette ownership manifest. No changes made.");}
  if(r?.owner!=="pifrost-command-palette-v1"||!/^[0-9a-f]{64}$/u.test(r.sha256))
    throw Error("Unrecognised ownership manifest. No changes made.");
  return r;
}
function owned(file,record) {
  if(!existsSync(file))return !record;
  if(!record)return false;
  regular(file);
  const content=readFileSync(file,"utf8");
  return content.includes(marker)&&hash(content)===record.sha256;
}
function atomic(path,content) {
  const temp=path+".pifrost-"+randomUUID()+".tmp";
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try{writeFileSync(fd,content);fsyncSync(fd);}
  finally{closeSync(fd);}
  renameSync(temp,path);
}
export function commandStatus(env=process.env) {
  const {file,record}=commandPaths(env);
  const existing=readRecord(record);
  if(!existsSync(file))return {status:existing?"drift":"disabled",file};
  return {status:owned(file,existing)?"enabled":"unmanaged",file};
}
export function enableCommands(env=process.env) {
  const {file,record}=commandPaths(env);
  const current=commandStatus(env);
  if(current.status!=="disabled"&&current.status!=="enabled")
    throw Error("Existing command palette is unowned, changed, or in an inconsistent state; refusing to overwrite.");
  const content=readFileSync(SOURCE,"utf8");
  if(!content.includes(marker))throw Error("Command palette source is invalid.");
  if(current.status==="enabled"&&hash(readFileSync(file,"utf8"))===hash(content))
    return {changed:false,file};
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const backup=current.status==="enabled"?file+".backup-"+randomUUID():undefined;
  if(backup)copyFileSync(file,backup,constants.COPYFILE_EXCL);
  atomic(file,content);
  atomic(record,JSON.stringify({owner:"pifrost-command-palette-v1",sha256:hash(content)},null,2)+"\n");
  return {changed:true,file,backup};
}
export function disableCommands(env=process.env) {
  const {file,record}=commandPaths(env);
  const current=commandStatus(env);
  if(current.status==="disabled")return {changed:false,file};
  if(current.status!=="enabled")throw Error("Palette is unmanaged/modified; refusing to delete.");
  const backup=file+".backup-"+randomUUID();
  copyFileSync(file,backup,constants.COPYFILE_EXCL);
  rmSync(file);
  rmSync(record);
  return {changed:true,file,backup};
}
