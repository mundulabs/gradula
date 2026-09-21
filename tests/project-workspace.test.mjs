import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../web/src/graph-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {projectGraph,radialGraph}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const nodes=Array.from({length:500},(_,i)=>({id:String(i),name:`Node ${i}`,kind:i%5===0?'doc':'file',about:''}));
const graph={nodes,edges:nodes.slice(1).map(n=>({from:'0',to:n.id,confidence:'EXTRACTED'}))};
test('radial workspace keeps the drawing bounded while search reaches offscreen nodes',()=>{
 const view=projectGraph(graph,'','all',null,80);assert.equal(view.shown.length,80);assert.ok(view.edges.length<=100);assert.equal(view.total,500);
 const search=projectGraph(graph,'Node 499','all',null,80);assert.deepEqual(search.shown.map(n=>n.id),['499']);
 for(const [width,height] of [[1440,750],[390,450],[280,220]]){
  const layout=radialGraph(view.shown,width,height,null);
  for(const p of layout.positions.values()){assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.x>=0&&p.x<=width);assert.ok(p.y>=0&&p.y<=height);}
  assert.ok(layout.rings.every(r=>!r.path.includes('NaN')));
 }
});
test('focused node stays at the center and only real neighbours become relationships',()=>{
 const view=projectGraph(graph,'','all','499',80),layout=radialGraph(view.shown,1000,600,'499');
 assert.deepEqual(new Set(view.shown.map(n=>n.id)),new Set(['0','499']));assert.equal(view.edges.length,1);
 assert.deepEqual(layout.positions.get('499'),{x:500,y:300,angle:0,center:true});
 assert.equal(layout.positions.get('0').center,false);
 assert.equal(radialGraph([],1000,600,null).rings.length,0);
});
