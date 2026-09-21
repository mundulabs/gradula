/** Read only usage/lifecycle metadata from the explicitly enrolled Codex trace.
 * No prompt, tool arguments, replies or credentials leave this adapter. */
import {createReadStream} from 'node:fs';
import {readdir,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {homedir} from 'node:os';
const fields={inputTokens:'input_tokens',outputTokens:'output_tokens',cachedInputTokens:'cached_input_tokens',reasoningOutputTokens:'reasoning_output_tokens'};
export async function findTrace(session,home=process.env.CODEX_HOME||join(homedir(),'.codex')) {
  if(!/^[a-f0-9-]{36}$/.test(session??''))return null;
  // Enumerate filenames only; never search other conversations' contents.
  async function walk(path,depth){
    const entries=await readdir(path,{withFileTypes:true}).catch(()=>[]);
    for(const e of entries){
      if(e.isFile()&&e.name.endsWith(`-${session}.jsonl`))return join(path,e.name);
      if(depth&&e.isDirectory()&&/^\d{2,4}$/.test(e.name)){const found=await walk(join(path,e.name),depth-1);if(found)return found;}
    }
    return null;
  }
  return await walk(join(home,'sessions'),3)??await walk(join(home,'archived_sessions'),3);
}
export async function traceMetadata(path) {
  if(!path)return null;
  const size=(await stat(path).catch(()=>null))?.size;
  if(size===undefined||size>512*1024*1024)return null;
  const turns=[],samples=[],models=[];let current=null,identity=null,delegated=0,invalid=false;
  const lines=createInterface({input:createReadStream(path),crlfDelay:Infinity});
  for await(const line of lines){
    if(!/"(?:token_count|task_started|task_complete|task_aborted|session_meta|turn_context|spawn_agent|collab_agent_spawn_begin)"/.test(line))continue;
    let r;try{r=JSON.parse(line);}catch{continue;}
    const p=r.payload??{},at=Date.parse(r.timestamp);
    if(r.type==='session_meta')identity=p.id;
    if(r.type==='turn_context'&&typeof p.model==='string')models.push({at,model:p.model});
    if(p.type==='collab_agent_spawn_begin'||p.name==='spawn_agent'||p.name==='collaboration.spawn_agent')delegated++;
    if(r.type!=='event_msg')continue;
    if(p.type==='task_started'){current={id:p.turn_id,start:r.timestamp,end:null,before:samples.at(-1)?.usage??null,delegatedBefore:delegated};turns.push(current);}
    if(['task_complete','task_aborted'].includes(p.type)&&current&&p.turn_id===current.id){current.end=r.timestamp;current.aborted=p.type==='task_aborted';}
    if(p.type!=='token_count'||!p.info?.total_token_usage)continue;
    const usage=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,p.info.total_token_usage[v]??(k==='cachedInputTokens'||k==='reasoningOutputTokens'?0:null)]));
    if(!Object.values(usage).every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isFinite(at)){invalid=true;continue;}
    if(current&&!current.before&&samples.length===0&&Object.entries(fields).every(([k,v])=>usage[k]===(p.info.last_token_usage?.[v]??0)))current.before=Object.fromEntries(Object.keys(fields).map(k=>[k,0]));
    samples.push({at,usage,delegated});
  }
  return {identity,turns,samples,models,invalid};
}
export function usageWindow(trace,{turnId,closeAt=null}) {
  const gaps=['external-usage-unverified'];
  if(!trace)return {usage:null,models:[],gaps:[...gaps,'trace-unavailable']};
  const turn=trace.turns.find(t=>t.id===turnId);
  if(!turn?.before||trace.invalid)return {usage:null,models:[],gaps:[...gaps,'usage-missing']};
  const end=closeAt?trace.turns.find(t=>t.end&&Date.parse(t.end)>=Date.parse(closeAt)):null;
  const models=[...new Set(trace.models.filter(m=>m.at>=Date.parse(turn.start)&&(!end||m.at<=Date.parse(end.end))).map(m=>m.model))];
  if(closeAt&&!end)gaps.push('unfinished-turn');
  const samples=trace.samples.filter(s=>s.at>=Date.parse(turn.start)&&(!end||s.at<=Date.parse(end.end)));
  const last=samples.at(-1);if(!last)return {usage:null,models,gaps:[...gaps,'usage-missing']};
  let previous=turn.before,calls=0;
  for(const s of samples){if(Object.keys(fields).some(k=>s.usage[k]<previous[k]))gaps.push('counter-reset');if(s.usage.inputTokens!==previous.inputTokens||s.usage.outputTokens!==previous.outputTokens)calls++;previous=s.usage;}
  if(samples.some(s=>s.delegated>turn.delegatedBefore))gaps.push('delegated-usage');
  const usage=Object.fromEntries(Object.keys(fields).map(k=>[k,last.usage[k]-turn.before[k]]));
  if(gaps.includes('counter-reset'))return {usage:null,models,gaps:[...new Set(gaps)]};
  return {usage:{...usage,modelCalls:calls},models,gaps:[...new Set(gaps)]};
}
