import assert from "node:assert/strict";
import test from "node:test";

import { effectiveRepoMcpPolicy } from "../cli-lib.mjs";
import { normalizeMcpClientShape } from "../mcp-client-shape.mjs";

test("effective MCP policy intersects repo grants with Bifrost client execution allow-lists", () => {
  const client = normalizeMcpClientShape({
    config: {
      client_id: "hound-id",
      name: "hound",
      tools_to_execute: ["mcp_smart_search"],
      tools_to_auto_execute: ["mcp_smart_search", "mcp_smart_fetch"],
    },
    tools: ["mcp_smart_search", "mcp_smart_fetch"],
  });
  const policy = effectiveRepoMcpPolicy({
    id: "vk-1",
    mcp_configs: [{
      mcp_client_id: "hound-id",
      mcp_client_name: "hound",
      tools_to_execute: ["*"],
    }],
  }, [], [client]);

  assert.equal(policy.effective.length, 1);
  const grant = policy.effective[0];
  assert.deepEqual(grant.tools, ["*"]);
  assert.equal(grant.executionPolicyKnown, true);
  assert.deepEqual(grant.executableTools, ["mcp_smart_search"]);
  assert.equal(grant.autoExecutionPolicyKnown, true);
  assert.deepEqual(grant.autoExecutableTools, ["mcp_smart_search"]);
});

test("older MCP client shapes remain fail-compatible when execution policy fields are absent", () => {
  const client = normalizeMcpClientShape({
    client_id: "legacy-id",
    name: "legacy",
    available_tools: ["read", "write"],
  });
  const policy = effectiveRepoMcpPolicy({
    id: "vk-1",
    mcp_configs: [{
      mcp_client_name: "legacy",
      tools_to_execute: ["read"],
    }],
  }, [], [client]);

  const grant = policy.effective[0];
  assert.equal(grant.executionPolicyKnown, false);
  assert.deepEqual(grant.executableTools, ["read"]);
  assert.equal(grant.autoExecutionPolicyKnown, false);
  assert.deepEqual(grant.autoExecutableTools, []);
});

test("broad Bifrost auto-execution is surfaced as a warning without mutation", () => {
  const client = normalizeMcpClientShape({
    config: {
      client_id: "automation-id",
      name: "automation",
      tools_to_execute: ["*"],
      tools_to_auto_execute: ["*"],
    },
    tools: ["read", "write"],
  });
  const policy = effectiveRepoMcpPolicy({
    id: "vk-1",
    mcp_configs: [{
      mcp_client_name: "automation",
      tools_to_execute: ["*"],
    }],
  }, [], [client]);

  assert.deepEqual(policy.effective[0].autoExecutableTools, ["read", "write"]);
  assert.match(policy.warnings[0] ?? "", /tools_to_auto_execute=\*/u);
});
