/** Whole-task observations are separate from paid classifier attempts. */
import {digest} from './decision-pilot.mjs';
export const TASK_CAMPAIGN='task-usage-v1';
export const TASK_LIMITS={perProject:200,total:1000};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=1e12;
export function taskInput(x) {
  if(!x||!hash(x.requestId)||!hash(x.taskDigest)||!hash(x.sessionDigest)||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(x.revision??'')||!(/^[A-Z]{2,8}-\d{1,7}$/).test(x.card??'')||!Number.isFinite(Date.parse(x.startedAt)))throw Error('Expected card, source revision, task/session digests and start time.');
  return {requestId:x.requestId,card:x.card,revision:x.revision,taskDigest:x.taskDigest,sessionDigest:x.sessionDigest,startedAt:new Date(x.startedAt).toISOString(),arm:parseInt(digest(x.requestId).slice(0,2),16)%2?'typesafe':'baseline'};
}
export function taskObservation(x) {
  if(!x||!['active','review','done','ice'].includes(x.status)||!['baseline','suggested','fallback','limit','disabled','key-required','unavailable'].includes(x.decision)||!(x.trialId===null||/^[0-9A-Z]{26}$/.test(x.trialId??'')))throw Error('Invalid task observation.');
  if(!Array.isArray(x.gaps)||x.gaps.length>12||x.gaps.some(g=>!['trace-unavailable','trace-changed','usage-missing','counter-reset','delegated-usage','overlapping-tasks','unfinished-turn','unsupported-coder','dirty-start','late-enrollment','external-usage-unverified'].includes(g)))throw Error('Invalid collection gaps.');
  let usage=null;
  if(x.usage!==null){
    const u=x.usage;
    if(!u||!['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','modelCalls'].every(k=>integer(u[k]))||u.cachedInputTokens>u.inputTokens||u.reasoningOutputTokens>u.outputTokens)throw Error('Invalid observed usage.');
    usage=Object.fromEntries(['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','modelCalls'].map(k=>[k,u[k]]));
  }
  if(!Array.isArray(x.models)||x.models.length>20||x.models.some(m=>typeof m!=='string'||!(/^[a-zA-Z0-9_.:-]{1,100}$/).test(m)))throw Error('Invalid model identifiers.');
  if(x.adoption!==null&&typeof x.adoption!=='boolean')throw Error('Adoption must be an explicit boolean or unknown.');
  return {status:x.status,decision:x.decision,trialId:x.trialId,adoption:x.adoption,usage,models:x.models,gaps:[...new Set(x.gaps)],source:'codex-rollout',scope:'task-session-window',costUsd:null,success:x.status==='done'?true:x.status==='ice'?false:null};
}
export function taskReport(runs) {
  const arms={};
  for(const arm of ['baseline','typesafe']){
    const own=runs.filter(r=>r.arm===arm),finished=own.filter(r=>['review','done','ice'].includes(r.result?.status));
    const metered=finished.filter(r=>r.result.usage&&!r.result.gaps.some(g=>g!=='external-usage-unverified'));
    const sum=k=>metered.reduce((n,r)=>n+r.result.usage[k],0);
    arms[arm]={started:own.length,finished:finished.length,metered:metered.length,adopted:own.filter(r=>r.result?.adoption===true).length,adoptionUnknown:own.filter(r=>r.result?.decision==='suggested'&&r.result.adoption===null).length,accepted:finished.filter(r=>r.result.success===true).length,awaitingOutcome:finished.filter(r=>r.result.success===null).length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cachedInputTokens:sum('cachedInputTokens'),modelCalls:sum('modelCalls'),classifierInputTokens:metered.reduce((n,r)=>n+(r.result.classifierInputTokens??0),0),classifierEstimatedCostUsd:metered.reduce((n,r)=>n+(r.result.classifierEstimatedCostUsd??0),0),unmeteredClassifier:metered.filter(r=>r.result.classifierInputTokens===null).length};
  }
  return {campaign:TASK_CAMPAIGN,arms,remainingProjectRuns:Math.max(0,TASK_LIMITS.perProject-runs.length),pending:runs.filter(r=>!r.result||r.result.status==='active').length,collectionGaps:runs.filter(r=>r.result?.gaps.some(g=>g!=='external-usage-unverified')).length,taskCostUsd:null,provenTokenSavings:null,guidance:'Observed task-session windows, not matched replays. Arm totals describe different tasks and do not prove savings. Cached input is included in input; reasoning is included in output. Classifier overhead is separate. External model usage is unverified. Acceptance is board state, not independent review.'};
}
