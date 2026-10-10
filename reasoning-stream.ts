import type { AssistantMessage, AssistantMessageEvent } from "@oh-my-pi/pi-ai";

/**
 * Narrow, evidence-led live-stream repair. In captured CommandCode DeepSeek
 * Responses streams Bifrost emitted TWO literal synthetic replay markers
 * followed by <think> before the genuine reasoning. Never suppress one
 * occurrence, other models, ordinary answers or unrecognised prefixes.
 */
const CONFIRMED_PREFIX = /^(?:reasoning unavailable[ \t]*(?:\r?\n[ \t]*)?){2,}(?=<think>)/u;
const MAX_PREFIX_LOOKAHEAD = 256;

export interface ReasoningHygieneCounters {
  replayRemoved: number;
  replayMixedRewritten: number;
  replayAmbiguousRetained: number;
  replayStructuredRetained: number;
  rawReasoningSseFrames: number;
  rawReasoningMarkerFrames: number;
  outputThinkingDeltas: number;
  outputPrefixesRemoved: number;
  outputPrefixCharsRemoved: number;
}
export function newReasoningHygieneCounters(): ReasoningHygieneCounters {
  return {
    replayRemoved: 0, replayMixedRewritten: 0, replayAmbiguousRetained: 0,
    replayStructuredRetained: 0, rawReasoningSseFrames: 0,
    rawReasoningMarkerFrames: 0, outputThinkingDeltas: 0,
    outputPrefixesRemoved: 0, outputPrefixCharsRemoved: 0,
  };
}

/** Only count wire-event metadata. Never retain/log SSE data or request content.
 * This observes Bifrost -> OMP, not the inaccessible provider -> Bifrost hop. */
export function observeReasoningSse(
  counters: ReasoningHygieneCounters,
  event: { event?: string; data?: string },
): void {
  if (typeof event.event !== "string" || !event.event.startsWith("response.reasoning")) return;
  counters.rawReasoningSseFrames++;
  if (typeof event.data === "string" && event.data.includes("reasoning unavailable")) {
    counters.rawReasoningMarkerFrames++;
  }
}

type Pending = {
  index: number;
  buffered: string;
  last: Extract<AssistantMessageEvent, { type: "thinking_delta" }>;
};

/**
 * Stateful transform of OMP's published event protocol. Buffers only an
 * initially ambiguous leading prefix. All emitted deltas, partial snapshots,
 * thinking_end and terminal messages agree. A non-match is replayed verbatim.
 * No changes to native replay signatures, encrypted reasoning, tool data or IDs.
 */
export class ResponsesReasoningPrefixFilter {
  private pending?: Pending;
  private decided: "pass" | "strip" | undefined;
  private activeIndex?: number;
  private readonly removed = new Map<number, string>();

  constructor(
    private readonly counters: ReasoningHygieneCounters,
    private readonly enabled: boolean,
  ) {}

  private clean(message: AssistantMessage): AssistantMessage {
    if (!this.removed.size) return message;
    let changed = false;
    const content = message.content.map((part, index) => {
      const prefix = this.removed.get(index);
      if (!prefix || part.type !== "thinking" || !part.thinking.startsWith(prefix)) return part;
      changed = true;
      return { ...part, thinking: part.thinking.slice(prefix.length) };
    });
    return changed ? { ...message, content } : message;
  }

  private snapshot(event: AssistantMessageEvent): AssistantMessageEvent {
    if (!this.removed.size) return event;
    if (event.type === "done") return { ...event, message: this.clean(event.message) };
    if (event.type === "error") return { ...event, error: this.clean(event.error) };
    return { ...event, partial: this.clean(event.partial) };
  }

  private flushPending(): AssistantMessageEvent[] {
    const pending = this.pending;
    if (!pending) return [];
    this.pending = undefined;
    // Reconstruct the only withheld semantic delta. It carries the last
    // original partial and the combined delta; both agree on final thinking.
    return [{ ...pending.last, delta: pending.buffered }];
  }

  /** Returns zero or more valid OMP events. */
  consume(event: AssistantMessageEvent): AssistantMessageEvent[] {
    if (!this.enabled) return [event];
    if (event.type === "start") {
      const flushed = this.flushPending();
      this.decided = undefined;
      this.activeIndex = undefined;
      this.removed.clear();
      return [...flushed, event];
    }

    if (event.type === "thinking_start") {
      const flushed = this.flushPending();
      this.activeIndex = event.contentIndex;
      this.decided = undefined;
      return [...flushed, this.snapshot(event)];
    }
    if (event.type === "thinking_delta") {
      this.counters.outputThinkingDeltas++;
      if (this.activeIndex !== event.contentIndex) {
        const flushed = this.flushPending();
        this.activeIndex = event.contentIndex;
        this.decided = undefined;
        return [...flushed, ...this.consumeDelta(event)];
      }
      return this.consumeDelta(event);
    }

    const flushed = this.flushPending();
    if (event.type === "thinking_end") {
      this.activeIndex = undefined;
      this.decided = undefined;
      const updated = this.snapshot(event);
      const prefix = this.removed.get(event.contentIndex);
      return [...flushed, prefix && updated.type === "thinking_end" &&
        updated.content.startsWith(prefix)
        ? { ...updated, content: updated.content.slice(prefix.length) }
        : updated];
    }
    return [...flushed, this.snapshot(event)];
  }

  private consumeDelta(
    event: Extract<AssistantMessageEvent, { type: "thinking_delta" }>,
  ): AssistantMessageEvent[] {
    if (this.decided === "pass" || this.decided === "strip") return [this.snapshot(event)];
    if (!this.pending) this.pending = { index: event.contentIndex, buffered: "", last: event };
    this.pending.buffered += event.delta;
    this.pending.last = event;
    const buffered = this.pending.buffered;

    // Avoid delaying ordinary reasoning. Delay only while it might still be
    // the exact reported two-marker prefix, up to a strict 256-character cap.
    const couldBeMarker = "reasoning unavailable".startsWith(buffered) ||
      buffered.startsWith("reasoning unavailable");
    if (!couldBeMarker || buffered.includes("<think>") || buffered.length >= MAX_PREFIX_LOOKAHEAD) {
      const match = couldBeMarker ? CONFIRMED_PREFIX.exec(buffered) : null;
      this.pending = undefined;
      if (match) {
        this.decided = "strip";
        this.removed.set(event.contentIndex, match[0]);
        this.counters.outputPrefixesRemoved++;
        this.counters.outputPrefixCharsRemoved += match[0].length;
        const remaining = buffered.slice(match[0].length);
        return remaining ? [this.snapshot({ ...event, delta: remaining })] : [];
      }
      this.decided = "pass";
      return [{ ...event, delta: buffered }];
    }
    return [];
  }
}
