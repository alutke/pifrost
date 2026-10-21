/**
 * Operator-controlled recovery with the pinned OMP ExtensionCommandContext
 * capabilities: user-approved newSession, not synthetic session mutations.
 */
import { assessRecovery, formatRecoveryStatus, type RecoveryTraceEvidence } from "./controlled-recovery.ts";

export interface RecoveryCommandHost {
  readonly isMain: boolean;
  readonly interactive: boolean;
  readonly isIdle: () => boolean;
  readonly hasPendingMessages: () => boolean;
  readonly hasRunningAsyncJobs: () => boolean;
  readonly parentSessionFile?: string;
  readonly currentSessionId: string;
  readonly notify: (message: string, level: "info" | "warning" | "error") => void;
  readonly input: (title: string, placeholder: string) => Promise<string | undefined>;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly newSession: (options: { parentSession?: string }) => Promise<{ cancelled: boolean }>;
  readonly sendUserMessage: (message: string) => void;
}

function safeToFork(host: RecoveryCommandHost): string | undefined {
  if (!host.isMain || !host.interactive) return "Recovery fork requires an interactive top-level OMP session.";
  if (!host.isIdle()) return "OMP is still executing; recovery cannot interrupt an active turn.";
  if (host.hasPendingMessages()) return "OMP has queued messages; finish or clear them before recovery.";
  if (host.hasRunningAsyncJobs()) return "OMP has running asynchronous jobs; complete them before recovery.";
  if (!host.currentSessionId || !host.parentSessionFile) return "OMP has no saved source session to preserve.";
  return undefined;
}

/** A user-written brief is the only content sent to the new session.
 * The original session remains on disk, while the workspace is unchanged.
 * No previous tool calls, reasoning signatures, or assistant turns are copied. */
export function recoveryContinuationPrompt(userBrief: string): string {
  return [
    "Continue the following task in this NEW OMP session.",
    "The prior session could not replay its reasoning history. No prior assistant reasoning or tool calls were transferred.",
    "The working directory may contain changes made before the failure. Inspect existing files, git status and relevant test/output evidence BEFORE any non-idempotent actions.",
    "Do not repeat prior writes, commands, deployments, releases, purchases or external actions without verifying whether they already occurred.",
    "Do not claim work is complete without fresh evidence. If context is missing, ask for it; never infer unobserved previous actions.",
    "",
    "User-provided continuation brief:",
    userBrief,
  ].join("\n");
}

export async function handleRecoveryCommand(
  args: string,
  latest: RecoveryTraceEvidence | undefined,
  host: RecoveryCommandHost,
): Promise<"status" | "cancelled" | "forked" | "blocked"> {
  const action = args.trim().toLowerCase() || "status";
  if (action !== "status" && action !== "fork") {
    host.notify("Usage: /pifrost recover [status|fork]. 'fork' creates a new session only after your confirmation.", "warning");
    return "blocked";
  }
  const assessment = assessRecovery(latest);
  if (action === "status") {
    host.notify(formatRecoveryStatus(assessment), assessment ? "warning" : "info");
    return "status";
  }
  if (!assessment?.mayFork) {
    host.notify(formatRecoveryStatus(assessment) + "\nA clean fork is offered only for a classified, pre-output reasoning-history failure.", "warning");
    return "blocked";
  }

  const unsafe = safeToFork(host);
  if (unsafe) { host.notify(unsafe, "warning"); return "blocked"; }

  const brief = await host.input(
    "Recovery: describe what to continue",
    "State the current task, relevant file/project and what is already done. No old transcript will be copied.",
  );
  if (brief === undefined) return "cancelled";
  const cleaned = brief.trim();
  if (!cleaned) {
    host.notify("Recovery not started: enter a task brief. No session changes were made.", "warning");
    return "blocked";
  }

  // Re-check, as an input modal can outlive the originating idle state.
  const afterInput = safeToFork(host);
  if (afterInput) { host.notify(afterInput, "warning"); return "blocked"; }

  const confirmed = await host.confirm(
    "Create a fresh OMP recovery session?",
    [
      "The existing session stays saved and can be reopened.",
      "The new session will inherit the working directory, NOT the old assistant or tool history.",
      "Only the task brief you wrote will be sent as a new user request.",
      "Inspect workspace effects before acting. No tool replay or automatic provider retry will occur.",
      "",
      "Proceed?",
    ].join("\n"),
  );
  if (!confirmed) return "cancelled";

  // Final guard before a state-changing host API call.
  const afterConfirmation = safeToFork(host);
  if (afterConfirmation) { host.notify(afterConfirmation, "warning"); return "blocked"; }

  const result = await host.newSession({ parentSession: host.parentSessionFile });
  if (result.cancelled) {
    host.notify("OMP cancelled the new session; original session and context remain unchanged.", "info");
    return "cancelled";
  }
  host.sendUserMessage(recoveryContinuationPrompt(cleaned));
  host.notify("Pifrost recovery: started an OMP-managed clean session from your brief. Original session remains saved. No previous tools were replayed.", "info");
  return "forked";
}
