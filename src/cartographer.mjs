/**
 * The cartographer — it sees connections and puts notes in the tray.
 *
 * IT NEVER WRITES INTO A CARD. That is not caution, it is the reason anyone
 * listens to it at all: a tool that quietly lays links has, within three
 * weeks, a web nobody trusts any more. A proposal with a reason costs one
 * gesture and can be checked.
 *
 * THREE SORTS, AND THEY ARE NOT EQUALLY SURE:
 *
 *   touches   — HARD. Two cards name the same file. That is not a
 *               resemblance, it is a fact, and it is the reason for the
 *               warning at start.
 *   resembles — SOFT. Same module, same stack, similar title. May be a
 *               duplicate, may be chance — which is why the number it means
 *               it by stands next to it.
 *   bundle    — SOFT. Three or more open cards in ONE module that belong to
 *               no venture yet. That is a proposal for order, not a claim
 *               about content.
 *
 * Everything here is pure: cards and links in, proposals out. No storage, no
 * time, no network — so a test can pin down every line.
 */

/**
 * Words that stand in almost every title and therefore separate nothing.
 *
 * The German words below are DATA, not prose: a card may be written in either
 * language, and a title stripped of its filler is the same title in both.
 */
const FILLER = new Set([
  // German.
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'eines',
  'und', 'oder', 'aber', 'für', 'fuer', 'mit', 'ohne', 'auf', 'aus', 'bei', 'von', 'nach', 'vom',
  'zum', 'zur', 'ist', 'sind', 'wird', 'werden', 'nicht', 'kein', 'keine',
  'was', 'wie', 'als', 'auch', 'nur', 'noch', 'schon', 'man', 'sich',
  // English. Anything of three letters or fewer is already dropped by length,
  // so only the longer ones need naming.
  'that', 'this', 'with', 'from', 'have', 'been', 'does', 'will', 'into', 'than',
  'then', 'when', 'what', 'which', 'there', 'their', 'would', 'could', 'should',
  'about', 'after', 'before', 'while', 'also', 'only', 'just', 'like', 'make',
]);

/** The load-bearing words of a title — lowercase, no filler, nothing short. */
export function wordsOf(title) {
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3 && !FILLER.has(w)),
  );
}

/** How alike two sets are: shared over total. */
export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const isOpen = (card) => !['done', 'ice'].includes(card.state);
const keyPair = (a, b) => [a, b].sort().join('|');

/**
 * @param cards every card of a project (with `files`, `module`, `stack`)
 * @param links the links that exist, so nothing already there is proposed
 */
export function suggestions(cards, links = [], { threshold = 0.34 } = {}) {
  const byId = new Map(cards.map((k) => [k.id, k]));
  const already = new Set();
  for (const link of links) {
    const from = byId.get(link.from)?.key;
    const to = byId.get(link.to)?.key;
    if (from && to) already.add(keyPair(from, to));
  }

  const out = [];
  const open = cards.filter(isOpen);

  // --- HARD: the same file ----------------------------------------------------
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i]; const b = open[j];
      if (already.has(keyPair(a.key, b.key))) continue;
      const shared = (a.files ?? []).filter((d) => (b.files ?? []).includes(d));
      if (shared.length) {
        out.push({
          kind: 'touches', confidence: 'hard', from: a.key, to: b.key,
          reason: `both name ${shared.slice(0, 3).join(', ')}`,
        });
        already.add(keyPair(a.key, b.key));
      }
    }
  }

  // --- SOFT: a similar title in the same place --------------------------------
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i]; const b = open[j];
      if (already.has(keyPair(a.key, b.key))) continue;
      const sameModule = (a.module ?? []).some((m) => (b.module ?? []).includes(m));
      const sameStack = (a.stack ?? []).some((s) => (b.stack ?? []).includes(s));
      if (!sameModule && !sameStack) continue;
      const value = similarity(wordsOf(a.title), wordsOf(b.title));
      if (value < threshold) continue;
      out.push({
        kind: 'resembles', confidence: 'soft', from: a.key, to: b.key,
        reason: `${Math.round(value * 100)} % shared words, ${sameModule ? 'same module' : 'same stack'}`,
      });
      already.add(keyPair(a.key, b.key));
    }
  }

  // --- SOFT: a bundle that could become a venture -----------------------------
  const partOf = new Set(
    links.filter((f) => f.kind === 'part-of').map((f) => byId.get(f.from)?.key).filter(Boolean),
  );
  const byModule = new Map();
  for (const card of open) {
    if (card.kind !== 'task' || partOf.has(card.key)) continue;
    for (const module of card.module ?? []) {
      if (!byModule.has(module)) byModule.set(module, []);
      byModule.get(module).push(card.key);
    }
  }
  for (const [module, keys] of byModule) {
    if (keys.length < 3) continue;
    out.push({
      kind: 'bundle', confidence: 'soft', module, cards: keys,
      reason: `${keys.length} open tasks in ${module}, none belongs to a venture`,
    });
  }

  return out;
}
