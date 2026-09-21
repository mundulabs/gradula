import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGraph} from '../src/codegraph.mjs';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
const graph=()=>({schema:'gradula.codegraph.v1',repository:'team/repo',nodes:[{id:'a',name:'A',kind:'module',path:'src/a.rs'},{id:'b',name:'B',kind:'doc',path:'docs/b.md'}],edges:[{from:'a',to:'b',kind:'documents',confidence:'EXTRACTED',reason:'Explicit source reference',source:{path:'docs/b.md',line:2}}]});
test('source revision survives normalization and participates in the digest',()=>{
 const legacy=normalizeGraph(graph(),'team/repo');assert.equal(legacy.revision,null);assert.equal(legacy.dirty,null);
 const current=normalizeGraph({...graph(),revision:'a'.repeat(40),dirty:false},'team/repo');
 assert.equal(current.revision,'a'.repeat(40));assert.equal(current.dirty,false);assert.notEqual(current.digest,legacy.digest);
 assert.notEqual(normalizeGraph({...graph(),revision:'b'.repeat(40),dirty:false},'team/repo').digest,current.digest);
 for(const extra of [{revision:'dev'},{revision:'abc'},{dirty:'false'}]) assert.throws(()=>normalizeGraph({...graph(),...extra},'team/repo'));
});
test('graph admission rejects mismatches, unsafe paths and ungrounded edges',()=>{
 for(const path of ['/Users/me/a.rs','../a.rs','docs/../../key','https://evil.test','C:\\file','a/./b']) { const x=graph();x.nodes[0].path=path;assert.throws(()=>normalizeGraph(x,'team/repo')); }
 const dangling=graph();dangling.edges[0].to='missing';assert.throws(()=>normalizeGraph(dangling,'team/repo'));
 const duplicate=graph();duplicate.nodes.push(duplicate.nodes[0]);assert.throws(()=>normalizeGraph(duplicate,'team/repo'));
 assert.throws(()=>normalizeGraph(graph(),'other/repo'));
 const unknown=graph();unknown.edges[0].confidence='CERTAIN';assert.throws(()=>normalizeGraph(unknown,'team/repo'));
 assert.equal(normalizeGraph(graph(),'team/repo').edges[0].source.line,2);
});
const builds=[['memory',async()=>createMemoryStore()]];
if(process.env.GRADULA_DB_URL) builds.push(['Postgres',async()=>{const {createPgStore}=await import('../src/store-pg.mjs');const s=await createPgStore(process.env.GRADULA_DB_URL,{schema:`graph_${Date.now()}`});await s.migrate();return s;}]);
for(const [name,build] of builds) test(`${name}: graph snapshots are isolated, idempotent and do not author card files`,async t=>{
 const store=await build();t.after(()=>store.close?.());const g=createGradula(store);
 await g.createProject({key:'ONE',name:'One',repo:'team/repo'});await g.createProject({key:'TWO',name:'Two',repo:'team/repo'});
 const card=await g.addItem('ONE',{kind:'task',title:'A task',files:['src/a.rs']},'Person');
 const documentGraph={...graph(),documents:[{path:'docs/b.md',markdown:'# Project One'}]};
 const saved=await g.putCodegraph('ONE',documentGraph,'Person');
 assert.equal((await g.publishedDocument('ONE','docs/b.md')).markdown,'# Project One');
 await assert.rejects(g.publishedDocument('TWO','docs/b.md'));
 await assert.rejects(g.publishedDocument('ONE','../secret.md'));assert.equal(saved.actor,'Person');
 assert.equal(await g.getCodegraph('TWO'),null);
 assert.deepEqual(await g.putCodegraph('ONE',documentGraph,'Another'),saved);
 assert.equal((await store.codegraphs.history('ONE')).length,1);
 assert.deepEqual((await g.getItem(card.key)).files,['src/a.rs']);
 const revisions=Array.from({length:10},(_,i)=>(i+1).toString(16).padStart(40,'0'));
 for(const revision of revisions) await g.putCodegraph('ONE',{...graph(),revision,dirty:false},'Publisher');
 assert.equal((await g.getCodegraph('ONE',revisions[2])).revision,revisions[2]);
 assert.equal(await store.codegraphs.get('ONE',revisions[0]),null,'old revision snapshots are evicted');
 assert.equal((await g.getContext('ONE',{q:'A',revision:revisions[2]})).snapshot.freshness,'matching');
 await g.putCodegraph('ONE',{...graph(),revision:revisions[2],dirty:true},'Person');
 assert.equal((await store.codegraphs.get('ONE',revisions[2])).dirty,false,'dirty uploads cannot replace immutable clean-revision lookup');
 for(let i=0;i<20;i++)await store.events.add({item:card.id,actor:'Person',verb:'said',data:{line:`historical detail ${i}`}});
 const evidence=await store.events.add({item:card.id,actor:'Verifier',verb:'evidenced',data:{kind:'commit',ref:'f'.repeat(40),comment:'Verified source change'}});
 const recent=await store.events.of(card.id,{limit:12});assert.equal(recent.length,12);assert.equal(recent.at(-1).id,evidence.id);
 assert.deepEqual((await store.events.of(card.id,{limit:12,verbs:['evidenced']})).map(e=>e.id),[evidence.id]);
 const before=(await store.events.of(card.id)).length;
 const context=await g.getContext('ONE',{card:card.key,maxBytes:4096});
 assert.ok(context.work.nodes.some(n=>n.eventId===evidence.id));
 assert.ok(context.work.edges.some(e=>e.kind==='touches'));
 assert.ok(Buffer.byteLength(JSON.stringify(context))+1<=4096);
 assert.equal((await store.events.of(card.id)).length,before,'history is never compacted destructively');
 const concurrent={...graph(),revision:'e'.repeat(40),dirty:false};
 const historyBefore=(await store.codegraphs.history('ONE')).length;
 await Promise.all([g.putCodegraph('ONE',concurrent,'One'),g.putCodegraph('ONE',concurrent,'Two')]);
 assert.equal((await store.codegraphs.history('ONE')).length,historyBefore+1,'concurrent identical publications are one import');
 await g.patchProject('ONE',{repo:'changed/repo'});assert.equal(await g.getCodegraph('ONE'),null);
 await assert.rejects(g.putCodegraph('ONE',graph(),'Person'));
});

test('documents are bounded indexed Markdown and are covered by the snapshot digest',()=>{
 const input={...graph(),documents:[{path:'docs/b.md',markdown:'# Original'}]};
 const saved=normalizeGraph(input,'team/repo');assert.match(saved.documents[0].contentHash,/^[a-f0-9]{64}$/);
 assert.notEqual(normalizeGraph({...input,documents:[{path:'docs/b.md',markdown:'# Changed'}]},'team/repo').digest,saved.digest);
 for(const documents of [[{path:'../secret.md',markdown:'x'}],[{path:'missing.md',markdown:'x'}],[{path:'src/a.rs',markdown:'x'}],[{path:'docs/b.md',markdown:'x'.repeat(128001)}],[...input.documents,...input.documents]])assert.throws(()=>normalizeGraph({...input,documents},'team/repo'));
});
