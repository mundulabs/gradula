/**
 * NO GERMAN WORD MAY BE AN IDENTIFIER.
 *
 * The rename to English left words behind in CODE, not in prose, and every one
 * of them was a ReferenceError waiting for the line to run:
 *
 *   `statisch`  took the service down on deploy — a comment had eaten its
 *               declaration, and nothing but the deploy said so.
 *   `gelesen`   killed `gradula sync`, which is the ONE command that turns
 *               commits into evidence. The hook calls it silently and
 *               detached, so it would have failed without a sound.
 *   `kette`     broke the sentence that names a cycle.
 *
 * A test suite does not run every line of a CLI, and `node --check` sees only
 * syntax. So this reads the source: strings and comments are blanked out, and
 * what German is left is code.
 *
 * The list is deliberately narrow — words that were actually used here as
 * names. A general German dictionary would flag `is`, `war`, `hat` and go red
 * on English.
 *
 * IT READS THE BOARD TOO, and there the names are compounds: `setProjekt`,
 * `KartenKnopf`, `geaendert`. A word boundary finds none of those, so every
 * identifier is cut at its humps and each piece is looked up on its own. That
 * is also why `module` is not on the list: it is the same word in both
 * languages and it is the API's own name for an axis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const GERMAN = [
  'gelesen', 'gesetzt', 'geholt', 'geschoben', 'gefunden', 'gemacht', 'statisch', 'kette', 'wurzel',
  'datei', 'dateien', 'befehl', 'adresse', 'zeile', 'zeilen', 'spalte', 'karte', 'karten', 'faden',
  'faeden', 'chronik', 'bote', 'boten', 'schluessel', 'projekt', 'akteur', 'zustand', 'titel',
  'modul', 'stapel', 'laeufer', 'welle', 'vorhaben', 'meilenstein', 'aufgabe', 'entscheidung',
  'grund', 'warum', 'ergebnis', 'anlauf', 'sitzung', 'umzug', 'takt', 'uhr', 'senden', 'holen',
  'anlegen', 'verschieben', 'abbrechen', 'oeffnen', 'zaehler', 'fenster', 'jetzt', 'nichts',
  'alles', 'eins', 'zwei', 'drei', 'erste', 'zweite', 'nochmal', 'danach', 'seither', 'innen',
  'aussen', 'drin', 'offen', 'leer', 'fertig', 'kaputt', 'schief', 'gut', 'roh', 'rumpf', 'spur',
];

/**
 * The code without its prose: block comments, line comments and every literal.
 *
 * Newlines are KEPT. Collapsing a comment to one space moves every line number
 * after it, and a finding that names the wrong line is a finding nobody
 * believes — the first run of this test reported four, all of them innocent.
 */
const blank = (match) => match.replace(/[^\n]/g, ' ');
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/.*$/gm, blank)
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, blank);
}

const files = [];
for (const [dir, ending] of [['src', '.mjs'], ['bin', '.mjs'], ['mcp', '.mjs'], ['web/src', '.ts']]) {
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    if (name.endsWith(ending) || name.endsWith(`${ending}x`)) files.push(`${dir}/${name}`);
  }
}

/**
 * An identifier cut at its humps: `setProjekt` → `set`, `Projekt`. A single
 * lowercase run stays whole, so `gutter` never reads as `gut`.
 */
const partsOf = (identifier) => identifier.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [];

test('no German word stands where a name stands', () => {
  assert.ok(files.length > 20, 'there are modules to read');
  const german = new Set(GERMAN);
  const found = [];
  for (const file of files) {
    const code = codeOnly(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const identifier of line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
        for (const part of partsOf(identifier)) {
          if (german.has(part.toLowerCase())) found.push(`${file}:${i + 1}  ${identifier}`);
        }
      }
    });
  }
  assert.deepEqual(found, [], 'these are names, not prose — and every one of them throws when its line runs');
});
