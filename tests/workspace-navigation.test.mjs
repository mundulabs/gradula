import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
async function compiled(file){const js=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));}
const {workspaceView,WORKSPACE_VIEWS}=await compiled('../web/src/workspace-navigation.ts');
const {knowledgeSearch}=await compiled('../web/src/graph-model.ts');
test('fresh and unknown links open tickets, while old Map links have a lightweight destination',()=>{
 for(const value of [null,'','unknown'])assert.equal(workspaceView(value),'board');
 assert.equal(workspaceView('map'),'overview');
 for(const value of WORKSPACE_VIEWS)assert.equal(workspaceView(value),value);
 assert.ok(!WORKSPACE_VIEWS.includes('map'));
});
test('knowledge search distinguishes identical basenames by full path and reaches the whole index',()=>{
 const graph={nodes:[{id:'a',name:'lib.rs',kind:'file',path:'crates/audio/lib.rs',about:'Audio processing'},{id:'b',name:'lib.rs',kind:'file',path:'crates/video/lib.rs',about:'Image processing'},...Array.from({length:150},(_,i)=>({id:`d${i}`,name:`Guide ${i}`,kind:'doc',path:`docs/${i}.md`,about:''}))],edges:[]};
 assert.deepEqual(knowledgeSearch(graph,'audio lib.rs','code').map(n=>n.id),['a']);
 assert.deepEqual(knowledgeSearch(graph,'image','all').map(n=>n.id),['b']);
 assert.equal(knowledgeSearch(graph,'','docs').length,150);
 assert.equal(knowledgeSearch(graph,'Guide 149','docs')[0].id,'d149');
 assert.deepEqual(knowledgeSearch(graph,'lib.rs','docs'),[]);
 assert.equal(knowledgeSearch(graph,'','docs')[2].name,'Guide 2');
});
