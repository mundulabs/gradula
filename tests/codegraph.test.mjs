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
 const saved=await g.putCodegraph('ONE',graph(),'Person');assert.equal(saved.actor,'Person');
 assert.equal(await g.getCodegraph('TWO'),null);
 assert.deepEqual(await g.putCodegraph('ONE',graph(),'Another'),saved);
 assert.equal((await store.codegraphs.history('ONE')).length,1);
 assert.deepEqual((await g.getItem(card.key)).files,['src/a.rs']);
 await g.patchProject('ONE',{repo:'changed/repo'});assert.equal(await g.getCodegraph('ONE'),null);
 await assert.rejects(g.putCodegraph('ONE',graph(),'Person'));
});
