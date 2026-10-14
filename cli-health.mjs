/** CLI health results share a stable, secrets-free JSON and text contract. */
const secretPatterns=[
  /\bsk-[a-z0-9_-]{8,}\b/giu,
  /\bBearer\s+\S+/giu,
  /([?&](?:api_key|token|password|virtual_key)=)[^\s&]+/giu,
];
export function safeUiText(input, max=180) {
  let text=String(input??"Not verified").replace(/[\x00-\x1f\x7f]/gu," ").trim();
  for(const pattern of secretPatterns)text=text.replace(pattern,"[redacted]");
  return text.slice(0,max)+(text.length>max?"…":"");
}
export const healthCodes=Object.freeze({
  OK:"ok",WARN:"warn",FAIL:"fail",UNKNOWN:"unknown",SKIP:"skip",
});
export function healthOutcome(checks,strict=false) {
  const requiredFailure=checks.some(x=>x.required!==false&&x.status==="fail");
  const warnings=checks.some(x=>x.status!=="ok");
  return {outcome:requiredFailure?"FAILED":warnings?"ATTENTION":"OK",
    exitCode:requiredFailure||(strict&&warnings)?2:0};
}
export function reportHealth({command,checks,strict=false,json=false}) {
  const normalized=checks.map((check,index)=>({
    id:safeUiText(check.id??("check-"+(index+1)),64),
    label:safeUiText(check.label,96),
    status:["ok","warn","fail","unknown","skip"].includes(check.status)?check.status:"unknown",
    required:check.required!==false,
    detail:safeUiText(check.detail,180),
    action:check.action?safeUiText(check.action,180):undefined,
  }));
  const {outcome,exitCode}=healthOutcome(normalized,strict);
  if(json) {
    console.log(JSON.stringify({
      schemaVersion:1,command,result:outcome,
      counts:{ok:normalized.filter(x=>x.status==="ok").length,issues:normalized.filter(x=>x.status!=="ok").length},
      checks:normalized,
    },null,2));
  }
  return {outcome,exitCode,checks:normalized};
}
export function listFilter(items,{filter,limit}={}) {
  const needle=typeof filter==="string"?filter.trim().toLowerCase():"";
  const filtered=needle?items.filter(x=>String(x.name??x.id??x).toLowerCase().includes(needle)):items;
  const max=limit===undefined?Infinity:Number(limit);
  return {items:filtered.slice(0,max),total:filtered.length,omitted:Math.max(0,filtered.length-max)};
}
export function operationSummary(kind, changes=[]) {
  return ["Operation: "+kind, ...changes.map(change=>"  - "+safeUiText(change,200))].join("\n");
}
