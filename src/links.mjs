/**
 * The links between cards — and the one calculation that follows from them.
 *
 * Everything here is pure: lists in, lists out, no storage, no time. That is
 * deliberate, because these are exactly the sentences you must be able to
 * recompute: "why is this card blocked" must never mean "because a box was ticked".
 *
 * Two things deliberately do NOT sit in the database as state:
 *
 * BLOCKED is computed. A card is blocked as long as a card it needs is not
 * done. Once that one is done the mark disappears by itself — nobody has to
 * remember it. A stored tick would be wrong by the first week, and nobody
 * would know which one.
 *
 * CYCLES are refused, not reported. A link that closes a cycle is never laid
 * in the first place, and the refusal names the chain. Otherwise in three
 * months everything waits on everything and nobody finds the spot.
 */

/** Links that claim an order — only those can form a cycle. */
const ORDERING = new Set(['needs', 'blocks']);

/**
 * `needs` and `blocked by` are the same edge from two directions. Only one
 * direction is stored — otherwise there would be two truths about one thing.
 */
export function asNeeds(link) {
  if (link.kind === 'needs') return { from: link.from, to: link.to };
  if (link.kind === 'blocks') return { from: link.to, to: link.from };
  return null;
}

/** The chain that would arise — or `null` if no cycle arises. */
export function cycleWith(links, candidate) {
  const edge = asNeeds(candidate);
  if (!edge) return null;
  const out = new Map();
  for (const link of links) {
    const e = asNeeds(link);
    if (!e) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  if (!out.has(edge.from)) out.set(edge.from, []);
  out.get(edge.from).push(edge.to);

  // From the head of the new edge back to its foot: if a path is found, the
  // cycle is closed. The path itself is the answer for the person.
  const seen = new Set();
  const stack = [[edge.to, [edge.from, edge.to]]];
  while (stack.length) {
    const [node, path] = stack.pop();
    if (node === edge.from) return path;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of out.get(node) ?? []) stack.push([next, [...path, next]]);
  }
  return null;
}

/**
 * Who holds up whom: `{ [itemId]: [ids of the cards being waited on] }`.
 * `done` is the only kind of card that holds nobody up any more.
 */
export function blockedBy(links, items) {
  const state = new Map(items.map((item) => [item.id, item.state]));
  const out = new Map();
  for (const link of links) {
    const edge = asNeeds(link);
    if (!edge) continue;
    if (state.get(edge.to) === 'done') continue;
    if (!state.has(edge.to)) continue;
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(edge.to);
  }
  return out;
}

/**
 * What two cards touch in common — the hard collision. It comes not from a
 * model but from what the runner really touched on its last move, and from
 * the path a gate of kind `file` names.
 */
export function filesOf(item) {
  const files = new Set(item.files ?? []);
  if (item.gate?.kind === 'file') files.add(item.gate.call);
  return [...files];
}

/** The running cards that touch the same file as `item`. */
export function collisions(item, running) {
  const mine = new Set(filesOf(item));
  if (!mine.size) return [];
  const out = [];
  for (const other of running) {
    if (other.id === item.id) continue;
    const shared = filesOf(other).filter((file) => mine.has(file));
    if (shared.length) out.push({ card: other.key, files: shared });
  }
  return out;
}
