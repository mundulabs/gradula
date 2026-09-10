/**
 * Which cards belong together. The melt draws exactly this, so getting it
 * wrong draws a relationship that does not exist — and a board that invents
 * connections is worse than one that shows none.
 *
 * The rule lives in TypeScript on the board; this checks the shape of the law
 * the same way tests/motion.test.mjs does, because a design review cannot
 * answer "does this bond mean anything" by looking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LINK_KINDS } from '../src/spec.mjs';

const law = readFileSync(new URL('../web/src/bonds.ts', import.meta.url), 'utf8');

test('a bond is drawn only for a fact the board actually has', () => {
  // `file` comes from what a runner really touched; `venture` from a link a
  // person laid. Anything else would be a guess with a nice edge on it.
  const reasons = /export type Bond = \{ reason: ([^;]+);/.exec(law)[1]
    .split('|').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(reasons.sort(), ['file', 'venture']);
});

test('the venture bond reads a link kind that exists', () => {
  const kind = /link\.kind !== '([a-z-]+)'/.exec(law)[1];
  assert.ok(LINK_KINDS.includes(kind), `"${kind}" is not a link kind`);
});

test('a group of one is not a group', () => {
  // Drawing a bond around a single card says something untrue — and costs a
  // filter for nothing.
  assert.match(law, /length < 2/, 'the law refuses pairs of one');
  const guards = [...law.matchAll(/\.length < 2/g)];
  assert.equal(guards.length, 2, 'both kinds of bond refuse a group of one');
});

test('grouping stays inside one column', () => {
  assert.match(law, /Grouping across columns would be a lie/,
    'the reason is written down, so nobody helpfully removes the limit');
});
