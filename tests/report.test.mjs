/**
 * The report: many moves become one message — and the human shape must not
 * leak what only means something inside the house.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { gather, plainReport, humanReport, htmlReport, escapeHtml, bar } from '../src/report.mjs';

const cards = [
  { id: 'a', key: 'PRB-9', title: 'A picture and a file', module: ['infra'], stack: ['backend'], target: 'release', gate: { kind: 'test' } },
  { id: 'b', key: 'PRB-22', title: 'Ideas or wishes?' },
  { id: 'c', key: 'PRB-40', title: 'Crash while loading', count: 12, source: 'sentry' },
  { id: 'd', key: 'PRB-7', title: 'Something internal', gate: null },
];
const history = [
  { item: 'a', verb: 'moved', data: { to: 'done' }, actor: 'david' },
  { item: 'a', verb: 'moved', data: { to: 'done' }, actor: 'david' },
  { item: 'b', verb: 'decided', data: { reason: 'Wishes, because that is the room people write into' }, actor: 'felix' },
  { item: 'c', verb: 'ingested', actor: 'sentry' },
  { item: 'd', verb: 'moved', data: { to: 'done' }, actor: 'david' },
  { item: 'zzz', verb: 'moved', data: { to: 'done' }, actor: 'ghost' },
];

test('a card counted twice is counted once', () => {
  // A list that counts one thing twice is a list nobody checks against reality.
  const found = gather(history, cards);
  assert.equal(found.done.length, 2, 'PRB-9 moved to done twice and appears once');
  assert.deepEqual(found.done.map((r) => r.card.key), ['PRB-7', 'PRB-9']);
});

test('an entry without a card is skipped, not guessed', () => {
  const found = gather(history, cards);
  assert.equal(found.touched, 4, 'the ghost entry belongs to no card');
});

test('released is the subset that actually left the house', () => {
  const found = gather(history, cards);
  assert.deepEqual(found.released.map((r) => r.card.key), ['PRB-9']);
});

test('the plain shape carries keys, labels and the missing gate', () => {
  const text = plainReport(gather(history, cards), { project: 'PRB', period: 'today' });
  assert.match(text, /PRB-9/);
  assert.match(text, /\[infra backend\]/);
  assert.doesNotMatch(text, /NO GATE/, 'a gate is a choice, not a lack — production decides what is done');
  assert.match(text, /^• PRB-9 /m, 'a list, one card per line, the key first');
});

test('the human shape names no key, no actor, no module', () => {
  const text = humanReport(gather(history, cards), { period: 'today' });
  assert.match(text, /A picture and a file/);
  assert.doesNotMatch(text, /PRB-/, 'a key means nothing outside the house');
  assert.doesNotMatch(text, /david|felix/, 'nor does who moved it');
  assert.doesNotMatch(text, /infra|backend/, 'nor which module');
  assert.match(text, /because that is the room/, 'but the reason for a decision belongs in');
});

test('an empty period says so instead of sending an empty shape', () => {
  const text = humanReport(gather([], cards), {});
  assert.match(text, /Nothing moved/);
});

test('HTML escapes exactly the three characters that matter', () => {
  assert.equal(escapeHtml('a & b <c> "d"'), 'a &amp; b &lt;c&gt; "d"');
  const html = htmlReport(gather(history, [{ ...cards[0], title: 'Fix <script> & co' }]), { project: 'PRB', voice: 'plain' });
  assert.doesNotMatch(html.replace(/<\/?(b|pre)>/g, ''), /<script>/, 'a title never becomes markup');
});

/**
 * A BAR IS ONLY HONEST WHERE THERE IS A WHOLE.
 *
 * A milestone has parts, so "6 of 8 settled" has a denominator. "31 cards
 * finished this week" has none, and a bar over that would invent one.
 */
test('a share becomes ten blocks, and nothing else does', () => {
  assert.equal(bar(0), '░░░░░░░░░░');
  assert.equal(bar(1), '██████████');
  assert.equal(bar(0.5), '█████░░░░░');
  assert.equal(bar(0.81), '████████░░');
  assert.equal(bar(null), '', 'no share, no bar');
  assert.equal(bar(undefined), '');
  // Ten cells, always — a line in a chat has to survive a phone.
  assert.equal(bar(0.37).length, 10);
});

test('the bar rides in a monospace box, or it makes a ladder', () => {
  const found = {
    done: [], released: [], decided: [], incidents: [], started: [], actors: [], touched: 0,
    goals: [{ key: 'A-1', title: 'W2 the third room', share: 0.5, done: 4, dropped: 0, total: 8 }],
  };
  const html = htmlReport(found, { project: 'A', period: 'this week' });
  assert.match(html, /<code>█████░░░░░<\/code>/);
  assert.match(html, /4\/8/);
  assert.match(humanReport(found, { period: 'this week' }), /^█████░░░░░ {2}4\/8 {2}W2 the third room$/m);
});

test('a title is not cut; the whole message is clipped at a line and says how much is missing', async () => {
  const { clip } = await import('../src/report.mjs');
  const long = Array.from({ length: 200 }, (_, i) => `• card ${i}: a sentence long enough to count`).join('\n');
  const out = clip(long, 800);
  assert.ok(out.length <= 830, 'within the limit');
  assert.match(out, /\n… \d+ more on the board$/, 'ends at a line, and counts what is missing');
  assert.equal(clip('short'), 'short');
});
