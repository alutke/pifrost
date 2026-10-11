export interface JudgeGatewayConfig { url: string; virtualKey?: string; apiKey?: string }
export interface NativeJudgeSelection { model: string; selector: string }
export interface NativeJudgeGateway extends NativeJudgeSelection { provider: string; baseUrl: string; virtualKey: string }
export const PIFROST_JUDGE_PROVIDER: "bifrost-judge";
export const PIFROST_JUDGE_ENV: "PIFROST_NATIVE_JUDGE_MODEL";
export function nativeJudgeSelection(env?: NodeJS.ProcessEnv): NativeJudgeSelection | undefined;
export function nativeJudgeGateway(config: JudgeGatewayConfig | undefined, env?: NodeJS.ProcessEnv): NativeJudgeGateway | undefined;
export function validateNativeJudgeResponse(body: unknown, questions: Record<string, "noul" | "choice" | "score">): { model: string; answered: number; hasUsage: boolean };
export function nativeJudgeProbeRequest(model: string): { model: string; state: string; questions: Record<string, unknown> };
export function parseNativeJudgeModelsResponse(body: unknown): string[];
