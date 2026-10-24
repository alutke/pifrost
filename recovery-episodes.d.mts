export const PIFROST_RECOVERY_EPISODE_TYPE:"dev.pifrost.recovery-episode.v2";
export const LEGACY_RECOVERY_ATTEMPT_TYPE:"dev.pifrost.recovery-attempt.v1";
export interface ProgressProof {
  kind:"initial"|"paired-tool"|"verified-step"|"user-resume";
  entryId:string;
  fingerprint:string;
}
export interface EpisodeAttempt {
  schemaVersion:1|2;
  sessionKey:string;anchor:string;ordinal:number;
  stage:"native"|"context"|"model";assistantEntryId:string;reason:string;
  episodeKey?:string;proof?:ProgressProof;
}
export interface EpisodeState {
  records:EpisodeAttempt[];
  episodeAttempts:number;
  episodeKey:string;proof:ProgressProof;
  lastAttemptIndex:number;anchorIndex:number;
  nextProgress:ProgressProof|null;
}
export function recoveryEpisodeState(branch:readonly unknown[],scope:{anchor:string},
  sessionId:string,cwd?:string,limit?:number):EpisodeState|null;
export function nextRecoveryEpisode(state:EpisodeState,anchor:string):{
  episodeKey:string;proof:ProgressProof;attempts:number;newEpisode:boolean;
};
