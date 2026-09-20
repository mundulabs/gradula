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
 assert.equal((await g.getProject('PRB')).integration,'pr');
 await g.patchProject('PRB',{integration:'direct'},'test');
 assert.equal((await createGradula(store).getProject('PRB')).integration,'direct');
 await assert.rejects(g.patchProject('PRB',{integration:'merge'},'test'));
});

test('Git branch presence is shown without claiming a deployment or absent older commits',async()=>{
 const sha='a'.repeat(40);
 const doc=await gatherSystem({connections:{github:{repo:'o/r',token:'t'}},board:{cards:[{key:'PRB-1',state:'review'}],evidence:new Map([['PRB-1',[{sha:sha.slice(0,12)},{sha:'b'.repeat(12)}]]])},fetchImpl:async url=>({status:url.includes('/commits?sha=dev')?200:404,json:async()=>url.includes('/commits?sha=dev')?[{sha,commit:{message:'Feature'}}]:null})});
 assert.deepEqual(doc.cards[0].git,{repo:'o/r',total:2,dev:1,main:null});
 assert.deepEqual(doc.cards[0].deployed,{development:null,production:null});
});

test('a key a person owns mints a named service key; a system key may not', async () => {
  const store = createMemoryStore(); const g = createGradula(store);
  await g.createProject({ key: 'PRB', name: 'Test' });
  const person = { kind: 'human', owner: 'u1', ownerName: 'David', name: 'laptop' };
  const made = await g.mintOwnKey('PRB', 'docs', null, { holder: person });
  assert.ok(made.token); assert.equal(made.entry.kind, 'system'); assert.equal(made.entry.owner, 'u1'); assert.equal(made.entry.name, 'docs');
  const byAgent = await g.mintOwnKey('PRB', 'runner', null, { holder: { kind: 'agent', owner: 'u1', ownerName: 'David', name: 'Claude Code · laptop' } });
  assert.equal(byAgent.entry.owner, 'u1'); assert.equal(byAgent.entry.createdBy, 'David (Claude Code · laptop)');
  await assert.rejects(g.mintOwnKey('PRB', 'x', null, { holder: { kind: 'agent', owner: null } }), (e) => e.code === 'humans-only');
  await assert.rejects(g.mintOwnKey('PRB', 'x', null, { holder: { kind: 'system', owner: 'u1' } }), (e) => e.code === 'humans-only');
  await assert.rejects(g.mintOwnKey('PRB', 'x', null), (e) => e.code === 'humans-only');
  assert.equal((await store.tokens.verify(made.token)).kind, 'system');
});
