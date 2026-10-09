/**
 * Pinned DonSeTch MCP schema canary. DonSeTch is an independently deployed
 * upstream, not a Pifrost runtime dependency. GitHub release tags are pinned
 * to immutable commit IDs for required CI and master remains opt-in advisory.
 */
const stable="b04fddae439e03cb9908399612a2fb045df8f2b0"; // v4.7.0
const expected={
  web_search:["query","intent","max_results","deadline_ms"],
  web_fetch:["url","focus","mode","offset","since_last"],
  web_crawl:["url","mode","max_pages","resume"],
  web_screenshot:["url","full_page","deadline_ms"],
};
async function get(ref,path) {
  const url="https://raw.githubusercontent.com/dondai44423/donsetch/"+ref+"/"+path;
  const r=await fetch(url,{headers:{"User-Agent":"pifrost-research-contract"}});
  if(!r.ok) throw Error("DonSeTch "+ref+" "+path+" returned HTTP "+r.status);
  return r.text();
}
async function check(ref,label) {
  const [raw,spec]=await Promise.all([get(ref,"tests/fixtures/tools_list.json"),get(ref,"src/mcp/compat.rs")]);
  const data=JSON.parse(raw),tools=Array.isArray(data.tools)?data.tools:[];
  const names=tools.map(t=>t.name);
  for(const [tool,fields] of Object.entries(expected)) {
    const row=tools.find(t=>t.name===tool);
    if(!row)throw Error(label+" is missing MCP tool "+tool);
    const props=row.inputSchema?.properties??{};
    for(const field of fields) if(!Object.hasOwn(props,field))throw Error(label+" missing "+tool+"."+field);
  }
  if(names.length!==4||!spec.includes("[meta]")||!spec.includes("structuredContent")||!spec.includes("shape_result"))
    throw Error(label+" tool surface or result compatibility contract changed");
  console.log(label+" passed: "+names.join(", ")+", [meta] result status available");
}
await check(stable,"DonSeTch v4.7.0 pinned");
if(process.env.PIFROST_DONSETCH_UPSTREAM_CANARY==="1")await check("master","DonSeTch master canary");
