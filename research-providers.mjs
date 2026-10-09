import { mcpClientExecutionDiagnostics } from "./mcp-client-shape.mjs";
export const RESEARCH_CAPABILITIES = Object.freeze(["search", "fetch", "crawl", "screenshot"]);
export const RESEARCH_PROFILES = Object.freeze({
  donsetch: Object.freeze({ label: "DonSeTch", tools: Object.freeze({ search: "web_search", fetch: "web_fetch", crawl: "web_crawl", screenshot: "web_screenshot" }), statefulHandles: true, resultFormat: "donsetch" }),
  hound: Object.freeze({ label: "Hound (legacy)", tools: Object.freeze({ search: "mcp_smart_search", fetch: "mcp_smart_fetch", crawl: "mcp_smart_crawl", screenshot: "mcp_screenshot" }), resultFormat: "hound" }),
});
export const CODE_MODE_META_TOOLS = Object.freeze(["listToolFiles", "readToolFile", "getToolDocs", "executeToolCode"]);
const nonEmpty = (v) => typeof v === "string" ? v.trim() : "";
const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
const same = (a,b) => norm(a) !== "" && norm(a) === norm(b);
const toolNames = (c) => Array.isArray(c?.tools) ? c.tools.filter((v) => typeof v === "string") : [];
const mappedProfile = (c) => same(c?.name,"donsetch") && ["web_search","web_fetch"].every(t=>toolNames(c).includes(t)) ? "donsetch" : same(c?.name,"hound") && ["mcp_smart_search","mcp_smart_fetch"].every(t=>toolNames(c).includes(t)) ? "hound" : undefined;
function validateTools(tools) {
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) throw Error("Research tools require a capability-to-tool mapping");
  const entries=Object.entries(tools);
  if (!entries.length || entries.some(([k,v])=>!RESEARCH_CAPABILITIES.includes(k)||typeof v!=="string"||!/^[A-Za-z_][\w.-]{0,127}$/u.test(v))) throw Error("Invalid research capability or MCP tool name");
  if (new Set(entries.map(([,v])=>v)).size !== entries.length) throw Error("Research capabilities must map to distinct tools");
  return { ...tools };
}
export function normalizeResearchBindings(raw=[]) {
  if (!Array.isArray(raw)) throw Error("research.providers must be an array");
  const ids=new Set(), clients=new Set();
  return raw.map(row=>{
    if (!row||typeof row!=="object"||Array.isArray(row)) throw Error("Invalid research provider binding");
    const id=nonEmpty(row.id),clientId=nonEmpty(row.clientId),mcpClient=nonEmpty(row.mcpClient),profile=nonEmpty(row.profile||"generic").toLowerCase();
    if (!/^[A-Za-z][\w-]{0,63}$/u.test(id)||(!clientId&&!mcpClient)) throw Error("Research binding requires id and clientId or mcpClient");
    if (ids.has(id.toLowerCase())||clients.has((clientId||mcpClient).toLowerCase())) throw Error("Duplicate research id or MCP client");
    ids.add(id.toLowerCase());clients.add((clientId||mcpClient).toLowerCase());
    if (profile!=="generic" && !Object.hasOwn(RESEARCH_PROFILES,profile)) throw Error("Unknown research profile: "+profile);
    if (profile==="generic"&&!row.tools) throw Error("Generic research provider requires explicit tools mapping");
    return {id,clientId:clientId||undefined,mcpClient:mcpClient||undefined,profile,tools:validateTools(row.tools??RESEARCH_PROFILES[profile].tools)};
  });
}
export function normalizeResearchPreference(raw={}) {
  const providers=normalizeResearchBindings(raw?.providers??[]),preferred=nonEmpty(raw?.preferred);
  if (preferred&&!providers.some(p=>same(p.id,preferred))) throw Error("Preferred research provider must have an explicit binding");
  return {preferred:preferred||undefined,providers};
}
function matchingClient(binding,clients) {
  return clients.find(c=>binding.clientId&&same(c.id,binding.clientId))??(!binding.clientId?clients.find(c=>same(c.name,binding.mcpClient)):undefined);
}
function displayedTool(name,client,tool,allClients) {
  const lower=String(name??"").toLowerCase(),target=tool.toLowerCase();
  const ids=[client?.name,client?.id].filter(Boolean).map(v=>String(v).toLowerCase());
  for(const id of ids) for(const part of [id,id.replace(/[^a-z0-9]+/gu,"_"),id.replace(/[^a-z0-9]+/gu,"-")]) {
    if (["mcp__bifrost_"+part+"_"+target,"mcp__bifrost_"+part+"-"+target,"mcp__bifrost__"+part+"__"+target,"mcp__"+part+"_"+target].includes(lower)) return true;
  }
  const owners=allClients.filter(c=>toolNames(c).includes(tool));
  return owners.length===1&&owners[0]===client&&lower==="mcp__bifrost_"+target;
}
function capabilityStatus(client,cap,tool,policy,clients,liveTools,codeModeProbes) {
  const exists=toolNames(client).includes(tool);
  const grant=policy?.effective?.find(g=>same(g.client,client.name)||same(g.client,client.id));
  const permission=grant?mcpClientExecutionDiagnostics(client,grant.tools):undefined;
  const row=permission?.rows.find(r=>r.tool===tool);
  let visible, gatewayName, surface=client.isCodeModeClient?"code":"classic";
  if(Array.isArray(liveTools)) {
    if(client.isCodeModeClient) {
      const metas=["listToolFiles","readToolFile","executeToolCode"];
      const metadata=metas.every(t=>liveTools.some(r=>String(r.name).toLowerCase().endsWith(t.toLowerCase())));
      const probe=codeModeProbes?.[client.id]??codeModeProbes?.[client.name];
      visible=metadata&&probe?.ok===true&&probe.tools?.includes(tool)===true;
    } else {
      const display=liveTools.find(t=>displayedTool(t.name,client,tool,clients));
      gatewayName=display?.name;visible=Boolean(display);
    }
  }
  return {tool,exists,granted:Boolean(row),executable:row?.executable??(row?undefined:false),autoExecutable:row?.autoExecutable,visible,gatewayName,surface,callable:exists&&Boolean(row)&&row.executable!==false&&visible===true};
}
function evaluate(binding,client,policy,clients,options) {
  if(!client) return {id:binding.id,client:binding.mcpClient??binding.clientId,profile:binding.profile,status:"missing-client",configured:true,authorized:false,capabilities:{}};
  const grant=policy?.effective?.find(g=>same(g.client,client.name)||same(g.client,client.id));
  const capabilities=Object.fromEntries(RESEARCH_CAPABILITIES.map(cap=>[cap,binding.tools[cap]?capabilityStatus(client,cap,binding.tools[cap],policy,clients,options.liveTools,options.codeModeProbes):{callable:false,exists:false,granted:false}]));
  const capable=RESEARCH_CAPABILITIES.filter(cap=>capabilities[cap].callable),ready=capable.includes("search")&&capable.includes("fetch");
  const status=!grant?"not-authorized":!Array.isArray(options.liveTools)?"configured-unverified":ready?"research-ready":capable.length?"partial":"unavailable";
  return {id:binding.id,clientId:client.id,client:client.name,profile:binding.profile,label:RESEARCH_PROFILES[binding.profile]?.label??binding.id,
    mode:client.isCodeModeClient?"code":"classic",status,configured:true,authorized:Boolean(grant),liveVerified:Array.isArray(options.liveTools)&&capable.length>0,
    searchReady:capable.includes("search"),webResearchReady:ready,deepResearchReady:ready&&capable.includes("crawl"),screenshotCallable:capable.includes("screenshot"),
    visualWebStatus:capable.includes("screenshot")?(client.isCodeModeClient?"conditional-code-mode":"recoverable"):"unavailable",
    capabilities,grantedVia:grant?.sources??[],warnings:grant?mcpClientExecutionDiagnostics(client,grant.tools).warnings:[],
    statefulHandles:RESEARCH_PROFILES[binding.profile]?.statefulHandles===true,serverInstructions:Boolean(client.serverInstructions)};
}
export function researchProviderDiagnostics(policy,clients=[],options={}) {
  const research=normalizeResearchPreference(options.research??{}), bound=research.providers.map(binding=>({binding,client:matchingClient(binding,clients)}));
  const seen=new Set(bound.filter(x=>x.client).map(x=>x.client.id||x.client.name));
  for(const client of clients) {
    if(seen.has(client.id||client.name))continue;
    const profile=mappedProfile(client);
    if(!profile)continue;
    bound.push({binding:{id:profile,clientId:client.id,mcpClient:client.name,profile,tools:RESEARCH_PROFILES[profile].tools},client});
    seen.add(client.id||client.name);
  }
  const providers=bound.map(x=>evaluate(x.binding,x.client,policy,clients,options));
  const preferred=research.preferred??providers.find(p=>p.profile==="donsetch")?.id??providers[0]?.id;
  const selected=providers.find(p=>p.id===preferred);
  return {preferred,providers,ready:providers.some(p=>p.webResearchReady),
    search:{preferred,usable:providers.filter(p=>p.searchReady).map(p=>p.id),omp:options.ompSearch,
      path:selected?.searchReady?"Bifrost MCP/"+selected.client+" ("+selected.mode+")":options.ompSearch?.available?"OMP native web_search":"unavailable"}};
}
export function eligibleResearchCodeModeClients(policy,clients=[],research={}) {
  const config=normalizeResearchPreference(research);
  return clients.filter(client=>client.isCodeModeClient&&(
    Boolean(mappedProfile(client))||config.providers.some(p=>same(p.clientId,client.id)||(!p.clientId&&same(p.mcpClient,client.name)))
  )&&policy?.effective?.some(g=>same(g.client,client.name)||same(g.client,client.id)));
}
const contentText=value=>typeof value==="string"?value:Array.isArray(value?.content)?value.content.filter(x=>x?.type==="text").map(x=>x.text??"").join("\n"):"";
function stubFiles(output) {
  const stack=[],out=[];
  for(const line of contentText(output).split(/\r?\n/u)) {
    const level=Math.floor((line.match(/^ */u)?.[0]?.length??0)/2),token=line.trim();
    if(token.endsWith("/")){stack[level]=token.slice(0,-1);stack.length=level+1;}
    else if(token.endsWith(".pyi"))out.push(token.startsWith("servers/")?token:[...stack.slice(0,level),token].join("/"));
  }
  return [...new Set(out)].filter(f=>f.startsWith("servers/")&&f.endsWith(".pyi"));
}
function signatureNames(output) {
  return [...new Set(contentText(output).split(/\r?\n/u).map(l=>l.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/u)?.[1]).filter(Boolean))];
}
/** Metadata inspection only; no provider tools or sandbox code executed. */
export async function probeResearchCodeMode(callTool,clients=[],options={}) {
  const files=stubFiles(await callTool("listToolFiles",{})),results={};
  for(const client of clients.slice(0,Math.min(20,options.maxClients??20))) {
    const own=files.filter(f=>same(f.split("/")[1].replace(/\.pyi$/u,""),client.name));
    let tools=[],level="server";
    const one=own.find(f=>f.split("/").length===2);
    if(one)tools=signatureNames(await callTool("readToolFile",{fileName:one}));
    else {level="tool";for(const file of own.slice(0,8)) {
      const declared=file.split("/").at(-1).replace(/\.pyi$/u,"");
      if(signatureNames(await callTool("readToolFile",{fileName:file})).includes(declared))tools.push(declared);
    }}
    results[client.id??client.name]={ok:tools.length>0,bindingLevel:level,tools,files:own,error:tools.length?undefined:"No matching validated .pyi tool signatures"};
  }
  return results;
}
