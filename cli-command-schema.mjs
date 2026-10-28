/**
 * The CLI command contract: strict options and positionals, contextual help,
 * explicit side effects, and predictable automation semantics.
 * Machine-secret endpoints are excluded from any JSON or diagnostic renderer.
 */
const values = {
  "url":"Bifrost gateway URL", "api-key":"Optional inference API key",
  "virtual-key":"Inference Virtual Key", "management-auth":"Bifrost management auth mode",
  "management-username":"Management username", "management-password":"Management password",
  "management-key":"Management API key", "setup-token":"Initial setup token",
  "clients":"Comma-separated MCP clients", "tools":"Explicit comma-separated MCP tool allow-list or *",
  "virtual-mcps":"Comma-separated Virtual MCP bundles", "vk-id":"Virtual Key management ID",
  "id":"Internal repository identifier", "filter":"Case-insensitive name filter",
  "limit":"Maximum displayed entries", "api":"completions|responses",
};
const bools = new Set([
  "help","all","version","verbose","strict","json","dry-run","yes","skip-test","skip-omp",
  "force","delete-remote","recover-by-name","rotate-existing","no-mcp-instructions",
  "install-matching-skills","no-skill-discovery",
]);
const general = ["help"];
const read = ["verbose"];
const healthRead = ["verbose","strict","json"];
const filters = ["filter","limit"];
// Registered commands. Source-of-truth for validation/help side effects.
const rows = [
  ["status",0,0,healthRead,"read-only"],
  ["models",0,0,[],"read-only"],
  ["mcp",0,0,[...filters,...read],"read-only"],
  ["skills",0,0,[...filters,...read],"read-only"],
  ["omp commands status",0,0,[],"read-only"],
  ["omp commands enable",0,0,["dry-run"],"local-change"],
  ["omp commands disable",0,0,["dry-run"],"local-change"],
  ["init",0,0,["url","api-key","virtual-key","management-auth","management-username","management-password","management-key","setup-token","skip-omp","skip-test","yes","dry-run"],"local-change"],
  ["global setup",0,0,["url","api-key","virtual-key","management-auth","management-username","management-password","management-key","setup-token","skip-omp","skip-test","yes","dry-run"],"local-change"],
  ["global status",0,0,healthRead,"read-only"],
  ["global mcp-policy",0,0,read,"read-only"],
  ["global observability",0,0,["vk-id",...read],"read-only"],
  ["migrate status",0,0,[],"read-only"],
  ["migrate disable-extension",0,0,["dry-run"],"local-change"],
  ["migrate apply",0,0,[],"local-change"],
  ["migrate rollback",0,0,[],"local-change"],
  ["models list",0,0,[],"read-only"],
  ["models status",0,0,[],"read-only"],
  ["models enable",0,0,["api","dry-run"],"local-change"],
  ["models disable",0,0,["dry-run"],"local-change"],
  ["models kinds",0,0,read,"read-only"],
  ["repo init",0,0,["clients","tools","virtual-mcps","rotate-existing","no-mcp-instructions","install-matching-skills","no-skill-discovery","dry-run","yes"],"gateway-change"],
  ["repo status",0,0,healthRead,"read-only"],
  ["repo rotate-key",0,0,["dry-run","yes"],"gateway-change"],
  ["repo reset",0,0,["delete-remote","recover-by-name","yes","dry-run"],"gateway-change"],
  ["repo mcp list",0,0,[...filters,...read],"read-only"],
  ["repo mcp add",1,1,["tools","dry-run","install-matching-skills","no-skill-discovery","yes"],"gateway-change"],
  ["repo mcp remove",1,1,["dry-run"],"gateway-change"],
  ["repo mcp instructions",1,1,["dry-run"],"local-change"],
  ["repo vmcp list",0,0,[...filters,...read],"read-only"],
  ["repo vmcp add",1,1,["install-matching-skills","no-skill-discovery","dry-run"],"gateway-change"],
  ["repo vmcp remove",1,1,["dry-run"],"gateway-change"],
  ["repo skills list",0,0,[...filters,...read],"read-only"],
  ["repo skills suggestions",0,0,["install-matching-skills",...read],"read-only"],
  ["repo skills bind",2,2,["install-matching-skills","no-skill-discovery"],"local-change"],
  ["repo skills unbind",1,1,[],"local-change"],
  ["repo skills dismiss",1,1,[],"local-change"],
  ["repo skills undismiss",1,1,[],"local-change"],
  ["repo skills add",1,1,["force","dry-run"],"local-change"],
  ["repo skills remove",1,1,["force","dry-run"],"local-change"],
  ["repo skills sync",0,1,["force","dry-run"],"local-change"],
  ["secret repo-mcp",0,0,["id"],"machine-secret"],
  ["secret inference",0,0,[],"machine-secret"],
  ["secret inference-vk",0,0,[],"machine-secret"],
  ["secret inference-bearer",0,0,[],"machine-secret"],
  ["doctor",0,0,healthRead,"read-only"],
];
export const commandCatalog = new Map(rows.map(([name,min,max,options,operation]) => [name,{
  name,min,max,options:[...new Set([...general,...options])],
  operation,
}]));
export function flagRequiresValue(key, command) {
  if (key === "tools") return true; // An explicit MCP grant is never inferred.
  return Object.hasOwn(values,key);
}
export function isKnownFlag(key) { return Object.hasOwn(values,key) || bools.has(key); }
export function cliUsageError(message) {
  return Object.assign(new Error(message),{isUsage:true});
}
export function validateCliInvocation(name,args,flags) {
  const def=commandCatalog.get(name);
  if(!def)throw cliUsageError("Unsupported command. Use pifrost help.");
  for(const key of Object.keys(flags)){
    if(!def.options.includes(key))throw cliUsageError("Option --"+key+" is not valid for '"+name+"'. Use pifrost "+name+" --help.");
    if(flagRequiresValue(key,name)&& (typeof flags[key] !== "string" || !flags[key].trim()))
      throw cliUsageError("Option --"+key+" needs a value.");
    if(!flagRequiresValue(key,name) && flags[key] !== true)
      throw cliUsageError("Option --"+key+" does not take a value.");
  }
  if(args.length < def.min || args.length > def.max)
    throw cliUsageError("Expected "+(def.min === def.max ? def.min : def.min+"–"+def.max)+" argument(s) for '"+name+"'. Use pifrost "+name+" --help.");
  if(flags.json&&flags.verbose)
    throw cliUsageError("--json and --verbose are separate display modes; choose one.");
  if(flags.strict&&flags.verbose)
    throw cliUsageError("Use --strict with the compact health check (without --verbose).");
  if(name==="repo mcp add" && !Object.hasOwn(flags,"tools"))
    throw cliUsageError("Specify allowed tools explicitly with --tools tool1,tool2 or --tools '*'. No default wildcard grant.");
  if(name==="repo init" && flags.clients !== undefined && flags.tools === undefined)
    throw cliUsageError("--clients requires an explicit --tools allow-list; use --tools '*' only if intentional.");
  if(flags.limit!==undefined && (!/^[1-9]\d{0,3}$/u.test(flags.limit)||Number(flags.limit)>1000))
    throw cliUsageError("--limit must be an integer from 1 to 1000.");
  if(name==="models enable" && flags.api!==undefined && !["completions","responses"].includes(flags.api))
    throw cliUsageError("--api must be completions or responses.");
  return def;
}
export function commandUsage(name) {
  const d=commandCatalog.get(name);
  if(!d)return "Unknown command. Run pifrost help.";
  const positional = d.min === 0 && d.max === 0 ? "" :
    d.min===d.max ? " "+Array(d.min).fill("<value>").join(" ") : " [<value>]";
  return [
    "Usage: pifrost "+name+positional+(d.options.length?" [options]":""),
    "Operation: "+({
      "read-only":"Read-only inspection",
      "local-change":"Changes local Pifrost/OMP configuration",
      "gateway-change":"Changes gateway permissions or credentials",
      "billed":"Performs a live operation that may incur provider usage",
      "machine-secret":"Internal machine-secret output; never share its stdout",
    }[d.operation]??d.operation),
    d.options.length?"Options:":"No options.",
    ...d.options.map(k=>k==="skip-omp" ? "  --skip-omp  Deprecated no-op; Pifrost never changes OMP roles" : "  --"+k+(flagRequiresValue(k,name)?" <value>":"")+(values[k]?"  "+values[k]:"")),
    "Detailed help: pifrost help --all",
  ].join("\n");
}
export function operationLabel(op) {
  return {
    "read-only":"Read-only",
    "local-change":"Changes local configuration",
    "gateway-change":"Changes Bifrost gateway configuration",
    "billed":"Performs live provider calls (charges may apply)",
    "machine-secret":"Sensitive machine output",
  }[op]??op;
}
