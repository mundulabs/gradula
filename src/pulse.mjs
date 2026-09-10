/**
 * The pulse — five questions a board should answer without being asked twice.
 *
 *   what happened      what moved in the period
 *   where we are going the goals, nearest date first
 *   are we in time     the measured pace against the remaining time
 *   where energy goes  which module, which craft, which person got the days
 *   what it hangs on   the cards the most other cards wait on
 *
 * FOUR OF THE FIVE ALREADY HAD AN ANSWER somewhere — report.mjs, wave.mjs's
 * coverage, health.mjs's findings. This file adds only what was missing and
 * composes nothing: the service puts the five together, because only the
 * service has a store.
 *
 * NO SCORE, AND NO PERCENTAGE OF LIKELIHOOD. Both were asked for and both
 * would be invented: a probability out of eleven settled cards is a decimal
 * point pretending to be knowledge. What stands here instead is the pair of
 * numbers the judgement rests on — days needed, days left — and the sample it
 * was measured from. Whoever reads it can disagree with it, which is the
 * whole point.
 *
 * Pure: chronicle, cards, links in — lists out. No store, no clock, no network.
 */

import { asNeeds } from './links.mjs';
import { nameOf, viaOf } from './people.mjs';

const DAY = 86_400_000;
const OPEN = (card) => !['done', 'ice'].includes(card.state);

/** When it happened. `at` in both stores — see store.mjs. */
const timeOf = (entry) => new Date(entry.at ?? 0).getTime();

/** Everything from `since` up to `now`, oldest first — the shape a period wants. */
export function within(entries, { since, now = Date.now() } = {}) {
  const from = since ? new Date(since).getTime() : 0;
  return entries
    .filter((entry) => { const t = timeOf(entry); return t >= from && t <= now; })
    .sort((a, b) => timeOf(a) - timeOf(b));
}

/**
 * WHERE THE ENERGY WENT — per module, per craft, per person.
 *
 * The unit is a MOVE, one line of the chronicle. A machine that evidences ten
 * times in a minute weighs ten times as much as a person who says one
 * sentence, and that is why the cards stand next to every number: a column
 * that looks big and names three cards is a loop, not a labour.
 *
 * `nowhere` is not a rounding error, it is the finding. A board where two
 * thirds of the moves carry no craft cannot say where its energy goes — and
 * it should say THAT, instead of drawing a confident chart of the third it
 * happens to know about.
 *
 * PEOPLE ARE FOLDED TO ONE NAME (people.mjs). Before that, the real board
 * showed four Davids — one signed in, two spellings of the same "via key"
 * sentence, and one client that had sent no name at all. Every number under
 * `people` was wrong by a factor of four, and the picture looked plausible.
 */
export function energy(entries, cards, { since, now = Date.now(), aliases = {} } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const window = within(entries, { since, now });

  const axes = { module: new Map(), stack: new Map() };
  const people = new Map();
  const viaOfPerson = new Map();
  const nowhere = { module: { moves: 0, cards: new Set() }, stack: { moves: 0, cards: new Set() } };
  let moves = 0;

  const put = (bucket, name, key) => {
    if (!bucket.has(name)) bucket.set(name, { id: name, moves: 0, cards: new Set() });
    const entry = bucket.get(name);
    entry.moves += 1;
    entry.cards.add(key);
  };

  for (const entry of window) {
    const card = byId.get(entry.item);
    if (!card) continue;
    moves += 1;
    for (const axis of ['module', 'stack']) {
      const labels = card[axis] ?? [];
      if (!labels.length) { nowhere[axis].moves += 1; nowhere[axis].cards.add(card.key); continue; }
      for (const label of labels) put(axes[axis], label, card.key);
    }
    const person = nameOf(entry.actor, aliases);
    if (person) {
      put(people, person, card.key);
      const via = viaOf(entry.actor);
      if (via) {
        if (!viaOfPerson.has(person)) viaOfPerson.set(person, new Set());
        viaOfPerson.get(person).add(via);
      }
    }
  }

  const list = (bucket) => [...bucket.values()]
    .map((e) => ({ ...e, cards: [...e.cards].sort() }))
    .sort((a, b) => b.moves - a.moves || a.id.localeCompare(b.id));

  return {
    since: since ?? null,
    until: new Date(now).toISOString(),
    moves,
    module: list(axes.module),
    stack: list(axes.stack),
    people: list(people).map(({ id, moves: m, cards: c }) => ({
      person: id, moves: m, cards: c, via: [...(viaOfPerson.get(id) ?? [])].sort(),
    })),
    nowhere: {
      module: { moves: nowhere.module.moves, cards: [...nowhere.module.cards].sort() },
      stack: { moves: nowhere.stack.moves, cards: [...nowhere.stack.cards].sort() },
    },
  };
}

/**
 * HOW FAST THINGS SETTLE — cards per day, measured, not promised.
 *
 * Settled means done OR dropped. Dropping a card is a decision like any
 * other; counting only `done` makes a week of honest clearing out look like a
 * week of nothing.
 *
 * The sample is named because it is small. Eleven cards over seven days is a
 * hint about next week and nothing at all about next quarter, and a number
 * without its sample gets quoted as if it were a promise.
 */
export function pace(entries, { since, now = Date.now() } = {}) {
  const window = within(entries, { since, now });
  const settled = window.filter((e) => e.verb === 'moved' && ['done', 'ice'].includes(e.data?.to)).length;
  const from = since ? new Date(since).getTime() : (window.length ? timeOf(window[0]) : now);
  const days = Math.max((now - from) / DAY, 1);
  return { settled, days: Math.round(days * 10) / 10, perDay: settled / days, sample: window.length };
}

/**
 * WHETHER A GOAL IS IN TIME.
 *
 * Honest answers, and never a guess in place of one. `no parts`, `no date`
 * and `no pace` are answers: a goal with nothing under it is unanswered, a
 * goal without a date cannot be late, and a week in which nothing settled
 * cannot forecast anything. Whoever fills those three in with a number has
 * built a board that is confidently wrong twice a month.
 *
 * The boundary between `ahead` and `tight` sits at three quarters of the
 * remaining time — room for one bad week, no more.
 */
export function outlook(goal, perDay, { now = Date.now() } = {}) {
  const open = goal.open?.length ?? Math.max((goal.total ?? 0) - (goal.done ?? 0) - (goal.dropped ?? 0), 0);
  // A goal with nothing under it is UNANSWERED, not finished. Calling that
  // one settled is the "0 % done" lie stood on its head, and it is worse:
  // green is read and believed, where a zero at least gets a second look.
  if (!goal.total) return { verdict: 'no parts', open: 0 };
  if (!open) return { verdict: 'settled', open: 0 };
  if (!goal.due) return { verdict: 'no date', open };
  const left = (new Date(`${goal.due}T23:59:59Z`).getTime() - now) / DAY;
  if (!perDay) return { verdict: 'no pace', open, daysLeft: Math.round(left * 10) / 10 };
  const need = open / perDay;
  const verdict = left <= 0 ? 'behind' : need <= left * 0.75 ? 'ahead' : need <= left ? 'tight' : 'behind';
  return { verdict, open, daysNeeded: Math.round(need * 10) / 10, daysLeft: Math.round(left * 10) / 10 };
}

/**
 * WHAT IT HANGS ON — the open cards the most other open cards wait on.
 *
 * Counted TRANSITIVELY, because that is the question. A card that blocks one
 * card which blocks six is not a small problem, and a direct count says it is.
 * Cycles cannot occur — they are refused when the link is laid (links.mjs) —
 * but the walk carries a seen-set anyway: a store restored from a backup of
 * two halves would otherwise hang the whole request.
 *
 * Done and dropped cards hold nobody up and are not listed.
 */
export function hangs(cards, links, { atMost = 5 } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const open = cards.filter(OPEN);

  // waiters: who waits DIRECTLY on this card.
  const waiters = new Map();
  for (const link of links) {
    const edge = asNeeds(link);
    if (!edge) continue;
    const waiting = byId.get(edge.from);
    const held = byId.get(edge.to);
    if (!waiting || !held || !OPEN(waiting) || !OPEN(held)) continue;
    if (!waiters.has(edge.to)) waiters.set(edge.to, []);
    waiters.get(edge.to).push(edge.from);
  }

  const out = [];
  for (const card of open) {
    const seen = new Set([card.id]);
    const stack = [...(waiters.get(card.id) ?? [])];
    const behind = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      behind.add(id);
      for (const next of waiters.get(id) ?? []) stack.push(next);
    }
    if (!behind.size) continue;
    out.push({
      card: card.key,
      title: card.title,
      state: card.state,
      waiting: [...behind].map((id) => byId.get(id)?.key).filter(Boolean).sort(),
    });
  }

  return out
    .sort((a, b) => b.waiting.length - a.waiting.length || a.card.localeCompare(b.card))
    .slice(0, atMost);
}
