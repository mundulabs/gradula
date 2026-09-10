/**
 * The motion law: every effect shows a fact from the board, or it does not go
 * in. That is testable because the law is a function, not a stylesheet — and
 * it has to be, since "does this move for a reason" is exactly the question a
 * design review cannot answer by looking.
 *
 * The board's source is TypeScript, so this test carries the same law in the
 * plain form the service can read. If the two ever drift, the web build breaks
 * on the shared vocabulary — the states come from src/spec.mjs either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STATES, LEVELS, isLoud } from '../src/spec.mjs';

const law = readFileSync(new URL('../web/src/motion.ts', import.meta.url), 'utf8');

test('the law names only states the vocabulary knows', () => {
  // A signal for a state that cannot happen is decoration with extra steps.
  for (const quoted of law.matchAll(/card\.state === '([a-z]+)'/g)) {
    assert.ok(STATES.includes(quoted[1]), `"${quoted[1]}" is not a state`);
  }
});

test('every signal has a shape, and no shape is orphaned', () => {
  const signals = [...law.matchAll(/case '(working|attention|changed)':/g)].map((m) => m[1]);
  const declared = /export type Signal = ([^;]+);/.exec(law)[1]
    .split('|').map((s) => s.trim().replace(/'/g, ''));
  for (const name of declared) {
    assert.ok(signals.includes(name), `signal "${name}" is declared but has no beam`);
  }
});

test('the orb reads a lease, not a state', () => {
  // `making` is a state somebody put the card in and may leave it in for days.
  // `running` is a machine, right now. Showing them as one signal would lose
  // the interesting half — so the orb reads `running` and nothing else.
  assert.match(law, /card\.running === true/, 'the orb reads the lease');
  assert.match(law, /making/, 'and the beam still reads the state');
  assert.doesNotMatch(
    /export const isRunning[^;]+;/.exec(law)[0],
    /state/,
    'the lease must not be derived from a state',
  );
});

test('exactly one signal is warm, and it is the one that needs a person', () => {
  // Mundula's design law: the orange means state, never decoration. Colour
  // here doubles the shape; it does not open a second language. Two warm
  // signals would be two languages.
  const warm = [...law.matchAll(/case '(\w+)': return \{[^}]*color: 'sunset'/g)].map((m) => m[1]);
  assert.deepEqual(warm, ['attention'], 'only attention is warm');
  const cold = [...law.matchAll(/case '(\w+)': return \{[^}]*color: 'mono'/g)].map((m) => m[1]);
  assert.deepEqual(cold.sort(), ['changed', 'working'], 'progress is not an alarm');
});

/**
 * A FATAL CRASH ASKS FOR A HAND — IN THE SIGNAL THE BOARD ALREADY HAS.
 *
 * The level came out of Sentry as a line of text in the body, so a card
 * carrying a fatal crash looked like every other card. It is a field now, and
 * a loud one raises the signal that already means "you are needed".
 *
 * This file reads the law rather than running it (the board is TypeScript, the
 * service is not), so what is checked is the law's SHAPE: no second warm
 * colour was invented, only the levels the vocabulary knows are named, and a
 * settled card is excluded — an alarm on something done is one nobody can
 * answer.
 */
test('a loud level raises the signal the board already has, and invents no second one', () => {
  const loud = /const loud = ([^;]+);/.exec(law);
  assert.ok(loud, 'the law names a loud level at all');
  for (const quoted of loud[1].matchAll(/level === '([a-z]+)'/g)) {
    assert.ok(LEVELS.includes(quoted[1]), `"${quoted[1]}" is not a level Sentry sends`);
    assert.ok(isLoud(quoted[1]), `"${quoted[1]}" does not ask for a hand`);
  }
  assert.match(loud[1], /!\['done', 'ice'\]\.includes\(card\.state\)/, 'a settled card is quiet, however bad the crash was');
  assert.match(law, /loud\) return 'attention'/, 'it raises the signal that already means "you are needed"');

  const warm = [...law.matchAll(/color: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(warm)].filter((c) => c !== 'mono'), ['sunset'], 'exactly one warm colour, and it was already there');
});
