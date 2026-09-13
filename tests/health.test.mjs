/**
 * The housekeeping. It must not be a number — and every finding must name its
 * cards, or it can only be believed or ignored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { findings, whoDidWhat } from '../src/health.mjs';
import { RUNNING_MS } from '../src/spec.mjs';

const now = Date.parse('2026-09-09T12:00:00Z');
const k = (id, x = {}) => ({
  id, key: id, kind: 'task', state: 'ready', title: id,
  created: new Date(now - 86_400_000).toISOString(), suggestions: { module: [], stack: [] }, ...x,
});

test('every finding names its cards', () => {
  const out = findings([k('A'), k('B', { gate: { kind: 'test', call: 'x' } })], [], [], { now });
  const gate = out.find((f) => f.id === 'no-gate');
  assert.deepEqual(gate.cards, ['A'], 'only the ones without a gate');
  assert.equal(gate.count, 1);
  assert.ok(gate.why, 'and the reason with it');
});

test('what is empty is not reported at all', () => {
  // Nobody reads a list of seven zeroes twice.
  const clean = findings([k('A', { gate: { kind: 'test', call: 'x' }, module: ['panels'] })], [], [], { now });
  assert.deepEqual(clean.map((f) => f.id), [], 'nothing to sweep, nothing to report');
});

test('being made without a runner is a finding, being made WITH one is not', () => {
  const cards = [
    k('A', { state: 'making', gate: { kind: 'test', call: 'x' } }),
    k('B', { state: 'making', gate: { kind: 'test', call: 'x' }, heartbeat: new Date(now - 10_000).toISOString() }),
    k('C', { state: 'making', gate: { kind: 'test', call: 'x' }, heartbeat: new Date(now - RUNNING_MS - 1000).toISOString() }),
  ];
  const stalled = findings(cards, [], [], { now }).find((f) => f.id === 'stalled');
  assert.deepEqual(stalled.cards, ['A', 'C'], 'an expired lease counts like none');
});

test('an overdue milestone is the only deadline that counts', () => {
  const cards = [
    k('M', { kind: 'milestone', due: '2026-09-01' }),
    k('N', { kind: 'milestone', due: '2026-12-01' }),
    k('O', { kind: 'milestone', due: '2026-09-01', state: 'done' }),
  ];
  const over = findings(cards, [], [], { now }).find((f) => f.id === 'overdue');
  assert.deepEqual(over.cards, ['M'], 'only open and past');
});

test('there is no health score', () => {
  // A value falls when you write things down honestly and rises when you
  // stop. After two weeks a team optimises the number instead of the thing.
  const out = findings([k('A')], [], [], { now });
  for (const f of out) {
    assert.ok(!('score' in f) && !('percent' in f) && !('health' in f), 'no value');
  }
});


test('data hygiene flags cards that became prompt-sized', () => {
  const long = 'word '.repeat(260);
  const out = findings([k('A', { text: long }), k('B', { gate: { kind: 'test', call: 'x' }, module: ['panels'] })], [], [], { now });
  const found = out.find((f) => f.id === 'too-long');
  assert.deepEqual(found.cards, ['A']);
  assert.match(found.why, /brief/);
});

test('data hygiene flags noisy chronicles without deleting history', () => {
  const card = k('A', { gate: { kind: 'test', call: 'x' }, module: ['panels'] });
  const entries = Array.from({ length: 41 }, (_, i) => ({ item: 'A', verb: 'said', actor: 'david', at: new Date(now - i).toISOString() }));
  const found = findings([card], [], entries, { now }).find((f) => f.id === 'noisy-history');
  assert.deepEqual(found.cards, ['A']);
  assert.match(found.why, /resume/);
});

test('who did what comes from the chronicle — and the person stands before the machine', () => {
  const cards = [k('A'), k('B')];
  const entries = [
    { item: 'A', verb: 'moved', actor: 'david (via key "Davids Rechner")' },
    { item: 'B', verb: 'decided', actor: 'david' },
    { item: 'A', verb: 'created', actor: 'felix (via key "Felix")' },
  ];
  const who = whoDidWhat(entries, cards);
  assert.deepEqual(who.map((p) => p.actor), ['david', 'felix'], 'david (via key …) IS david');
  assert.equal(who[0].decided, 1);
  assert.deepEqual(who[0].cards, ['A', 'B']);
});

test('a machine is not a colleague', () => {
  // `key "Davids Rechner"` has no person in front of it — counted as one it
  // would be exactly the flattering mirror law 1 forbids.
  const cards = [k('A')];
  const who = whoDidWhat([
    { item: 'A', verb: 'moved', actor: 'key "Davids Rechner"' },
    { item: 'A', verb: 'moved', actor: 'Gradula (rule: all parts done)' },
    { item: 'A', verb: 'created', actor: 'felix (via key "Felix")' },
  ], cards);
  assert.deepEqual(who.map((p) => [p.actor, p.machine]), [
    ['felix', false],
    ['key "Davids Rechner"', true],
    ['Gradula', true],
  ], 'people first, machines below — and named as such');
});
