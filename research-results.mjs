/** Parse provider result status without mutating model-visible evidence. */
export function classifyResearchResult(result,profile="generic") {
  const blocks=Array.isArray(result?.content)?result.content:[];
  const first=blocks.find(block=>block?.type==="text");
  const line=first?.text?.startsWith("[meta] ")?first.text.slice(7).split(/\r?\n/u,1)[0]:"";
  let folded;
  if(line&&line.length<=128000)try{const v=JSON.parse(line);if(v&&typeof v==="object"&&!Array.isArray(v))folded=v;}catch{}
  const structured=result?.structuredContent&&typeof result.structuredContent==="object"&&!Array.isArray(result.structuredContent)?result.structuredContent:undefined;
  const meta=folded??structured;
  const failed=result?.isError===true||(profile==="donsetch"&&meta?.ok===false);
  return {ok:failed?false:profile==="donsetch"&&!meta?undefined:true,
    code:typeof meta?.code==="string"?meta.code:undefined,
    errorKind:typeof meta?.errorKind==="string"?meta.errorKind:undefined,
    nextAction:typeof meta?.next_action==="string"?meta.next_action:undefined,
    url:typeof meta?.url==="string"?meta.url:undefined,
    continuation:meta?.next_offset??meta?.resume,
    imageBlocks:blocks.filter(block=>block?.type==="image").length,
    source:folded?"folded-meta":structured?"structured":"none"};
}
