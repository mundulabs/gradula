/**
 * Two languages on the surface, ONE in the data.
 *
 * The test holds both together: that no twin is missing (or a bare
 * identifier stands in the English board), and that the VALUES stay German.
 * The second is the more important one: a state that changes with the
 * language setting silently breaks every link ever built.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORDS, LANGUAGES, word,
  KINDS, STATES, TARGETS, LINK_KINDS, GATE_KINDS, RUNNERS,
} from '../src/spec.mjs';

test('every word has a twin in every language', () => {
  const german = Object.keys(WORDS.de);
  for (const language of LANGUAGES) {
    const missing = german.filter((k) => !WORDS[language][k]);
    assert.deepEqual(missing, [], `"${language}" is missing: ${missing.join(', ')}`);
    const extra = Object.keys(WORDS[language]).filter((k) => !WORDS.de[k]);
    assert.deepEqual(extra, [], `"${language}" holds what German does not`);
  }
});

test('every identifier from the vocabulary can be translated', () => {
  for (const identifier of [...KINDS, ...STATES, ...TARGETS, ...LINK_KINDS, ...GATE_KINDS, ...RUNNERS]) {
    assert.ok(WORDS.en[identifier], `"${identifier}" has no English word`);
    assert.ok(WORDS.de[identifier], `"${identifier}" has no German word`);
  }
});

test('the DATA stay English — they are the contract', () => {
  // What stands in the database, in URLs and in SQL must not know the
  // language. These lists are identifiers, not display.
  assert.ok(STATES.includes('making'));
  assert.ok(!STATES.includes('Arbeit'), 'the column is called making, whichever language someone sees');
  assert.equal(word('making', 'de'), 'Arbeit', 'only what a person reads gets translated');
});

test('an unknown word is not an empty surface', () => {
  assert.equal(word('making', 'kl'), 'Making', 'an unknown language falls back to English');
  assert.equal(word('nosuchthing'), 'nosuchthing', 'better the identifier than nothing');
});

/**
 * THE GERMAN TWIN MUST BE GERMAN.
 *
 * A blanket rename went through this table once and turned `blockiert` into
 * `blocked`: the German surface then said "blocked", and nothing was red —
 * a translation that returns an English word looks like a translation.
 *
 * So: no German word may be identical to its English key, and none may be an
 * English word from the table's own other side.
 */
test('no German word is its English twin', () => {
  const english = new Set(Object.values(WORDS.en).map((w) => w.toLowerCase()));
  const same = [];
  for (const [key, word] of Object.entries(WORDS.de)) {
    if (word.toLowerCase() === key.toLowerCase()) continue; // Test, Server — the same word in both
    if (english.has(word.toLowerCase()) && WORDS.en[key]?.toLowerCase() !== word.toLowerCase()) same.push(`${key}: ${word}`);
  }
  assert.deepEqual(same, [], 'these German words are English words belonging to another key');
});
