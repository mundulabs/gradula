import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {createApi} from '../src/api.mjs';
import {PILOT,digest} from '../src/decision-pilot.mjs';
import {taskInput,taskObservation,taskReport} from '../src/task-measurement.mjs';
import {findTrace,traceMetadata,usageWindow} from '../src/task-usage.mjs';
import {beginMeasurement,collectMeasurements,setMeasurement,adoptMeasurement,ROUTES} from '../src/decision-workflow.mjs';

const thread='01a0c082-bc21-74c0-8f78-7d9c35d811fa';
const at=n=>new Date(Date.UTC(2026,8,21,12,0,n)).toISOString();
const event=(n,type,extra={})=>JSON.stringify({timestamp:at(n),type:'event_msg',payload:{type,...extra}})+'\n';
const token=(n,input,output,extra={})=>event(n,'token_count',{info:{total_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:0,reasoning_output_tokens:0},last_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:0,reasoning_output_tokens:0}},...extra});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'gradula-measure-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const home=join(dir,'codex'),cwd=join(dir,'repo'),folder=join(home,'sessions','2026','09','21');await mkdir(folder,{recursive:true});await mkdir(cwd);
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:'ignore'});git('init','-q');git('-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-qm','fixture');
 const path=join(folder,`rollout-2026-09-21T12-00-00-${thread}.jsonl`);
 await writeFile(path,JSON.stringify({timestamp:at(0),type:'session_meta',payload:{id:thread}})+'\n'+token(1,100,10)+event(2,'task_started',{turn_id:'turn'})+JSON.stringify({timestamp:at(2),type:'turn_context',payload:{model:'test-model'}})+'\n'+token(3,200,20));
 return {cwd,home,path,env:{CODEX_THREAD_ID:thread,CODEX_HOME:home}};
}
test('usage includes all calls through completion, deduplicates counters and stops before unrelated turns',async t=>{
 const f=await fixture(t);assert.equal(await findTrace(thread,f.home),f.path);assert.equal(await findTrace('../escape',f.home),null);
 await appendFile(f.path,token(4,200,20)+token(5,350,40)+event(6,'task_complete',{turn_id:'turn'})+event(7,'task_started',{turn_id:'unrelated'})+token(8,9000,500));
 const result=usageWindow(await traceMetadata(f.path),{turnId:'turn',closeAt:at(4)});
 assert.deepEqual(result.usage,{inputTokens:250,outputTokens:30,cachedInputTokens:0,reasoningOutputTokens:0,modelCalls:2});
 assert.deepEqual(result.models,['test-model']);assert.deepEqual(result.gaps,['external-usage-unverified']);
 assert.equal(JSON.stringify(result).includes('payload'),false);
});
test('new sessions start at zero only with a matching first-call counter; gaps never become zero usage',async t=>{
 const f=await fixture(t);
 await writeFile(f.path,event(1,'task_started',{turn_id:'first'})+token(2,90,10));
 assert.equal(usageWindow(await traceMetadata(f.path),{turnId:'first'}).usage.inputTokens,90);
 await appendFile(f.path,token(3,20,2));
 assert.equal(usageWindow(await traceMetadata(f.path),{turnId:'first'}).usage,null);
 assert.ok(usageWindow(await traceMetadata(f.path),{turnId:'first'}).gaps.includes('counter-reset'));
 assert.equal(usageWindow(null,{turnId:'first'}).usage,null);
});
test('uncompleted turns and delegated work are explicitly incomplete',async t=>{
 const f=await fixture(t);await appendFile(f.path,event(4,'collab_agent_spawn_begin')+token(5,250,30));
 const result=usageWindow(await traceMetadata(f.path),{turnId:'turn',closeAt:at(4)});
 assert.ok(result.gaps.includes('unfinished-turn'));assert.ok(result.gaps.includes('delegated-usage'));
});

const builds=[['memory',async()=>createMemoryStore()]];
if(process.env.GRADULA_DB_URL)builds.push(['Postgres',async()=>{const {createPgStore}=await import('../src/store-pg.mjs');const store=await createPgStore(process.env.GRADULA_DB_URL,{schema:`task_usage_${Date.now()}_${Math.floor(Math.random()*1e6)}`});await store.migrate();return store;}]);
else test('Postgres whole-task measurements',{skip:'GRADULA_DB_URL not set'},()=>{});
const task=(key='PRB-1',n=0)=>({requestId:digest(`run-${n}`),card:key,revision:'a'.repeat(40),taskDigest:digest('frozen-task'),sessionDigest:digest(`session-${n}`),startedAt:at(2)});
const observation=(extra={})=>({status:'active',decision:'baseline',trialId:null,adoption:null,usage:{inputTokens:100,outputTokens:10,cachedInputTokens:20,reasoningOutputTokens:2,modelCalls:2},models:['test-model'],gaps:['external-usage-unverified'],...extra});
for(const [name,build] of builds)test(`${name}: task observations survive restart, isolate projects, preserve quotas and separate unknown outcomes`,async t=>{
 const store=await build();t.after(()=>store.close?.());
 const options={decisionPilot:{projects:['PRB','OTH']}};const g=createGradula(store,options);
 await g.createProject({key:'PRB',name:'Probe'});await g.createProject({key:'OTH',name:'Other'});
 await g.addItem('PRB',{kind:'task',title:'A bounded change'},'test');
 const input=task(),run=(await g.beginTaskRun('PRB',input,'test')).run;
 assert.equal((await g.beginTaskRun('PRB',input,'test')).run.id,run.id);
 await assert.rejects(g.beginTaskRun('PRB',{...input,revision:'b'.repeat(40)},'test'),/different task/);
 await assert.rejects(g.beginTaskRun('OTH',input,'test'));
 await assert.rejects(g.observeTaskRun('OTH',run.id,observation(),'test'));
 const saved=await g.observeTaskRun('PRB',run.id,observation({status:'done',decision:run.arm==='baseline'?'baseline':'fallback'}),'test');
 assert.equal(saved.result.status,'active');assert.equal(saved.result.success,null,'a caller cannot declare success');
 assert.equal((await createGradula(store,options).decisionReport('PRB')).tasks.arms[run.arm].started,1);
 assert.equal((await g.decisionReport('PRB')).attempts,0,'task observations never consume classifier quota');
 const fake=observation({trialId:'0'.repeat(26)});await assert.rejects(g.observeTaskRun('PRB',run.id,fake,'test'));
 await store.projects.rekey('PRB','NEW','test');assert.equal((await store.decisions.get('NEW',run.id)).project,'NEW');
});

test('real HTTP lifecycle: one optional route, explicit adoption, completion accounting, no paid report calls',async t=>{
 const f=await fixture(t),store=createMemoryStore();let paid=0;
 const g=createGradula(store,{decisionPilot:{projects:['PRB'],apiKey:'fake',fetchImpl:async()=>{paid++;return new Response(JSON.stringify({model:PILOT.model,answers:{selection:{choice:'contract',confidence:0.97,probabilities:{reproduce:0.01,contract:0.96,'existing-pattern':0.01,documentation:0.01,fallback:0.01}}},usage:{input_tokens:300}}));}}});
 await g.createProject({key:'PRB',name:'Probe'});
 const card=await g.addItem('PRB',{kind:'task',title:'Add an API behavior contract'},'test');
 const credential=await g.mintToken('PRB','tester','test','system');
 const server=createServer(createApi(g));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{method='GET',body}={})=>{const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const json=await response.json();assert.equal(response.status,200,JSON.stringify(json));return json;};
 let session='test-0';for(let i=0;taskInput({...task(),requestId:digest({card:card.key,session,base})}).arm!=='typesafe';i++)session=`test-${i+1}`;
 const opts={...f,call,base,session};
 assert.equal(await beginMeasurement(card,opts),null,'off by default');setMeasurement(true,f.cwd);
 const begun=await beginMeasurement(card,opts);assert.equal(begun.arm,'typesafe');assert.equal(begun.selection,'contract');assert.equal(paid,1);
 assert.equal((await beginMeasurement(card,opts)).runId,begun.runId);assert.equal(paid,1,'restart never repeats paid request');
 const cli=async(...args)=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[new URL('../bin/gradula.mjs',import.meta.url).pathname,...args],{cwd:f.cwd,env:{...process.env,...f.env,GRADULA_URL:base,GRADULA_TOKEN:credential.token,GRADULA_AGENT_TOKEN:credential.token,GRADULA_SESSION:session,TYPESAFE_API_KEY:''}});
   let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(err||out)));
 });
 assert.match(await cli('start',card.key,'--here','Isolated integration fixture','--files','src'),/Task measurement:.*typesafe/);
 assert.equal(paid,1,'CLI start shares the idempotent enrollment');
 await adoptMeasurement(card.key,true,opts);
 // Test controls the store state instead of pretending an agent can approve.
 await store.items.patch(card.key,{state:'review'});
 await appendFile(f.path,token(4,500,50)+event(59,'task_complete',{turn_id:'turn'}));
 const closed={...card,state:'review',history:[{verb:'moved',at:at(4),data:{to:'review'}}]};
 await collectMeasurements({...opts,card:closed});
 const report=await g.decisionReport('PRB');assert.equal(report.attempts,1);assert.equal(report.tasks.arms.typesafe.finished,1);assert.equal(report.tasks.arms.typesafe.inputTokens,400);assert.equal(report.tasks.arms.typesafe.classifierInputTokens,300);assert.equal(report.tasks.arms.typesafe.adopted,1);assert.equal(report.tasks.provenTokenSavings,null);
 assert.equal(report.tasks.arms.typesafe.awaitingOutcome,1);
 await collectMeasurements({...opts,card:closed});assert.equal(paid,1,'collection is free of provider calls');
 assert.equal(JSON.parse(await cli('decision-report')).tasks.arms.typesafe.finished,1,'real CLI reports collect usage');
 const metadata=await readFile(join(f.cwd,'.git','gradula-measure',digest(base).slice(0,16),(await readdir(join(f.cwd,'.git','gradula-measure',digest(base).slice(0,16)))).find(n=>n.endsWith('.json'))),'utf8');
 assert.equal(metadata.includes(card.title),false);assert.equal(metadata.includes('fake'),false);
});
test('invalid counters/adoption are rejected and different tasks never become a claimed saving',()=>{
 assert.throws(()=>taskObservation(observation({usage:{inputTokens:-1}})));
 assert.throws(()=>taskObservation(observation({adoption:'human-approved'})));
 assert.throws(()=>taskInput({...task(),sessionDigest:'private text'}));
 const report=taskReport([{arm:'baseline',result:observation({status:'done'})},{arm:'typesafe',result:observation({status:'done'})}]);
 assert.equal(report.provenTokenSavings,null);assert.equal(report.taskCostUsd,null);
});
