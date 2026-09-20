import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {createApi} from '../src/api.mjs';
import {PILOT,pilotInput,evaluatePilot,pilotFeedback,pilotReport} from '../src/decision-pilot.mjs';
const input=(id='one')=>({requestId:id,kind:'skill',summary:'Create a slide deck from the supplied outline.',baseline:'reason',candidates:[{id:'slides',description:'Create or edit presentation decks.'},{id:'reason',description:'General reasoning without a specialized skill.'}]});
const response=(overrides={})=>new Response(JSON.stringify({model:PILOT.model,answers:{selection:{choice:'slides',confidence:0.97,probabilities:{slides:0.98,reason:0.01,fallback:0.01}}},usage:{input_tokens:400},...overrides}));
const builds=[['memory',async()=>createMemoryStore()]];
if(process.env.GRADULA_DB_URL)builds.push(['Postgres',async()=>{const {createPgStore}=await import('../src/store-pg.mjs');const store=await createPgStore(process.env.GRADULA_DB_URL,{schema:`decision_${Date.now()}_${Math.floor(Math.random()*1e6)}`});await store.migrate();await store.migrate();return store;}]);
else test('Postgres decision pilot contract',{skip:'GRADULA_DB_URL not set'},()=>{});
for(const [name,build] of builds)test(`${name}: retries, concurrent quota, project isolation, feedback and rekey`,async t=>{
 const store=await build();t.after(()=>store.close?.());let calls=0;
 const g=createGradula(store,{decisionPilot:{apiKey:'fake-secret',projects:['PRB','OTH'],fetchImpl:async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer fake-secret');assert.equal(JSON.parse(options.body).model,PILOT.model);return response();}}});
 await g.createProject({key:'PRB',name:'Probe'});await g.createProject({key:'OTH',name:'Other'});
 const [first,duplicate]=await Promise.all([g.decisionTrial('PRB',input(),'Alice'),g.decisionTrial('PRB',input(),'Bob')]);
 assert.equal(calls,1);assert.equal(first.trial.id,duplicate.trial.id);
 assert.equal(first.trial.result.suggested,'slides');assert.equal(first.mode,'shadow');
 assert.equal(JSON.stringify(first).includes(input().summary),false);assert.equal(JSON.stringify(first).includes('fake-secret'),false);
 await assert.rejects(g.decisionTrial('PRB',{...input(),summary:'Different task'},'Alice'),e=>e.code==='request-id');
 await assert.rejects(g.decisionFeedback('OTH',first.trial.id,{expected:'slides'},'Bob','agent'),e=>e.status===404||e.code==='missing');
 await g.decisionFeedback('PRB',first.trial.id,{expected:'slides'},'Alice','agent');
 const report=await g.decisionReport('PRB');assert.equal(report.labels.rawCorrect,1);assert.equal(report.labels.agent,1);assert.equal(report.comparison,null);
 const many=await Promise.all(Array.from({length:30},(_,i)=>g.decisionTrial('PRB',input('request-'+i),'Alice')));
 assert.equal(calls,PILOT.perProject);assert.equal(many.filter(x=>x.status==='limit').length,11);
 assert.equal((await g.decisionReport('OTH')).attempts,0);
 await store.projects.rekey('PRB','NEW','Alice');
 assert.equal((await store.decisions.get('NEW',first.trial.id)).project,'NEW');
 assert.equal(await store.decisions.get('PRB',first.trial.id),null);
 const row={id:'global',campaign:PILOT.campaign,requestId:'other'};
 assert.equal(await store.decisions.reserve('OTH',row,{total:PILOT.perProject,perProject:20}),null,'global cap includes other tenants');
});
test('disabled mode never sends data or consumes an attempt',async()=>{
 const store=createMemoryStore(),g=createGradula(store,{decisionPilot:{apiKey:'unused',projects:[],fetchImpl:()=>{throw Error('must not call');}}});
 await g.createProject({key:'PRB',name:'Probe'});assert.equal((await g.decisionTrial('PRB',input(),'test')).status,'disabled');assert.equal((await g.decisionReport('PRB')).attempts,0);
});
test('uncertainty, invalid outputs, timeout and errors keep the existing route',async()=>{
 const trial=pilotInput(input());
 const low=await evaluatePilot(trial,{apiKey:'secret',fetchImpl:async()=>response({answers:{selection:{choice:'slides',confidence:0.4,probabilities:{slides:0.6,reason:0.3,fallback:0.1}}}})});
 assert.equal(low.suggested,'reason');assert.equal(low.abstained,true);assert.equal(low.inputTokens,400);
 for(const body of [{model:'unexpected'}, {answers:{selection:{choice:'arbitrary-execution',confidence:1,probabilities:{}}}}, {usage:{input_tokens:-1}}]){
  const result=await evaluatePilot(trial,{fetchImpl:async()=>response(body)});assert.equal(result.status,'unavailable');assert.equal(result.suggested,'reason');assert.equal(result.inputTokens,null);
 }
 let calls=0;const failed=await evaluatePilot(trial,{fetchImpl:async()=>{calls++;throw Error('secret content');}});assert.equal(calls,1);assert.equal(JSON.stringify(failed).includes('secret'),false);
 const timed=await evaluatePilot(trial,{timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('test guard')),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);});})});assert.equal(timed.status,'unavailable');
});
test('feedback cannot manufacture missing usage; reports add routing cost and avoid repeated comparison runs',()=>{
 assert.throws(()=>pilotInput({...input(),baseline:'unknown'}));assert.throws(()=>pilotInput({...input(),summary:'x'.repeat(1501)}));
 assert.throws(()=>pilotInput({...input(),candidates:[input().candidates[0],input().candidates[0]]}));
 const trial={candidateIds:['slides','reason'],baseline:'reason',result:{choice:'reason',confidence:0.96,inputTokens:400,estimatedCostUsd:0.0000168,latencyMs:200,status:'answered',abstained:false}};
 assert.throws(()=>pilotFeedback({expected:'invented'},trial));assert.throws(()=>pilotFeedback({comparison:{sameTask:false}},trial));
 const feedback=pilotFeedback({expected:'slides',comparison:{sameTask:true,baselineRunId:'run-a',pilotRunId:'run-b',baseline:{inputTokens:1000,outputTokens:100,success:true,costUsd:0.02},pilot:{inputTokens:400,outputTokens:50,success:false,costUsd:0.01}}},trial);
 trial.feedback=[{...feedback,authorKind:'human'}];
 const report=pilotReport([trial,trial]);assert.equal(report.comparison.pairs,1);assert.equal(report.comparison.pilotTokens,850);assert.equal(report.comparison.baselineTokens,1100);assert.equal(report.comparison.pilotSucceeded,0);assert.equal(report.labels.falseConfident,2);
});
test('real HTTP pilot endpoints authenticate and refuse cross-project feedback',async t=>{
 const store=createMemoryStore(),g=createGradula(store,{decisionPilot:{apiKey:'secret',projects:['PRB','OTH'],fetchImpl:async()=>response()}});
 await g.createProject({key:'PRB',name:'Probe'});await g.createProject({key:'OTH',name:'Other'});
 const a=await g.mintToken('PRB','tester','test','system'),b=await g.mintToken('OTH','tester','test','system');
 const server=createServer(createApi(g));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/v1/decision-trials`;
 assert.equal((await fetch(url)).status,401);
 const request=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify(input())});assert.equal(request.status,200);
 const {trial}=await request.json();
 const feedback=await fetch(`${url}/${trial.id}/feedback`,{method:'POST',headers:{Authorization:`Bearer ${b.token}`,'Content-Type':'application/json'},body:JSON.stringify({expected:'slides'})});assert.equal(feedback.status,404);
 const own=await fetch(`${url}/${trial.id}/feedback`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({expected:'slides'})});assert.equal(own.status,200);
 assert.equal((await own.json()).feedback[0].authorKind,'agent');
 for(const [kind,expectedKind] of [['agent','agent'],['human','human']]){
  const credential=await store.tokens.mint({project:'PRB',name:kind,createdBy:'test',kind,owner:'test-owner',ownerName:'Tester'});
  const result=await fetch(`${url}/${trial.id}/feedback`,{method:'POST',headers:{Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json','X-Gradula-Actor':'human'},body:JSON.stringify({expected:'slides',authorKind:'human'})});
  assert.equal(result.status,200);
  assert.equal((await result.json()).feedback.at(-1).authorKind,expectedKind,'authentication determines attribution, not actor headers or submitted fields');
 }
});
test('failed paid attempts persist and repeated request ids never retry the provider',async()=>{
 const store=createMemoryStore();let calls=0;
 const options={decisionPilot:{apiKey:'key',projects:['PRB'],fetchImpl:async()=>{calls++;return new Response('credential echo',{status:503});}}};
 const g=createGradula(store,options);await g.createProject({key:'PRB',name:'Probe'});
 const first=await g.decisionTrial('PRB',input(),'tester');assert.equal(first.trial.result.status,'unavailable');
 const restarted=createGradula(store,options);await restarted.decisionTrial('PRB',input(),'tester');assert.equal(calls,1);
 const report=await restarted.decisionReport('PRB');assert.equal(report.attempts,1);assert.equal(report.unmeteredAttempts,1);assert.equal(report.comparison,null);
});
