import type { AssistantMessageEvent } from "@oh-my-pi/pi-ai";

/** Commitment is generated, irreversible content, never an empty block event.
 * Shared by the physical fallback runner and session diagnostics. */
export function isCommittedModelOutput(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return event.delta.length > 0;
    case "text_end":
      return event.content.length > 0;
    case "thinking_end":
      return event.content.length > 0;
    case "toolcall_end":
    case "image_end":
      return true;
    default:
      return false;
  }
}

export function isUncommittedBlockEvent(event: AssistantMessageEvent): boolean {
  return event.type === "text_start" || event.type === "thinking_start" ||
    event.type === "toolcall_start" || event.type === "text_end" ||
    event.type === "thinking_end" || event.type === "toolcall_delta" ||
    event.type === "text_delta" || event.type === "thinking_delta";
}
