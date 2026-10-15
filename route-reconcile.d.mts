import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
export function createOnDemandRouteCheck(options: {
  now?: () => number;
  minIntervalMs?: number;
  run: () => Promise<{ status: string; schemaVersion?: number }>;
  refresh: (context: ExtensionContext) => Promise<void>;
  notify?: (message: string, level: "info" | "warning", context: ExtensionContext) => void;
}): (context: ExtensionContext) => Promise<{ status: string; [key: string]: unknown } | undefined>;
