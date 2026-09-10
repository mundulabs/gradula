/**
 * The cartographer. What is checked is what it does NOT propose — its whole
 * worth hangs on that. The German card titles below are DATA: a card may be
 * written in either language, and a title stripped of its filler must be the
 * same title in both.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestions, similarity, wordsOf } from '../src/cartographer.mjs';

const card = (o) => ({ id: o.key, state: 'ready', kind: 'task', module: [], stack: [], files: [], title: '', ...o });

test('filler words carry no similarity — in either language', () => {
  assert.deepEqual([...wordsOf('Die Karte ist in der Ansicht nicht da')], ['karte', 'ansicht']);
  assert.deepEqual([...wordsOf('The card is not there in that view')], ['card', 'view']);
  assert.equal(similarity(wordsOf('a'), wordsOf('b')), 0, 'words that are too short do not count');
});

test('the same file is a fact, not a feeling', () => {
  const out = suggestions([
    card({ key: 'X-1', files: ['packages/panels/src/A.tsx'] }),
    card({ key: 'X-2', files: ['packages/panels/src/A.tsx', 'b.ts'] }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'touches');
  assert.equal(out[0].confidence, 'hard');
  assert.match(out[0].reason, /A\.tsx/);
});

test('what is already connected is not proposed again', () => {
  const cards = [card({ key: 'X-1', files: ['a.ts'] }), card({ key: 'X-2', files: ['a.ts'] })];
  const out = suggestions(cards, [{ from: 'X-1', to: 'X-2', kind: 'touches' }]);
  assert.deepEqual(out, []);
});

test('it does not propose finished or frozen cards', () => {
  const out = suggestions([
    card({ key: 'X-1', files: ['a.ts'], state: 'done' }),
    card({ key: 'X-2', files: ['a.ts'] }),
  ]);
  assert.deepEqual(out, []);
});

// The German titles below are DATA: resemblance is measured on the words that
// carry, and the filler list has to strip the same words in either language.
test('resemblance counts only in the same place', () => {
  const foreign = suggestions([
    card({ key: 'X-1', title: 'Menü im Fensterkopf zusammenlegen', module: ['panels'] }),
    card({ key: 'X-2', title: 'Menü im Fensterkopf aufräumen', module: ['engine'] }),
  ]);
  assert.deepEqual(foreign, [], 'same words, another module — no proposal');

  const nah = suggestions([
    card({ key: 'X-1', title: 'Menü im Fensterkopf zusammenlegen', module: ['panels'] }),
    card({ key: 'X-2', title: 'Menü im Fensterkopf aufräumen', module: ['panels'] }),
  ]);
  assert.equal(nah[0].kind, 'resembles');
  assert.equal(nah[0].confidence, 'soft');
  assert.match(nah[0].reason, /% shared words/);
});

test('three loose tasks in one module make a bundle proposal', () => {
  const cards = ['a', 'b', 'c'].map((n, i) => card({ key: `X-${i + 1}`, title: `Sache ${n}`, module: ['panels'] }));
  const bundle = suggestions(cards).find((v) => v.kind === 'bundle');
  assert.equal(bundle.module, 'panels');
  assert.deepEqual(bundle.cards, ['X-1', 'X-2', 'X-3']);

  const already = suggestions(cards, [{ from: 'X-1', to: 'X-9', kind: 'part-of' }]);
  assert.equal(already.find((v) => v.kind === 'bundle'), undefined, 'whatever already belongs to a venture does not count');
});
