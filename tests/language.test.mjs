/**
 * Which language a card is written in — guessed, and never more than guessed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { looksLike, strangers } from '../src/language.mjs';

test('a letter English does not have is proof on its own', () => {
  assert.equal(looksLike('Die Tür klemmt'), 'de');
  assert.equal(looksLike('GPU flackert beim Größenwechsel'), 'de');
});

test('common words vote, and a clear majority decides', () => {
  assert.equal(looksLike('the shader is not drawing on the second screen'), 'en');
  assert.equal(looksLike('der Schieber wird nicht gezeichnet auf dem zweiten Schirm'), 'de');
});

/**
 * A guess with no evidence is worse than no guess: it fills a finding with
 * cards nobody needs to look at, and then the finding gets ignored.
 */
test('too little to say is an answer', () => {
  assert.equal(looksLike('GPU shader flicker'), null, 'three words are not evidence');
  assert.equal(looksLike('packages/visual/src/shader.wgsl'), null, 'a path says nothing');
  assert.equal(looksLike(''), null);
  assert.equal(looksLike(null), null);
  assert.equal(looksLike('W2 release milestone card'), null, 'no marker words at all');
});

test('one foreign word in a sentence is not evidence', () => {
  assert.equal(looksLike('the WebGPU pipeline wird nicht auf dem Schirm gezeichnet'), 'de',
    'four German markers against one English one');
});

test('only cards that clearly speak another language are named', () => {
  const cards = [
    { key: 'A-1', title: 'Die Tür klemmt', text: '' },
    { key: 'A-2', title: 'the shader is not drawing on the screen', text: '' },
    { key: 'A-3', title: 'GPU flicker', text: '' },
  ];
  assert.deepEqual(strangers(cards, 'en'), ['A-1'], 'the German one, and not the unclear one');
  assert.deepEqual(strangers(cards, 'de'), ['A-2']);
  assert.deepEqual(strangers(cards, null), [], 'a board that has not chosen names nobody');
});

test('the title alone may be an identifier — the text counts too', () => {
  const cards = [{ key: 'A-1', title: 'MDLA-14', text: 'Der Regler wird nicht gezeichnet und das ist schlecht' }];
  assert.deepEqual(strangers(cards, 'en'), ['A-1']);
});
