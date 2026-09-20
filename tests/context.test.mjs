import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeGraph} from '../src/codegraph.mjs';
import {contextOptions, retrieveContext} from '../src/context.mjs';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {createApi} from '../src/api.mjs';

const revision = 'a'.repeat(40);
const fixture = () => normalizeGraph({schema:'gradula.codegraph.v1', repository:'team/repo', revision, dirty:false,
  nodes:[
    {id:'auth',name:'sessionKey',kind:'symbol',path:'src/auth.mjs',about:'credential authentication'},
    {id:'doc',name:'Access decisions',kind:'document',path:'docs/access.md'},
    {id:'test',name:'Authentication tests',kind:'file',path:'tests/auth.test.mjs'},
    {id:'other',name:'A speculative relation',kind:'file',path:'src/other.mjs'},
  ], edges:[
    {from:'auth',to:'doc',kind:'documented-by',confidence:'EXTRACTED',reason:'Explicit reference',source:{path:'docs/access.md',line:4}},
    {from:'test',to:'auth',kind:'imports',confidence:'EXTRACTED',reason:'Import',source:{path:'tests/auth.test.mjs',line:2}},
    {from:'auth',to:'other',kind:'resembles',confidence:'INFERRED',reason:'A hypothesis'},
  ]},'team/repo');

test('path and symbol retrieval includes explained neighbours and no unrelated bulk', () => {
  const result = retrieveContext(fixture(),null,contextOptions({q:'sessionKey',revision}));
  assert.equal(result.nodes[0].id,'auth');
  assert.equal(result.snapshot.freshness,'matching');
  assert.ok(result.nodes.some(n=>n.path==='docs/access.md'));
  assert.equal(result.edges[0].confidence,'EXTRACTED');
  assert.deepEqual(result.edges[0].source,{path:'docs/access.md',line:4});
  assert.ok(result.edges.some(e=>e.confidence==='INFERRED' && e.source===null));
  assert.equal(retrieveContext(fixture(),null,contextOptions({q:'nonexistent'})).nodes.length,0);
  assert.equal(retrieveContext(fixture(),null,contextOptions({files:['src/auth.mjs'],limit:1})).nodes[0].match,'declared-file');
  assert.ok(retrieveContext(fixture(),null,contextOptions({files:['src']})).nodes.some(n=>n.match==='declared-folder'));
});

test('freshness is explicit and never inferred from import time', () => {
  const graph = fixture();
  const state = (g, revision) => retrieveContext(g,null,contextOptions({q:'auth',revision})).snapshot.freshness;
  assert.equal(state(null),'missing');
  assert.equal(state(graph),'unchecked');
  assert.equal(state(graph,'b'.repeat(40)),'different');
  assert.equal(state({...graph,dirty:true},revision),'dirty');
  assert.equal(state({...graph,revision:null},revision),'unknown');
  assert.equal(state({...graph,dirty:null},revision),'unknown');
});

test('UTF-8 serialized response, including metadata, stays within its byte budget', () => {
  const graph = fixture();
  graph.nodes.push(...Array.from({length:200},(_,i)=>({id:`large${i}`,name:'sessionKey',path:`src/${'漢'.repeat(180)}${i}.mjs`,kind:'file',about:'漢\\"'.repeat(500)})));
  graph.edges.push(...graph.nodes.slice(4).map(n=>({from:'auth',to:n.id,kind:'imports',confidence:'EXTRACTED',reason:'漢'.repeat(2000),source:{path:'src/auth.mjs',line:1}})));
  const card={key:'ONE-1',title:'Access',text:'漢'.repeat(10000),state:'making',files:Array(30).fill('漢'.repeat(500)),history:Array(2000).fill({verb:'said',data:{line:'noise'}})};
  const result=retrieveContext(graph,card,contextOptions({q:'sessionKey',maxBytes:4096,limit:20}));
  assert.ok(Buffer.byteLength(JSON.stringify(result))+1<=4096);
  assert.equal(result.budget.bytes,Buffer.byteLength(JSON.stringify(result))+1);
  assert.ok(result.budget.omittedNodes>0 && result.budget.omittedEdges>0 && result.budget.cardTruncated);
  assert.equal('history' in result.card,false);
  assert.equal(card.history.length,2000,'retrieval never deletes the chronicle');
});

test('invalid inputs fail explicitly instead of silently widening retrieval', () => {
  for (const input of [{},{q:'a',maxBytes:0},{q:'a',maxBytes:24001},{q:'a',limit:NaN},{q:'a',limit:1.5},{files:['../secret']},{files:['/secret']},{card:3},{card:'OTHER'},{q:'a',revision:'main'},{q:'x'.repeat(501)}]) assert.throws(()=>contextOptions(input));
});

test('service enforces project isolation even when the card is a query parameter', async () => {
  const g=createGradula(createMemoryStore());
  await g.createProject({key:'ONE',name:'One',repo:'team/repo'});
  await g.createProject({key:'TWO',name:'Two',repo:'team/repo'});
  assert.equal((await g.health('ONE')).context.freshness,'missing');
  const card=await g.addItem('TWO',{kind:'task',title:'Secret'},'Person');
  await assert.rejects(g.getContext('ONE',{card:card.key}),{status:404});
  await g.putCodegraph('ONE',fixture(),'Person');
  assert.equal((await g.health('ONE')).context.freshness,'unchecked');
  assert.equal((await g.getContext('TWO',{q:'auth'})).snapshot.freshness,'missing');
  await g.patchProject('ONE',{repo:'other/repo'});
  assert.equal((await g.getContext('ONE',{q:'auth'})).snapshot.freshness,'missing');
});

const run = (script,args,env,cwd,stdin='') => new Promise((resolve,reject) => {
  const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),...args],{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(stdin);
});

test('real HTTP, CLI publish/context and MCP all use the same bounded door', async t => {
  const g=createGradula(createMemoryStore());
  await g.createProject({key:'ONE',name:'One',repo:'team/repo'});
  const {token}=await g.mintToken('ONE','test','Person');
  const server=createServer(createApi(g));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>server.close(done)));
  const dir=mkdtempSync(join(tmpdir(),'gradula-context-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const env={GRADULA_URL:base,GRADULA_TOKEN:token,GRADULA_AGENT_TOKEN:token,GRADULA_SESSION:'context-test'};
  assert.equal((await fetch(`${base}/api/v1/context?q=auth`)).status,401);
  assert.equal((await fetch(`${base}/api/v1/context?maxBytes=bogus&q=auth`,{headers:{Authorization:`Bearer ${token}`}})).status,400);
  writeFileSync(join(dir,'graph.json'),JSON.stringify(fixture()));
  const publish=await run('../bin/gradula.mjs',['codegraph','graph.json'],env,dir);
  assert.equal(publish.code,0,publish.stderr);assert.match(publish.stdout,/4 nodes/);
  const cli=await run('../bin/gradula.mjs',['context','sessionKey','--revision',revision,'--max-bytes','4096'],env,dir);
  assert.equal(cli.code,0,cli.stderr);
  const result=JSON.parse(cli.stdout);assert.equal(result.nodes[0].id,'auth');assert.equal(result.snapshot.freshness,'matching');
  assert.ok(Buffer.byteLength(cli.stdout)<=4096);
  const mcp=await run('../mcp/server.mjs',[],env,dir,`${JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'plan_context',arguments:{q:'sessionKey',revision,maxBytes:4096}}})}\n`);
  assert.equal(mcp.code,0,mcp.stderr);
  assert.deepEqual(JSON.parse(JSON.parse(mcp.stdout).result.content[0].text),result);
});
