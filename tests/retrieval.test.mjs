import test from 'node:test';
import assert from 'node:assert/strict';
import {rankNodes,graphWalk} from '../src/retrieval.mjs';
import {contextOptions,retrieveContext} from '../src/context.mjs';
import {normalizeGraph} from '../src/codegraph.mjs';
const graph=()=>normalizeGraph({schema:'gradula.codegraph.v1',repository:'team/repo',nodes:[
  {id:'a',name:'authenticate',kind:'symbol',path:'src/auth.ts',about:'OIDC sign in'},
  {id:'b',name:'loginRoute',kind:'symbol',path:'src/routes.ts'},
  {id:'c',name:'Access guide',kind:'document',path:'docs/access.md'},
  {id:'d',name:'unrelated',kind:'symbol',path:'src/else.ts'},
],edges:[
  {from:'b',to:'a',kind:'calls',confidence:'EXTRACTED',reason:'Resolved call',source:{path:'src/routes.ts',line:3}},
  {from:'c',to:'b',kind:'references',confidence:'EXTRACTED',reason:'Citation',source:{path:'docs/access.md',line:2}},
  {from:'d',to:'a',kind:'resembles',confidence:'INFERRED',reason:'Not established'},
]},'team/repo');
test('BM25 resolves common terminology and prioritizes exact paths/symbols',()=>{
  assert.equal(rankNodes(graph(),{q:'authentication'})[0].node.id,'a');
  assert.equal(rankNodes(graph(),{q:'loginRoute'})[0].node.id,'b');
  assert.equal(rankNodes(graph(),{q:'access',files:['src/auth.ts']})[0].node.id,'a');
  assert.deepEqual(rankNodes(graph(),{q:'no-such-feature'}),[]);
});
test('path traversal returns the actual source chain and labels search bounds',()=>{
  const found=graphWalk(graph(),{mode:'path',from:'a',to:'c',depth:2});
  assert.deepEqual(found.nodes.map(n=>n.id),['a','b','c']);assert.equal(found.traversal.status,'found');
  assert.equal(graphWalk(graph(),{mode:'path',from:'a',to:'c',depth:1}).traversal.status,'bounded');
  assert.equal(graphWalk(graph(),{mode:'path',from:'a',to:'d',depth:6}).traversal.status,'not-found');
  assert.equal(graphWalk(graph(),{mode:'path',from:'a',to:'d',depth:1,includeInferred:true}).traversal.status,'found');
  assert.equal(graphWalk(graph(),{mode:'path',from:'missing',to:'d'}).traversal.status,'unresolved');
});
test('impact follows dependents rather than dependencies and does not invent inferred paths',()=>{
  assert.deepEqual(graphWalk(graph(),{mode:'impact',from:'a',depth:2}).nodes.map(n=>n.id),['a','b','c']);
  assert.deepEqual(graphWalk(graph(),{mode:'impact',from:'c',depth:2}).nodes.map(n=>n.id),['c']);
  const result=retrieveContext(graph(),null,contextOptions({mode:'path',from:'a',to:'c',limit:1}));
  assert.equal(result.traversal.outputTruncated,true);assert.equal(result.nodes.length,1);
  assert.ok(result.budget.bytes<=result.budget.maxBytes);
});
test('walk input rejects unsupported modes and unbounded or incomplete requests',()=>{
  for(const input of [{mode:'path',from:'a'},{q:'a',mode:'everything'},{q:'a',depth:30},{q:'a',includeInferred:'yes'}])assert.throws(()=>contextOptions(input));
});
test('ambiguous symbols require an exact node ID instead of choosing an arbitrary definition',()=>{
  const g=graph();g.nodes.push({id:'duplicate',name:'authenticate',kind:'symbol',path:'src/other.ts'});
  assert.equal(graphWalk(g,{mode:'explain',from:'authenticate'}).traversal.status,'unresolved');
  assert.equal(graphWalk(g,{mode:'explain',from:'a'}).nodes[0].id,'a');
});
test('compact lookup omits repeated prose and reports local checkout edits',()=>{
  const result=retrieveContext({...graph(),revision:'a'.repeat(40),dirty:false},null,contextOptions({q:'authenticate',revision:'a'.repeat(40),localDirty:true}));
  assert.equal(result.snapshot.freshness,'local-dirty');assert.equal(result.detail,'paths');assert.equal(result.nodes.length,1);
  assert.ok(!('about' in result.nodes[0]));assert.equal(result.edges.length,0);
});
