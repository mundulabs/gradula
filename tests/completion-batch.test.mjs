import test from 'node:test';
import assert from 'node:assert/strict';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';
import { createCompletionBatch, completionSummary } from '../src/completion-batch.mjs';

test('completion bursts send one summary per subscribed herald and preserve history', async () => {
  const sent = [];
  const g = createGradula(createMemoryStore(), { completionWindowMs: 20, origin: 'https://board.test', heraldKinds: { probe: { async send(c, text) { sent.push({ chat:c.chat, text }); return { sent:true }; } } } });
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
  }
  for (const card of cards) assert.equal((await g.getItem(card.key)).state, 'done');
});

test('batches isolate recipients, recover after delivery failure and bound long summaries', async () => {
  const q=createCompletionBatch({delay:5}); const calls=[];
  const deliver=async entries=>{calls.push(entries.length);return {sent:true};};
  await Promise.all([q.enqueue('a',1,deliver),q.enqueue('a',2,deliver),q.enqueue('b',3,deliver)]);
  assert.deepEqual(calls,[2,1]);
  assert.equal((await q.enqueue('a',1,async()=>{throw Error('down');})).sent,false);
  assert.equal((await q.enqueue('a',1,deliver)).sent,true);
  const entries=Array.from({length:30},(_,i)=>({card:{key:`PRB-${i+1}`,title:'x'.repeat(300)}}));
  const text=completionSummary(entries,'Probe');
  assert.match(text,/30 cards completed/); assert.match(text,/18 more/); assert.ok(text.length<2000);
});
