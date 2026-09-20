import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMemoryStore } from '../src/store.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createApi } from '../src/api.mjs';
import { gatherDeployed } from '../src/deployed.mjs';
const builds = [['memory', async () => createMemoryStore()]];
if (process.env.GRADULA_DB_URL) builds.push(['Postgres', async () => {
  const { createPgStore } = await import('../src/store-pg.mjs');
  const s = await createPgStore(process.env.GRADULA_DB_URL, { schema: `rekey_${Date.now()}` });
  await s.migrate(); return s;
}]);
for (const [name, build] of builds) test(`${name}: rekey preserves active work, history, credentials and tenant isolation`, async t => {
  const store = await build(); t.after(() => store.close?.());
  const g = createGradula(store);
  await g.createProject({key:'OLD',name:'Native',repo:'owner/native'});
  await g.createProject({key:'OTHER',name:'Other'});
  const card = await g.addItem('OLD',{kind:'task',title:'Follow OLD-2',text:'See OLD-2 and XOLD-2.'},'owner');
  const peer = await g.addItem('OLD',{kind:'task',title:'Peer'},'owner');
  await store.links.add({project:'OLD',from:card.id,to:peer.id,kind:'mentions'});
  const {token} = await store.tokens.mint({project:'OLD',name:'Agent',kind:'agent'});
  const other = await store.tokens.mint({project:'OTHER',name:'Other'});
  const owner = {owner:'session-owner',session:'active-session',files:['src/engine.rs']};
  await g.startItem(card.key,'owner',owner);
  const before = await g.getItem(card.key);
  await store.vocab.set('OLD',[{id:'native',paths:['src'],words:[]}]);
  await store.github.set('OLD',{repo:'owner/native',token:'private'});
  await store.dokploy.set('OLD',{base:'https://deploy.test',token:'private',composeId:'native'});
  const device = await store.devices.open({project:'OLD',machine:'dev'});
  await store.codegraphs.set('OLD',{digest:'same',revision:'a'.repeat(40),dirty:false,actor:'owner',importedAt:new Date().toISOString(),repository:'owner/native',nodes:[],edges:[]});
  const renamed = await g.rekeyProject('OLD','NEW','owner');
  assert.equal(renamed.key,'NEW');
  const after = await g.getItem('OLD-1');
  assert.equal(after.id,card.id); assert.equal(after.key,'NEW-1');
  assert.equal(after.title,'Follow NEW-2'); assert.equal(after.text,'See NEW-2 and XOLD-2.');
  assert.deepEqual(after.reservation,before.reservation);
  assert.deepEqual(after.history.slice(0,before.history.length),before.history);
  assert.deepEqual(after.history.at(-1).data.rekey,{from:'OLD-1',to:'NEW-1'});
  await g.beat('OLD-1','owner',owner);
  await assert.rejects(g.beat('NEW-1','intruder',{owner:'other',session:'other'}), e=>e.code==='reserved');
  assert.equal((await store.tokens.verify(token)).project,'NEW');
  assert.equal((await store.devices.get(device.id)).project,'NEW');
  assert.equal((await store.vocab.get('NEW'))[0].id,'native');
  assert.equal((await store.github.get('NEW')).token,'private');
  assert.equal((await store.dokploy.get('NEW')).composeId,'native');
  assert.equal((await store.links.list('NEW')).length,1);
  assert.equal((await store.codegraphs.get('NEW','a'.repeat(40))).digest,'same');
  assert.equal((await g.addItem('OLD',{kind:'task',title:'Future'},'owner')).key,'NEW-3');
  await assert.rejects(g.createProject({key:'OLD',name:'Hijack'}));
  await assert.rejects(store.projects.create({key:'OLD',name:'Hijack'}));
  assert.equal(await store.projects.rekey('OTHER','OLD'),null);
  const server = createServer(createApi(g));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const key of ['OLD-1','NEW-1']) {
    const ok = await fetch(`${base}/api/v1/cards/${key}`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(ok.status,200); assert.equal((await ok.json()).key,'NEW-1');
    const denied = await fetch(`${base}/api/v1/cards/${key}`,{headers:{Authorization:`Bearer ${other.token}`}});
    assert.equal(denied.status,404);
    const context = await fetch(`${base}/api/v1/context?card=${key}`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(context.status,200);
    const deniedContext = await fetch(`${base}/api/v1/context?card=${key}`,{headers:{Authorization:`Bearer ${other.token}`}});
    assert.equal(deniedContext.status,404);
  }
  const redirect = await fetch(`${base}/OLD-1`, {redirect:'manual'});
  assert.equal(redirect.status,302); assert.equal(redirect.headers.get('location'),'/NEW-1');
  await g.rekeyProject('NEW','LAST','owner');
  assert.equal((await g.getItem('OLD-1')).key,'LAST-1');
  assert.equal((await g.getItem('NEW-1')).id,card.id);
  assert.equal((await g.getProject('OLD')).key,'LAST');
  await g.beat('OLD-1','owner',owner);
});
test('a deployment naming an old Plan key still carries the renamed card',async()=>{
  const result = await gatherDeployed({
    environments:[{id:'production',deployments:[{status:'done',head:'a'.repeat(40),sha:'a'.repeat(40),carries:['OLD-1'],at:new Date().toISOString()}]}],
    cards:[{key:'NEW-1',state:'making'}],keyAliases:{OLD:'NEW'},
  });
  assert.deepEqual(result.deployed.production.cards,['NEW-1']);
});
