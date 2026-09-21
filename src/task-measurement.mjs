/** Whole-task usage observations: what one task actually cost the coding
 * model, read from the coder's own trace over the task-session window. */
import {createHash} from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const TASK_CAMPAIGN='task-usage-v1';
export const TASK_LIMITS={perProject:200,total:1000};
export const GAPS=['trace-unavailable','trace-changed','usage-missing','counter-reset','delegated-usage','overlapping-tasks','unfinished-turn','unsupported-coder','dirty-start','late-enrollment','external-usage-unverified'];
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=1e12;
export function taskInput(x) {
  if(!x||!hash(x.requestId)||!hash(x.taskDigest)||!hash(x.sessionDigest)||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(x.revision??'')||!(/^[A-Z]{2,8}-\d{1,7}$/).test(x.card??'')||!Number.isFinite(Date.parse(x.startedAt)))throw Error('Expected card, source revision, task/session digests and start time.');
  return {requestId:x.requestId,card:x.card,revision:x.revision,taskDigest:x.taskDigest,sessionDigest:x.sessionDigest,startedAt:new Date(x.startedAt).toISOString()};
}
export function taskObservation(x) {
  if(!x||!['active','review','done','ice'].includes(x.status))throw Error('Invalid task observation.');
  if(!Array.isArray(x.gaps)||x.gaps.length>12||x.gaps.some(g=>!GAPS.includes(g)))throw Error('Invalid collection gaps.');
  let usage=null;
  if(x.usage!==null){
    const u=x.usage;
    if(!u||!['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','modelCalls'].every(k=>integer(u[k]))||u.cachedInputTokens>u.inputTokens||u.reasoningOutputTokens>u.outputTokens)throw Error('Invalid observed usage.');
    usage=Object.fromEntries(['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','modelCalls'].map(k=>[k,u[k]]));
  }
  if(!Array.isArray(x.models)||x.models.length>20||x.models.some(m=>typeof m!=='string'||!(/^[a-zA-Z0-9_.:-]{1,100}$/).test(m)))throw Error('Invalid model identifiers.');
  return {status:x.status,usage,models:x.models,gaps:[...new Set(x.gaps)],source:'codex-rollout',scope:'task-session-window',costUsd:null,success:x.status==='done'?true:x.status==='ice'?false:null};
}
/** One total over the metered runs, and every run on its own, so a reader
 * compares tasks by eye instead of trusting an aggregate. */
export function taskReport(runs) {
  const finished=runs.filter(r=>['review','done','ice'].includes(r.result?.status));
  const metered=finished.filter(r=>r.result.usage&&!r.result.gaps.some(g=>g!=='external-usage-unverified'));
  const sum=k=>metered.reduce((n,r)=>n+r.result.usage[k],0);
  return {campaign:TASK_CAMPAIGN,started:runs.length,finished:finished.length,metered:metered.length,accepted:finished.filter(r=>r.result.success===true).length,awaitingOutcome:finished.filter(r=>r.result.success===null).length,
    inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cachedInputTokens:sum('cachedInputTokens'),reasoningOutputTokens:sum('reasoningOutputTokens'),modelCalls:sum('modelCalls'),
    runs:runs.map(r=>({id:r.id,card:r.card,startedAt:r.startedAt,status:r.result?.status??'pending',usage:r.result?.usage??null,models:r.result?.models??[],gaps:r.result?.gaps??[]})),
    remainingProjectRuns:Math.max(0,TASK_LIMITS.perProject-runs.length),pending:runs.filter(r=>!r.result||r.result.status==='active').length,collectionGaps:runs.filter(r=>r.result?.gaps.some(g=>g!=='external-usage-unverified')).length,taskCostUsd:null,
    guidance:'Observed task-session windows of the coding model, read from its own trace. Cached input is included in input; reasoning is included in output. Different tasks are not comparable runs. External model usage is unverified. Acceptance is board state, not independent review.'};
}
