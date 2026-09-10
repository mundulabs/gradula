/**
 * The wave: the order and the concurrency — the two things a loop inside ONE
 * repository cannot know.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { wave, ripe, coverage } from '../src/wave.mjs';

const k = (key, x = {}) => ({ id: key, key, kind: 'task', state: 'ready', title: key, files: [], ...x });
const keys = (list) => list.map((x) => x.key);

test('what waits on something open is not ready — what waits on something done is', () => {
  const cards = [k('A'), k('B'), k('C', { state: 'done' }), k('D')];
  const links = [
    { kind: 'needs', from: 'B', to: 'A' },
    { kind: 'needs', from: 'D', to: 'C' },
  ];
  const { waves, waiting } = wave(cards, links);
  assert.deepEqual(keys(waves[0]), ['A', 'D'], 'D waits on a finished card and may go');
  assert.deepEqual(waiting.map((w) => [w.card.key, w.waitsOn]), [['B', ['A']]]);
});

test('two cards on the same file do NOT run side by side', () => {
  const cards = [k('A', { files: ['x.js'] }), k('B', { files: ['x.js'] }), k('C', { files: ['y.js'] })];
  const { waves } = wave(cards, []);
  assert.equal(waves.length, 2);
  assert.deepEqual(keys(waves[0]), ['A', 'C'], 'different files may go together');
  assert.deepEqual(keys(waves[1]), ['B'], 'the same file has to wait');
});

test('without files nothing collides', () => {
  const { waves } = wave([k('A'), k('B'), k('C')], []);
  assert.equal(waves.length, 1, 'whoever touches nothing stands in nobody\'s way');
});

test('the same question gives the same answer', () => {
  const cards = [k('P-10', { files: ['x'] }), k('P-2', { files: ['x'] }), k('P-1', { files: ['x'] })];
  const one = wave(cards, []);
  const two = wave([...cards].reverse(), []);
  assert.deepEqual(one.waves.map(keys), two.waves.map(keys), 'the order of the input does not decide');
  assert.deepEqual(one.waves.map(keys), [['P-1'], ['P-2'], ['P-10']], 'by number, not as text');
});

test('a venture takes its parts with it, the parts of the parts too', () => {
  const cards = [k('V'), k('T1'), k('T2'), k('TIEF'), k('FREMD')];
  const links = [
    { kind: 'part-of', from: 'T1', to: 'V' },
    { kind: 'part-of', from: 'T2', to: 'V' },
    { kind: 'part-of', from: 'TIEF', to: 'T1' },
  ];
  const { waves, root } = wave(cards, links, { root: 'V' });
  assert.equal(root, 'V');
  assert.deepEqual(keys(waves[0]).sort(), ['T1', 'T2', 'TIEF', 'V']);
  assert.ok(!keys(waves.flat()).includes('FREMD'), 'what does not hang under it does not belong to it');
});

test('a venture that does not exist is an empty answer — not a crash', () => {
  assert.deepEqual(wave([k('A')], [], { root: 'GIBTSNICHT' }), { waves: [], waiting: [], withoutGate: [], root: null });
});

test('whoever has no gate is named — or the loop has nothing to stop it', () => {
  const { withoutGate } = wave([k('A', { gate: { kind: 'test', call: 'npm test' } }), k('B')], []);
  assert.deepEqual(withoutGate, ['B']);
});

test('only tasks are asked for a gate', () => {
  // A decision is done once it has been made. An idea is not work yet. A
  // venture has a better gate: its parts.
  const cards = [k('E', { kind: 'decision' }), k('I', { kind: 'idea' }), k('V', { kind: 'venture' }), k('A')];
  assert.deepEqual(wave(cards, []).withoutGate, ['A']);
});

test('a venture is ripe when its parts are', () => {
  const cards = [
    k('V', { kind: 'venture' }),
    k('T1', { state: 'done' }),
    k('T2', { state: 'ice' }),
  ];
  const links = [
    { kind: 'part-of', from: 'T1', to: 'V' },
    { kind: 'part-of', from: 'T2', to: 'V' },
  ];
  assert.deepEqual(ripe(cards, links).map((r) => [r.card.key, r.parts]), [['V', ['T1', 'T2']]],
    'nobody waits on what lies on ice');

  cards[2].state = 'making';
  assert.deepEqual(ripe(cards, links), [], 'one open part keeps the whole thing open');
});

test('a venture without parts is NOT ripe', () => {
  // Otherwise every freshly created one would be done at once — the kind of
  // rule you meet once and never switch on again.
  assert.deepEqual(ripe([k('V', { kind: 'venture' })], []), []);
});

test('a task with parts is not closed by itself', () => {
  const cards = [k('A'), k('T', { state: 'done' })];
  assert.deepEqual(ripe(cards, [{ kind: 'part-of', from: 'T', to: 'A' }]), [],
    'the rule holds for ventures and milestones, not for everything with children');
});

test('coverage is a real fraction of a real set — or nothing at all', () => {
  // Not a global "x % done": that number goes UP when you create fewer cards,
  // which teaches a team not to write things down, and then nothing is true.
  const cards = [
    k('M', { kind: 'milestone', due: '2026-09-30' }),
    k('V', { kind: 'venture' }),
    k('A', { state: 'done' }), k('B', { state: 'ice' }), k('C'),
    k('X'),
  ];
  const links = [
    { kind: 'part-of', from: 'A', to: 'M' },
    { kind: 'part-of', from: 'B', to: 'M' },
    { kind: 'part-of', from: 'C', to: 'M' },
  ];
  const [first, second] = coverage(cards, links);

  assert.equal(first.card.key, 'M', 'the nearest date comes first');
  assert.equal(first.total, 3);
  assert.equal(first.done, 1, 'one was built');
  assert.equal(first.dropped, 1, 'one was thrown away — settled, but not made');
  assert.equal(Math.round(first.share * 100), 67, 'both are settled, so two thirds are behind us');
  assert.deepEqual(first.open, ['C'], 'a number without the cards behind it answers no next question');

  // A milestone without parts is NOT at zero percent. It is unanswered, and
  // those are two different things.
  assert.equal(second.card.key, 'V');
  assert.equal(second.share, null);
});

test('only a milestone or a venture has a coverage at all', () => {
  const cards = [k('T'), k('D', { kind: 'decision' })];
  assert.deepEqual(coverage(cards, []), []);
});

/**
 * A DROPPED PART IS NOT A BUILT ONE.
 *
 * Something on ice settles a venture — nobody waits on it, so it is ripe and
 * nothing is left to do. But it was not made. A milestone that reports "5 of
 * 5" when one of the five was thrown away is lying about what exists, and the
 * lie is invisible: the number looks the way a finished thing looks.
 */
test('what was dropped is counted apart from what was done', () => {
  const cards = [
    k('V', { kind: 'venture', state: 'making' }),
    k('A', { state: 'done' }), k('B', { state: 'done' }),
    k('C', { state: 'done' }), k('D', { state: 'done' }),
    k('E', { state: 'ice' }),
  ];
  const links = ['A', 'B', 'C', 'D', 'E'].map((k) => ({ kind: 'part-of', from: k, to: 'V' }));
  const [v] = coverage(cards, links);
  assert.equal(v.total, 5);
  assert.equal(v.done, 4, 'four were built');
  assert.equal(v.dropped, 1, 'one was thrown away, and it says so');
  assert.equal(v.share, 1, 'nothing is left to do all the same — the venture is settled');
  assert.deepEqual(v.open, [], 'nobody is waiting on ice');
});
