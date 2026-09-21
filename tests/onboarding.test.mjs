import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {projectKey,serviceOrigin,initializeInstance} from '../tools/setup.mjs';
import {scanRepository} from '../tools/codegraph.mjs';
import {createMemoryStore} from '../src/store.mjs';
import {createGradula} from '../src/gradula.mjs';
import {createApi} from '../src/api.mjs';

test('instance setup generates private unique secrets, refuses overwrite and foreign HTTP',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gradula-setup-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'.env.instance');initializeInstance({file,origin:'https://board.example.org'});
 const content=await readFile(file,'utf8');assert.match(content,/PUBLIC_ORIGIN=https:\/\/board.example.org/);
 assert.equal((await stat(file)).mode&0o777,0o600);
 const secrets=[...content.matchAll(/(?:PASSWORD|TOKEN|SECRET)=([a-f0-9]+)/g)].map(m=>m[1]);assert.equal(secrets.length,3);assert.equal(new Set(secrets).size,3);
 assert.throws(()=>initializeInstance({file,origin:'http://localhost:3200'}),/EEXIST/);
 assert.throws(()=>serviceOrigin('http://remote.example'));
 assert.throws(()=>serviceOrigin('https://user:password@example.org'));
 assert.equal(projectKey('My sound project'),'MSP');assert.equal(projectKey('Gradula'),'GRADULA');assert.equal(projectKey('1'),'PR');
});

test('initial scan inventories a mixed repository at a frozen revision without reading secrets or symlinks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gradula-scan-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.email','test@example.org');git('config','user.name','Test');git('remote','add','origin','https://github.com/example/polyglot.git');
 for(const [path,text] of Object.entries({'main.rs':'fn main() {}','app.py':'print("ok")','README.md':'# Example\nSee `main.rs`.','index.ts':'export const value = 1;','.env.production':'PASSWORD=never-publish-this','private.key':'secret-key','image.png':'binary'}))await writeFile(join(root,path),text);
 git('add','.');git('commit','-qm','Initial');const revision=git('rev-parse','HEAD');
 await writeFile(join(root,'README.md'),'uncommitted secret');
 const {graph}=scanRepository(root,undefined,{revision});assert.equal(graph.revision,revision);assert.equal(graph.dirty,false);
 for(const path of ['main.rs','app.py','image.png'])assert.ok(graph.nodes.find(n=>n.path===path&&n.kind==='file'));
 assert.ok(graph.edges.find(e=>e.from==='file:README.md'&&e.to==='file:main.rs'));
 assert.ok(!graph.nodes.some(n=>/\.env|private.key/.test(n.path??'')));
 assert.ok(!JSON.stringify(graph).includes('never-publish-this'));assert.ok(!JSON.stringify(graph).includes('uncommitted secret'));
 assert.match(graph.coverage.scope,/other languages are paths only/);
 assert.equal(graph.documents[0].markdown,'# Example\nSee `main.rs`.');
});

async function server(t){
 const store=createMemoryStore(),g=createGradula(store);
 const auth={role:'gradula',who:req=>req.headers.cookie?{sub:'alice',name:'Alice',roles:['gradula','project:A']} : null};
 const s=createServer(createApi(g,{adminToken:'admin-secret',auth,origin:'https://board.example'}));await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));
 const call=async(path,{token,body,method=body?'POST':'GET',cookie=false,origin}={})=>{
 const r=await fetch(`http://127.0.0.1:${s.address().port}${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(cookie?{cookie:'session=yes'}:{}),...(origin?{origin}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};return {g,call};
}
test('all admin routes reject ordinary keys; project roles isolate humans; archiving preserves data',async t=>{
 const {g,call}=await server(t);
 await g.createProject({key:'AA',name:'A',repo:'example/a',accessRole:'project:A'});await g.createProject({key:'BB',name:'B',accessRole:'project:B'});
 const credential=await g.mintToken('AA','test','admin');
 for(const path of ['/api/admin/projects/AA','/api/admin/projects/AA/rekey']){
  const method=path.endsWith('rekey')?'POST':'PATCH';
  assert.equal((await call(path,{method,body:{name:'Hijacked',key:'BAD'}})).status,401);
  assert.equal((await call(path,{token:credential.token,method,body:{name:'Hijacked',key:'BAD'}})).status,401);
 }
 assert.equal((await call('/api/v1/project?project=BB',{cookie:true})).status,404);
 assert.deepEqual((await call('/api/v1/projects',{cookie:true})).body.map(p=>p.key),['AA']);
 assert.equal((await call('/api/v1/project?project=AA',{cookie:true,method:'PATCH',body:{language:'en'},origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/v1/project?project=AA',{cookie:true,method:'PATCH',body:{language:'en'},origin:'https://board.example'})).status,200);
 const card=await g.addItem('AA',{kind:'task',title:'History stays'},'test');
 assert.equal((await call('/api/admin/projects/AA',{token:'admin-secret',method:'PATCH',body:{archived:true}})).status,200);
 assert.equal((await call('/api/v1/project',{token:credential.token})).status,410);
 assert.deepEqual((await call('/api/v1/projects',{cookie:true})).body,[]);
 assert.equal((await g.getItem(card.key)).title,'History stays');
 await call('/api/admin/projects/AA',{token:'admin-secret',method:'PATCH',body:{archived:false}});
 assert.equal((await call('/api/v1/project',{token:credential.token})).status,200);
});


test('rekey preserves an opted-in pilot without spending a new attempt',async()=>{
 const g=createGradula(createMemoryStore(),{decisionPilot:{projects:['OLD']}});
 await g.createProject({key:'OLD',name:'Pilot'});
 await g.rekeyProject('OLD','NEW');
 const report=await g.decisionReport('NEW');
 assert.equal(report.enabled,true);assert.equal(report.attempts,0);
});
