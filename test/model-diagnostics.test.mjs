import assert from "node:assert/strict";
import test from "node:test";

import {
  OMP_OPENAI_COMPAT_DEFAULT_EFFORTS,
  effectiveThinking,
  formatModelDiagnostic,
} from "../model-diagnostics.mjs";

function model(overrides = {}) {
  return {
    id: "omp-default",
    contextWindow: 229376,
    maxTokens: 16384,
    reasoning: true,
    input: ["text"],
    compat: { supportsReasoningEffort: true },
    ...overrides,
  };
}

test("doctor preserves an explicit Pifrost effort ladder", () => {
  const result = effectiveThinking(model({
    id: "omp-task",
    thinking: { mode: "effort", efforts: ["high", "max"] },
  }));
  assert.deepEqual(result, { efforts: ["high", "max"], source: "explicit" });
});

test("doctor reports OMP 18 fallback efforts for sparse openai-completions reasoning aliases", () => {
  const result = effectiveThinking(model({ thinking: undefined }));
  assert.deepEqual(result, {
    efforts: [...OMP_OPENAI_COMPAT_DEFAULT_EFFORTS],
    source: "omp-derived",
  });
});

test("doctor does not invent thinking for non-reasoning aliases", () => {
  assert.deepEqual(effectiveThinking(model({ reasoning: false, thinking: undefined })), {
    efforts: [],
    source: "none",
  });
});

test("formatted doctor line matches OMP-visible effective ladder", () => {
  const line = formatModelDiagnostic(model({ input: ["text", "image"] }));
  assert.match(line, /thinking=minimal,low,medium,high/);
  assert.match(line, /images=yes/);
  assert.match(line, /source=omp-derived/);
});
