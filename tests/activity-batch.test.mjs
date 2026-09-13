import test from 'node:test';
import assert from 'node:assert/strict';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';
import { createActivityBatch, activitySummary } from '../src/activity-batch.mjs';

test('completion bursts send one summary per subscribed herald and preserve history', async () => {
  const sent = [];
  const g = createGradula(createMemoryStore(), { activityWindowMs: 20, origin: 'https://board.test', heraldKinds: { probe: { async send(c, text) { sent.push({ chat:c.chat, text }); return { sent:true }; } } } });
  await g.createProject({ key:'PRB', name:'Probe' });
  for (const chat of ['a','b']) await g.setHerald('PRB', { kind:'probe', name:chat, token:'x', chat, filter:{ verbs:['moved'], states:['done'] } }, 'human');
  const cards = [];
  for (let i=0;i<3;i++) cards.push(await g.addItem('PRB', { kind:'task', title:`Task ${i} & test` }, 'human'));
  await g.settle(); sent.length = 0;
  for (const card of cards) await g.moveItem(card.key, 'done', 'human');
  await g.settle();
  assert.equal(sent.length, 2);
  for (const msg of sent) {
    assert.match(msg.text, /3 cards completed/);
    for (const card of cards) assert.ok(msg.text.includes(`https://board.test/${card.key}`));
    assert.match(msg.text, /&amp;/);
    assert.match(msg.text, /●●●●● done/);
  }
  for (const card of cards) assert.equal((await g.getItem(card.key)).state, 'done');
});

test('batches isolate recipients, recover after delivery failure and bound long summaries', async () => {
  const q=createActivityBatch({delay:5}); const calls=[];
  const deliver=async entries=>{calls.push(entries.length);return {sent:true};};
  await Promise.all([q.enqueue('a',1,deliver),q.enqueue('a',2,deliver),q.enqueue('b',3,deliver)]);
  assert.deepEqual(calls,[2,1]);
  assert.equal((await q.enqueue('a',1,async()=>{throw Error('down');})).sent,false);
  assert.equal((await q.enqueue('a',1,deliver)).sent,true);
  const entries=Array.from({length:30},(_,i)=>({verb:'moved',to:'done',card:{key:`PRB-${i+1}`,title:'x'.repeat(300),state:'done'}}));
  const text=activitySummary(entries,'Probe');
  assert.match(text,/30 cards completed/); assert.match(text,/18 more/); assert.ok(text.length<2000);
});


test('mixed activity folds repeated cards to their latest state without claiming completion', () => {
  const entries = [
    { verb:'created', card:{ key:'PRB-1', title:'First', state:'ready' } },
    { verb:'moved', to:'review', card:{ key:'PRB-1', title:'First', state:'review' } },
    { verb:'evidenced', card:{ key:'PRB-2', title:'Second', state:'making' } },
  ];
  const text = activitySummary(entries, 'Probe');
  assert.match(text, /2 cards updated/);
  assert.match(text, /PRB-1 ●●●◐○ review/);
  assert.equal((text.match(/PRB-1/g) ?? []).length, 1);
  assert.doesNotMatch(text, /completed|ready/);
});

test('ordinary bursts combine before Done', async () => {
  const sent=[];
  const g=createGradula(createMemoryStore(), { activityWindowMs:20, heraldKinds:{ probe:{ async send(_c,text){sent.push(text); return {sent:true};} } } });
  await g.createProject({key:'PRB',name:'Probe'});
  await g.setHerald('PRB',{kind:'probe',name:'Workshop',chat:'a',token:'x',template:'workshop'},'human');
  const a=await g.addItem('PRB',{title:'First',kind:'task'},'human');
  await g.addItem('PRB',{title:'Second',kind:'task'},'human');
  await g.moveItem(a.key,'review','human');
  await g.settle();
  assert.equal(sent.length,1);
  assert.match(sent[0],/2 cards updated/);
  assert.match(sent[0],/●●●◐○ review/);
  assert.match(sent[0],/●◐○○○ ready/);
});


test('several events for one card send the latest detailed message', async () => {
  const sent = [];
  const g = createGradula(createMemoryStore(), { activityWindowMs: 30, origin:'https://board.test', heraldKinds: { probe: { async send(_c,text) { sent.push(text); return {sent:true}; } } } });
  await g.createProject({key:'PRB',name:'Probe'});
  await g.setHerald('PRB',{kind:'probe',name:'Workshop',chat:'a',token:'x',template:'workshop'},'human');
  const card = await g.addItem('PRB',{title:'Latest detailed title',kind:'task'},'human');
  await g.moveItem(card.key,'review','human','Latest review evidence');
  await g.settle();
  assert.equal(sent.length,1);
  assert.match(sent[0],/●●●◐○ review/);
  assert.match(sent[0],/Latest detailed title/);
  assert.match(sent[0],/Latest review evidence/);
  assert.doesNotMatch(sent[0],/cards updated|cards completed|•/);
});
