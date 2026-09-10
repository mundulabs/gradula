/**
 * The pulse. Pure functions, so every line can be pinned down without a store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { energy, pace, outlook, hangs, within } from '../src/pulse.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-09T12:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();

const card = (o) => ({ id: o.key, state: 'ready', kind: 'task', module: [], stack: [], title: o.key, ...o });
const move = (o) => ({ item: o.item, actor: o.actor ?? 'david', verb: o.verb ?? 'changed', data: o.data ?? null, at: o.time });

test('a period holds what falls inside it, oldest first', () => {
  const entries = [
    move({ item: 'A', time: ago(20) }),
    move({ item: 'B', time: ago(1) }),
    move({ item: 'C', time: ago(3) }),
  ];
  const held = within(entries, { since: ago(7), now: NOW });
  assert.deepEqual(held.map((e) => e.item), ['C', 'B'], 'the old one stays outside and the rest are in order');
});

test('energy is counted per module, per craft and per person', () => {
  const cards = [
    card({ key: 'A', module: ['panels'], stack: ['gpu'] }),
    card({ key: 'B', module: ['panels'], stack: ['design'] }),
  ];
  const entries = [
    move({ item: 'A', time: ago(1), actor: 'david' }),
    move({ item: 'A', time: ago(2), actor: 'claude' }),
    move({ item: 'B', time: ago(2), actor: 'david' }),
  ];
  const flow = energy(entries, cards, { since: ago(7), now: NOW });

  assert.equal(flow.moves, 3);
  assert.deepEqual(flow.module, [{ id: 'panels', moves: 3, cards: ['A', 'B'] }]);
  assert.deepEqual(flow.stack.map((s) => [s.id, s.moves]), [['gpu', 2], ['design', 1]], 'the busiest craft first');
  assert.deepEqual(flow.people, [
    { person: 'david', moves: 2, cards: ['A', 'B'], via: [] },
    { person: 'claude', moves: 1, cards: ['A'], via: [] },
  ]);
});

/**
 * The finding, not a rounding error: a board that cannot say where two thirds
 * of its energy went must SAY that, instead of drawing a confident chart of
 * the third it knows about.
 */
test('energy that carries no label is named as such, not dropped', () => {
  const cards = [card({ key: 'A', stack: ['gpu'] }), card({ key: 'B' })];
  const entries = [
    move({ item: 'A', time: ago(1) }),
    move({ item: 'B', time: ago(1) }),
    move({ item: 'B', time: ago(2) }),
  ];
  const flow = energy(entries, cards, { since: ago(7), now: NOW });

  assert.deepEqual(flow.stack, [{ id: 'gpu', moves: 1, cards: ['A'] }]);
  assert.deepEqual(flow.nowhere.stack, { moves: 2, cards: ['B'] }, 'two of three moves carry no craft');
  assert.deepEqual(flow.nowhere.module, { moves: 3, cards: ['A', 'B'] }, 'and no card carries a module at all');
});

test('a move on a card that is gone counts for nothing', () => {
  const flow = energy([move({ item: 'GONE', time: ago(1) })], [], { since: ago(7), now: NOW });
  assert.equal(flow.moves, 0);
});

/**
 * Dropping a card is a decision like any other. Counting only `done` makes a
 * week of honest clearing out look like a week of nothing.
 */
test('the pace counts what was settled — done and dropped alike', () => {
  const entries = [
    move({ item: 'A', verb: 'moved', data: { to: 'done' }, time: ago(1) }),
    move({ item: 'B', verb: 'moved', data: { to: 'ice' }, time: ago(2) }),
    move({ item: 'C', verb: 'moved', data: { to: 'review' }, time: ago(2) }),
    move({ item: 'D', verb: 'moved', data: { to: 'done' }, time: ago(30) }),
  ];
  const speed = pace(entries, { since: ago(4), now: NOW });
  assert.equal(speed.settled, 2, 'the one from a month ago is outside the period');
  assert.equal(speed.days, 4);
  assert.equal(speed.perDay, 0.5);
  assert.equal(speed.sample, 3, 'the sample is every move in the period, so the number can be judged');
});

test('a goal without a date cannot be late, and a still week cannot forecast', () => {
  assert.deepEqual(outlook({ due: null, open: ['A'], total: 1 }, 1, { now: NOW }), { verdict: 'no date', open: 1 });
  assert.equal(outlook({ due: '2026-09-30', open: ['A'], total: 1 }, 0, { now: NOW }).verdict, 'no pace');
  assert.deepEqual(outlook({ due: '2026-09-30', open: [], total: 2 }, 1, { now: NOW }), { verdict: 'settled', open: 0 });
});

/**
 * Green is read and believed, where a zero at least gets a second look — so a
 * goal with nothing under it must not come back as finished.
 */
test('a goal with no parts is unanswered, not finished', () => {
  assert.deepEqual(outlook({ due: '2026-09-30', open: [], total: 0 }, 1, { now: NOW }), { verdict: 'no parts', open: 0 });
});

test('the outlook says ahead, tight or behind — with the two numbers it rests on', () => {
  const due = new Date(NOW + 10 * DAY).toISOString().slice(0, 10);
  const goal = (open) => ({ due, total: open, open: Array.from({ length: open }, (_, i) => `K-${i}`) });

  assert.equal(outlook(goal(2), 1, { now: NOW }).verdict, 'ahead', 'two days of work, ten left');
  const tight = outlook(goal(9), 1, { now: NOW });
  assert.equal(tight.verdict, 'tight', 'it fits, with no room for a bad week');
  assert.equal(tight.daysNeeded, 9);
  assert.equal(outlook(goal(30), 1, { now: NOW }).verdict, 'behind');
  assert.equal(outlook({ due: '2020-01-01', open: ['A'], total: 1 }, 5, { now: NOW }).verdict, 'behind', 'the date is past');
});

/**
 * A card that blocks one card which blocks six is not a small problem, and a
 * direct count says it is.
 */
test('what it hangs on is counted through the chain, not just next door', () => {
  const cards = ['A', 'B', 'C', 'D'].map((key) => card({ key }));
  const links = [
    { from: 'B', to: 'A', kind: 'needs' },
    { from: 'C', to: 'B', kind: 'needs' },
    { from: 'D', to: 'C', kind: 'needs' },
  ];
  const held = hangs(cards, links);
  assert.deepEqual(held[0], { card: 'A', title: 'A', state: 'ready', waiting: ['B', 'C', 'D'] });
  assert.deepEqual(held.map((h) => h.card), ['A', 'B', 'C'], 'D holds nobody up and is not listed');
});

test('a settled card holds nobody up', () => {
  const cards = [card({ key: 'A', state: 'done' }), card({ key: 'B' })];
  assert.deepEqual(hangs(cards, [{ from: 'B', to: 'A', kind: 'needs' }]), []);
});

test('blocks and needs are the same edge from two sides', () => {
  const cards = [card({ key: 'A' }), card({ key: 'B' })];
  const byNeeds = hangs(cards, [{ from: 'B', to: 'A', kind: 'needs' }]);
  const byBlocks = hangs(cards, [{ from: 'A', to: 'B', kind: 'blocks' }]);
  assert.deepEqual(byNeeds, byBlocks);
});
