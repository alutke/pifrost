import assert from "node:assert/strict";
import test from "node:test";
import {
  BIFROST_CODE_MODE_TOOLS,
  HOUND_TOOLS,
  houndMcpDiagnostics,
  probeHoundCodeMode,
} from "../hound-diagnostics.mjs";

test("Hound live verification requires an actually visible Hound path", () => {
  const clients = [{
    id: "hound-id",
    name: "hound",
    state: "connected",
    isCodeModeClient: false,
    tools: HOUND_TOOLS,
  }];
  const diagnostics = houndMcpDiagnostics(
    {
      effective: [{ client: "hound", tools: ["*"], sources: ["direct"] }],
      virtualMcps: [],
    },
    clients,
    [],
    { liveTools: [{ name: "github-search" }] },
  );
  assert.equal(diagnostics.hound.configured, true);
  assert.equal(diagnostics.hound.liveVerified, false);
  assert.equal(diagnostics.hound.available, false);
});

test("Code Mode screenshot capability is reported as conditional, not safely recoverable", () => {
  const clients = [{
    id: "hound-id",
    name: "hound",
    state: "connected",
    isCodeModeClient: true,
    tools: HOUND_TOOLS,
  }];
  const diagnostics = houndMcpDiagnostics(
    {
      effective: [{ client: "hound", tools: ["*"], sources: ["direct"] }],
      virtualMcps: [],
    },
    clients,
    [],
    {
      liveTools: BIFROST_CODE_MODE_TOOLS.map((name) => ({ name })),
      codeModeProbe: {
        ok: true,
        bindingLevel: "server",
        serverName: "hound",
        fileName: "servers/hound.pyi",
        tools: HOUND_TOOLS,
        files: ["servers/hound.pyi"],
      },
    },
  );
  assert.equal(diagnostics.hound.screenshotCallable, true);
  assert.equal(diagnostics.hound.visualWebReady, false);
  assert.equal(diagnostics.hound.visualWebRecoverable, false);
  assert.equal(diagnostics.hound.visualWebConditional, true);
  assert.equal(diagnostics.hound.visualWebStatus, "conditional-code-mode");
});

test("Code Mode probe requires real pyi function signatures rather than tool-name substrings", async () => {
  const probe = await probeHoundCodeMode(async (name, args) => {
    if (name === "listToolFiles") {
      return { content: [{ type: "text", text: "servers/\n  hound.pyi" }] };
    }
    if (name === "readToolFile" && args.fileName === "servers/hound.pyi") {
      return {
        content: [{
          type: "text",
          text: [
            "# mcp_smart_search is mentioned in a comment only",
            "DESCRIPTION = 'mcp_smart_fetch mcp_smart_crawl mcp_screenshot'",
            "def unrelated() -> dict:",
          ].join("\n"),
        }],
      };
    }
    throw new Error(`unexpected call ${name}`);
  }, ["hound"]);
  assert.equal(probe.ok, false);
});


test("Hound capability readiness respects Bifrost executable allow-list enforcement", () => {
  const clients = [{
    id: "hound-id",
    name: "hound",
    state: "connected",
    isCodeModeClient: true,
    tools: HOUND_TOOLS,
  }];
  const diagnostics = houndMcpDiagnostics(
    {
      effective: [{
        client: "hound",
        tools: ["*"],
        executableTools: ["mcp_smart_fetch", "mcp_smart_crawl"],
        autoExecutableTools: [],
        executionPolicyKnown: true,
        autoExecutionPolicyKnown: true,
        sources: ["direct"],
      }],
      virtualMcps: [],
    },
    clients,
    [],
    {
      liveTools: BIFROST_CODE_MODE_TOOLS.map((name) => ({ name })),
      codeModeProbe: {
        ok: true,
        bindingLevel: "server",
        serverName: "hound",
        fileName: "servers/hound.pyi",
        tools: HOUND_TOOLS,
        files: ["servers/hound.pyi"],
      },
    },
  );
  assert.equal(diagnostics.hound.capabilities.search.configured, true);
  assert.equal(diagnostics.hound.capabilities.search.executionPolicyKnown, true);
  assert.equal(diagnostics.hound.capabilities.search.executable, false);
  assert.equal(diagnostics.hound.capabilities.search.available, false);
  assert.equal(diagnostics.hound.capabilities.fetch.executable, true);
  assert.equal(diagnostics.hound.capabilities.fetch.available, true);
});
