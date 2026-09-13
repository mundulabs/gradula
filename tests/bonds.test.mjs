import test from 'node:test';
import assert from 'node:assert/strict';
import { group, parentsFrom } from '../web/src/bonds.ts';

const card = (key, files = []) => ({ key, files, title: key, state: 'review' });

test('shared instructions, manifests and source files do not invent a hierarchy', () => {
  const cards = [card('MDLA-3', ['AGENTS.md', 'Cargo.toml', 'src/lib.rs']), card('MDLA-4', ['AGENTS.md', 'Cargo.toml', 'src/lib.rs'])];
  assert.deepEqual(group(cards), cards.map((c) => ({ cards: [c], bond: null })));
});

test('explicit parent groups use their title and preserve card membership and order', () => {
  const cards = [card('MDLA-3'), card('MDLA-4'), card('MDLA-5')];
  const parents = parentsFrom([
    { kind: 'part-of', from: 'MDLA-3', to: 'MDLA-1' },
    { kind: 'part-of', from: 'MDLA-5', to: 'MDLA-1' },
    { kind: 'touches', from: 'MDLA-4', to: 'MDLA-1' },
  ]);
  assert.deepEqual(group(cards, parents, new Map([['MDLA-1', 'Native performance']])), [
    { cards: [cards[0], cards[2]], bond: { reason: 'venture', detail: 'Native performance · MDLA-1' } },
    { cards: [cards[1]], bond: null },
  ]);
  assert.equal(group(cards, parents)[0].bond.detail, 'MDLA-1');
});

test('a single visible child stays ungrouped even when siblings exist in another column', () => {
  const cards = [card('MDLA-3')];
  assert.deepEqual(group(cards, new Map([['MDLA-3', 'MDLA-1'], ['MDLA-4', 'MDLA-1']])), [{ cards, bond: null }]);
});
