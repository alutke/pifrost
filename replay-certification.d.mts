export function certifyReplayHygiene(original:unknown,cleaned:unknown,
 protocol:"openai-responses"|"openai-completions",
 options?:{allowSyntheticReasoningRemoval?:boolean}):
 {payload:unknown;accepted:boolean;reason:"unchanged"|"structurally-safe"|"preserved-uncertain"};
export function formatRedactedIntegrityReport(options?:{
 hygiene?:{
  removedVisiblePlaceholders?:number;
  retainedReasoningItems?:number;
  removedSyntheticReasoningItems?:number;
 };
 certification?:{accepted?:boolean};
 mode?:"openai-responses"|"openai-completions";
 decision?:{reason?:string};
}):Readonly<{
 schemaVersion:1;reasoningReplay:string;replayItemsRemoved:number|null;
 replayItemsRetained:number|null;replaySyntheticReasoningRemoved:number|null;
 transport:string;stopClass:string;
}>;
