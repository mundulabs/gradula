/**
 * The housekeeping — what is wrong with the board itself.
 *
 * Deliberately NO number. A "project health score" is the same lie as a
 * global "x % done": it falls when you write things down honestly and rises
 * when you stop. After two weeks a team optimises the number instead of the
 * thing.
 *
 * Named findings instead, and EVERY one names its cards. A finding without
 * the cards behind it never answers the next question — you can only believe
 * it or ignore it, and the second is what happens.
 *
 * Everything here is pure: cards, links, chronicle in, findings out. What the
 * foreign systems know (Sentry, Dokploy, GitHub) does not belong here: that
 * is their standing, not our order.
 */

import { isRunning } from './spec.mjs';
import { nameOf } from './people.mjs';
import { strangers } from './language.mjs';

const OPEN = (card) => !['done', 'ice'].includes(card.state);
const days = (iso, now) => (iso ? (now - new Date(iso).getTime()) / 86_400_000 : Infinity);
const tooLong = (text, limit) => String(text ?? '').replace(/\s+/g, ' ').trim().length > limit;

/**
 * @param cards every card of the project
 * @param links every link (with `from`/`to` as identifiers)
 * @param entries the chronicle, newest first
 */
export function findings(cards, links = [], entries = [], { now = Date.now(), quiet = 14, language = null } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const touched = new Map();
  for (const entry of entries) {
    const key = byId.get(entry.item)?.key;
    if (key && !touched.has(key)) touched.set(key, entry.at);
  }

  const found = [];
  const add = (id, line, list, why) => {
    if (list.length) found.push({ id, line, cards: list.sort(), count: list.length, why });
  };

  // Without a gate a card never moves by itself — and a loop has no stopping
  // condition from outside.
  add('no-gate', 'open tasks without a gate',
    cards.filter((c) => c.kind === 'task' && OPEN(c) && !c.gate).map((c) => c.key),
    'a task without a gate never reaches done on its own');

  // The card is being made, but no machine holds a lease. Either somebody is
  // working without `gradula work`, or nobody is working.
  add('stalled', 'cards in making with no runner',
    cards.filter((c) => c.state === 'making' && !isRunning(c.heartbeat, now)).map((c) => c.key),
    'either somebody works without saying so, or nobody works');

  // An overdue milestone is the only deadline that counts here.
  const today = new Date(now).toISOString().slice(0, 10);
  add('overdue', 'milestones past their date',
    cards.filter((c) => c.due && c.due < today && OPEN(c)).map((c) => c.key),
    'the date passed and the milestone is still open');

  // An incident nobody has touched is an incident that comes back.
  add('incidents', 'open incidents from Sentry',
    cards.filter((c) => c.source === 'sentry' && OPEN(c)).map((c) => c.key),
    'a crash nobody touched is a crash that comes back');

  // Proposed labels nobody has confirmed: the cartographer saw something, and
  // it has been lying in the tray ever since.
  add('unconfirmed', 'labels waiting for a hand',
    cards.filter((c) => OPEN(c) && ((c.suggestions?.module?.length ?? 0) + (c.suggestions?.stack?.length ?? 0)) > 0).map((c) => c.key),
    'a suggestion changes nothing until a hand confirms it');

  // Nothing has happened for a long time. No accusation — a question.
  add('quiet', `open cards untouched for ${quiet} days`,
    cards.filter((c) => OPEN(c) && days(touched.get(c.key) ?? c.created, now) > quiet).map((c) => c.key),
    'not an accusation, a question: is this still wanted?');

  // A card may carry detail, but it should not become the prompt. Long
  // cards make every handoff expensive; the fix is a linked doc or a shorter
  // acceptance paragraph, not deleting history.
  add('too-long', 'open cards with too much text for a default handoff',
    cards.filter((c) => OPEN(c) && (tooLong(c.title, 140) || tooLong(c.text, 1200))).map((c) => c.key),
    'keep the card brief; put durable detail in docs and let brief/resume carry the handoff');

  const entriesByCard = new Map();
  for (const entry of entries) {
    const key = byId.get(entry.item)?.key;
    if (!key) continue;
    entriesByCard.set(key, (entriesByCard.get(key) ?? 0) + 1);
  }
  add('noisy-history', 'open cards with a noisy chronicle',
    cards.filter((c) => OPEN(c) && (entriesByCard.get(c.key) ?? 0) > 40).map((c) => c.key),
    'the full chronicle is still there, but agents should resume from brief evidence, not every small move');

  // A card with no label at all cannot be found, cannot be filtered, and
  // counts towards nothing on the pulse. The rule fills both axes at creation
  // and `relabel` fills what was empty — what is left over is what no rule
  // could see, and that is a question for a person, not a refusal at the door.
  add('unlabelled', 'open cards with no label at all',
    cards.filter((c) => OPEN(c) && !(c.module ?? []).length && !(c.stack ?? []).length).map((c) => c.key),
    'no module and no craft — invisible to every filter and to the map');

  // A board with developers in three countries drifts, and then nobody can
  // search it. Named, not refused: four words are not enough evidence to turn
  // somebody away at the door.
  // Only what a PERSON wrote. A crash title is Sentry's words in Sentry's
  // language, and telling somebody to translate `TypeError: Cannot read
  // properties of undefined` is a finding that gets switched off, taking the
  // useful half with it.
  add('other-language', 'cards not written in this board\'s language',
    strangers(cards.filter((c) => OPEN(c) && c.source !== 'sentry'), language),
    'a board half in one language and half in another cannot be searched');

  // A venture without parts is unanswered, not at zero percent.
  const hasParts = new Set(links.filter((l) => l.kind === 'part-of').map((l) => l.to));
  add('no-parts', 'milestones and ventures with no parts',
    cards.filter((c) => ['milestone', 'venture'].includes(c.kind) && OPEN(c) && !hasParts.has(c.id)).map((c) => c.key),
    'a milestone without parts is unanswered, not at zero');

  return found;
}

/**
 * Who did what — from the chronicle, never from a second list.
 *
 * Deliberately NO performance measure. It counts moves, not worth, and
 * whoever makes a ranking out of it gets many small cards within four weeks.
 * The purpose is another: to see who is WHERE right now — so that two people
 * do not reach for the same thing.
 */
export function whoDidWhat(entries, cards, { aliases = {} } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const people = new Map();
  for (const entry of entries) {
    // The person BEFORE the machine, and under the project's declared
    // aliases: "david (via key …)" is david, and david may be David Bläsing.
    const raw = String(entry.actor ?? '');
    const who = nameOf(raw, aliases) ?? raw.split(' (')[0];
    if (!who) continue;
    // But when NO person stands in front, the actor is the machine itself:
    // `key "Davids Rechner"` is not a colleague. Counting it as a person is
    // exactly the flattering mirror law 1 forbids — and in a team that wants
    // to see who is where, it would be one answer too many.
    // `Schlüssel ` is DATA, not prose: entries written before the vocabulary
    // moved to English carry it, and they are still in the chronicle.
    const machine = /^(key |Schlüssel |Gradula\b|sentry\b)/.test(who);
    if (!people.has(who)) people.set(who, { actor: who, machine, moves: 0, decided: 0, cards: new Set() });
    const seen = people.get(who);
    seen.moves += 1;
    if (entry.verb === 'decided') seen.decided += 1;
    const key = byId.get(entry.item)?.key;
    if (key) seen.cards.add(key);
  }
  // People first, machines below: the question is "who is where", and a
  // runner is the answer only afterwards.
  return [...people.values()]
    .map((p) => ({ ...p, cards: [...p.cards].sort() }))
    .sort((a, b) => (a.machine === b.machine ? b.moves - a.moves : a.machine ? 1 : -1));
}
