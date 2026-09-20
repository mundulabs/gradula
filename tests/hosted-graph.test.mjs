import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {importHostedGraph} from '../src/hosted-graph.mjs';
test('hosted imports are revision-pinned, idempotent and refuse foreign provenance',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'hosted-graph-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'graph.json'),store=createMemoryStore(),g=createGradula(store);
  await g.createProject({key:'GRD',name:'Gradula',repo:'mundulabs/gradula'});
  const graph={schema:'gradula.codegraph.v1',repository:'mundulabs/gradula',revision:'a'.repeat(40),dirty:false,nodes:[{id:'file:a',kind:'file',name:'a',path:'src/a.mjs'}],edges:[]};
  await writeFile(path,JSON.stringify(graph));
  for(let i=0;i<2;i++)await importHostedGraph(g,{path,log:{info(){}}});
  assert.equal((await store.codegraphs.history('GRD')).length,1);
  for(const change of [{dirty:true},{revision:null},{repository:'someone/else'}]){
    await writeFile(path,JSON.stringify({...graph,...change}));
    await assert.rejects(importHostedGraph(g,{path}));
    assert.equal((await g.getCodegraph('GRD')).revision,graph.revision);
  }
  assert.deepEqual(await importHostedGraph(g),{enabled:false});
});
