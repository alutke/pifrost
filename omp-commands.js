// PIFROST-COMMAND-PALETTE-V1
// Opt-in, command-only OMP extension. No hooks, tools, provider registration,
// conversation messages, automatic model mapping, or LLM traffic handling.
const HELP = [
  "Pifrost (optional Bifrost integration)",
  "  /pifrost                 Open the compact menu",
  "  /pifrost status          Gateway and connection health",
  "  /pifrost models          Native Bifrost model integration status",
  "  /pifrost models list     List available Bifrost models",
  "  /pifrost models enable [completions|responses]   Opt in to manual selection",
  "  /pifrost models disable  Remove optional Bifrost model registration",
  "  /pifrost repo            Repo MCP/Skills status",
  "  /pifrost mcp             Repo MCP client inventory",
  "  /pifrost mcp add NAME TOOLS       Add explicit allowed tools (comma-separated)",
  "  /pifrost mcp remove NAME",
  "  /pifrost vmcp            Available Virtual MCP bundles",
  "  /pifrost vmcp add NAME   /pifrost vmcp remove NAME",
  "  /pifrost skills          Bifrost Skills catalogue",
  "  /pifrost skills add NAME /pifrost skills sync [NAME]",
  "  /pifrost skills remove NAME",
  "  /pifrost migrate        Preview cleanup of legacy model roles",
  "  /pifrost commands       Slash-command integration status",
  "Changes require confirmation. For initial setup use pifrost init / pifrost repo init in a terminal.",
].join("\n");
const MENU = ["Status", "Models", "MCPs", "Skills", "Migration", "Help"];
const MENU_ROUTES = {Status:"status",Models:"models",MCPs:"mcp",Skills:"skills",Migration:"migrate",Help:"help"};
const CAP = 2600;
function words(text) {
  if (text.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw Error("Invalid or oversized input.");
  const output=[]; let word="";let quote="";let escaped=false;let started=false;
  for(const ch of text) {
    if(escaped){word+=ch;escaped=false;started=true;continue;}
    if(ch==="\\"){escaped=true;started=true;continue;}
    if(quote){if(ch===quote)quote="";else word+=ch;continue;}
    if(ch==="'"||ch==='"'){quote=ch;started=true;continue;}
    if(/\s/u.test(ch)){if(started){output.push(word);word="";started=false;}continue;}
    word+=ch;started=true;
  }
  if(escaped||quote)throw Error("Unclosed quote or escape.");
  if(started)output.push(word);
  return output;
}
function asName(tokens,usage) {
  const name=tokens.join(" ").trim();
  if(!name||name.length>128||name.startsWith("--"))throw Error("Usage: "+usage);
  return name;
}
function resolve(tokens) {
  const [group,action,...rest]=tokens;
  if(!group||group==="help")return {help:true};
  if(group==="status"||group==="doctor")return {argv:["doctor"],read:true};
  if(group==="models"){
    if(!action||action==="status")return {argv:["models","status"],read:true};
    if(action==="list")return {argv:["models","list"],read:true};
    if(action==="enable"){
      if(rest.length>1||rest[0]&&!["completions","responses"].includes(rest[0]))throw Error("Use /pifrost models enable [completions|responses]");
      return {argv:["models","enable",...(rest.length?["--api",rest[0]]:[])],confirm:"Enable optional Bifrost models? OMP model roles remain unchanged."};
    }
    if(action==="disable"&&rest.length===0)return {argv:["models","disable"],confirm:"Remove Pifrost-managed Bifrost model discovery? Native OMP models are unaffected."};
  }
  if(group==="repo"&&!action)return {argv:["repo","status"],read:true};
  if(group==="commands"&&!action)return {argv:["omp","commands","status"],read:true};
  if(group==="migrate"&&!action||group==="migrate"&&action==="status")return {argv:["migrate","status"],read:true};
  if(group==="mcp"){
    if(!action||action==="list")return {argv:["repo","mcp","list"],read:true};
    if(action==="add"){
      if(rest.length!==2||!rest[1]||rest[1].startsWith("--"))throw Error("Usage: /pifrost mcp add CLIENT tool1,tool2");
      return {argv:["repo","mcp","add",rest[0],"--tools",rest[1]],
        confirm:"Grant only these MCP tools to the current repository: "+rest[0]+" / "+rest[1]+"?"};
    }
    if(action==="remove") {
      const name=asName(rest,"/pifrost mcp remove CLIENT");
      return {argv:["repo","mcp","remove",name],confirm:"Remove MCP client "+name+" from this repository?"};
    }
  }
  if(group==="vmcp"){
    if(!action||action==="list")return {argv:["repo","vmcp","list"],read:true};
    if(action==="add"||action==="remove"){
      const name=asName(rest,"/pifrost vmcp "+action+" BUNDLE");
      return {argv:["repo","vmcp",action,name],
        confirm:(action==="add"?"Grant":"Remove")+" Virtual MCP bundle '"+name+"' for this repository?"};
    }
  }
  if(group==="skills"){
    if(!action||action==="list")return {argv:["repo","skills","list"],read:true};
    if(["add","remove","sync"].includes(action)){
      if(action!=="sync"&&rest.length===0)throw Error("Usage: /pifrost skills "+action+" NAME");
      const name=rest.length?asName(rest,"/pifrost skills "+action+" NAME"):undefined;
      return {argv:["repo","skills",action,...(name?[name]:[])],
        confirm:(action==="remove"?"Remove":action==="sync"?"Synchronise":"Install")+" "+(name||"all managed Skills")+" in this repository?"};
    }
  }
  throw Error("Unknown Pifrost command. Use /pifrost help.");
}
function clip(text) {
  const safe=String(text||"").trim()
    .replace(/Bearer\s+\S+/giu,"Bearer [redacted]")
    .replace(/\b(?:sk|vk|bf|ghp|gho|ghs|ghu|github_pat)-[A-Za-z0-9_-]{8,}\b/giu,"[redacted]")
    .replace(/\b(?:x-bf-vk|authorization|api[_-]?key|virtual[_-]?key|password|access[_-]?token|secret)\b\s*[:=]\s*["']?[^"',}\s]+/giu,"[redacted]")
    .replace(/(https?:\/\/)[^/\s@]+@/giu,"$1[redacted]@")
    .replace(/([?&](?:token|api_key|key|secret|password)=)[^&\s]+/giu,"$1[redacted]");
  return safe.length>CAP?safe.slice(0,CAP)+"\n… (truncated; use the Pifrost CLI to see all results)":safe;
}
export async function runPifrostSlash(raw, ctx, run) {
  let tokens;
  try {tokens=words(String(raw||"").trim());}
  catch(e){ctx.ui.notify(String(e.message),"warning");return;}
  if(!tokens.length&&ctx.hasUI&&ctx.ui?.select){
    const choice=await ctx.ui.select("Pifrost",MENU);
    if(!choice)return;
    tokens=[MENU_ROUTES[choice]];
  }
  let route;
  try{route=resolve(tokens);}
  catch(e){ctx.ui.notify(e.message,"warning");return;}
  if(route.help){ctx.ui.notify(HELP,"info");return;}
  if(route.confirm){
    if(!ctx.hasUI||!ctx.ui?.confirm){ctx.ui.notify("Use the Pifrost CLI for changes without an interactive OMP UI.","warning");return;}
    if(!await ctx.ui.confirm("Pifrost — confirm change",route.confirm))return;
  }
  try {
    const result=await run(route.argv,ctx.cwd);
    if(result.killed){ctx.ui.notify("Pifrost command timed out. No completion is assumed.","warning");return;}
    if(result.code!==0){
      // Gateway error bodies may contain arbitrary credentials; do not send
      // stderr to OMP's persistent interactive notification surface.
      ctx.ui.notify("Pifrost command failed (exit "+result.code+"). Run the equivalent CLI command to inspect details.","error");
      return;
    }
    const output=clip(result.stdout);
    ctx.ui.notify(output||"Completed.","info");
  }catch(e){ctx.ui.notify("Could not run Pifrost CLI: "+clip(e.message),"error");}
}
export default function registerPifrost(pi) {
  pi.registerCommand("pifrost",{
    description:"Bifrost models, repository MCPs and Skills (opt-in, no runtime hooks)",
    getArgumentCompletions(prefix){
      const candidates=["help","status","models","models list","models enable","models disable",
        "repo","mcp","mcp add","mcp remove","vmcp","vmcp add","vmcp remove",
        "skills","skills add","skills sync","skills remove","migrate","commands"];
      const p=prefix.toLowerCase();return candidates.filter(x=>x.startsWith(p)).map(x=>({value:x,label:x})); 
    },
    async handler(args,ctx) {
      return runPifrostSlash(args,ctx,(argv,cwd)=>pi.exec("pifrost",argv,{cwd,timeout:20000}));
    },
  });
}
