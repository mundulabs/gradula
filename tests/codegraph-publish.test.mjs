import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publishGraph,scanRepository} from '../tools/codegraph.mjs';
const env={GRADULA_URL:'https://board.test',GRADULA_AGENT_TOKEN:'test-token'};

test('publisher probes capabilities before mutation and rejects dirty snapshots',async()=>{
  let calls=0;
  const unsupported=async()=>{calls++;return {ok:true,json:async()=>({})}};
  await assert.rejects(publishGraph({dirty:true},{env,fetchImpl:unsupported}),/clean/);assert.equal(calls,0);
  await assert.rejects(publishGraph({dirty:false},{env,fetchImpl:unsupported}),/Upgrade/);assert.equal(calls,1);
  const graph={revision:'a'.repeat(40),dirty:false,digest:'digest'};
  const requests=[];
  await publishGraph(graph,{env,fetchImpl:async(url,options)=>{requests.push({url,method:options.method});return {ok:true,json:async()=>options.method==='PUT'?graph:{capabilities:{version:2}}}}});
  assert.equal(requests.length,2);assert.equal(requests[1].method,'PUT');
  await assert.rejects(publishGraph(graph,{env,fetchImpl:async(_url,options)=>({ok:true,json:async()=>options.method==='PUT'?{...graph,digest:'changed'}:{capabilities:{version:2}}})}),/preserve/);
});

test('clean scans read committed blobs, ignore secrets and symlinks, and identify local changes',t=>{
  const root=mkdtempSync(join(tmpdir(),'gradula-publisher-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.test');git('remote','add','origin','https://github.com/team/repo.git');
  writeFileSync(join(root,'code.ts'),'export function first() {}');writeFileSync(join(root,'.env'),'secret=never-index');
  symlinkSync('.env',join(root,'linked.ts'));git('add','.');git('commit','-qm','fixture');
  const clean=scanRepository(root);assert.equal(clean.graph.dirty,false);assert.equal(clean.graph.revision,git('rev-parse','HEAD'));
  assert.deepEqual([...new Set(clean.graph.nodes.map(n=>n.path))],['code.ts']);assert.ok(!JSON.stringify(clean.graph).includes('never-index'));
  writeFileSync(join(root,'code.ts'),'export function changed() {}');writeFileSync(join(root,'untracked.ts'),'export const absent=1');
  const dirty=scanRepository(root);assert.equal(dirty.graph.dirty,true);assert.ok(dirty.graph.nodes.some(n=>n.name==='changed'));assert.ok(!dirty.graph.nodes.some(n=>n.path==='untracked.ts'));
});
