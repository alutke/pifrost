/**
 * CLI grammar, ownership, help and pre-execution validation.
 * Unknown or duplicate options are rejected before any writes.
 */
const common = {verbose:"boolean",strict:"boolean",json:"boolean"};
const view=(summary,min=0,max=min,flags={})=>({summary,min,max,flags:{...common,...flags},effect:"Read-only"});
const write=(summary,min=0,max=min,flags={},effect="Changes local configuration")=>({summary,min,max,flags,effect});
const setupFlags={url:"string","api-key":"string","virtual-key":"string","management-auth":"string","management-username":"string","management-password":"string","management-key":"string","setup-token":"string","skip-omp":"boolean","skip-test":"boolean",yes:"boolean","dry-run":"boolean"};
export const COMMAND_SPEC=Object.freeze({
"init":write("Install and configure Pifrost",0,0,setupFlags,"Changes local and gateway configuration"),
"global setup":write("Configure gateway credentials and OMP settings",0,0,setupFlags),
"global status":view("Show gateway status"),
"global mcp-policy":view("Inspect provider-injected MCP tools"),
"global observability":view("Inspect complexity and privacy configuration",0,0,{"vk-id":"string"}),
"global configure-omp":write("Apply OMP settings"),
"judge status":view("Inspect native judge"),
"judge activate":write("Activate judge model"),
"judge probe":write("Run an explicitly billed judge test",0,0,{decisions:"boolean"},"Executes live inference; may incur charges"),
"routes list":view("List routing rules",0,0,{filter:"string",limit:"integer"}),
"routes diff":view("Compare saved versus live routing"),
"routes verify":write("Verify routing and refresh local timestamp",0,0,{"dry-run":"boolean"}),
"routes sync":write("Save routing policy and refresh model catalogue",0,0,{"dry-run":"boolean","no-refresh":"boolean"}),
"routes diagnose":view("Inspect routing discovery"),
"routes effective":view("Display OMP role assignments",0,0,{role:"string",limit:"integer"}),
"routes explain":view("Preview route member eligibility",1,1,{"input-tokens":"integer","output-tokens":"integer",image:"boolean",tools:"boolean",reasoning:"boolean","tool-search":"boolean","between-tools":"boolean","tool-choice":"string","service-tier":"string"}),
"models refresh":write("Refresh OMP models",0,0,{force:"boolean"}),
"models doctor":view("Inspect model health"),
"models kinds":view("Inspect model kinds"),
"repo init":write("Configure repository Virtual Key and MCP",0,0,{clients:"string",tools:"string","allow-all-tools":"boolean","virtual-mcps":"string","no-mcp-instructions":"boolean","install-matching-skills":"boolean","no-skill-discovery":"boolean","rotate-existing":"boolean","dry-run":"boolean",yes:"boolean"},"Changes gateway access and local configuration"),
"repo status":view("Inspect repository and MCP readiness"),
"repo research status":view("Inspect research provider readiness"),
"repo research bind":write("Bind research provider",2,2,{profile:"string","search-tool":"string","fetch-tool":"string","crawl-tool":"string","screenshot-tool":"string"}),
"repo research unbind":write("Remove research binding",1),
"repo research prefer":write("Set preferred research guidance",1),
"repo research probe":write("Run live MCP search",0,1,{},"Executes live MCP search; may incur charges"),
"repo rotate-key":write("Rotate repository Virtual Key",0,0,{"dry-run":"boolean"},"Changes local and gateway credentials"),
"repo reset":write("Remove repository configuration",0,0,{"delete-remote":"boolean","recover-by-name":"boolean",yes:"boolean","dry-run":"boolean"},"Potentially destructive local/gateway change"),
"repo mcp list":view("List available MCP clients",0,0,{filter:"string",limit:"integer"}),
"repo mcp add":write("Grant explicit MCP tools",1,1,{tools:"string","allow-all-tools":"boolean","dry-run":"boolean","install-matching-skills":"boolean"},"Changes gateway access"),
"repo mcp remove":write("Revoke MCP grant",1,1,{"dry-run":"boolean"},"Changes gateway access"),
"repo mcp instructions":write("Set OMP MCP instruction mode",1),
"repo vmcp list":view("List Virtual MCP bundles"),
"repo vmcp add":write("Attach Virtual MCP bundle",1,1,{"dry-run":"boolean","install-matching-skills":"boolean"},"Changes gateway access"),
"repo vmcp remove":write("Detach Virtual MCP bundle",1,1,{"dry-run":"boolean"},"Changes gateway access"),
"repo skills list":view("List Bifrost Skills"),
"repo skills suggestions":write("Show matching Skills; optional explicit install",0,0,{"install-matching-skills":"boolean"},"Read-only by default; installs only with --install-matching-skills"),
"repo skills bind":write("Bind MCP to a Skill",2,2,{"install-matching-skills":"boolean"}),
"repo skills unbind":write("Remove Skill binding",1),
"repo skills dismiss":write("Hide a Skill suggestion",1),
"repo skills undismiss":write("Restore a Skill suggestion",1),
"repo skills add":write("Install a Skill",1,1,{force:"boolean","dry-run":"boolean"}),
"repo skills remove":write("Remove a managed Skill",1,1,{force:"boolean","dry-run":"boolean"}),
"repo skills sync":write("Synchronise configured Skills",0,1,{force:"boolean","dry-run":"boolean"}),
"secret repo-mcp":write("Internal secret output",0,0,{id:"string"},"Machine-only secret stdout"),
"doctor":view("Check required and optional services")
});
export class CommandUsageError extends Error{
constructor(message){super(message);this.name="CommandUsageError";this.isUsage=true}
}
const POSITION_NAMES={
  "routes explain":["role-or-alias"],
  "repo research bind":["provider-id","mcp-client"],
  "repo research unbind":["provider-id"],
  "repo research prefer":["provider-id|none"],
  "repo research probe":["provider-id"],
  "repo mcp add":["client"],"repo mcp remove":["client"],
  "repo mcp instructions":["on|off|default"],
  "repo vmcp add":["bundle"],"repo vmcp remove":["bundle"],
  "repo skills add":["skill"],"repo skills remove":["skill"],
  "repo skills sync":["skill"],"repo skills bind":["client","skill"],
  "repo skills unbind":["client"],"repo skills dismiss":["client"],
  "repo skills undismiss":["client"]
};
const EXAMPLES={
  "repo mcp add":"pifrost repo mcp add donsetch --tools web_search,web_fetch --dry-run",
  "repo reset":"pifrost repo reset --delete-remote --dry-run",
  "routes explain":"pifrost routes explain default --input-tokens 20000 --tools",
  "routes sync":"pifrost routes sync --dry-run",
  "repo skills suggestions":"pifrost repo skills suggestions",
  "repo research probe":"pifrost repo research probe donsetch",
  "doctor":"pifrost doctor --strict --json"
};
export function commandUsage(name){
const s=COMMAND_SPEC[name];
if(!s)return "Unknown command. Run pifrost help --all.";
const args=Array.from({length:s.min},(_,i)=>"<"+(POSITION_NAMES[name]?.[i]??"argument-"+(i+1))+">").join(" ");
const opts=Object.entries(s.flags).map(([k,v])=>"  --"+k+(v==="boolean"?"":" VALUE"));
return ["Usage: pifrost "+name+(args?" "+args:"")+(s.max>s.min?" [argument]":"")+" [options]",s.summary,"Effect: "+s.effect,...opts,"  --help  Show this command's help",EXAMPLES[name]?"Example: "+EXAMPLES[name]:""].filter(Boolean).join("\n");
}
export function parseCliArgs(argv){
const positional=[],flags={};
const kinds={help:"boolean","help-all":"boolean",version:"boolean",all:"boolean"};
const selected=Object.keys(COMMAND_SPEC).sort((a,b)=>b.length-a.length)
  .find(name=>name.split(" ").every((part,i)=>argv[i]===part));
if(selected)Object.assign(kinds,COMMAND_SPEC[selected].flags);
for(let i=0;i<argv.length;i++){
const token=argv[i];
if(token==="--"){positional.push(...argv.slice(i+1));break}
if(!token.startsWith("--")){positional.push(token);continue}
const eq=token.indexOf("=");
const name=eq>=0?token.slice(2,eq):token.slice(2);
if(!Object.hasOwn(kinds,name))throw new CommandUsageError("Unknown option --"+name+".");
if(Object.hasOwn(flags,name))throw new CommandUsageError("Duplicate option --"+name+".");
if(kinds[name]==="boolean"){
if(eq>=0)throw new CommandUsageError("--"+name+" cannot accept a value.");
flags[name]=true;
}else{
const value=eq>=0?token.slice(eq+1):argv[++i];
if(!value||value.startsWith("--"))throw new CommandUsageError("--"+name+" requires a value.");
if(kinds[name]==="integer"&&(!/^\d+$/u.test(value)||!Number.isSafeInteger(Number(value))))
throw new CommandUsageError("--"+name+" requires a non-negative integer.");
flags[name]=kinds[name]==="integer"?Number(value):value;
}
}
return {positional,flags};
}
export function validateCommand(name,args,flags){
const spec=COMMAND_SPEC[name];
if(!spec)throw new CommandUsageError("Unknown command. Run pifrost help.");
for(const key of Object.keys(flags)){
if(key==="help")continue;
if(!Object.hasOwn(spec.flags,key))throw new CommandUsageError("--"+key+" is not valid for "+name+".");
}
if(args.length<spec.min||args.length>spec.max)
throw new CommandUsageError("Invalid arguments for "+name+".\n"+commandUsage(name));
if(flags["allow-all-tools"]&&flags.tools)throw new CommandUsageError("Use --allow-all-tools OR --tools, not both.");
if(name==="repo mcp add"&&!flags.tools&&!flags["allow-all-tools"])
throw new CommandUsageError("Explicitly choose --tools tool1,tool2 or --allow-all-tools.");
if((name==="repo mcp add"||name==="repo init")&&flags.tools){
const entries=flags.tools.split(",").map(x=>x.trim());
if(entries.some(x=>!x))throw new CommandUsageError("--tools contains an empty tool name.");
if(entries.includes("*")&&entries.length>1)throw new CommandUsageError("Cannot mix wildcard * with named tools.");
if(entries.includes("*")&&!flags["allow-all-tools"])throw new CommandUsageError("Wildcard grants require --allow-all-tools.");
}
if(name==="repo research bind"&&flags.profile&&!["donsetch","hound","generic"].includes(flags.profile))
throw new CommandUsageError("--profile must be donsetch, hound or generic.");
if(name==="repo reset"&&flags["recover-by-name"]&&!flags["delete-remote"])
throw new CommandUsageError("--recover-by-name requires --delete-remote.");
if(name==="secret repo-mcp"&&!flags.id)throw new CommandUsageError("Internal secret resolver requires --id.");
return spec;
}
export function operationDescription(name){return COMMAND_SPEC[name]?.effect??"Unknown";}
