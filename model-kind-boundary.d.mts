export interface BifrostKindEvidence { kind: string; source: string; chat: boolean }
export function bifrostModelKindEvidence(model: unknown): BifrostKindEvidence;
export function isBifrostChatModel(model: unknown): boolean;
export function bifrostModelKindSummary(models: unknown[]): { chat: number; nonChat: number; unknown: number };
