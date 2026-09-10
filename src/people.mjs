/**
 * Who did it — one person, one name.
 *
 * THE CHRONICLE STORED A SENTENCE WHERE A NAME BELONGS. `actorOf` wrote
 * `david (via key "Davids Rechner")`, the German build of the same service
 * wrote `david (über Schlüssel „Davids Rechner")`, a signed-in person wrote
 * `David Bläsing`, and a client that sent no header wrote `key "Davids
 * Rechner"`. On the real board that is FOUR people, all of them David, and
 * every count that groups by actor was wrong by a factor of four.
 *
 * The rule from here on: an actor has a WHO and a VIA, and only the who is
 * their name. The via is how they came in — a key, a session, a rule — and it
 * belongs beside the name, not inside it.
 *
 * The old sentences stay in the database. Rewriting a chronicle is worse than
 * reading it carefully: it is the one table nobody may edit, or it stops being
 * evidence. So this reads them.
 *
 * ALIASES ARE DECLARED, NEVER GUESSED. `david` and `David Bläsing` are the
 * same person only because somebody said so. A board that guesses at identity
 * from similar spellings will one day put two people's work under one name,
 * and there is no way to notice.
 *
 * Pure: strings in, strings out.
 */

/**
 * The tail that is not a name: `(Davids Rechner)`, `(via key "x")`,
 * `(über Schlüssel „x")`, `(rule: x)`. Since 10.09. the service writes the
 * short form — the name, then the hand in brackets — and the older spellings
 * stay in the chronicle, so all of them are read: a trailing bracket is the
 * hand, whatever word it opens with. One nested bracket is allowed, because a
 * key may be called „Maschinenraum (liest)".
 *
 * Built from STRINGS, not written as a literal. The German words in here are
 * data — spellings that stand in the chronicle from before the service moved
 * to English — and the gate that forbids German NAMES reads code with its
 * strings blanked out. A regex literal is code, and this list would read to it
 * as a pile of identifiers.
 */
const VIA = new RegExp('\\s*[({](?:[^(){}]|[({][^(){}]*[)}])*[)}]\\s*$');

/**
 * The words that only said "here comes the hand": `via key`, `via the key`,
 * `über Schlüssel`. Stripped, so that `david (via key "x")` from Tuesday and
 * `david (x)` from Thursday count as ONE hand and not as two keys.
 */
const VIA_WORDS = new RegExp('^(?:via\\s+(?:the\\s+)?key|über\\s+Schlüssel|ueber\\s+Schluessel|per\\s+key)\\s*', 'i');
const QUOTES = new RegExp('^["\'„»«]|["\'“”»«]$', 'g');

/** A client that sent no name at all landed here as its own "person". */
const BARE_KEY = new RegExp('^(?:key|Schlüssel|Schluessel)\\s+["\'„»]', 'i');

/**
 * The who inside an actor string. A bare key is not a person and comes back
 * as `null`: counting keys as people is how a board reports that a laptop
 * closed nine cards.
 */
export function whoOf(actor) {
  const text = String(actor ?? '').trim();
  if (!text) return null;
  if (BARE_KEY.test(text)) return null;
  const who = text.replace(VIA, '').trim();
  return who || null;
}

/**
 * What came after the name — the hand — for showing beside it, never for
 * counting. `via key "Davids Rechner"` and `Davids Rechner` are the same hand.
 */
export function viaOf(actor) {
  const found = String(actor ?? '').match(VIA);
  if (!found) return null;
  const inside = found[0].trim().replace(/^[({]|[)}]$/g, '').trim();
  return inside.replace(VIA_WORDS, '').trim().replace(QUOTES, '').trim() || null;
}

/**
 * The one name for a who, after the project's declared aliases.
 *
 * Matching ignores case and spacing, because `David Bläsing` and `david
 * bläsing` are one person by anybody's reading — but nothing beyond that is
 * folded together.
 */
export function nameOf(actor, aliases = {}) {
  const who = whoOf(actor);
  if (!who) return null;
  const flat = who.toLowerCase().replace(/\s+/g, ' ');
  for (const [from, to] of Object.entries(aliases)) {
    if (String(from).toLowerCase().replace(/\s+/g, ' ') === flat) return String(to);
  }
  return who;
}

/**
 * Everyone who appears in a set of chronicle entries, folded to one name each.
 *
 * `via` is collected as a set, so the answer can say "david, from two keys"
 * — which is the honest picture of one person on a laptop and a runner.
 */
export function fold(entries, { aliases = {} } = {}) {
  const people = new Map();
  for (const entry of entries) {
    const name = nameOf(entry.actor, aliases);
    if (!name) continue;
    if (!people.has(name)) people.set(name, { person: name, moves: 0, via: new Set(), github: null });
    const row = people.get(name);
    row.moves += 1;
    const via = viaOf(entry.actor);
    if (via) row.via.add(via);
    // A commit knows its author, and that is the only identity on this board
    // that was not typed in by the person it names.
    if (!row.github && entry.data?.github) row.github = entry.data.github;
  }
  return [...people.values()]
    .map((row) => ({ ...row, via: [...row.via].sort() }))
    .sort((a, b) => b.moves - a.moves || a.person.localeCompare(b.person));
}
