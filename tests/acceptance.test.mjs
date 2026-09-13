import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {gatherSystem} from '../src/system.mjs';
const stores=[['memory',async()=>createMemoryStore()]];
if(process.env.GRADULA_DB_URL) stores.push(['Postgres',async()=>{const {createPgStore}=await import('../src/store-pg.mjs');const s=await createPgStore(process.env.GRADULA_DB_URL,{schema:`accept_${Date.now()}`});await s.migrate();return s;}]);
for(const [name,build] of stores) test(`${name}: manual acceptance defaults off, persists, and never bypasses gates`,async t=>{
 const store=await build();t.after(()=>store.close?.());const g=createGradula(store);await g.createProject({key:'PRB',name:'Test'});
 assert.equal((await g.getProject('PRB')).manualAcceptance,false);
 const a=await g.addItem('PRB',{kind:'task',title:'Automatic'},'test');
 await g.arrived(a.key,'production','abc');assert.equal((await g.getItem(a.key)).state,'done');
 await g.patchProject('PRB',{manualAcceptance:true},'test');
 assert.equal((await createGradula(store).getProject('PRB')).manualAcceptance,true);
 const b=await g.addItem('PRB',{kind:'task',title:'Manual'},'test');await g.arrived(b.key,'production','abc');assert.equal((await g.getItem(b.key)).state,'review');
 await g.moveItem(b.key,'done','reviewer');assert.equal((await g.getItem(b.key)).state,'done');
 const c=await g.addItem('PRB',{kind:'task',title:'Gated',gate:{kind:'command',call:'true'}},'test');
 assert.equal((await g.getItem(c.key)).gateStanding,null);
 await assert.rejects(g.moveItem(c.key,'done','reviewer'),e=>e.code==='gate-red');
 await g.patchProject('PRB',{manualAcceptance:false},'test');await g.arrived(c.key,'production','abc');assert.equal((await g.getItem(c.key)).state,'review');
 await assert.rejects(g.patchProject('PRB',{manualAcceptance:'false'},'test'));
});

test('Git branch presence is shown without claiming a deployment or absent older commits',async()=>{
 const sha='a'.repeat(40);
 const doc=await gatherSystem({connections:{github:{repo:'o/r',token:'t'}},board:{cards:[{key:'PRB-1',state:'review'}],evidence:new Map([['PRB-1',[{sha:sha.slice(0,12)},{sha:'b'.repeat(12)}]]])},fetchImpl:async url=>({status:url.includes('/commits?sha=dev')?200:404,json:async()=>url.includes('/commits?sha=dev')?[{sha,commit:{message:'Feature'}}]:null})});
 assert.deepEqual(doc.cards[0].git,{repo:'o/r',total:2,dev:1,main:null});
 assert.deepEqual(doc.cards[0].deployed,{development:null,production:null});
});
