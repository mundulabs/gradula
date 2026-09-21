/** Project-side measurement adapter. The API owns the task-run records; Git
 * metadata holds private collection cursors so a report can finish after the
 * final turn. Opt in per repository; nothing is read without it. */
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './task-measurement.mjs';
import {findTrace,traceMetadata,usageWindow} from './task-usage.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
export function measurementEnabled(cwd=process.cwd()) {try{return git(cwd,'config','--get','gradula.measureTasks')==='true';}catch{return false;}}
export function setMeasurement(enabled,cwd=process.cwd()){git(cwd,'config','--local','gradula.measureTasks',String(enabled));return {enabled,scope:'this repository and its worktrees'};}
async function location(cwd,base){
  const root=join(git(cwd,'rev-parse','--path-format=absolute','--git-common-dir'),'gradula-measure',digest(base).slice(0,16));
  await mkdir(root,{recursive:true,mode:0o700});return root;
}
async function save(path,value){const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);}
async function load(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function rows(root){return (await readdir(root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));}
async function acquire(path){
  const lock=`${path}.lock`,info=await stat(lock).catch(()=>null);
  if(info&&Date.now()-info.mtimeMs>300000)await rm(lock,{recursive:true,force:true});
  try{await mkdir(lock);return lock;}catch{return null;}
}
function reply(record){return {runId:record.run?.id??null,status:'enrolled',measurement:'Task-session usage will be collected through the completion turn. Other model/tool usage must be disclosed.'};}

export async function beginMeasurement(card,{call,cwd=process.cwd(),base,session,env=process.env}={}) {
  if(!measurementEnabled(cwd))return null;
  let lock;
  try {
    const root=await location(cwd,base),requestId=digest({card:card.key,session,base}),path=join(root,`${requestId}.json`);
    lock=await acquire(path);if(!lock)return {status:'collection-busy',guidance:'Continue normally.'};
    let record=await load(path);
    if(record?.run)return reply(record);
    const report=await call('/api/v1/task-runs');
    if(!report.enabled)return {status:'disabled'};
    const tracePath=await findTrace(env.CODEX_THREAD_ID,env.CODEX_HOME),trace=await traceMetadata(tracePath),turn=trace?.turns.at(-1);
    if(!turn||trace.identity!==env.CODEX_THREAD_ID)return {status:'collection-unavailable',guidance:'No matching Codex usage trace; only Codex sessions are metered so far.'};
    if(!record){
      const revision=git(cwd,'rev-parse','HEAD'),dirty=!!git(cwd,'status','--porcelain','--untracked-files=no');
      record={input:{requestId,card:card.key,revision,taskDigest:digest({title:card.title,text:card.text,gate:card.gate,revision}),sessionDigest:digest(session),startedAt:turn.start},tracePath,thread:env.CODEX_THREAD_ID,turnId:turn.id,gaps:dirty?['dirty-start']:[]};
      if((card.history??[]).some(e=>e.verb==='started'&&Date.parse(e.at)<Date.parse(turn.start)))record.gaps.push('late-enrollment');
      for(const file of await rows(root)){
        const other=await load(join(root,file));
        if(other&&other.thread===record.thread&&!other.closeAt&&other.input.card!==card.key){record.gaps.push('overlapping-tasks');other.gaps=[...new Set([...other.gaps,'overlapping-tasks'])];await save(join(root,file),other);}
      }
      await save(path,record);
    }
    const enrolled=await call('/api/v1/task-runs',{method:'POST',body:record.input});
    if(enrolled.status!=='enrolled')return enrolled;
    record.run=enrolled.run;
    await save(path,record);
    await collectOne(record,path,call);
    return reply(record);
  }catch{return {status:'collection-unavailable',guidance:'Measurement failed; continue the task normally.'};}
  finally{if(lock)await rm(lock,{recursive:true,force:true}).catch(()=>{});}
}

async function collectOne(record,path,call,card=null,cache=new Map()){
  if(!record.run)return {status:'not-enrolled'};
  card??=await call(`/api/v1/cards/${record.input.card}`);
  const closed=['review','done','ice'].includes(card.state);
  if(!closed&&record.closeAt){record.closeAt=null;record.finalMeasurement=null;record.gaps=[...new Set([...record.gaps,'overlapping-tasks'])];}
  if(closed&&!record.closeAt){
    // Prefer the first completion transition after enrollment. The final
    // assistant response in that turn still counts; report can collect it later.
    const moves=(card.history??[]).filter(e=>e.verb==='moved'&&['review','done','ice'].includes(e.data?.to)&&Date.parse(e.at)>=Date.parse(record.input.startedAt));
    record.closeAt=moves[0]?.at??new Date().toISOString();
  }
  let measured=record.finalMeasurement;
  if(!measured){
    if(!cache.has(record.tracePath))cache.set(record.tracePath,traceMetadata(record.tracePath));
    const trace=await cache.get(record.tracePath);
    measured=trace?.identity===record.thread?usageWindow(trace,record):{usage:null,models:[],gaps:['trace-changed']};
    if(closed&&measured.usage&&!measured.gaps.includes('unfinished-turn'))record.finalMeasurement=measured;
  }
  const observation={status:closed?card.state:'active',...measured,gaps:[...new Set([...record.gaps,...measured.gaps])]};
  const fingerprint=digest(observation);
  if(fingerprint!==record.uploaded){await call(`/api/v1/task-runs/${record.run.id}/observation`,{method:'POST',body:observation});record.uploaded=fingerprint;}
  record.lastStatus=observation.status;await save(path,record);
  return {card:record.input.card,status:observation.status,gaps:observation.gaps};
}
export async function collectMeasurements({call,cwd=process.cwd(),base,card=null}={}){
  if(!measurementEnabled(cwd))return {enabled:false};
  const results=[],cache=new Map();
  try{
    const root=await location(cwd,base);
    for(const file of await rows(root)){
      const path=join(root,file),lock=await acquire(path);if(!lock)continue;
      try{
        const record=await load(path);if(!record?.run||(card&&card.key!==record.input.card))continue;
        try{results.push(await collectOne(record,path,call,card,cache));}catch{results.push({card:record.input.card,status:'collection-unavailable'});}
      }finally{await rm(lock,{recursive:true,force:true});}
    }
  }catch{return {enabled:true,status:'collection-unavailable'};}
  return {enabled:true,runs:results};
}
