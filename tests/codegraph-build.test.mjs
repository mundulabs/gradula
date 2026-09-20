import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph} from '../tools/codegraph.mjs';

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
