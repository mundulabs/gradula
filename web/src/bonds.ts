/**
 * Which cards belong together — and how sure we are.
 *
 * The board already computes this as a fact; it just never showed it. Two
 * cards that name the SAME FILE are not similar, they are in each other's way,
 * and that is the hard finding the cartographer reports. Two cards that hang
 * under the same venture belong together because a person said so.
 *
 * The melt makes exactly that visible: bonded cards flow into one silhouette.
 * The motion is the information — see motion.ts for the law. A gooey edge
 * because gooey edges look good would be the decoration that law forbids.
 *
 * Pure: cards and links in, groups out.
 */
import type { Card } from './api';

export type Bond = { reason: 'file' | 'venture'; detail: string };
export type Group = { cards: Card[]; bond: Bond | null };

/** Cards keyed by what they touch, so a shared file finds its pair in one pass. */
function byFile(cards: Card[]): Map<string, Card[]> {
  const found = new Map<string, Card[]>();
  for (const card of cards) {
    for (const file of card.files ?? []) {
      if (!found.has(file)) found.set(file, []);
      found.get(file)!.push(card);
    }
  }
  return found;
}

/**
 * Group the cards of ONE column. Grouping across columns would be a lie: two
 * cards in different states are not doing the same thing, whatever they share.
 *
 * A card belongs to at most one group — the first bond wins, and file beats
 * venture because a shared file is a fact and a venture is an intention.
 */
export function group(cards: Card[], parentOf: Map<string, string> = new Map()): Group[] {
  const taken = new Set<string>();
  const groups: Group[] = [];

  for (const [file, sharing] of byFile(cards)) {
    const free = sharing.filter((c) => !taken.has(c.key));
    if (free.length < 2) continue;
    for (const card of free) taken.add(card.key);
    groups.push({ cards: free, bond: { reason: 'file', detail: file } });
  }

  const byVenture = new Map<string, Card[]>();
  for (const card of cards) {
    if (taken.has(card.key)) continue;
    const venture = parentOf.get(card.key);
    if (!venture) continue;
    if (!byVenture.has(venture)) byVenture.set(venture, []);
    byVenture.get(venture)!.push(card);
  }
  for (const [venture, part] of byVenture) {
    if (part.length < 2) continue;
    for (const card of part) taken.add(card.key);
    groups.push({ cards: part, bond: { reason: 'venture', detail: venture } });
  }

  // Everything else stands alone. A group of one is not a group — it would
  // draw a bond that does not exist.
  for (const card of cards) {
    if (taken.has(card.key)) continue;
    groups.push({ cards: [card], bond: null });
  }

  // Stable order: whatever the columns did before, they keep doing. A board
  // that reshuffles on every poll cannot be read.
  const first = (g: Group) => Math.min(...g.cards.map((c) => cards.indexOf(c)));
  return groups.sort((a, b) => first(a) - first(b));
}

/** `part-of` links, flattened to "this card hangs under that venture". */
export function parentsFrom(links: { kind: string; from: string | null; to: string | null }[]): Map<string, string> {
  const parent = new Map<string, string>();
  for (const link of links) {
    if (link.kind !== 'part-of' || !link.from || !link.to) continue;
    parent.set(link.from, link.to);
  }
  return parent;
}
