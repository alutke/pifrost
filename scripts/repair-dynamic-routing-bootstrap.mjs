import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-dynamic-routing-0.4.0.mjs";
let source = readFileSync(path, "utf8");

function replaceRequired(before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing repair anchor: ${label}`);
  source = source.replace(before, after);
}

// The generated dynamic-routing.ts lives inside a template literal in the
// bootstrap script. Avoid nested template literals in the generated source so
// the bootstrap itself parses under Node.
replaceRequired(
  'reasons.push(`context ${member.contextWindow} < required ${requiredContextTokens}`);',
  'reasons.push("context " + member.contextWindow + " < required " + requiredContextTokens);',
  "context exclusion message",
);
replaceRequired(
  'reasons.push(`max-output ${member.maxTokens} < requested ${outputReserveTokens}`);',
  'reasons.push("max-output " + member.maxTokens + " < requested " + outputReserveTokens);',
  "output exclusion message",
);
replaceRequired(
  '`Pifrost dynamic route ${profile.id} has no eligible member for estimated input ${estimatedInputTokens} + output reserve ${outputReserveTokens} = ${requiredContextTokens} tokens; compact the session or lower the requested output ceiling`,',
  '"Pifrost dynamic route " + profile.id + " has no eligible member for estimated input " + estimatedInputTokens + " + output reserve " + outputReserveTokens + " = " + requiredContextTokens + " tokens; compact the session or lower the requested output ceiling",',
  "capacity error message",
);

// Keep TypeScript's unknown-valued recursive walk explicit, and avoid a slash
// escape being consumed by the bootstrap template before the generated regex is
// parsed.
replaceRequired(
  'return Object.values(record).reduce((sum, item) => sum + imagePartCount(item, depth + 1), 0);',
  'return Object.values(record).reduce<number>((sum, item) => sum + imagePartCount(item, depth + 1), 0);',
  "image recursive reducer type",
);
replaceRequired(
  'if (/^data:image\\//iu.test(item)) return "[image-data]";',
  'if (item.toLowerCase().startsWith("data:image/")) return "[image-data]";',
  "image data URI detection",
);

// Bifrost exposes `request` as the request-rate-limit percentage. A rule using
// it is dynamic governance and must never be bypassed by local route compilation.
replaceRequired(
  '  "provider",\\n]);',
  '  "provider",\\n  "request",\\n]);',
  "request governance identifier",
);

writeFileSync(path, source);
console.log("Dynamic routing bootstrap repaired");
