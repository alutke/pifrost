import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeProviderBlock, mergeNativeProviderYaml, nativeModelsPath, nativeModelsStatus, writeNativeModels } from "../native-models.mjs";

test("Pifrost 0.30 native provider is opt-in and never edits roles", () => {
  const src = "providers:\n  other:\n    baseUrl: https://local.invalid/v1\n    api: openai-completions\n";
  const block = nativeProviderBlock("http://127.0.0.1:8180/v1");
  const withBifrost = mergeNativeProviderYaml(src, block);
  assert.match(withBifrost, /providers:\n  # PIFROST-NATIVE-MODELS-START/u);
  assert.match(withBifrost, /  other:\n/u);
  assert.match(withBifrost, /auth: none/u);
  assert.doesNotMatch(withBifrost,/apiKey:|authHeader: true/u);
  assert.match(withBifrost, /x-bf-vk: "!pifrost secret inference-vk"/u);
  assert.equal(mergeNativeProviderYaml(withBifrost,block),withBifrost);
  assert.match(mergeNativeProviderYaml(withBifrost,""),/  other:/u);
  assert.doesNotMatch(mergeNativeProviderYaml(withBifrost,""),/  bifrost:/u);
  assert.doesNotMatch(withBifrost,/modelRoles|enabledModels|retry\.modelFallback/u);
});

test("native provider protects unmanaged and hand-edited configs", () => {
  const block = nativeProviderBlock("https://gateway.invalid/v1","openai-responses");
  assert.throws(()=>mergeNativeProviderYaml("providers:\n  bifrost:\n    api: openai-responses\n",block),/(?:unmanaged|Existing Bifrost)/u);
  assert.throws(()=>mergeNativeProviderYaml("providers:\n"+block.replace("openai-responses","openai-completions").replace("    authHeader: false","    authHeader: true")+"\n",""),/local edits/u);
  assert.throws(()=>mergeNativeProviderYaml("providers:\n  # PIFROST-NATIVE-MODELS-START\n",block),/marker mismatch/u);
  assert.throws(()=>nativeProviderBlock("file:///tmp/v1"),/plain HTTP/u);
});

test("native provider writes atomically, retains unrelated providers, and disables", () => {
  const root=mkdtempSync(join(tmpdir(),"pifrost-native-"));
  const env={PI_CODING_AGENT_DIR:root};
  try {
    const path=nativeModelsPath(env);
    mkdirSync(root,{recursive:true});
    const original="providers:\n  user-api:\n    api: openai-completions\n    baseUrl: https://user.invalid/v1\n";
    writeFileSync(path,original);
    assert.equal(nativeModelsStatus(env).enabled,false);
    const first=writeNativeModels("openai-completions","http://127.0.0.1:8180/v1",env);
    assert.equal(first.changed,true);
    assert.ok(existsSync(first.backup));
    assert.equal(readFileSync(first.backup,"utf8"),original);
    assert.equal(nativeModelsStatus(env).protocol,"openai-completions");
    assert.equal(writeNativeModels("openai-completions","http://127.0.0.1:8180/v1",env).changed,false);
    const removed=writeNativeModels(null,null,env);
    assert.equal(removed.changed,true);
    assert.equal(nativeModelsStatus(env).enabled,false);
    assert.match(readFileSync(path,"utf8"),/user-api/u);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("native model editor refuses duplicate and unsupported YAML layouts without writes",()=>{
 const block=nativeProviderBlock("http://127.0.0.1:8180/v1");
 assert.throws(()=>mergeNativeProviderYaml("providers:\n  other: {}\nproviders:\n  another: {}\n",block),/Duplicate root/u);
 assert.throws(()=>mergeNativeProviderYaml("---\nproviders:\n  other: {}\n",block),/Unsupported YAML/u);
 assert.throws(()=>mergeNativeProviderYaml("providers:\n  \"bifrost\": {}\n",block),/Existing Bifrost/u);
 assert.throws(()=>mergeNativeProviderYaml("providers: {other: {}}\n",block),/Non-standard root/u);
});
