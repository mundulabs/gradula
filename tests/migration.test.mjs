/**
 * The test that did not exist on 09.09.
 *
 * `create table if not exists` creates a MISSING table and does not touch an
 * existing one. Locally every table is fresh, so everything ran; in
 * production the tables were already there, the new columns were missing, and
 * an index in the CREATE section reached for a column that comes into being
 * only in the MIGRATION: `column "seq" does not exist` — and the service stood.
 *
 * The mistake can be seen in the text, without a database. So it is found in
 * the text: no line above the migration may name a word that only the
 * migration creates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GUARD, GUARD_IN_DATA, RENAMING, SCHEMA, WORDS_IN_DATA } from '../src/store-pg.mjs';

const MARK = '-- MIGRATIONS.';

test('nothing in the create section reaches for a migrated column', () => {
  const cut = SCHEMA.indexOf(MARK);
  assert.ok(cut > 0, 'the migrations are still recognisable as a block');
  const creating = SCHEMA.slice(0, cut);
  const migrating = SCHEMA.slice(cut);

  const later = [...migrating.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
  assert.ok(later.length >= 2, 'there are migrations to check at all');

  // The columns MAY stand in the creation of a NEW table — that is where they
  // are born. What is forbidden is USING them there in an index.
  for (const line of creating.split('\n')) {
    if (!/^create (unique )?index/i.test(line.trim())) continue;
    for (const column of later) {
      assert.ok(
        !new RegExp(`\\b${column}\\b`).test(line),
        `an index above names the migrated column "${column}" — that is exactly how production lay:\n  ${line.trim()}`,
      );
    }
  }
});

test('every migration is repeatable on its own', () => {
  const migrations = SCHEMA.slice(SCHEMA.indexOf(MARK));

  // A `do $$ … end $$` block cannot say `if not exists` — it is a program, not
  // a statement. It is repeatable when it LOOKS BEFORE IT ACTS, so that is what
  // gets checked instead: every such block must carry a condition.
  const blocks = [...migrations.matchAll(/do \$\$([\s\S]*?)end \$\$;/g)].map((m) => m[1]);
  for (const block of blocks) {
    assert.match(block, /\bwhere\b|\bif\b/i,
      `a do-block without a condition runs its change again on every start:\n${block.slice(0, 120)}`);
  }

  // Everything outside those blocks is a plain statement and must say so.
  const plain = migrations.replace(/do \$\$[\s\S]*?end \$\$;/g, '');
  for (const line of plain.split('\n')) {
    const statement = line.trim();
    if (!statement || statement.startsWith('--')) continue;
    assert.match(
      statement,
      /if not exists/i,
      `a migration without "if not exists" runs well exactly once:\n  ${statement}`,
    );
  }
});

/**
 * THE SECOND GUARD HAS THE SAME REASON AS THE FIRST.
 *
 * A migration renames columns and so falls at the border of a column.
 * `card.gate` and `vocabulary.module` have an inner life, and something has
 * been left there twice already: first the gate kind, then `pfade`/`worte`.
 * The second time NO card could be created any more, and the service started
 * all the same.
 *
 * So: every German key GUARD_IN_DATA looks for must also be translated in
 * WORDS_IN_DATA. A guard without a migration would be a service that no
 * longer starts; a migration without a guard is exactly what happened twice.
 */
test('what the guard looks for in the JSON also migrates', () => {
  const looked = [...GUARD_IN_DATA.matchAll(/'([a-zäöüß]+)'/g)].map((m) => m[1]);
  assert.ok(looked.length >= 5, 'the guard names keys at all');
  for (const name of new Set(looked)) {
    assert.ok(
      WORDS_IN_DATA.includes(`'${name}'`),
      `the guard looks for "${name}" in the JSON, but no migration translates it`,
    );
  }
});

/**
 * THE GUARD MAY ONLY LOOK FOR NAMES THAT ARE ACTUALLY OLD.
 *
 * The guard asks the database whether any German column survived the migration.
 * A blanket rename went through its LIST once and turned `zaehler` into
 * `counter` — the new, correct name of that column. From then on the guard
 * found `project.counter` in every healthy database, threw at startup, and the
 * whole board was down. The lesson is the same one the migration itself
 * teaches: a list of OLD names is data about the past, and a rename must not
 * walk through it.
 *
 * So: every name the guard looks for must appear in RENAMING as a SOURCE, and
 * none of them may be a TARGET.
 */
test('the guard looks only for names the migration renames away', () => {
  const sources = new Set(), targets = new Set();
  for (const [, from, to] of RENAMING.matchAll(/\('[a-z_]+','([a-z_äöüß]+)','([a-z_]+)'\)/g)) { sources.add(from); targets.add(to); }
  for (const [, from, to] of RENAMING.matchAll(/\('([a-zäöüß_]+)','([a-z_]+)'\)/g)) { sources.add(from); targets.add(to); }
  assert.ok(sources.size > 30, 'the migration renames something at all');

  const looked = [...GUARD.matchAll(/'([a-z_äöüß]+)'/g)].map((m) => m[1]);
  assert.ok(looked.length > 20, 'the guard looks for something at all');
  const notOld = looked.filter((name) => !sources.has(name));
  assert.deepEqual(notOld, [], 'the guard looks for names the migration never renames away');
  const alsoNew = looked.filter((name) => targets.has(name) && !sources.has(name));
  assert.deepEqual(alsoNew, [], 'the guard looks for a name the migration CREATES — every healthy database would fail');
});
