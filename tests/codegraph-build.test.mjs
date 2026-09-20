import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph} from '../tools/codegraph.mjs';
import {createIndexer} from '../tools/codegraph-index.mjs';

test('local AST scan extracts imports, declarations and document citations with real lines',()=>{
  const files=new Map([
    ['src/a.mjs','// import "./fake.mjs";\nimport {authenticate} from "./b.mjs";\nexport function login() { return authenticate(); }\nconst text = "import x from ./fake.mjs";'],
    ['src/b.mjs','export function authenticate() {}'],
    ['src/fake.mjs','export const fake = true;'],
    ['docs/access.md','# Access\nSee [auth](../src/b.mjs) and `src/a.mjs`.'],
  ]);
  const metadata={repository:'team/repo',revision:'a'.repeat(40),dirty:false};
  const graph=buildGraph(files,metadata);
  assert.equal(graph.revision,metadata.revision);
  assert.ok(graph.nodes.some(n=>n.id==='file:src/a.mjs#login'));
  assert.equal(graph.nodes.find(n=>n.id==='file:src/a.mjs#login').line,3);
  const imports=graph.edges.filter(e=>e.kind==='imports');
  assert.equal(imports.length,1);assert.equal(imports[0].to,'file:src/b.mjs');assert.equal(imports[0].source.line,2);
  assert.equal(graph.edges.filter(e=>e.kind==='references').length,2);
  assert.ok(graph.edges.every(e=>e.source && e.confidence==='EXTRACTED'));
  assert.equal(buildGraph(new Map([...files].reverse()),metadata).digest,graph.digest,'stable regardless of file input order');
  assert.throws(()=>buildGraph(new Map([['bad.ts','export function {']]),metadata),/invalid syntax/);
});

test('compiler resolves aliases, re-exports, namespace calls and local shadowing',()=>{
  const files=new Map([
    ['src/core.ts','export function verify() {}\nexport class Token {}'],
    ['src/barrel.ts','export {verify} from "./core.js";'],
    ['src/client.ts','import {verify as check} from "./barrel.js";\nimport * as core from "./core.js";\nexport function run() { check(); core.verify(); new core.Token(); }\nexport function isolated() { function check() {} check(); }'],
  ]);
  const graph=buildGraph(files,{repository:'team/repo',revision:'a'.repeat(40),dirty:false});
  assert.ok(graph.edges.some(e=>e.from==='file:src/client.ts#run' && e.to==='file:src/core.ts#verify' && e.kind==='calls'));
  assert.ok(graph.edges.some(e=>e.from==='file:src/client.ts#run' && e.to==='file:src/core.ts#Token' && e.kind==='constructs'));
  assert.ok(graph.edges.some(e=>e.from==='file:src/client.ts#isolated' && e.to==='file:src/client.ts#isolated.check'));
  assert.ok(!graph.edges.some(e=>e.from==='file:src/client.ts#isolated' && e.to==='file:src/core.ts#verify'));
});

test('incremental rescans reuse unchanged syntax and remove deleted files and their edges',()=>{
  const indexer=createIndexer(), metadata={repository:'team/repo',revision:'a'.repeat(40),dirty:false};
  const files=new Map([['a.ts','import {f} from "./b.js"; export function g(){f()}'],['b.ts','export function f(){}']]);
  const first=indexer.build(files,metadata), warm=indexer.build(files,metadata);
  assert.equal(warm.stats.parsed,0);assert.equal(warm.stats.reused,2);assert.equal(first.graph.digest,warm.graph.digest);
  files.set('b.ts','export function renamed(){}');
  const changed=indexer.build(files,metadata);assert.equal(changed.stats.parsed,1);
  assert.ok(!changed.graph.edges.some(e=>e.to==='file:b.ts#f'));
  files.delete('b.ts');const removed=indexer.build(files,metadata);
  assert.equal(removed.stats.deleted,1);assert.ok(!removed.graph.nodes.some(n=>n.path==='b.ts'));
  assert.ok(!removed.graph.edges.some(e=>e.to.startsWith('file:b.ts')));
});

test('file mode retains every file and compiler dependency with bounded representative edges',()=>{
  const files=new Map([
    ['a.ts','import {f} from "./b.js"; export function run(){f();f()}'],
    ['b.ts','export function f(){}'],
    ['unused.ts','export const untouched=1;'],
    ['docs.md','# Guide\nSee `a.ts`.'],
  ]), metadata={repository:'team/repo',revision:'a'.repeat(40),dirty:false};
  const indexer=createIndexer({granularity:'files'}),{graph}=indexer.build(files,metadata);
  assert.deepEqual(graph.nodes.map(n=>n.path).sort(),[...files.keys()].sort());
  assert.ok(graph.nodes.every(n=>['file','document'].includes(n.kind)));
  const calls=graph.edges.filter(e=>e.kind==='calls');
  assert.equal(calls.length,1);assert.equal(calls[0].from,'file:a.ts');assert.equal(calls[0].to,'file:b.ts');
  assert.equal(calls[0].source.path,'a.ts');assert.equal(calls[0].confidence,'EXTRACTED');
  assert.match(graph.coverage.scope,/symbol details omitted/);
  assert.equal(indexer.build(new Map([...files].reverse()),metadata).graph.digest,graph.digest);
  files.delete('b.ts');assert.ok(!indexer.build(files,metadata).graph.edges.some(e=>e.to==='file:b.ts'));
  assert.throws(()=>createIndexer({granularity:'unknown'}),/Granularity/);
});
