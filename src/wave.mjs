/**
 * The wave — what can start NOW, and what must not run side by side.
 *
 * This is the answer to the question of whether a planning board contributes
 * anything at all to a model that already works in a loop. It contributes
 * exactly two things, and a loop inside ONE repository can know neither:
 *
 *   THE ORDER. Work that waits on something nobody has built yet is not work,
 *   it is a loop that ends up explaining itself.
 *
 *   THE CONCURRENCY. Two runners touching the same file produce a conflict
 *   that both take for someone else's mistake. That was measured next door
 *   (parallel sessions in one tree) and it was expensive.
 *   teuer.
 *
 * The GRAPH belongs here, the LOOP belongs to the runner. The seam between
 * them is the gate: a loop needs a stopping condition from outside, or a model
 * marks its own homework. That is why the wave names every card that has none
 * — such a card can never reach done by itself.
 *
 * In: cards and links. Out: waves. No storage, no time, no network.
 */

import { blockedBy, filesOf } from './links.mjs';

const isOpen = (card) => !['done', 'ice'].includes(card.state);

/** Everything hanging under a venture — including what hangs under its parts. */
function partsOf(rootId, links) {
  const children = new Map();
  for (const link of links) {
    if (link.kind !== 'part-of') continue;
    if (!children.has(link.to)) children.set(link.to, []);
    children.get(link.to).push(link.from);
  }
  const inside = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.pop()) ?? []) {
      if (inside.has(child)) continue;
      inside.add(child);
      queue.push(child);
    }
  }
  return inside;
}

/**
 * @param cards every card of the project (the state of ALL of them counts,
 *   finished ones included — otherwise a met precondition reads as open)
 * @param links every link of the project
 * @param root optional: only this venture and what hangs under it
 */
/**
 * Which venture is ripe — all its parts are done, and it is not?
 *
 * A venture needs no gate made of a test: it HAS one, and a better one. It is
 * done when its parts are. Whoever draws that by hand forgets it the third
 * time — and then the board carries an open venture under which nothing is
 * open any more.
 *
 * A venture WITHOUT parts is not ripe. Otherwise every freshly created one
 * would be done at once, and that is the kind of rule you meet once and never
 * again — and never switch on again.
 */
export function ripe(cards, links) {
  const byId = new Map(cards.map((k) => [k.id, k]));
  const parts = new Map();
  for (const link of links) {
    if (link.kind !== 'part-of') continue;
    if (!parts.has(link.to)) parts.set(link.to, []);
    parts.get(link.to).push(link.from);
  }
  const out = [];
  for (const [wholeId, partIds] of parts) {
    const whole = byId.get(wholeId);
    if (!whole || !['venture', 'milestone'].includes(whole.kind)) continue;
    if (['done', 'ice'].includes(whole.state)) continue;
    const children = partIds.map((id) => byId.get(id)).filter(Boolean);
    if (!children.length) continue;
    // 'ice' counts as settled: nobody is waiting on what lies on ice.
    if (!children.every((k) => ['done', 'ice'].includes(k.state))) continue;
    out.push({ card: whole, parts: children.map((k) => k.key) });
  }
  return out;
}

export function wave(cards, links, { root = null } = {}) {
  const byId = new Map(cards.map((k) => [k.id, k]));
  const rootCard = root ? cards.find((k) => k.key === root || k.id === root) : null;
  if (root && !rootCard) return { waves: [], waiting: [], withoutGate: [], root: null };

  const inside = rootCard ? partsOf(rootCard.id, links) : null;
  const belongs = (card) => !inside || inside.has(card.id);

  // The state is computed over ALL cards; the filter comes afterwards.
  const blockedMap = blockedBy(links, cards);

  const waiting = [];
  const ready = [];
  for (const card of cards) {
    if (!isOpen(card) || !belongs(card)) continue;
    const waitsOn = (blockedMap.get(card.id) ?? []).map((id) => byId.get(id)?.key).filter(Boolean);
    if (waitsOn.length) waiting.push({ card, waitsOn });
    else ready.push(card);
  }

  // Packing waves: only what shares no file with anything already in the wave
  // may join it. Greedy and stable — the smaller number first, so that two
  // calls give the same answer.
  const rest = [...ready].sort((a, b) => String(a.key).localeCompare(String(b.key), 'de', { numeric: true }));
  const waves = [];
  while (rest.length) {
    const now = [];
    const evidenced = new Set();
    for (let i = 0; i < rest.length;) {
      const files = filesOf(rest[i]);
      if ([...files].some((d) => evidenced.has(d))) { i += 1; continue; }
      for (const d of files) evidenced.add(d);
      now.push(rest.splice(i, 1)[0]);
    }
    waves.push(now);
  }

  return {
    waves,
    waiting,
    // Without a gate there is no stopping condition from outside. That is no
    // small thing: this is exactly where the loop stops being checkable.
    //
    // Only TASKS are reminded. A decision is done once it has been made, an
    // idea is not work yet — and a venture has a better gate than any test:
    // its parts (see `ripe`).
    withoutGate: ready.filter((k) => k.kind === 'task' && !k.gate).map((k) => k.key),
    root: rootCard?.key ?? null,
  };
}

/**
 * A milestone's coverage: parts done over parts in total.
 *
 * A real fraction over a real set — unlike a global "x % done" number, which
 * RISES when you write down fewer cards. That number teaches a team not to
 * write things down, and then nothing adds up at all.
 *
 * Without parts there is no coverage. `null` instead of `0 %`: a milestone
 * with no parts is not at zero percent, it is unanswered, and those are two
 * different things.
 *
 * A DROPPED PART IS NOT A BUILT ONE. Something on ice settles the venture —
 * nobody is waiting on it any more, so `share` counts it as settled and
 * reaches 1 when there is nothing left to do. But it was not made, and a
 * milestone that reports "5 of 5" when one of the five was thrown away is
 * lying about what exists. So `dropped` is counted on its own and the surface
 * says it: "4 done · 1 dropped".
 */
export function coverage(cards, links) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const parts = new Map();
  for (const link of links) {
    if (link.kind !== 'part-of') continue;
    if (!parts.has(link.to)) parts.set(link.to, []);
    parts.get(link.to).push(link.from);
  }

  const out = [];
  for (const card of cards) {
    if (!['milestone', 'venture'].includes(card.kind)) continue;
    const mine = (parts.get(card.id) ?? []).map((id) => byId.get(id)).filter(Boolean);
    if (!mine.length) { out.push({ card, total: 0, done: 0, dropped: 0, share: null, due: card.due ?? null }); continue; }
    const done = mine.filter((c) => c.state === 'done').length;
    const dropped = mine.filter((c) => c.state === 'ice').length;
    out.push({
      card,
      total: mine.length,
      done,
      dropped,
      share: (done + dropped) / mine.length,
      due: card.due ?? null,
      // What is still open, named: a number without the cards behind it never
      // answers the next question.
      open: mine.filter((c) => !['done', 'ice'].includes(c.state)).map((c) => c.key),
    });
  }
  return out.sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')));
}
