/**
 * 30E: structural post-condition guard on provider-wire reasoning replay cleanup.
 * Pifrost may clean only unsigned, synthetic, redundant assistant text. On
 * uncertainty, send the unmodified bridged payload through existing OMP
 * reasoning compatibility checks; never invent/strip tool calls or opaque state.
 */
const rec = x => x !== null && typeof x === "object" && !Array.isArray(x) ? x : null;
const signed = item => {
  const x=rec(item);
  if(!x)return false;
  if (["encrypted_content","textSignature","thinkingSignature","signature","signature_delta"].some(k=>
      Object.hasOwn(x,k) && x[k] != null)) return true;
  return false;
};
function unsafeMessage(item){
  const x=rec(item), p=Array.isArray(x?.content) && x.content.length===1?rec(x.content[0]):null;
  return !x || x.type!=="message" || x.role!=="assistant" || typeof x.id==="string" ||
    signed(x) || !p || p.type!=="output_text" || typeof p.text!=="string" ||
    typeof p.id==="string" || signed(p) || (Array.isArray(p.annotations)&&p.annotations.length>0);
}
const pureText=x=>/^\s*(?:<think>\s*)+reasoning unavailable\s*<\/think>\s*$/u.test(x);
function syntheticReason(x) {
  const e=rec(x), part=Array.isArray(e?.content)&&e.content.length===1?rec(e.content[0]):null;
  return e?.type==="reasoning" && !signed(e) && !signed(part) &&
    e.id===undefined && e.encrypted_content===undefined &&
    Array.isArray(e.summary) && e.summary.length===0 && part?.type==="reasoning_text" &&
    part.text==="reasoning unavailable";
}
function allowedChange(a,b){
  if(unsafeMessage(a)||unsafeMessage(b))return false;
  const x=rec(a),y=rec(b),bp=rec(x.content[0]),ap=rec(y.content[0]);
  const keys=(x,y,omit)=>Object.keys(x).filter(k=>k!==omit).length===Object.keys(y).filter(k=>k!==omit).length &&
    Object.keys(x).every(k=>k===omit || x[k]===y[k]);
  if(!keys(x,y,"content")||!keys(bp,ap,"text"))return false;
  const original=bp.text,replacement=ap.text;
  if(typeof replacement!=="string"||replacement.trim().length===0)return false;
  const m=original.match(/^(\s*<think>\s*)(?:(?:<think>\s*)*reasoning unavailable(?:[ \t]*(?:\r?\n[ \t]*)+|(?=<(?:dy\b|think\b|parameter\b|\/think\b))))+(?=\S)/u);
  return !!m && replacement===original.slice(0,m[1].length)+original.slice(m[0].length);
}
function verifyResponses(original, revised, allowSyntheticReasoningRemoval){
  const source=rec(original),out=rec(revised),a=source?.input,b=out?.input;
  if(!Array.isArray(a)||!Array.isArray(b)||!source||!out)return false;
  // Unchanged metadata/tool descriptors: no provider, budgets or tool rewrites
  // introduced by the replay cleanup pass.
  for(const k of Object.keys(source))if(k!=="input"&&source[k]!==out[k])return false;
  if(Object.keys(source).length!==Object.keys(out).length)return false;
  let i=0,j=0;
  while(i<a.length){
    const old=a[i],next=b[j];
    if(old===next){i++;j++;continue;}
    if(j<b.length&&allowedChange(old,next)){i++;j++;continue;}
    const x=rec(old);
    if(allowSyntheticReasoningRemoval&&syntheticReason(old)){i++;continue;}
    if(!unsafeMessage(old)&&pureText(x.content[0].text)){i++;continue;}
    return false;
  }
  return j===b.length;
}
function verifyChat(original,revised){
  const a=rec(original),b=rec(revised);
  if(!a||!b||!Array.isArray(a.messages)||!Array.isArray(b.messages)||
      a.messages.length!==b.messages.length||Object.keys(a).length!==Object.keys(b).length)return false;
  for(const k of Object.keys(a))if(k!=="messages"&&a[k]!==b[k])return false;
  for(let i=0;i<a.messages.length;i++){
    const before=a.messages[i],after=b.messages[i];
    if(before===after)continue;
    const x=rec(before),y=rec(after);
    if(!x||!y||x.role!=="assistant"||x.id!==undefined||signed(x)||signed(y) ||
        typeof x.content!=="string"||typeof y.content!=="string")return false;
    if(Object.keys(x).length!==Object.keys(y).length ||
      Object.keys(x).some(k=>k!=="content"&&x[k]!==y[k]))return false;
    const regex=/^(\s*<think>\s*)(?:(?:<think>\s*)*reasoning unavailable(?:[ \t]*(?:\r?\n[ \t]*)+|(?=<(?:dy\b|think\b|parameter\b|\/think\b))))+(?=\S)/u;
    const match=x.content.match(regex);
    if(!match||y.content!==x.content.slice(0,match[1].length)+x.content.slice(match[0].length))return false;
  }
  return true;
}
export function certifyReplayHygiene(original,cleaned,protocol,options={}){
  if(original===cleaned)return {payload:original,accepted:true,reason:"unchanged"};
  let accepted=false;
  try {
    accepted=protocol==="openai-responses"
      ?verifyResponses(original,cleaned,options.allowSyntheticReasoningRemoval===true)
      :protocol==="openai-completions"&&verifyChat(original,cleaned);
  }catch {accepted=false;}
  return {payload:accepted?cleaned:original,accepted,reason:accepted?"structurally-safe":"preserved-uncertain"};
}
export function formatRedactedIntegrityReport({hygiene,certification,mode,decision}={}){
 const safeInt=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const allowedReason=new Set(["REASONING_ONLY_STOP","EMPTY_STOP","LEAKED_THINKING_STOP","NONE"]);
 const status=certification?.accepted===false?"preserved-uncertain":
   certification?.accepted===true?"certified":"unknown";
 const counters=hygiene&&typeof hygiene==="object"?hygiene:{};
 return Object.freeze({
   schemaVersion:1,reasoningReplay:status,
   replayItemsRemoved:safeInt(counters.removedVisiblePlaceholders),
   replayItemsRetained:safeInt(counters.retainedReasoningItems),
   replaySyntheticReasoningRemoved:safeInt(counters.removedSyntheticReasoningItems),
   transport:mode==="openai-completions"?"chat":mode==="openai-responses"?"responses":"unknown",
   stopClass:allowedReason.has(decision?.reason)?decision.reason:"unverified",
   // No model names, prompt text, raw history, provider headers or opaque signatures.
 });
}
