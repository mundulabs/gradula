/**
 * One person, one name.
 *
 * Measured on the real board: `David Bläsing`, `david (via key "Davids
 * Rechner")`, `david (über Schlüssel „Davids Rechner")` and `key "Davids
 * Rechner"` — four rows, one David, every count under `people` wrong by a
 * factor of four, and the picture looked entirely plausible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { whoOf, viaOf, nameOf, fold } from '../src/people.mjs';

test('the who is the name in front, in either language', () => {
  assert.equal(whoOf('david (via key "Davids Rechner")'), 'david');
  assert.equal(whoOf('david (über Schlüssel „Davids Rechner")'), 'david');
  assert.equal(whoOf('David Bläsing'), 'David Bläsing');
  assert.equal(whoOf('Gradula (rule: labels)'), 'Gradula');
});

/**
 * A laptop is not a colleague. Counting a key as a person is how a board
 * reports that a machine closed nine cards.
 */
test('a bare key is nobody', () => {
  assert.equal(whoOf('key "Davids Rechner"'), null);
  assert.equal(whoOf('Schlüssel „Davids Rechner"'), null);
  assert.equal(whoOf(''), null);
  assert.equal(whoOf(null), null);
});

test('the via is kept apart, for showing and never for counting', () => {
  // Three spellings from three days — ONE hand. The words "via key" only ever
  // said "here comes the hand"; the hand is the key's name.
  assert.equal(viaOf('david (Davids Rechner)'), 'Davids Rechner');
  assert.equal(viaOf('david (via key "Davids Rechner")'), 'Davids Rechner');
  assert.equal(viaOf('david (über Schlüssel „Davids Rechner")'), 'Davids Rechner');
  assert.equal(viaOf('Gradula (rule: all parts done)'), 'rule: all parts done');
  assert.equal(viaOf('Gradula (Maschinenraum (liest))'), 'Maschinenraum (liest)', 'one nested bracket is a name, not a second hand');
  assert.equal(whoOf('Gradula (Maschinenraum (liest))'), 'Gradula');
  assert.equal(viaOf('David Bläsing'), null);
});

test('aliases are declared, and only case and spacing are folded on their own', () => {
  const aliases = { david: 'David Bläsing' };
  assert.equal(nameOf('david (via key "x")', aliases), 'David Bläsing');
  assert.equal(nameOf('DAVID', aliases), 'David Bläsing');
  assert.equal(nameOf('David Bläsing', aliases), 'David Bläsing');
  assert.equal(nameOf('felix', aliases), 'felix', 'nobody is folded into anybody without being told');
});

test('four spellings of one person fold into one row that names its keys', () => {
  const entries = [
    { actor: 'David Bläsing', verb: 'moved' },
    { actor: 'david (via key "Davids Rechner")', verb: 'moved' },
    { actor: 'david (über Schlüssel „Davids Rechner")', verb: 'moved' },
    { actor: 'david (Davids Rechner)', verb: 'moved' },
    { actor: 'key "Davids Rechner"', verb: 'moved' },
    { actor: 'felix (via key "Felix")', verb: 'moved' },
  ];
  const folded = fold(entries, { aliases: { david: 'David Bläsing' } });
  assert.deepEqual(folded.map((p) => [p.person, p.moves]), [['David Bläsing', 4], ['felix', 1]]);
  // Three spellings of the same key are ONE hand — a person on one laptop is
  // not "david, from three keys".
  assert.deepEqual(folded[0].via, ['Davids Rechner']);
});

/**
 * The actor header is a claim and a signed-in name is a claim about a
 * session; a commit was signed by whoever wrote it.
 */
test('a commit author carries the one identity nobody typed about themselves', () => {
  const folded = fold([
    { actor: 'david (via key "x")', verb: 'evidenced', data: { github: 'edudavidblaesing' } },
    { actor: 'david (via key "x")', verb: 'moved' },
  ]);
  assert.equal(folded[0].github, 'edudavidblaesing');
});
