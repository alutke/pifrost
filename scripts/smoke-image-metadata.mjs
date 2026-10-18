/**
 * Opt-in, read-only Bifrost /v1/models capability inspection.
 * It reports only counts and whether optional image-count metadata is present.
 * No provider inference or image submission occurs.
 */
import { requestJson } from "../http-client.mjs";
if (process.env.PIFROST_LIVE_IMAGE_METADATA !== "1") {
  console.error("Set PIFROST_LIVE_IMAGE_METADATA=1 to make a live gateway inventory request.");
  process.exitCode=2;
} else if(!process.env.BIFROST_URL || !process.env.BIFROST_VIRTUAL_KEY) {
  console.error("BIFROST_URL and BIFROST_VIRTUAL_KEY are required.");
  process.exitCode=2;
} else {
  try {
    const url=new URL(process.env.BIFROST_URL);
    if(!/\/v1\/?$/.test(url.pathname)||!["http:","https:"].includes(url.protocol))
      throw Error("endpoint must be a Bifrost /v1 URL");
    const result=await requestJson(url.toString().replace(/\/$/,"")+"/models",{
      method:"GET",timeoutMs:12000,maxResponseBytes:4*1024*1024,
      headers:{"x-bf-vk":process.env.BIFROST_VIRTUAL_KEY,
        Authorization:"Bearer "+process.env.BIFROST_VIRTUAL_KEY},
    });
    if(!Array.isArray(result?.data))throw Error("invalid inventory envelope");
    let images=0, explicit=0, invalid=0;
    for(const model of result.data){
      const capable=model?.architecture?.input_modalities?.some(x=>typeof x==="string"&&x.toLowerCase().includes("image"));
      if(!capable)continue;
      images++;
      const values=[model.image_count_budget,model.per_request_limits?.images].filter(x=>x!==undefined);
      if(!values.length)continue;
      if(values.some(x=>!Number.isSafeInteger(x)||x<1||x>10000)||new Set(values).size!==1)invalid++;
      else explicit++;
    }
    console.log(JSON.stringify({models:result.data.length,imageCapable:images,
      verifiedOptionalBudgets:explicit,invalidOrConflicting:invalid,
      missingOrUnadvertised:images-explicit-invalid,source:"live Bifrost inventory",
      note:"Optional fields are not a guaranteed gateway contract; absence is normal."},null,2));
    if(invalid)process.exitCode=1;
  }catch {
    console.error("Live inventory inspection failed; inspect gateway connection and logs securely.");
    process.exitCode=1;
  }
}
