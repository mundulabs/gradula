/** Explicit parents take priority; shared modules offer a labeled fallback. Shared files are
 * overlap evidence, not a product hierarchy; they remain in collision checks.
 */
import type { Card } from './api';

export type Bond = { reason: 'venture' | 'module'; detail: string };
export type Group = { cards: Card[]; bond: Bond | null };

/**
 * Group the cards of ONE column. Grouping across columns would be a lie: two
 * cards in different states are not doing the same thing, whatever they share.
 *
 * A card belongs to at most one explicit parent group.
 */
export function group(cards: Card[], parentOf: Map<string, string> = new Map(), titles: Map<string, string> = new Map()): Group[] {
  const taken = new Set<string>();
  const groups: Group[] = [];

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
    groups.push({ cards: part, bond: { reason: 'venture', detail: titles.get(venture)?.trim() ? `${titles.get(venture)} · ${venture}` : venture } });
  }

  // Broad maintenance labels do not describe a feature. Prefer smaller,
  // more specific shared modules, never a bucket spanning most of a column.
  const maintenance = new Set(['docs', 'doc', 'repo', 'tests', 'tools', 'tooling', 'github', 'githooks']);
  const modules = new Map<string, Card[]>();
  for (const card of cards) {
    if (taken.has(card.key) || parentOf.has(card.key)) continue;
    for (const module of new Set(card.module ?? [])) {
      if (maintenance.has(module)) continue;
      if (!modules.has(module)) modules.set(module, []);
      modules.get(module)!.push(card);
    }
  }
  const candidates = [...modules].filter(([, part]) => part.length >= 2 && part.length <= Math.max(2, Math.min(8, cards.length / 2)))
    .sort(([a, x], [b, y]) => x.length - y.length || a.localeCompare(b));
  for (const [module, sharing] of candidates) {
    const free = sharing.filter((card) => !taken.has(card.key));
    if (free.length < 2) continue;
    free.forEach((card) => taken.add(card.key));
    groups.push({ cards: free, bond: { reason: 'module', detail: module } });
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
