import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../web/src/graph-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {projectGraph}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('knowledge projection bounds drawing, searches every node and preserves source relationships',()=>{
 const graph={nodes:Array.from({length:120},(_,i)=>({id:String(i),name:`Node ${i}`,kind:i===119?'doc':'file',path:i===119?'docs/last.md':`src/${i}.ts`,about:''})),edges:Array.from({length:119},(_,i)=>({from:'0',to:String(i+1),kind:'references',confidence:'EXTRACTED'}))};
 const overview=projectGraph(graph,'','all',null);assert.ok(overview.shown.length<=36);assert.ok(overview.shown.some(n=>n.id==='119'));assert.equal(overview.shown.length,36,'unused categories do not waste drawing capacity');
 const searched=projectGraph(graph,'last','docs',null);assert.deepEqual(searched.shown.map(n=>n.id),['119']);
 const focus=projectGraph(graph,'','all','119');assert.deepEqual(new Set(focus.shown.map(n=>n.id)),new Set(['119','0']));assert.deepEqual(focus.edges,[graph.edges[118]]);assert.equal(focus.relations.length,1);
 assert.deepEqual(projectGraph(graph,'absent','all',null).shown,[]);
});
