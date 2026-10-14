import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeGatewayComplexity, formatGatewayComplexity,
  summarizeGatewayPrivacy, formatGatewayPrivacy,
  summarizeGatewayResearchTools, formatGatewayResearchTools,
} from "../gateway-observability.mjs";

test("decision classifier is read-only and never exposes prompts or credentials", () => {
  const raw = { classifier: "decision",
    decision: { provider: "typesafe", model: "jev-latest", timeout: "5s",
      criteria: { complex: { definition: "private prompt do not print" } },
      api_key: "sk-secret" },
    session: { enabled: true },
  };
  const view = summarizeGatewayComplexity(raw);
  assert.equal(view.mode, "decision");
  assert.equal(view.session, "enabled");
  assert.deepEqual(view.decision, { provider: "typesafe", model: "jev-latest" });
  const report = formatGatewayComplexity(raw);
  assert.match(report, /mode=decision session-stickiness=enabled/u);
  assert.match(report, /typesafe.*jev-latest/u);
  assert.match(report, /no inference executed/u);
  assert.doesNotMatch(report, /private prompt|sk-secret|criteria|timeout=5s/u);
});

test("semantic classifier fallback and absent/default keyword modes remain honest", () => {
  const report = formatGatewayComplexity({
    classifier: "semantic",
    semantic: { provider: "openai", embedding_model: "text-embedding-3-large", fallback: "llm" },
    llm: { provider: "deepseek", model: "flash", prompt: "do not log" },
    session: { enabled: false },
  });
  assert.match(report, /mode=semantic session-stickiness=disabled/u);
  assert.match(report, /fallback=llm/u);
  assert.match(report, /fallback-llm provider=deepseek model=flash/u);
  assert.doesNotMatch(report, /do not log/u);
  assert.equal(summarizeGatewayComplexity({ keywords: {} }).mode, "keywords");
  assert.match(formatGatewayComplexity(undefined), /unverified/u);
  assert.equal(summarizeGatewayComplexity({ classifier: "not-a-mode" }).mode, "keywords");
});

test("privacy merges global default with explicit tri-state VK override only when inspected", () => {
  const gateway = { client_config: { disable_content_logging: false,
    log_retention_days: 30, retain_content_in_object_storage: true,
    allow_per_request_content_storage_override: true,
    private_key: "secret-should-not-leak" } };
  const unknown = summarizeGatewayPrivacy(gateway);
  assert.equal(unknown.effective, "unverified");
  assert.equal(unknown.global, "disabled");
  const inherited = summarizeGatewayPrivacy(gateway, { id: "vk-1", disable_content_logging: null });
  assert.equal(inherited.vk, "inherit");
  assert.equal(inherited.effective, "on");
  const forcedOff = summarizeGatewayPrivacy(gateway, { disable_content_logging: true, value: "sk-bf-secret" });
  assert.equal(forcedOff.effective, "off");
  const forcedOn = summarizeGatewayPrivacy({ client_config: { disable_content_logging: true } }, { disable_content_logging: false });
  assert.equal(forcedOn.effective, "on");
  const report = formatGatewayPrivacy(gateway, { disable_content_logging: true, value: "sk-bf-secret" });
  assert.match(report, /configured logging default.*off/u);
  assert.match(report, /hidden object-storage retention: enabled/u);
  assert.match(report, /log retention days: 30/u);
  assert.doesNotMatch(report, /secret-should-not-leak|sk-bf-secret|vk-1/u);
  assert.match(formatGatewayPrivacy(gateway), /--vk-id/u);
});

test("unknown privacy settings never claim content logging is off", () => {
  const v = summarizeGatewayPrivacy({}, {});
  assert.equal(v.effective, "unverified");
  assert.match(formatGatewayPrivacy({}, {}), /unverified/u);
  assert.equal(summarizeGatewayPrivacy({clientConfig:{disable_content_logging:true}}, {disable_content_logging:null}).effective, "off");
  assert.equal(summarizeGatewayPrivacy({data:{client_config:{disable_content_logging:true}}}, {disable_content_logging:false}).effective, "on");
});

test("research discovery reports only injected tools with read-only warnings, no keys or nonresearch tools", () => {
  const inventory = {
    schemaReported: true,
    policies: [{ provider:"deepseek", status:"configured", active:true, concerns:[],
      tools:[{name:"web_search", client:"DonSeTch",tool:"web_search"},
             {name:"json_schema",client:"DonSeTch",tool:"generic_tool"},
             {name:"research_fetch",client:"DonSeTch",tool:"web_fetch"}],
      key:"sk-secret" },
      {provider:"openrouter", status:"not-configured", active:false,tools:[]}],
  };
  const result = summarizeGatewayResearchTools(inventory);
  assert.equal(result.known,true);
  assert.equal(result.rows.length,2);
  const report = formatGatewayResearchTools(inventory);
  assert.match(report,/web_search=DonSeTch\/web_search/u);
  assert.match(report,/research_fetch=DonSeTch\/web_fetch/u);
  assert.doesNotMatch(report,/json_schema|sk-secret/u);
  assert.match(report,/No tool execution.*verified/u);
  assert.match(formatGatewayResearchTools({schemaReported:false}),/unverified/u);
});
