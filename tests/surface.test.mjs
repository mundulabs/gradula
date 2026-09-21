/**
 * The gate that was missing three times tonight.
 *
 * Every visible break on the board had the same cause: a rename swept the
 * markup and left the stylesheet. `.karte` stopped matching `card`, `.spalte`
 * stopped matching `column`, `.chronik` stopped matching `history` — and 129
 * tests stayed green throughout, because every one of them tests the server.
 * The one thing a person actually looks at had no gate at all.
 *
 * It was found by screenshots. Three times. That is not a testing strategy.
 *
 * This cannot check whether the board is beautiful — no test can. It checks
 * the one thing that made it ugly: that a class named in the markup has a rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { STATES, KINDS, VERBS, LIVE_VERBS, TARGETS, LINK_KINDS, GATE_KINDS, SOURCES, VISIBILITIES, WORDS, AGENT_KEY_KIND, INTEGRATIONS } from '../src/spec.mjs';
import { CADENCES } from '../src/schedule.mjs';

const here = new URL('../web/src/', import.meta.url);
const css = readFileSync(new URL('styles.css', here), 'utf8')
  // Comments mention file names — `motion.ts` is not a class.
  .replace(/\/\*[\s\S]*?\*\//g, '');
/*
 * `.ts` counts too. A class name does not stop being one because it stands in
 * a table beside the law that decides it — `LEVEL_CLASS` sits in motion.ts
 * next to `beamFor`, and reading only .tsx made five real rules look dead.
 */
const markup = readdirSync(here)
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => readFileSync(new URL(f, here), 'utf8'))
  .join('\n');

/**
 * A className is a string, a template with conditions, or a ternary. What
 * counts is every word that can end up in the attribute — so: the literal text
 * plus the quoted strings inside any `${…}`.
 *
 * A word that is a VOCABULARY VALUE is a comparison, not a class: nobody
 * styles `.making`, they compare against `'making'`. Reading those as classes
 * is how a checker reports things that are perfectly fine, and a checker that
 * cries wolf gets switched off.
 */
const vocabulary = new Set([...STATES, ...KINDS, ...LIVE_VERBS, ...TARGETS, ...LINK_KINDS,
  ...GATE_KINDS, ...SOURCES, ...VISIBILITIES]);
/**
 * Class names also live in lookups — a `Record<string, string>` is often
 * clearer than a chain of ternaries. So there is ONE convention, and it is
 * checked rather than assumed: a constant whose name ends in `_CLASS` holds
 * class names, and this reads it. Anywhere else, write the class in the
 * attribute where a person (and this test) can find it.
 */
const fromLookups = [...markup.matchAll(/const \w+_CLASS[^=]*=\s*\{([\s\S]*?)\}/g)]
  .flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]))
  .flatMap((piece) => piece.split(/\s+/));

const used = new Set(
  [...fromLookups, ...[...markup.matchAll(/className=(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/g)]
    .flatMap(([, plain, expression]) => {
      if (plain !== undefined) return plain.split(/\s+/);
      const inner = (expression ?? '').trim();
      const quoted = [...inner.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      // A TEMPLATE carries class names in its bare text too (`card${…}`); an
      // ordinary expression carries only variables there. Reading both the
      // same way reports `dim` out of `dim ? 'x' : undefined` as a missing
      // class — and a test that cries wolf gets switched off.
      // One quotation can carry several classes ('group group-file').
      if (!inner.startsWith('`')) return quoted.flatMap((piece) => piece.split(/\s+/));
      const literal = inner.replace(/\$\{[^}]*\}/g, ' ').replace(/[`'"]/g, ' ');
      return [...quoted, literal].flatMap((piece) => piece.split(/\s+/));
    })
    ].map((word) => word.trim())
    .filter((word) => word && word !== 'undefined' && /^[a-zA-Z][\w-]*$/.test(word)),
);

const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

test('every class the markup uses has a rule', () => {
  // A vocabulary word in a className attribute is usually a COMPARISON —
  // `state === 'making'` — not a class. But some are both (`decision` is a kind
  // AND a class), so the filter belongs here, in the forward direction only.
  const orphans = [...used].filter((c) => !styled.has(c) && !vocabulary.has(c)).sort();
  assert.deepEqual(orphans, [], `classes in the markup with no rule: ${orphans.join(', ')}`);
});

test('no rule points at a class nobody uses any more', () => {
  // The other half of the same mistake: a rename leaves a rule behind, it stops
  // applying, and nothing says so. The board looks fine and the rule is a lie
  // for whoever reads it next.
  const structural = new Set(['sheet', 'door', 'card-door', 'column', 'board', 'head', 'button', 'walking']);
  const dead = [...styled].filter((c) => !used.has(c) && !structural.has(c) && !c.startsWith('border-beam')).sort();
  assert.deepEqual(dead, [], `rules for classes the markup never names: ${dead.join(', ')}`);
});

/**
 * EVERY DOC COMMENT MUST CLOSE.
 *
 * A translation pass replaced a two-line comment with one line and ate the
 * closing marker on the third. The file stayed valid JavaScript — the next line
 * became part of the comment — so `node --check` was happy, every test that
 * does not import that module was green, and the service died on deploy with
 * `ReferenceError: statisch is not defined`.
 *
 * server.mjs is the one module no test imports, because importing it starts a
 * server. So it gets read instead.
 */
test('no doc comment swallows the line below it', () => {
  const root = new URL('..', import.meta.url);
  const files = [];
  for (const dir of ['src', 'bin', 'mcp']) {
    for (const name of readdirSync(new URL(dir, root))) if (name.endsWith('.mjs')) files.push(`${dir}/${name}`);
  }
  assert.ok(files.length > 15, 'there are modules to read at all');
  const open = [];
  for (const file of files) {
    const lines = readFileSync(new URL(file, root), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('/**') || line.endsWith('*/')) continue;
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('*') && !lines[j].trim().endsWith('*/')) j++;
      if (j >= lines.length || !lines[j].trim().endsWith('*/')) open.push(`${file}:${i + 1}`);
    }
  }
  assert.deepEqual(open, [], 'these doc comments never close, and the line after them is not code any more');
});

/**
 * THE BOARD MAY ONLY COMPARE AGAINST VERBS THAT EXIST.
 *
 * The chronicle's timeline asked `e.verb === 'gesagt'` and read `d.satz`. After
 * the move to English the service writes `said` and `{ line }`, so the whole
 * block matched nothing: every entry showed a verb and an actor and never once
 * what had been said. Nothing was red — a comparison that finds nothing is a
 * comparison that works.
 *
 * So every verb the surface compares against has to be one the service knows
 * — a chronicle verb, or the one the live line adds (`wipe`, LIVE_VERBS).
 */
test('every verb the board compares against is a verb the service writes', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const compared = [...app.matchAll(/verb\s*===\s*'([a-zäöüß-]+)'/g)].map((m) => m[1]);
  assert.ok(compared.length >= 3, 'the board compares against verbs at all');
  const strays = [...new Set(compared)].filter((verb) => !LIVE_VERBS.includes(verb));
  assert.deepEqual(strays, [], 'these verbs do not exist — the comparison silently finds nothing');
  assert.ok(VERBS.every((verb) => LIVE_VERBS.includes(verb)), 'the live line knows every chronicle verb');
});

/**
 * A WIPE EMPTIES THE TAB (2026-09-10). The admin door emptied a project and
 * the live line said so, but the board treated `wipe` like any move: it
 * read the cards again after 400 ms — and a tab that had lost its line in
 * between, or held bonds and a picture from before, kept showing a board
 * that no longer existed until somebody pressed reload. Now the wipe verb
 * has a branch of its own: the columns, the bonds and the picture go at
 * once, and the reading follows without waiting.
 */
test('the board hears a wipe and empties its columns at once', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf("event.verb === 'wipe'");
  assert.ok(start > 0, 'the live handler tells a wipe apart from a move');
  const branch = app.slice(start, app.indexOf('return;', start));
  for (const line of ['setCards([])', 'setBonds([])', 'setPicture(new Map())', 'previous.current = []', 'latestLoad.current()']) {
    assert.ok(branch.includes(line), `on a wipe the board runs ${line}`);
  }
  assert.ok(!branch.includes('setTimeout'), 'a wipe is not bundled behind the 400 ms clock');
});

/**
 * THE SESSIONS' KEY IS MARKED. `gradula login` mints two keys, and a list that
 * showed two names and no difference would have a person revoke the wrong
 * one. The mark compares against the kind the service declares, never a copy.
 */
test('"Your keys" marks the agent key by the kind the service declares', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const vocabulary = readFileSync(new URL('../web/src/vocabulary.ts', import.meta.url), 'utf8');
  assert.ok(vocabulary.includes('AGENT_KEY_KIND as agentKeyKind'), 'the kind comes from src/spec.mjs');
  assert.ok(app.includes("k.kind === AGENT_KEY_KIND ? <span className=\"small\">{t('keys.agent')}</span>"), 'the list marks it');
  assert.ok(!app.includes(`'${AGENT_KEY_KIND}'`), 'the word is not spelled out a second time in the board');
});

/**
 * TWO LANGUAGES, AND NEITHER HALF-FINISHED.
 *
 * The board speaks German and English; the data speaks one language and never
 * changes. So two things have to hold, and only a test holds them:
 *
 *   · Every key the surface asks for exists in BOTH languages. A missing twin
 *     comes back as the key itself, and a raw `card.gateMissing` on a button
 *     is the kind of thing that ships.
 *   · The vocabulary is not copied. States, kinds and targets live in
 *     spec.mjs; a second list in web/ drifts, and then a column is called
 *     something the herald does not know.
 */
test('every word the board asks for exists in both languages', () => {
  const root = new URL('..', import.meta.url);
  const dictionary = readFileSync(new URL('web/src/words.ts', root), 'utf8');
  const sides = [...dictionary.matchAll(/^  (en|de): \{$([\s\S]*?)^  \},$/gm)];
  assert.equal(sides.length, 2, 'the dictionary has both sides');
  const keysOf = (block) => new Set([...block.matchAll(/^\s+'([\w.]+)':/gm)].map((m) => m[1]));
  const [en, de] = sides.map(([, , block]) => keysOf(block));
  assert.deepEqual([...en].filter((k) => !de.has(k)), [], 'English keys without a German twin');
  assert.deepEqual([...de].filter((k) => !en.has(k)), [], 'German keys without an English twin');

  const asked = new Set();
  for (const file of ['web/src/App.tsx', 'web/src/Map.tsx']) {
    for (const m of readFileSync(new URL(file, root), 'utf8').matchAll(/\bt\('([\w.]+)'\)/g)) asked.add(m[1]);
  }
  assert.ok(asked.size > 15, 'the surface asks for words at all');
  // A key may also come from the shared vocabulary — that is the point of it.
  const vocabulary = new Set(Object.keys(WORDS.en));
  const strays = [...asked].filter((k) => !en.has(k) && !vocabulary.has(k));
  assert.deepEqual(strays, [], 'these words have no twin anywhere — the surface would show the key');
});

test('the board does not keep a second copy of the vocabulary', () => {
  const dictionary = readFileSync(new URL('../web/src/words.ts', import.meta.url), 'utf8');
  for (const word of ['ideas', 'ready', 'making', 'review']) {
    assert.ok(!new RegExp(`'${word}':`).test(dictionary), `${word} belongs to spec.mjs, not to the surface`);
  }
});

/**
 * NO SENTENCE STANDS BARE IN THE MARKUP.
 *
 * A dictionary catches only what somebody remembered to put in it. What was
 * left behind after the first pass: a form whose buttons said `create` and
 * `abbrechen` side by side, a gate picker offering `befehl`, `datei` and
 * `adresse` — three of four choices the service refuses with a 400 — and a
 * dozen words in between. Seen in a screenshot, because nothing here throws.
 *
 * So: text between tags and every placeholder either comes from `t(...)` or is
 * short enough to be a symbol (a plus, an arrow, a unit). The two vocabularies
 * that the service owns are read from it, never listed here.
 */
test('no sentence stands bare in the markup', () => {
  const root = new URL('..', import.meta.url);
  const bare = [];
  for (const file of ['web/src/App.tsx', 'web/src/Map.tsx']) {
    const source = readFileSync(new URL(file, root), 'utf8');
    for (const [, text] of source.matchAll(/>([A-Za-zÄÖÜäöü][^<>{}\n]{2,})</g)) {
      if (!/[a-zäöü]{3}/.test(text)) continue;          // a symbol or a number is not a sentence
      if (text.trim() === 'Gradula') continue;          // a name is not translated
      bare.push(`${file}: ${text.trim()}`);
    }
    for (const [, text] of source.matchAll(/(?:placeholder|aria-label)="([^"]{4,})"/g)) {
      if (/^[A-Z][a-z]+ · [a-z]+$/.test(text)) continue; // the language switch names both languages at once
      bare.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(bare, [], 'these read to a person and are not in the dictionary');
});

test('the gate kinds the board offers are the ones the service knows', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const listed = [...app.matchAll(/<option value="([a-zäöü-]+)"/g)].map((m) => m[1]);
  const known = new Set([...GATE_KINDS, ...KINDS, ...STATES, ...VISIBILITIES, ...CADENCES, ...INTEGRATIONS, 'human', 'plain']);
  const strays = listed.filter((one) => !known.has(one));
  assert.deepEqual(strays, [], 'the service answers 400 for these — and the board would look merely broken');
});

/**
 * A CHIP SAYS ONLY WHAT IS KNOWN.
 *
 * The two small chips on a card — dev, prod — read two sources: the card's
 * own `deployed` notes (memory: once seen, seen) and the live picture, which
 * measured the card against what the lane runs right now and answers true,
 * false, or "nobody could tell". The law is a function in web/src/deployed.ts
 * and Node reads it as it is, so the four answers are pinned here: filled,
 * outlined, absent — and absent altogether while no commit stands behind the
 * card, because two hollow chips on every card in making would say nothing.
 */
test('the deployed chips fill, outline, or stay away — never guess', async () => {
  const { laneChips, commitHref } = await import('../web/src/deployed.ts');
  const notes = (development, production) => ({ deployed: { development, production, at: { development: null, production: null } } });
  const measured = (development, production, evidence = 1) => ({ deployed: { development, production }, evidence });

  assert.deepEqual(laneChips(notes(false, false), null), { development: null, production: null }, 'no picture, no notes: nothing');
  assert.deepEqual(laneChips(notes(false, false), measured(false, false, 0)), { development: null, production: null }, 'no commit yet: nothing could have arrived');
  assert.deepEqual(laneChips(notes(false, false), measured(false, false)), { development: 'outlined', production: 'outlined' }, 'a commit, measured, nowhere yet: two outlined chips');
  assert.deepEqual(laneChips(notes(false, false), measured(true, null)), { development: 'filled', production: null }, 'on dev; production could not be measured — no chip, not a hollow one');
  assert.deepEqual(laneChips(notes(true, false), measured(null, false)), { development: 'filled', production: 'outlined' }, 'the note remembers dev where the picture could not tell');
  assert.deepEqual(laneChips(notes(false, true), null), { development: null, production: 'filled' }, 'a card that left the picture keeps what its notes say');
  assert.deepEqual(laneChips({ deployed: undefined }, undefined), { development: null, production: null }, 'an older service without the field breaks nothing');

  assert.equal(commitHref('mundulabs/gradula', 'abc123'), 'https://github.com/mundulabs/gradula/commit/abc123', 'the same address the GitHub door gives its evidence');
  assert.equal(commitHref(null, 'abc123'), null, 'no repository, no link — the sha stays text');

  // The words of the chips exist in both languages (the generic word test
  // already holds the key sets together; this pins the keys the chips ask for).
  const dictionary = readFileSync(new URL('../web/src/words.ts', import.meta.url), 'utf8');
  for (const key of ['lane.dev', 'lane.prod', 'card.onDev', 'card.onProd', 'card.notOnDev', 'card.notOnProd', 'card.deployed']) {
    assert.equal((dictionary.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length, 2, `${key} in both languages`);
  }
});
