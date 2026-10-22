import {test,expect} from "bun:test";
import {resolveImageTokenization,imageTokens} from "@oh-my-pi/pi-catalog/compat/image-tokenization";
import {
  installPifrostImageTokenPolicy,
  estimatePifrostImageTokens,
  resolvePifrostImageTokenization,
} from "../omp-context-policy.ts";

function png(width:number,height:number){
  const header=Buffer.alloc(26);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(header,0);
  header.writeUInt32BE(13,8);
  Buffer.from("IHDR").copy(header,12);
  header.writeUInt32BE(width,16);header.writeUInt32BE(height,20);
  header[24]=8;header[25]=2;
  return {type:"image",data:header.toString("base64"),detail:"original"};
}
const candidates=[
  {id:"deepseek-v4.1-flash",provider:"deepseek",api:"openai-completions",
    identity:{class:"deepseek",family:"flash",revision:"4.1"}},
  {id:"gpt-5.6-sol",provider:"openai",api:"openai-responses",
    identity:{class:"openai",family:"gpt",revision:"5.6"}},
  {id:"claude-opus-5",provider:"anthropic",api:"anthropic-messages",
    identity:{class:"anthropic",family:"opus",revision:"5"}},
] as const;

test("R5C-B01 pinned OMP 18.12.5 actual exported image rules price portable candidates exactly",()=>{
  for(const target of candidates){
    const official=resolveImageTokenization(target);
    expect(official).toBeDefined();
    installPifrostImageTokenPolicy(resolveImageTokenization,imageTokens);
    try {
      for(const [width,height] of [[1800,1200],[544,544],[1920,1080],[1024,768]]){
        const actual=estimatePifrostImageTokens(png(width,height),target);
        const expected=imageTokens(official!,{width,height},"original");
        expect(actual).toBe(expected);
      }
      expect(resolvePifrostImageTokenization(target).regime).toBe(official!.regime);
    } finally {installPifrostImageTokenPolicy(undefined,undefined)}
  }
});

test("R5C-B02 DeepSeek V4.1 price is sourced from measured lineage and avoids early compaction",()=>{
  const target=candidates[0];
  installPifrostImageTokenPolicy(resolveImageTokenization,imageTokens);
  try{
    const rule=resolvePifrostImageTokenization(target);
    expect(rule.regime).toBe("deepseek-patch");
    expect(rule.verified).toBe(true);
    const candidate=estimatePifrostImageTokens(png(1800,1200),target);
    const fallback=estimatePifrostImageTokens(png(1800,1200),{id:"unclassified-model",api:"openai-completions"});
    expect(candidate).toBeLessThan(fallback);
    expect(candidate).toBeLessThanOrEqual(1024);
  }finally{installPifrostImageTokenPolicy(undefined,undefined)}
});
