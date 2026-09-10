/**
 * The schedule. A report you have to trigger is, after two weeks, one nobody
 * triggers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { due, dueHeralds, CADENCES } from '../src/schedule.mjs';

const at = (iso) => Date.parse(iso);

test('without a schedule nothing is due', () => {
  assert.equal(due(undefined, { now: at('2026-09-09T12:00:00Z') }), false);
  assert.equal(due({ cadence: 'off', hour: 0 }, { now: at('2026-09-09T12:00:00Z') }), false);
  assert.deepEqual(CADENCES, ['daily', 'weekly', 'off']);
});

test('before the hour nothing is due, afterwards once', () => {
  const plan = { cadence: 'daily', hour: 8 };
  assert.equal(due(plan, { now: at('2026-09-09T07:59:00Z') }), false, 'too early');
  assert.equal(due(plan, { now: at('2026-09-09T08:00:00Z') }), true);
});

test('daily means once per calendar day, not every 24 hours', () => {
  // Otherwise the hour wanders a little later on every run, and after two
  // weeks the morning report arrives in the evening.
  const plan = { cadence: 'daily', hour: 8, lastRun: '2026-09-09T08:30:00Z' };
  assert.equal(due(plan, { now: at('2026-09-09T23:00:00Z') }), false, 'the same day');
  assert.equal(due(plan, { now: at('2026-09-10T08:05:00Z') }), true, 'a new day');
});

test('weekly only on its weekday', () => {
  // 2026-09-14 is a Monday.
  const plan = { cadence: 'weekly', hour: 7, weekday: 1 };
  assert.equal(due(plan, { now: at('2026-09-13T09:00:00Z') }), false, 'Sunday');
  assert.equal(due(plan, { now: at('2026-09-14T09:00:00Z') }), true, 'Monday');
});

test('a disabled herald is never due', () => {
  const heralds = [
    { id: 'a', active: false, schedule: { cadence: 'daily', hour: 0 } },
    { id: 'b', schedule: { cadence: 'daily', hour: 0 } },
  ];
  const out = dueHeralds(heralds, { now: at('2026-09-09T12:00:00Z') });
  assert.deepEqual(out.map((d) => d.herald.id), ['b']);
});

test('the first report does not reach back to the beginning of time', () => {
  // Otherwise the very first one is a wall nobody reads.
  const [first] = dueHeralds([{ id: 'a', schedule: { cadence: 'daily', hour: 0 } }], { now: at('2026-09-09T12:00:00Z') });
  assert.equal(first.since, '2026-09-08T12:00:00.000Z');
  assert.equal(first.period, 'today');
});
