/**
 * The herald speaks outward — and that is the only direction in which a
 * mistake cannot be taken back. So this file checks above all what it does
 * NOT say.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { matches, lineFor, messages, TEMPLATES, labelsOf } from '../src/heralds.mjs';
import { verify, send, withoutKey } from '../src/telegram.mjs';

const card = (x = {}) => ({
  key: 'GRD-9', title: 'A picture and a file', kind: 'task', state: 'done',
  module: ['infra'], stack: ['backend'], target: 'release', source: 'human', ...x,
});
const move = ({ card: k, ...x } = {}) => ({ verb: 'moved', actor: 'david', data: {}, ...x, card: card(k) });

test('an empty filter lets things through instead of falling silent', () => {
  assert.equal(matches({}, move()), true);
  assert.equal(matches({ verbs: [] }, move()), true, 'an empty list means everything');
});

test('every axis filters for itself', () => {
  assert.equal(matches({ verbs: ['created'] }, move()), false);
  assert.equal(matches({ kinds: ['idea'] }, move()), false);
  assert.equal(matches({ states: ['done'] }, move()), true);
  assert.equal(matches({ targets: ['branch'] }, move()), false);
  assert.equal(matches({ sources: ['sentry'] }, move()), false);
});

test('labels are an OR question across BOTH axes', () => {
  // You subscribe to topics, not to intersections.
  assert.deepEqual(labelsOf(card()), ['infra', 'backend']);
  assert.equal(matches({ labels: ['ios', 'backend'] }, move()), true, 'one hit is enough');
  assert.equal(matches({ labels: ['ios'] }, move()), false);
  assert.equal(matches({ labels: ['infra'] }, move()), true, 'the module counts too');
});

test('a public channel gets ONLY what was released — and it hears releases, not card moves', async () => {
  const filter = TEMPLATES.outside.filter;
  assert.equal(matches(filter, move()), false, 'a card is internal by itself');
  assert.equal(matches(filter, move({ card: { visibility: 'public' } })), false, 'a public card moving is still not a release');
  assert.deepEqual(filter.verbs, ['released']);
  const { releaseNote } = await import('../src/releases.mjs');
  const release = { id: 'build:x', lane: 'ios', at: '2026-09-10T16:00:00Z', version: '0.0.1 · 3', profile: 'beta', title: 'internal build title', url: 'https://expo.dev/b/x' };
  const cards = [{ key: 'P-1', title: 'Public thing', visibility: 'public' }, { key: 'P-2', title: 'Secret thing', visibility: 'internal' }];
  const outward = releaseNote(release, cards, { visibility: 'public' });
  assert.equal(outward, 'iOS 0.0.1 · 3 · TestFlight — released\n• Public thing', 'titles of public cards only; no key, no build title, no link');
  const inside = releaseNote(release, cards, { visibility: 'internal' });
  assert.match(inside, /• P-1 Public thing\n• P-2 Secret thing\nhttps:\/\/expo\.dev\/b\/x$/);
  assert.equal(releaseNote(release, [cards[1]], { visibility: 'public' }), null, 'nothing public: a public channel hears nothing');
});

test('the title goes outward — and nothing else', () => {
  const event = move({ data: { reason: 'Customer Meier is not paying' } });
  const innen = lineFor(event, { voice: 'human', visibility: 'internal' });
  const outward = lineFor(event, { voice: 'human', visibility: 'public' });
  assert.match(innen, /Customer Meier/);
  assert.doesNotMatch(outward, /Meier/, 'the reason is where somebody writes a name');

  const plainOutward = lineFor(event, { voice: 'plain', visibility: 'public' });
  assert.doesNotMatch(plainOutward, /david/, 'the actor does not belong out there either');
  assert.doesNotMatch(plainOutward, /infra/, 'and the labels give away the shape of the house');
});

test('two voices, two sentences', () => {
  const event = move({ data: { reason: 'gate green' } });
  assert.equal(lineFor(event, { voice: 'human' }), 'Done: A picture and a file — gate green');
  assert.match(lineFor(event, { voice: 'plain' }), /^GRD-9 moved .* \[infra backend\]\ndavid · gate green$/, 'the hand and the reason on a line of their own');
});

test('a long title is shortened, not cut off', () => {
  const lang = lineFor(move({ card: { title: 'x'.repeat(300) } }), { voice: 'human' });
  assert.ok(lang.length < 160);
  assert.match(lang, /…$/);
});

test('a disabled herald gets nothing', () => {
  const heralds = [
    { id: '1', project: 'GRD', active: false, filter: {} },
    { id: '2', project: 'GRD', filter: { verbs: ['moved'] } },
  ];
  const out = messages(heralds, move());
  assert.deepEqual(out.map((b) => b.herald.id), ['2']);
});

test('every template is a filter one could have written oneself', () => {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    assert.ok(template.name && template.line, `${name} has a name and a line`);
    assert.doesNotThrow(() => matches(template.filter, move()), `${name} is a filter like any other`);
  }
  assert.equal(matches(TEMPLATES.decisions.filter, move({ verb: 'decided' })), true);
  assert.equal(matches(TEMPLATES.fire.filter, move({ verb: 'ingested', card: { source: 'sentry' } })), true);
});

// --- Telegram -------------------------------------------------------------

const response = (body, status = 200) => async () => ({ status, json: async () => body });

test('a key never lands in a message', () => {
  assert.equal(withoutKey('broken bei 123456789:AAEwqRtZuiOpAsdFghJklYxCvBnM12'), 'broken bei bot…');
});

test('sending without a setup is not a failure, only a no', async () => {
  assert.deepEqual(await send({ token: null, chat: null }, 'hallo'), { sent: false, reason: 'not set up' });
});

test('a mute herald does not throw', async () => {
  const broken = async () => { throw new Error('no network'); };
  assert.deepEqual(await send({ token: 't', chat: '1' }, 'x', { fetchImpl: broken }), { sent: false, reason: 'no network' });
});

test('too fast means wait, not push again', async () => {
  const result = await send({ token: 't', chat: '1' }, 'x', {
    fetchImpl: response({ ok: false, parameters: { retry_after: 12 } }, 429),
  });
  assert.equal(result.sent, false);
  assert.match(result.reason, /first in 12 s/);
});

test("a message stays under Telegram's limit", async () => {
  let seen = null;
  await send({ token: 't', chat: '1' }, 'y'.repeat(9000), {
    fetchImpl: async (_url, init) => { seen = JSON.parse(init.body); return { status: 200, json: async () => ({ ok: true }) }; },
  });
  assert.ok(seen.text.length <= 3900);
  assert.equal(seen.disable_web_page_preview, true, 'no foreign page in the channel');
  assert.ok(!('parse_mode' in seen), 'no markdown — a title with a full stop in it would break it');
});

test('verifying says whom you have set up', async () => {
  const ok = await verify({ token: 't' }, { fetchImpl: response({ ok: true, result: { username: 'GradulaMachineBot' } }) });
  assert.deepEqual(ok, { ok: true, bot: 'GradulaMachineBot', chat: null });
  const falsch = await verify({ token: 't' }, { fetchImpl: response({ ok: false }, 401) });
  assert.match(falsch.reason, /401/);
});

/**
 * THE OUTWARD LANGUAGE IS NOT THE DEVELOPER'S.
 *
 * A person reads the board in the language they chose; a channel is read by
 * whoever is in it. A workshop channel in German and a client channel in
 * English is one board and two audiences, and the language belongs to the
 * HERALD, not to whoever moved the card.
 *
 * Only the human voice translates. The plain voice is keys, verbs and labels —
 * identifiers, and an identifier that changed with a setting would be exactly
 * what this board is built not to do.
 */
test('the human voice speaks the herald\'s language, the plain voice speaks none', () => {
  const done = move({ card: { key: 'GRD-9', title: 'A picture and a file', state: 'done', kind: 'task', module: [], stack: [], visibility: 'internal' } });
  assert.match(lineFor(done, { voice: 'human', language: 'en' }), /^Done: /);
  assert.match(lineFor(done, { voice: 'human', language: 'de' }), /^Fertig: /);

  const making = move({ card: { key: 'GRD-9', title: 'x', state: 'making', kind: 'task', module: [], stack: [], visibility: 'internal' } });
  assert.match(lineFor(making, { voice: 'human', language: 'de' }), /^Jetzt Arbeit: /, 'the state comes from the shared vocabulary');
  assert.match(lineFor(making, { voice: 'human', language: 'en' }), /^Now Making: /);

  const plain = lineFor(done, { voice: 'plain', language: 'de' });
  assert.match(plain, /\bmoved\b/, 'the verb stays an identifier');
  assert.doesNotMatch(plain, /Fertig|verschoben/, 'the plain voice does not translate');

  assert.match(lineFor(done, { voice: 'human' }), /^Done: /, 'without a language it is English');
});

test('the key at the head of the line is the link — no second key beneath, and a human line gets it in front', async () => {
  const { createGradula } = await import('../src/gradula.mjs');
  const { createMemoryStore } = await import('../src/store.mjs');
  const said = [];
  const store = createMemoryStore();
  const gradula = createGradula(store, { origin: 'https://board.test', heraldKinds: { probe: { async send(_c, text, opts) { said.push({ text, ...opts }); return { sent: true }; } } } });
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  await gradula.setHerald('PRB', { kind: 'probe', name: 'Plain', chat: 'a', token: 'x', template: 'workshop' }, 'david');
  await gradula.setHerald('PRB', { kind: 'probe', name: 'Human', chat: 'b', token: 'x', filter: { verbs: ['created', 'moved'], voice: 'human' } }, 'david');
  const card = await gradula.addItem('PRB', { title: 'A thing & another', kind: 'task' }, 'david');
  await gradula.settle();
  const plain = said.find((m) => m.text.includes(' created '));
  assert.equal(plain.text, `<a href="https://board.test/${card.key}">${card.key}</a> created A thing &amp; another\ndavid`, 'the key is the link, then the sentence, the hand beneath — nothing appended');
  const human = said.find((m) => m.text.includes('New:'));
  assert.equal(human.text, `<a href="https://board.test/${card.key}">${card.key}</a> New: A thing &amp; another`);
  said.length = 0;
  await gradula.startItem(card.key, 'david');
  await gradula.settle();
  assert.deepEqual(said, [], 'started right after created is the same moment — no second message');
});

test('a template picked on an existing herald replaces its filter — the form sends the old filter along, and the template still wins', async () => {
  const { createGradula } = await import('../src/gradula.mjs');
  const { createMemoryStore } = await import('../src/store.mjs');
  const gradula = createGradula(createMemoryStore());
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  const made = await gradula.setHerald('PRB', { kind: 'telegram', name: 'Lab', chat: '-1', token: 'x', template: 'outside' }, 'david');
  const changed = await gradula.setHerald('PRB', { ...made, token: '', template: 'release' }, 'david');
  assert.deepEqual(changed.filter, TEMPLATES.release.filter, 'the picked template is the filter now');
  const byHand = await gradula.setHerald('PRB', { ...changed, token: '', template: undefined, filter: { verbs: ['decided'] } }, 'david');
  assert.deepEqual(byHand.filter, { verbs: ['decided'] }, 'without a template, the filter given is the hand\'s own');
});
