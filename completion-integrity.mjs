/**
 * Release 30G: shared conservative leaked-planning detector.
 * This detects suspicious completion, but cannot authorize any retry.
 * OMP journal, checkpoint, pending work and cancellation guards still apply.
 */
const CLOSE=/<\/(?:think|thinking)>/giu;
const TRAILING_CLOSE=/(?:\s*<\/(?:think|thinking)>\s*)+$/iu;
const PAIRED=/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/iu;
const PILCROW=/(?:^|\n)\s*¶think\s*:/iu;
const LEAD=/\b(?:let(?:'s| me| us)|i(?:'ll| will| should| need to)|we(?:'ll| will| should| need to)|next(?: i| we| step)?|now(?: i| we)?|start with|first|proceed to)\b/giu;
const ACTION=/\b(?:start|write|patch|add|implement|run|check|fix|inspect|test|verify|update|review|build|commit|push|do|proceed|finish|measure|retest|remove|read|wire|wiring|edit|ci|docs|documentation|release)\b/iu;
const FINAL=/\b(?:all (?:work|tasks) (?:is|are) complete|release (?:is )?(?:complete|published)|task (?:is )?complete|no further action(?:s)? (?:is|are) required)\b|(?:^|\n)\s*#{1,5}\s*(?:final(?: report)?|summary|results|outcome)\b/iu;

/** Recognize high-confidence planning leakage, not merely an incomplete plan. */
export function isLeakedPlanningStop(value) {
  if(typeof value!=="string" || !value.trim())return false;
  const tail=value.slice(-4000);
  const closes=[...tail.matchAll(CLOSE)];
  const terminalTags=TRAILING_CLOSE.test(tail);
  if(!(closes.length>=2 || PAIRED.test(tail) || PILCROW.test(tail)))return false;
  const stripped=tail.replace(TRAILING_CLOSE,"").trim();
  const last=stripped.slice(-1600);
  let lastAction=null;
  for(const match of last.matchAll(LEAD)){
    const following=last.slice((match.index??0)+match[0].length);
    const clause=following.split(/[\n.!?]/u,1)[0].slice(0,145);
    const action=ACTION.exec(clause);
    if(action)lastAction=(match.index??0)+match[0].length+action.index+action[0].length;
  }
  if(lastAction===null)return false;
  const after=last.slice(lastAction);
  if(after.length>220 || FINAL.test(after))return false;
  // Internal quoted thinking-tag examples followed by explanatory prose are
  // not leaked planning. Planning inside tags is only accepted when the
  // response actually terminates in closing-tag artifacts.
  if(!terminalTags && !PILCROW.test(tail)){
    for(const marker of ["</thinking>","</think>"]){
      const lastClose=last.lastIndexOf(marker);
      if(lastClose>=0 && lastAction<lastClose)return false;
    }
  }
  return true;
}
