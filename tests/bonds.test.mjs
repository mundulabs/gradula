import test from 'node:test';
import assert from 'node:assert/strict';
import { group, parentsFrom } from '../web/src/bonds.ts';

const card = (key, files = []) => ({ key, files, title: key, state: 'review' });

test('shared instructions, manifests and source files do not invent a hierarchy', () => {
  const cards = [card('MDUS-3', ['AGENTS.md', 'Cargo.toml', 'src/lib.rs']), card('MDUS-4', ['AGENTS.md', 'Cargo.toml', 'src/lib.rs'])];
  assert.deepEqual(group(cards), cards.map((c) => ({ cards: [c], bond: null })));
});

test('explicit parent groups use their title and preserve card membership and order', () => {
  const cards = [card('MDUS-3'), card('MDUS-4'), card('MDUS-5')];
  const parents = parentsFrom([
    { kind: 'part-of', from: 'MDUS-3', to: 'MDUS-1' },
    { kind: 'part-of', from: 'MDUS-5', to: 'MDUS-1' },
    { kind: 'touches', from: 'MDUS-4', to: 'MDUS-1' },
  ]);
  assert.deepEqual(group(cards, parents, new Map([['MDUS-1', 'Native performance']])), [
    { cards: [cards[0], cards[2]], bond: { reason: 'venture', detail: 'Native performance · MDUS-1' } },
    { cards: [cards[1]], bond: null },
  ]);
  assert.equal(group(cards, parents)[0].bond.detail, 'MDUS-1');
});

test('a single visible child stays ungrouped even when siblings exist in another column', () => {
  const cards = [card('MDUS-3')];
  assert.deepEqual(group(cards, new Map([['MDUS-3', 'MDUS-1'], ['MDUS-4', 'MDUS-1']])), [{ cards, bond: null }]);
});

test('specific modules restore useful groups without files or broad maintenance buckets', () => {
  const cards = ['a','b','c','d','e','f'].map(key => ({ ...card(key), module: ['repo', 'docs', 'tests', 'core'] }));
  cards[0].module.push('audio'); cards[1].module.push('audio');
  cards[2].module.push('visual'); cards[3].module.push('visual');
  const groups = group(cards);
  assert.deepEqual(groups.filter(g => g.bond).map(g => [g.bond.detail, g.cards.map(c => c.key)]), [['audio', ['a','b']], ['visual', ['c','d']]]);
  assert.equal(groups.flatMap(g => g.cards).length, 6);
});

test('module fallback respects explicit parents and deduplicates module labels', () => {
  const cards = ['a','b','c'].map(key => ({ ...card(key), module: ['audio', 'audio'] }));
  const groups = group(cards, new Map([['a','parent']]));
  assert.equal(groups[0].bond, null);
  assert.deepEqual(groups[1], { cards: cards.slice(1), bond: { reason: 'module', detail: 'audio' } });
});
