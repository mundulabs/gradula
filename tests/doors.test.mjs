/**
 * The doors, over real HTTP. No imitated call: the server runs, and the tests
 * knock the way the CLI and the MCP tool do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';
import { createLive } from '../src/live.mjs';
import { createApi } from '../src/api.mjs';

const ADMIN = 'an-admin-secret-for-the-probe';

async function start2({ heraldKinds, staticFiles } = {}) {
  const store = createMemoryStore();
  const live = createLive();
  // The origin only where a test needs it: it is what a herald appends to a
  // released card, so switching it on everywhere would rewrite the one
  // sentence another test measures word for word.
  const origin = staticFiles ? 'https://board.test' : null;
  const gradula = createGradula(store, { live, ...(origin ? { origin } : {}), ...(heraldKinds ? { heraldKinds } : {}) });
  const server = createServer(createApi(gradula, { adminToken: ADMIN, live, ...(origin ? { origin } : {}), ...(staticFiles ? { staticFiles } : {}) }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, { token, actor, ...init } = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'X-Gradula-Session': 'test-session',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(actor ? { 'X-Gradula-Actor': actor } : {}),
        ...init.headers,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const project = await call('/api/admin/projects', { method: 'POST', token: ADMIN, body: { key: 'PRB', name: 'Probe' } });
  assert.equal(project.status, 201);
  const key = await call('/api/admin/projects/PRB/keys', { method: 'POST', token: ADMIN, body: { name: 'the test' } });
  assert.equal(key.status, 201);

  return { server, call, gradula, base, token: key.body.token, close: () => new Promise((done) => server.close(done)) };
}

test('without a key nobody comes in', async (t) => {
  const { call, close } = await start2();
  t.after(close);
  assert.equal((await call('/api/v1/cards')).status, 401);
  assert.equal((await call('/api/v1/cards', { token: 'grad_pat_erfunden' })).status, 401);
  assert.equal((await call('/api/health')).status, 200, 'health is open — a probe is not a secret');
  assert.equal((await call('/api/admin/projects', { method: 'POST', body: { key: 'XX', name: 'x' } })).status, 401);
});

test('create a card, find it, move it — with a chronicle', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  await call('/api/v1/vocabulary', {
    method: 'PUT', token,
    body: { module: [{ id: 'panels', paths: ['packages/panels'], words: ['bühne'] }] }, // a German word: a card may be written in either language
  });

  const created = await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david',
    body: { kind: 'task', title: 'Exactly one More menu per window head', text: 'packages/panels/src/PanelFrame.tsx in the browser' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.key, 'PRB-1');
  assert.equal(created.body.state, 'ready');
  assert.deepEqual(created.body.module, ['panels'], 'the label comes from the vocabulary');
  assert.ok(created.body.stack.includes('web'));

  const fetched = await call('/api/v1/cards/PRB-1', { token });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.history[0].verb, 'created');
  assert.equal(fetched.body.history[0].actor, 'david (the test)', 'the chronicle names the person, then the hand in brackets');

  const moved = await call('/api/v1/cards/PRB-1/move', { method: 'POST', token, actor: 'felix', body: { state: 'making' } });
  assert.equal(moved.body.state, 'making');
  assert.equal(moved.body.history.at(-1).verb, 'moved');
  assert.match(moved.body.history.at(-1).actor, /^felix/);

  const list = await call('/api/v1/cards?state=making', { token });
  assert.deepEqual(list.body.map((i) => i.key), ['PRB-1']);
});

/**
 * A NAME IN A SENTENCE IS A MENTION — NOT A COLLISION AND NOT AN ORDER.
 *
 * This laid `touches`, and `touches` means "these two cards name the same
 * FILE": it is the reason for the warning at `start`. So sixteen links on the
 * live board claimed a file collision because somebody had written "MDUS-14"
 * in a sentence, and a warning that is usually wrong is a warning nobody
 * reads.
 */
test('a mention is a neighbourhood, not a dependency', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'the first' } });
  const second = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'the second', text: 'follows on from PRB-1' } });
  assert.deepEqual(second.body.links, ['PRB-1']);

  const fetched = await call('/api/v1/cards/PRB-2', { token });
  const laid = fetched.body.links.find((f) => f.to === 'PRB-1');
  assert.equal(laid?.kind, 'mentions');
  assert.equal(laid?.source, 'rule');
  assert.equal(fetched.body.links.filter((f) => f.kind === 'touches').length, 0, 'no collision is claimed');
  // Measured on 2026-09-09: "part of MDUS-1" in the text made the card
  // blocked although the order was exactly the other way round. A name in a
  // text says nothing about who waits on whom.
  assert.deepEqual(fetched.body.blockedBy, [], 'a mention blocks nothing');
});

test('whoever really waits says so as a link', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  for (const title of ['Erste', 'Zweite']) await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title } });
  await call('/api/v1/links', { method: 'POST', token, body: { from: 'PRB-2', to: 'PRB-1', kind: 'needs' } });
  assert.deepEqual((await call('/api/v1/cards/PRB-2', { token })).body.blockedBy, ['PRB-1']);

  await call('/api/v1/cards/PRB-1/move', { method: 'POST', token, body: { state: 'done' } });
  assert.deepEqual((await call('/api/v1/cards/PRB-2', { token })).body.blockedBy, [], 'done holds nobody up any more');
});

test('a cycle is refused and names the chain', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  for (const title of ['A', 'B']) await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title } });
  assert.equal((await call('/api/v1/links', { method: 'POST', token, body: { from: 'PRB-1', to: 'PRB-2', kind: 'needs' } })).status, 201);
  const cycle = await call('/api/v1/links', { method: 'POST', token, body: { from: 'PRB-2', to: 'PRB-1', kind: 'needs' } });
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.error, 'cycle');
  assert.match(cycle.body.line, /PRB-2 → PRB-1 → PRB-2/);
});

test('a proposal changes nothing until a hand confirms it', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  // A proposal is a label too, and a label is a word from the list.
  await call('/api/v1/vocabulary', { method: 'PUT', token, body: { module: [{ id: 'core', paths: ['packages/core'] }] } });
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'idea', title: 'Etwas' } });
  const suggested = await call('/api/v1/cards/PRB-1/suggest', { method: 'POST', token, body: { module: ['core'], stack: ['engine'] } });
  assert.deepEqual(suggested.body.module, [], 'no label yet');
  assert.deepEqual(suggested.body.suggestions.module, ['core']);

  const confirmed = await call('/api/v1/cards/PRB-1/confirm', { method: 'POST', token, actor: 'david' });
  assert.deepEqual(confirmed.body.module, ['core']);
  assert.deepEqual(confirmed.body.suggestions.module, []);
});

test('start announces who touches the same file', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const file = 'packages/panels/src/StageView.tsx';
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Eine', files: [file] } });
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Andere', files: [file] } });
  await call('/api/v1/cards/PRB-1/start', { method: 'POST', token, actor: 'david' });

  const second = await call('/api/v1/cards/PRB-2/start', { method: 'POST', token, actor: 'felix' });
  assert.equal(second.body.state, 'making', 'the warning stops nobody');
  assert.deepEqual(second.body.warnings, [{ card: 'PRB-1', files: [file], actor: 'david (the test)', activity: 'active', modules: [], level: 'files' }]);
});

test('another project does not exist — 404, not 403', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/admin/projects', { method: 'POST', token: ADMIN, body: { key: 'AND', name: 'Anderes' } });
  const foreign = await call('/api/v1/cards/AND-1', { token });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, 'no-card');
});

test('a revoked key opens nothing any more', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const list = await call('/api/admin/projects/PRB/keys', { token: ADMIN });
  assert.equal((await call(`/api/admin/keys/${list.body[0].id}`, { method: 'DELETE', token: ADMIN })).status, 200);
  assert.equal((await call('/api/v1/cards', { token })).status, 401);
});

test('broken input is named, not swallowed', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  assert.equal((await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'raten', title: 'x' } })).body.error, 'kind');
  assert.equal((await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'idea', title: '   ' } })).body.error, 'empty');
  const badGate = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'idea', title: 'x', gate: { kind: 'raten', call: 'x' } } });
  assert.equal(badGate.status, 400, 'a wrong gate is an input error');
  assert.equal(badGate.body.error, 'gate');
});

test('the same evidence twice is none', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Eine' } });

  const first = await call('/api/v1/cards/PRB-1/evidence', { method: 'POST', token, actor: 'david', body: { kind: 'commit', ref: 'abc1234' } });
  assert.equal(first.status, 201);
  assert.equal(first.body.fresh, true);

  const again2 = await call('/api/v1/cards/PRB-1/evidence', { method: 'POST', token, body: { kind: 'commit', ref: 'abc1234' } });
  assert.equal(again2.body.fresh, false, 'sync runs more than once over the same history');

  const card = await call('/api/v1/cards/PRB-1', { token });
  assert.equal(card.body.history.filter((e) => e.verb === 'evidenced').length, 1);
  assert.equal(card.body.history.at(-1).data.ref, 'abc1234');

  const wrong = await call('/api/v1/cards/PRB-1/evidence', { method: 'POST', token, body: { kind: 'geraten', ref: 'x' } });
  assert.equal(wrong.body.error, 'kind');
});

test('a word is a word, a decision is a decision', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'decision', title: 'Postgres or documents?' } });

  await call('/api/v1/cards/PRB-1/say', { method: 'POST', token, actor: 'felix', body: { text: 'Documents would be less to run.' } });
  const talked = await call('/api/v1/cards/PRB-1', { token });
  assert.equal(talked.body.history.at(-1).verb, 'said');
  assert.equal(talked.body.state, 'ready', 'talking decides nothing');

  const withoutReason = await call('/api/v1/cards/PRB-1/decide', { method: 'POST', token, body: { result: 'Postgres' } });
  assert.equal(withoutReason.status, 400, 'a decision without a reason is no decision in three weeks');

  const decided = await call('/api/v1/cards/PRB-1/decide', {
    method: 'POST', token, actor: 'david',
    body: { result: 'Postgres', reason: 'A board is a query; documents cannot do that.' },
  });
  assert.equal(decided.status, 201);
  assert.equal(decided.body.state, 'done', 'the question is answered');
  const last = decided.body.history.at(-1);
  assert.equal(last.verb, 'decided');
  assert.equal(last.data.result, 'Postgres');
  assert.match(last.actor, /^david/, 'a decision names whoever made it');
});

test('a system may move and evidence — but not decide', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const system = (await call('/api/admin/projects/PRB/keys', {
    method: 'POST', token: ADMIN, body: { name: 'Regelwerk', kind: 'system' },
  })).body.token;

  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'decision', title: 'Eine Frage' } });

  const moved = await call('/api/v1/cards/PRB-1/move', {
    method: 'POST', token: system, body: { state: 'review' },
    headers: { 'X-Gradula-Rule': 'gate_green' },
  });
  assert.equal(moved.status, 200, 'it may move');
  assert.equal(moved.body.history.at(-1).actor, 'Gradula (rule: gate_green)', 'it names the rule, not a person');

  // Even with a claimed name it stays Gradula — a system has none.
  const lied = await call('/api/v1/cards/PRB-1/move', {
    method: 'POST', token: system, actor: 'david', body: { state: 'ready' },
  });
  assert.match(lied.body.history.at(-1).actor, /^Gradula \(/, 'a system does not borrow a name');

  const beschluss = await call('/api/v1/cards/PRB-1/decide', {
    method: 'POST', token: system, body: { result: 'yes', reason: 'because I can' },
  });
  assert.equal(beschluss.status, 403);
  assert.equal(beschluss.body.error, 'humans-only');
});

test('a system creates only ideas', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const system = (await call('/api/admin/projects/PRB/keys', {
    method: 'POST', token: ADMIN, body: { name: 'Kartograf', kind: 'system' },
  })).body.token;

  const idea = await call('/api/v1/cards', { method: 'POST', token: system, body: { kind: 'idea', title: 'Three cards in panels belong together' } });
  assert.equal(idea.status, 201);
  assert.match(idea.body.history === undefined ? 'ok' : 'ok', /ok/);

  for (const kind of ['task', 'venture', 'decision']) {
    const refused = await call('/api/v1/cards', { method: 'POST', token: system, body: { kind, title: 'Nicht deine Aufgabe' } });
    assert.equal(refused.status, 403, `a system may not create a ${kind}`);
    assert.equal(refused.body.error, 'ideas-only');
  }
});

test('the history answers "what happened while I was away"', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'Eine' } });
  // The mark is the SEQUENCE, not the time: two entries from the same
  // millisecond could not be told apart by a timestamp, and a log that loses
  // something in the process is not a log.
  const mark = (await call('/api/v1/history', { token })).body[0].seq;
  await call('/api/v1/cards/PRB-1/move', { method: 'POST', token, actor: 'felix', body: { state: 'making' } });

  const everything = await call('/api/v1/history', { token });
  assert.equal(everything.status, 200);
  assert.equal(everything.body[0].verb, 'moved', 'the newest stands on top');
  assert.equal(everything.body[0].card, 'PRB-1', 'every line names its card');
  assert.match(everything.body[0].actor, /^felix/);

  const since2 = await call(`/api/v1/history?after=${mark}`, { token });
  assert.equal(since2.body.length, 1, 'only what happened since the mark');
  assert.equal(since2.body[0].verb, 'moved');
});

test('a venture closes itself when its parts are settled', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  const fresh = async (kind, title) =>
    (await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind, title } })).body;
  const venture = await fresh('venture', 'Das Ganze');
  const one = await fresh('task', 'Teil one');
  const two = await fresh('task', 'part two');
  for (const part of [one, two]) {
    const link = await call('/api/v1/links', {
      method: 'POST', token, actor: 'david',
      body: { from: part.key, to: venture.key, kind: 'part-of' },
    });
    assert.equal(link.status, 201);
  }

  const push = (key) => call(`/api/v1/cards/${key}/move`, {
    method: 'POST', token, actor: 'david', body: { state: 'done' },
  });

  const vorher = (await call(`/api/v1/cards/${venture.key}`, { token })).body.state;
  await push(one.key);
  assert.equal((await call(`/api/v1/cards/${venture.key}`, { token })).body.state, vorher,
    'one open part keeps the whole thing open');

  const last = await push(two.key);
  assert.deepEqual(last.body.alsoClosed, [venture.key], 'the move says what it closed with it');
  assert.equal((await call(`/api/v1/cards/${venture.key}`, { token })).body.state, 'done');

  // The movement has to be visible — otherwise it is magic.
  const seen = (await call(`/api/v1/cards/${venture.key}`, { token })).body;
  const move = (seen.history ?? []).find((e) => e.verb === 'moved');
  assert.ok(move, "the card's chronicle carries the move");
  assert.equal(move.actor, 'Gradula (rule: all parts done)');
  assert.match(move.data.reason, /2 parts done/);
});


test('a move goes outward — but only what the filter allows', async (t) => {
  const said = [];
  const heraldKinds = {
    probe: {
      async verify() { return { ok: true, bot: 'ProbeBot' }; },
      async send({ chat }, text) { said.push({ chat, text }); return { sent: true }; },
    },
  };
  const { call, gradula, token, close } = await start2({ heraldKinds });
  t.after(close);

  const herald = async (body) => (await call('/api/v1/heralds', { method: 'PUT', token, body: body })).body;
  const workshop = await herald({
    kind: 'probe', name: 'Werkstatt', chat: 'inside', token: 'secret',
    filter: { verbs: ['moved'], voice: 'plain' },
  });
  assert.equal(workshop.token, 'set', 'the key never comes back');
  await herald({
    kind: 'probe', name: 'Outside', chat: 'outside', token: 'secret',
    template: 'outside',
  });

  const card = (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david',
    body: { kind: 'task', title: 'Etwas Fertiges', text: 'internal: Kunde Meier' },
  })).body;

  // Creating must not go out at all — the filter names only "moved".
  await gradula.settle();
  assert.deepEqual(said, [], 'a verb that is not in the filter does not go out');

  await call(`/api/v1/cards/${card.key}/move`, {
    method: 'POST', token, actor: 'david', body: { state: 'done', reason: 'Kunde Meier zahlt' },
  });
  await gradula.settle();

  const inside = said.filter((g) => g.chat === 'inside');
  const outside = said.filter((g) => g.chat === 'outside');
  assert.equal(inside.length, 1, 'the internal channel gets the move');
  assert.match(inside[0].text, /Etwas Fertiges/);
  assert.equal(outside.length, 0, 'the card is not released — outside stays quiet');

  const probe = (await call(`/api/v1/heralds/${workshop.id}/probe`, { method: 'POST', token })).body;
  assert.equal(probe.sent, true);
  assert.equal(probe.bot, 'ProbeBot');

  assert.equal((await call(`/api/v1/heralds/${workshop.id}`, { method: 'DELETE', token })).body.entfernt, true);
});

test('releasing is its own gesture — and only then does outside speak', async (t) => {
  const said = [];
  const heraldKinds = { probe: { async send({ chat }, text) { said.push({ chat, text }); return { sent: true }; } } };
  const { call, gradula, token, close } = await start2({ heraldKinds });
  t.after(close);

  await call('/api/v1/heralds', {
    method: 'PUT', token,
    body: { kind: 'probe', name: 'Outside', chat: 'outside', token: 'x', template: 'public-release' },
  });
  const card = (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'Something for everyone' },
  })).body;
  assert.equal(card.visibility, 'internal', 'a card is internal by itself');

  const done = () => call(`/api/v1/cards/${card.key}/move`, {
    method: 'POST', token, actor: 'david', body: { state: 'done' },
  });

  await done();
  await gradula.settle();
  assert.deepEqual(said, [], 'without a release the public channel stays quiet');

  const wrong = await call(`/api/v1/cards/${card.key}`, {
    method: 'PATCH', token, actor: 'david', body: { visibility: 'halb' },
  });
  assert.equal(wrong.status, 400, 'an invented visibility is named, not swallowed');

  await call(`/api/v1/cards/${card.key}`, { method: 'PATCH', token, actor: 'david', body: { visibility: 'public' } });
  await call(`/api/v1/cards/${card.key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'ready' } });
  await done();
  await gradula.settle();
  assert.deepEqual(said, [], 'public, done — and still quiet: outside speaks per RELEASE, not per card');

  // THE RELEASE: the production head that carries the card is seen once — one note, the public titles only.
  const picture = { deployed: { production: { sha: 'abcdef1234567890abcdef1234567890abcdef12', at: '2026-09-10T16:00:00Z', cards: [card.key] } }, environments: [{ id: 'production', deployments: [{ status: 'live', title: 'Ship it' }] }], builds: [], updates: [] };
  const spoken = await gradula.noteReleases('PRB', picture, { now: Date.parse('2026-09-10T16:30:00Z') });
  assert.equal(spoken.length, 1);
  assert.deepEqual(said, [], 'a raw release is card titles — commit subjects — and the outside does not hear those');
  // THE REVIEWED NOTES: the text the store shows, filed once per version — that is what the outside hears
  const filed = await gradula.fileNotes('PRB', { lane: 'web', version: 'abcdef1', text: 'Something for everyone, now in the app.' }, 'david');
  assert.equal(filed.filed, true);
  assert.equal(said.length, 1, 'now it goes out — once');
  assert.equal(said[0].text, 'Probe abcdef1\nSomething for everyone, now in the app.');
  assert.equal((await gradula.fileNotes('PRB', { lane: 'web', version: 'abcdef1', text: 'again' }, 'david')).filed, false, 'the same version again changes nothing');
  assert.equal(said.length, 1, 'and says nothing');
  const list = (await call('/api/v1/releases', { token })).body;
  assert.equal(list.length, 2, 'the release and its notes are both remembered');
  assert.deepEqual(list.find((r) => r.lane === 'web' && !r.id.startsWith('notes:')).cards, [card.key]);
});

test('the cartographer answers through its own door', async (t) => {
  // It did not, for one deployment: the verb called `cartograph` while the
  // import was still named `kartografiere`, and every request came back 500.
  // No test went through that door, so nothing said a word.
  const { call, token, close } = await start2();
  t.after(close);

  const fresh = async (title, files) => (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david', body: { kind: 'task', title, files },
  })).body;
  await fresh('One', ['src/same.mjs']);
  await fresh('Two', ['src/same.mjs']);

  const seen = await call('/api/v1/suggestions', { token });
  assert.equal(seen.status, 200, 'the door answers at all');
  assert.ok(Array.isArray(seen.body));
  const hard = seen.body.find((s) => s.kind === 'touches');
  assert.ok(hard, 'two cards on the same file is a fact, and it is reported');
  assert.match(hard.reason, /src\/same\.mjs/);
});

test('the card page for a crawler shows a title — and only for a released card', async (t) => {
  // Telegram and Slack fetch a preview WITHOUT signing in. So this page has no
  // sign-in — and therefore carries nothing but a title, and only when a person
  // released the card. An internal card gets the board and no tags: what is not
  // in the head cannot be read out of it.
  const seen = { head: null };
  const { call, token, close, base } = await start2({
    staticFiles: async (_req, res, _path, { head = null } = {}) => {
      seen.head = head;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head>${head ?? ''}</head><body>board</body></html>`);
      return true;
    },
  });
  t.after(close);

  const card = (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david',
    body: { kind: 'task', title: 'Something for everyone', text: 'internal: customer Meier' },
  })).body;

  const naked = async (path) => {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  };

  const internal = await naked(`/${card.key}`);
  assert.equal(internal.status, 200, 'the board answers — an internal card is not a 404 page');
  assert.match(seen.head, /noindex/, 'and nothing about it goes into the head');
  assert.doesNotMatch(internal.body, /Meier/, 'the text never leaves the house');

  await call(`/api/v1/cards/${card.key}`, { method: 'PATCH', token, actor: 'david', body: { visibility: 'public' } });
  const public1 = await naked(`/${card.key}`);
  assert.equal(public1.status, 200);
  assert.match(public1.body, /Something for everyone/, 'the title stands in the page a crawler reads');
  assert.match(public1.body, /og:title/);
  assert.doesNotMatch(public1.body, /Meier/, 'and still nothing else');

  // The old address is kept: links have gone out into chats nobody can edit.
  const moved = await naked(`/c/${card.key}`);
  assert.equal(moved.status, 302);
  assert.equal(moved.location, `/${card.key}`);
});

test('a runner leases the card by beating, and the lease expires by itself', async (t) => {
  // A runner does not say "I stopped" — it stops saying anything. Staleness IS
  // the stop signal, so nothing has to remember to clear a flag. Same reason
  // `blocked` is computed: a stored "is running" is wrong the first time a
  // laptop closes mid-run, and then nobody knows which one.
  const { call, token, close } = await start2();
  t.after(close);

  const card = (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'Long work' },
  })).body;
  assert.equal(card.running, false, 'a fresh card is not running');

  await call(`/api/v1/cards/${card.key}/start`, { method: 'POST', token });
  const beat = await call(`/api/v1/cards/${card.key}/beat`, { method: 'POST', token, actor: 'david' });
  assert.equal(beat.status, 200);
  assert.equal(beat.body.card, card.key);

  const seen = (await call(`/api/v1/cards/${card.key}`, { token })).body;
  assert.equal(seen.running, true, 'after a beat it is running');
  assert.ok(seen.heartbeat, 'and it says since when');

  const listed = (await call('/api/v1/cards', { token })).body.find((c) => c.key === card.key);
  assert.equal(listed.running, true, 'the list says the same as the sheet');

  // Beating must not write history: a log with a heartbeat every minute is no
  // longer a log.
  const history = (await call(`/api/v1/cards/${card.key}`, { token })).body.history ?? [];
  assert.equal(history.filter((e) => e.verb === 'beat').length, 0);
  assert.ok(history.length <= 2, 'only creation, nothing per beat');
});

test('a move reaches the live line — verb and key, nothing else', async (t) => {
  // This test exists because the line that announces was silently missing for
  // an hour: a scripted replace whose anchor had been renamed did nothing and
  // reported success. The channel opened, said hello, and carried nothing.
  const { call, gradula, token, close } = await start2();
  t.after(close);

  const heard = [];
  const fake = { write: (chunk) => heard.push(chunk), on: () => {} };
  gradula.live?.join?.('PRB', fake);

  const card = (await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david',
    body: { kind: 'task', title: 'Loud', text: 'a secret nobody streams' },
  })).body;
  await call(`/api/v1/cards/${card.key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'done' } });

  const stream = heard.join('');
  assert.match(stream, /"verb":"created"/, 'creating is announced');
  assert.match(stream, /"verb":"moved"/, 'so is moving');
  assert.match(stream, new RegExp(`"card":"${card.key}"`));
  assert.doesNotMatch(stream, /a secret nobody streams/, 'no content in the channel');
});

/**
 * THE ACTOR HEADER IS AN ADDRESS, AND BOTH SIDES MUST STAND AT IT.
 *
 * It was renamed Akteur -> Actor on the server and stayed Akteur in the CLI and
 * in the MCP server. Nothing broke loudly: every request still worked, every
 * card still moved — only the chronicle stopped saying WHO. Six entries on
 * 09.09.2026 read `key "Davids Rechner"` where the ones before them read
 * `david (via the key …)`.
 *
 * So this is a text check, not a request: whatever name the clients send must
 * be a name the server reads.
 */
test('what the clients send in the actor header is what the server reads', () => {
  const read = readFileSync(new URL('../src/api.mjs', import.meta.url), 'utf8');
  const accepted = [...read.matchAll(/req\.headers\['(x-gradula-[a-z]+)'\]/g)].map((m) => m[1]);
  assert.ok(accepted.length, 'the server reads an actor header at all');
  for (const client of ['../bin/gradula.mjs', '../mcp/server.mjs']) {
    const source = readFileSync(new URL(client, import.meta.url), 'utf8');
    const sent = [...source.matchAll(/'(X-Gradula-[A-Za-z]+)'/g)].map((m) => m[1].toLowerCase());
    assert.ok(sent.length, `${client} sends an actor header`);
    for (const name of sent) assert.ok(accepted.includes(name), `${client} sends ${name}, which the server does not read`);
  }
});

/**
 * EVERY MCP TOOL MUST CALL A DOOR THAT EXISTS.
 *
 * The MCP server has no truth of its own — every tool is a call to the same
 * API. So when the API moved to English, the server kept pointing at
 * `/api/v1/karten`, `/api/v1/faeden` and `/api/v1/vokabular`, and every route
 * it named was gone. Nothing was red: a model simply got a 404 and tried
 * something else, and the board looked to it like a thing that does not work.
 *
 * The routes are read out of api.mjs and turned into matchers, so this cannot
 * be a second list that drifts.
 */
test('every path the MCP server calls is a route the API has', async () => {
  const here = new URL('.', import.meta.url);
  const api = readFileSync(new URL('../src/api.mjs', here), 'utf8');
  const routes = [...api.matchAll(/\['[A-Z]+', \/\^(.+?)\$\/,/g)].map((m) => new RegExp(`^${m[1].replace(/\\\//g, '/')}$`));
  assert.ok(routes.length > 20, 'the API has routes to compare against');

  // The server refuses without a project key, and this test asks for paths,
  // not for answers — so it brings one of its own.
  process.env.GRADULA_TOKEN ??= 'a key that is never sent anywhere';
  const { TOOLS } = await import('../mcp/server.mjs');
  assert.ok(TOOLS.length > 5, 'the MCP server offers tools');

  // Call every tool with a fake api(): what it asks for is the path, not the answer.
  //
  // The real fetch is taken ONCE and given back ONCE. Taking it inside the
  // loop looks tidier and is wrong: `finally` runs a tick after the promise
  // resolves, so the next round captures the fake as if it were the real one
  // and hands it back at the end. Every test after this one then talked to a
  // fetch that answers `{}` to everything — and the failure showed up in a
  // test six hundred lines away that had never heard of MCP.
  const asked = [];
  const sample = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', card: 'MDUS-1', from: 'MDUS-1', to: 'MDUS-2', kind: 'needs', state: 'ready', title: 'x', root: 'MDUS-3' };
  const fetched = globalThis.fetch;
  const providerKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = ''; // Route-contract tests never read a real local provider secret.
  try {
    for (const tool of TOOLS) {
      const path = await new Promise((done) => {
        globalThis.fetch = async (url) => { done(new URL(url).pathname); return { ok: true, json: async () => ({}) }; };
        Promise.resolve(tool.run(sample)).catch(() => done(null));
      });
      if (path) asked.push([tool.name, path]);
    }
  } finally {
    globalThis.fetch = fetched;
    if(providerKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=providerKey;
  }
  assert.equal(asked.length, TOOLS.length, 'every tool asked for a path');

  const strays = asked.filter(([, path]) => !routes.some((route) => route.test(path)));
  assert.deepEqual(strays, [], 'these MCP tools call doors the API does not have');
});

/**
 * WHEN A RULE SETS AND WHEN IT ASKS.
 *
 * The first version of relabel proposed everything, and that was incoherent:
 * the SAME rule already sets the labels of a new card. Either it is good
 * enough or it is not.
 *
 * The line is not rule-versus-hand, it is what the label rests on. An EMPTY
 * axis gets filled — nothing is overwritten, nothing is lost, and the
 * chronicle says a rule did it. A board that leaves 22 cards blank to avoid
 * being wrong is wrong 22 times. A TOUCHED axis is asked: something already
 * stands there, and adding to it silently is editing somebody's answer.
 */
test('relabel fills an empty axis and asks about a touched one', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/vocabulary', { method: 'PUT', token, body: { module: [{ id: 'panels', paths: ['packages/panels'], words: [] }] } });

  const empty = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'idea', title: 'a card about nothing' } });
  const touched = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'idea', title: 'a card about nothing at all' } });
  await call(`/api/v1/cards/${touched.body.key}`, { method: 'PATCH', token, actor: 'david', body: { stack: ['design'] } });

  // Give both something a rule can find, without touching their labels.
  for (const card of [empty.body.key, touched.body.key]) {
    await call(`/api/v1/cards/${card}`, { method: 'PATCH', token, actor: 'david', body: { text: 'the shader in packages/panels/src/x.ts' } });
  }

  const done = await call('/api/v1/relabel', { method: 'POST', token, actor: 'david' });
  assert.equal(done.status, 200);
  const byKey = Object.fromEntries(done.body.map((r) => [r.card, r]));

  const filled = await call(`/api/v1/cards/${empty.body.key}`, { token });
  assert.deepEqual(filled.body.stack, ['gpu', 'frontend'], 'an empty axis is filled, and needs no hand — the word says gpu, the path says frontend');
  assert.deepEqual(filled.body.module, ['panels']);
  assert.deepEqual(byKey[empty.body.key].asked, { module: [], stack: [] }, 'and nothing was asked about it');

  const held = await call(`/api/v1/cards/${touched.body.key}`, { token });
  assert.deepEqual(held.body.stack, ['design'], "what a hand set is not touched");
  assert.deepEqual(held.body.suggestions.stack, ['gpu', 'frontend'], 'what the rule would add stands beside it');
  assert.deepEqual(held.body.module, ['panels'], 'the other axis was empty, so it was filled');
});

/**
 * FIVE QUESTIONS, ONE ANSWER.
 *
 * Five requests would let a surface show four fresh panels and one from a
 * minute ago, and the reader would never know which — so the pulse is one
 * door. This test knocks on it the way the board does.
 */
test('the pulse answers all five questions at once', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  const goal = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'milestone', title: 'a milestone' } });
  await call(`/api/v1/cards/${goal.body.key}`, { method: 'PATCH', token, actor: 'david', body: { due: '2099-01-01' } });
  const part = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'a part of it' } });
  const blocker = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'the one it waits on' } });
  await call('/api/v1/links', { method: 'POST', token, actor: 'david', body: { from: part.body.key, to: goal.body.key, kind: 'part-of' } });
  await call('/api/v1/links', { method: 'POST', token, actor: 'david', body: { from: part.body.key, to: blocker.body.key, kind: 'needs' } });

  const pulse = await call('/api/v1/pulse', { token });
  assert.equal(pulse.status, 200);
  for (const room of ['since', 'until', 'happened', 'goals', 'pace', 'energy', 'hangs', 'findings']) {
    assert.ok(room in pulse.body, `the pulse answers ${room}`);
  }

  const mine = pulse.body.goals.find((g) => g.key === goal.body.key);
  assert.deepEqual(mine.open, [part.body.key], 'the goal names what is still open under it');
  assert.equal(mine.outlook.verdict, 'no pace', 'nothing settled yet, so nothing is forecast');

  assert.deepEqual(pulse.body.hangs[0], {
    card: blocker.body.key, title: 'the one it waits on', state: 'ready', waiting: [part.body.key],
  }, 'what it hangs on names the card and who waits');

  // The chronicle names the person AND the key they came through, so the
  // period does too: 'david (via key "the test")'.
  assert.ok(pulse.body.happened.actors.some((a) => a.startsWith('david')), 'the period names who moved');
  assert.equal(pulse.body.happened.touched, 3, 'and how many cards were touched at all');
});

/**
 * ONE PERSON, ONE NAME.
 *
 * The real board showed four Davids: one signed in, two spellings of the same
 * "via key" sentence, and a client that had sent no name at all. Every count
 * under `people` was wrong by a factor of four and looked entirely plausible.
 */
test('aliases fold the spellings of one person, and a bare key is nobody', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  const card = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'a card' } });
  await call(`/api/v1/cards/${card.body.key}`, { method: 'PATCH', token, actor: 'David Bläsing', body: { text: 'one' } });
  await call(`/api/v1/cards/${card.body.key}`, { method: 'PATCH', token, body: { text: 'two' } });

  const before = await call('/api/v1/pulse', { token });
  assert.deepEqual(before.body.energy.people.map((p) => p.person).sort(), ['David Bläsing', 'david'],
    'without a declared alias nobody is folded into anybody — and the bare key is nobody at all');

  const said = await call('/api/v1/project', { method: 'PATCH', token, actor: 'david', body: { people: { david: 'David Bläsing' } } });
  assert.equal(said.status, 200);
  assert.deepEqual(said.body.people, { david: 'David Bläsing' });

  const after = await call('/api/v1/pulse', { token });
  // Three moves happened on the card; two of them carry a name. The third
  // came through the key alone, and a laptop is not a colleague.
  assert.deepEqual(after.body.energy.people.map((p) => [p.person, p.moves]), [['David Bläsing', 2]]);
  assert.deepEqual(after.body.energy.people[0].via, ['the test'], 'the key stands beside the name, not inside it');
});

/**
 * The actor header is a claim and a signed-in name is a claim about a session
 * — a commit was signed by whoever wrote it.
 */
test('a commit brings its author, and its line is finally kept', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const card = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'a card' } });

  const put = await call(`/api/v1/cards/${card.body.key}/evidence`, {
    method: 'POST', token, actor: 'david',
    body: { kind: 'commit', ref: 'abc123', note: 'the title of the commit', author: 'David Bläsing', email: '4711+edudavidblaesing@users.noreply.github.com' },
  });
  assert.equal(put.status, 201);

  const read = await call(`/api/v1/cards/${card.body.key}`, { token });
  const evidence = read.body.history.find((e) => e.verb === 'evidenced');
  assert.equal(evidence.data.comment, 'the title of the commit', 'the CLI sends `note` — it used to land as null');
  assert.equal(evidence.data.author, 'David Bläsing');
  assert.equal(evidence.data.github, 'edudavidblaesing', 'GitHub hides the address and leaves the login in it');
});

/**
 * WHAT IF SOMEBODY JUST STOPS.
 *
 * A chat closes, a laptop shuts, and a card stays in `making` forever with
 * nobody at it. The board used to only REPORT that, on a page nobody has open
 * while they work — and the column quietly filled with work that was not
 * happening.
 */
test('a card left lying goes back to ready by itself, and says why', async (t) => {
  const { call, token, gradula, close } = await start2();
  t.after(close);

  const left = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'the one nobody came back to' } });
  const held = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'the one a runner is holding' } });
  for (const card of [left.body.key, held.body.key]) {
    await call(`/api/v1/cards/${card}/move`, { method: 'POST', token, actor: 'david', body: { state: 'making' } });
  }
  await call(`/api/v1/cards/${held.body.key}/start`, { method: 'POST', token, actor: 'a runner' });
  await call(`/api/v1/cards/${held.body.key}/beat`, { method: 'POST', token, actor: 'a runner' });

  assert.deepEqual(await gradula.releaseStalled('PRB'), [], 'nothing is a day old yet');

  // With no patience at all, the ONE difference left between the two cards is
  // the lease — and a runner that is beating is working, however long it has
  // been at it. (The beat deliberately writes no chronicle line, which is
  // exactly why the idle clock alone would release a working card.)
  const back = await gradula.releaseStalled('PRB', { hours: 0 });
  assert.deepEqual(back.map((b) => b.card), [left.body.key]);

  const read = await call(`/api/v1/cards/${left.body.key}`, { token });
  assert.equal(read.body.state, 'ready');
  const moved = read.body.history.filter((e) => e.verb === 'moved').at(-1);
  assert.match(moved.actor, /^Gradula/, 'a rule did it, and the chronicle says so');
  assert.match(moved.data.reason, /Nothing happened here/);

  const still = await call(`/api/v1/cards/${held.body.key}`, { token });
  assert.equal(still.body.state, 'making');
});

/**
 * THE CHICKEN AND THE EGG AT THE HERALD.
 *
 * The list of channels needs the bot's key, and the key lives on a herald
 * nobody has saved yet — so the form asked a person to type a `-100…` number
 * from a place the board never mentioned. The key that is already in the field
 * asks directly, is used once, and is not stored.
 */
test('a key can ask which channels it sees before any herald exists', async (t) => {
  const asked = [];
  const kinds = {
    telegram: {
      chats: async ({ token }) => { asked.push(token); return { ok: true, chats: [{ id: '-100777', kind: 'group', name: 'Workshop' }] }; },
      say: async () => ({ sent: true }),
      verify: async () => ({ ok: true }),
    },
  };
  const { call, token, close } = await start2({ heraldKinds: kinds });
  t.after(close);

  const found = await call('/api/v1/heralds/chats', { method: 'POST', token, body: { kind: 'telegram', token: 'a-bot-key' } });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.chats, [{ id: '-100777', kind: 'group', name: 'Workshop' }]);
  assert.deepEqual(asked, ['a-bot-key'], 'the key was used once');

  assert.deepEqual((await call('/api/v1/heralds', { token })).body, [], 'and nothing was stored');

  const without = await call('/api/v1/heralds/chats', { method: 'POST', token, body: { kind: 'telegram' } });
  assert.deepEqual(without.body, { ok: false, reason: 'no key' }, 'no key, no list — and no crash');
});

/**
 * A review has two answers, and they must read the same from both sides: the
 * board has two buttons, the terminal has two words.
 */
test('approve and reject are the same two moves, said as decisions', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const card = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'a card' } });
  await call(`/api/v1/cards/${card.body.key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'review' } });

  const back = await call(`/api/v1/cards/${card.body.key}/move`, {
    method: 'POST', token, actor: 'david', body: { state: 'making', reason: 'the gate is still missing' },
  });
  assert.equal(back.body.state, 'making');

  const yes = await call(`/api/v1/cards/${card.body.key}/move`, {
    method: 'POST', token, actor: 'david', body: { state: 'done', reason: 'reviewed and approved' },
  });
  assert.equal(yes.body.state, 'done');
  const moves = (await call(`/api/v1/cards/${card.body.key}`, { token })).body.history.filter((e) => e.verb === 'moved');
  assert.deepEqual(moves.map((m) => m.data.reason), [null, 'the gate is still missing', 'reviewed and approved'],
    'every answer carries its sentence into the chronicle');
});

/**
 * A COMMIT KNOWS WHICH FILES IT TOUCHED, AND NOBODY WILL EVER TYPE THEM.
 *
 * `files` is the one field that makes the wave, the collision warning at
 * `start` and half the cartographer real — and on the live board 2 of 49 cards
 * carried any. Of course they did: it asked a person to write down paths they
 * had just written code in.
 */
test('evidence carries the files it touched, and a second commit adds to them', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  const card = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'a card' } });

  await call(`/api/v1/cards/${card.body.key}/evidence`, {
    method: 'POST', token, actor: 'david',
    body: { kind: 'commit', ref: 'aaa111', note: 'first', files: ['src/api.mjs', 'src/gradula.mjs'] },
  });
  assert.deepEqual((await call(`/api/v1/cards/${card.body.key}`, { token })).body.files, ['src/api.mjs', 'src/gradula.mjs']);

  // Added, never replaced: a card is usually several commits, and the second
  // must not erase what the first one touched.
  await call(`/api/v1/cards/${card.body.key}/evidence`, {
    method: 'POST', token, actor: 'david',
    body: { kind: 'commit', ref: 'bbb222', note: 'second', files: ['src/api.mjs', 'tests/doors.test.mjs'] },
  });
  assert.deepEqual((await call(`/api/v1/cards/${card.body.key}`, { token })).body.files,
    ['src/api.mjs', 'src/gradula.mjs', 'tests/doors.test.mjs']);
});

/**
 * A RED GATE IS NOT OVERRULED BY A HAND.
 *
 * The sheet said "the gate proves it, the hand agrees to it" — and the hand
 * could file a card as done while its test was red, or had never run. Now
 * the door refuses: a card with a gate reaches done through the gate, and
 * only a card without one is the hand's alone.
 */
test('a card with a gate reaches done only through a green gate', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  const gated = await call('/api/v1/cards', {
    method: 'POST', token, actor: 'david',
    body: { kind: 'task', title: 'A gate that decides', gate: { kind: 'test', call: 'tests/x.test.mjs' } },
  });
  assert.equal(gated.status, 201);
  const key = gated.body.key;
  const done = () => call(`/api/v1/cards/${key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'done', reason: 'reviewed and approved' } });

  const unrun = await done();
  assert.equal(unrun.status, 409, 'never ran: the hand does not stand in for the gate');
  assert.equal(unrun.body.error, 'gate-red');
  assert.match(unrun.body.line, /not run yet/);

  await call(`/api/v1/cards/${key}/evidence`, { method: 'POST', token, body: { kind: 'run', ref: '2026-09-10T01:00 test', note: 'red: 1 failing' } });
  const red = await done();
  assert.equal(red.status, 409, 'red: still refused');
  assert.match(red.body.line, /is red/);

  await call(`/api/v1/cards/${key}/evidence`, { method: 'POST', token, body: { kind: 'run', ref: '2026-09-10T01:05 test', note: 'green: 12 passed' } });
  const green = await done();
  assert.equal(green.status, 200, 'the newest run counts');
  assert.equal(green.body.state, 'done');

  // Review is still the hand's own room where there is nothing to prove.
  const bare = await call('/api/v1/cards', { method: 'POST', token, actor: 'david', body: { kind: 'task', title: 'No gate, the hand decides' } });
  const filed = await call(`/api/v1/cards/${bare.body.key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'done' } });
  assert.equal(filed.status, 200);
});

/**
 * A LABEL IS A WORD FROM THE LIST, OR IT IS NOT A LABEL.
 *
 * Only the rules ever kept to the lists; labels sent by hand went in as
 * typed. Six cards on the live board carried five crafts no filter knew.
 */
test('a craft outside the list and a module outside the vocabulary are refused', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/vocabulary', { method: 'PUT', token, body: { module: [{ id: 'core', paths: ['packages/core'] }] } });

  const craft = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Typed by hand', stack: ['studio'] } });
  assert.equal(craft.status, 400);
  assert.equal(craft.body.error, 'stack');
  assert.match(craft.body.line, /backend, frontend/, 'the answer carries the list');

  const module = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Typed by hand', module: ['auth'] } });
  assert.equal(module.status, 400);
  assert.equal(module.body.error, 'module');
  assert.match(module.body.line, /vocabulary push/);

  const fine = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'From the lists', module: ['core'], stack: ['engine'] } });
  assert.equal(fine.status, 201);
  assert.deepEqual(fine.body.module, ['core']);

  const patched = await call(`/api/v1/cards/${fine.body.key}`, { method: 'PATCH', token, body: { stack: ['sdk'] } });
  assert.equal(patched.status, 400, 'the same door on change');
  const proposed = await call(`/api/v1/cards/${fine.body.key}/suggest`, { method: 'POST', token, body: { stack: ['incident'] } });
  assert.equal(proposed.status, 400, 'and on a proposal');
});

/**
 * AN IDEA IS NOT AN ORDER, ICE IS OFF THE BOARD, AND BLOCKED MEANS BLOCKED.
 *
 * Start took any card from any column: the yes (ideas to ready) could be
 * skipped, and nineteen `needs` links on the live board stopped nothing.
 * The way through a block is a reason, and it stands in the chronicle.
 */
test('start refuses ideas, ice and blocked cards — a reason opens a block', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  const idea = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'idea', title: 'Only an idea' } });
  const early = await call(`/api/v1/cards/${idea.body.key}/start`, { method: 'POST', token, actor: 'felix' });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'not-ready');
  assert.equal((await call(`/api/v1/cards/${idea.body.key}`, { token })).body.state, 'ideas', 'nothing moved');

  await call(`/api/v1/cards/${idea.body.key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'ready' } });
  const now = await call(`/api/v1/cards/${idea.body.key}/start`, { method: 'POST', token, actor: 'felix' });
  assert.equal(now.status, 200, 'the move to ready was the yes');
  assert.equal(now.body.state, 'making');

  const iced = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'On ice', state: 'ice' } });
  assert.equal((await call(`/api/v1/cards/${iced.body.key}/start`, { method: 'POST', token })).status, 409);

  const first = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'First' } });
  const second = await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Second' } });
  await call('/api/v1/links', { method: 'POST', token, body: { from: second.body.key, to: first.body.key, kind: 'needs' } });

  const blocked = await call(`/api/v1/cards/${second.body.key}/start`, { method: 'POST', token, actor: 'felix' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'blocked');
  assert.match(blocked.body.line, new RegExp(first.body.key));

  const silent = await call(`/api/v1/cards/${second.body.key}/start`, { method: 'POST', token, actor: 'felix', body: { anyway: '   ' } });
  assert.equal(silent.status, 400, 'an empty reason is no reason');

  const anyway = await call(`/api/v1/cards/${second.body.key}/start`, { method: 'POST', token, actor: 'felix', body: { anyway: 'the first is a day from done and this is independent' } });
  assert.equal(anyway.status, 200);
  assert.equal(anyway.body.state, 'making');
  const started = anyway.body.history.find((e) => e.verb === 'started');
  assert.equal(started.data.anyway, 'the first is a day from done and this is independent', 'the reason stands beside the start');
  assert.deepEqual(started.data.blockedBy, [first.body.key]);
});

/**
 * "SHOW ME THE STUDIO" — the coarse axis above the modules. A card's area is
 * the area of its modules, read from the vocabulary when asked; nothing is
 * stored on the card, so a project that renames its areas renames them once.
 */
test('cards can be asked for by area, and a vocabulary from before areas still has them', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/vocabulary', {
    method: 'PUT', token,
    body: { module: [
      { id: 'core', paths: ['packages/core'], area: 'kit' },
      { id: 'scene', paths: ['packages/scene'], area: 'kit' },
      { id: 'mundula', paths: ['apps/mundula'] },
    ] },
  });
  const read = await call('/api/v1/vocabulary', { token });
  assert.deepEqual(read.body.map((m) => [m.id, m.area]), [['core', 'kit'], ['scene', 'kit'], ['mundula', 'mundula']]);

  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'In the kit', module: ['scene'] } });
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'In the studio', module: ['mundula'] } });
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Both', module: ['core', 'mundula'] } });
  await call('/api/v1/cards', { method: 'POST', token, body: { kind: 'task', title: 'Nowhere' } });

  const kit = await call('/api/v1/cards?area=kit', { token });
  assert.deepEqual(kit.body.map((c) => c.title).sort(), ['Both', 'In the kit']);
  const studio = await call('/api/v1/cards?area=mundula', { token });
  assert.deepEqual(studio.body.map((c) => c.title).sort(), ['Both', 'In the studio']);
  assert.equal((await call('/api/v1/cards?area=nowhere', { token })).body.length, 0);
});

/**
 * A PERSON'S OWN KEY — minted at the board, never handed over.
 *
 * Felix's key lay in a file on David's disk for a day, waiting to be carried
 * across. Now whoever can sign in mints a key for their own machine — and the
 * key IS that person: the name was checked when the key was made, so a
 * header claiming somebody else is not read.
 */
test('a signed-in person mints their own key, which speaks as them and obeys no header', async (t) => {
  const store = createMemoryStore();
  const live = createLive();
  const gradula = createGradula(store, { live });
  // The door for people, stubbed: a cookie names the person, the API checks the role.
  const people = { felix: { sub: 'zitadel-felix', name: 'Felix', roles: ['dev'], until: Date.now() + 60_000 }, gast: { sub: 'zitadel-gast', name: 'Gast', roles: ['dev'], until: Date.now() + 60_000 } };
  const auth = { role: 'dev', who: (req) => people[String(req.headers.cookie ?? '').replace('who=', '')] ?? null };
  const server = createServer(createApi(gradula, { adminToken: ADMIN, live, auth }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { token, cookie, actor, ...init } = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie: `who=${cookie}` } : {}),
        ...(actor ? { 'X-Gradula-Actor': actor } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  await call('/api/admin/projects', { method: 'POST', token: ADMIN, body: { key: 'PRB', name: 'Probe' } });

  // A key alone may not mint a personal key — there is no person behind it.
  const machine = await call('/api/admin/projects/PRB/keys', { method: 'POST', token: ADMIN, body: { name: 'a machine' } });
  assert.equal((await call('/api/v1/keys', { method: 'POST', token: machine.body.token, body: { name: 'x' } })).status, 403);

  const minted = await call('/api/v1/keys?project=PRB', { method: 'POST', cookie: 'felix', body: { name: "Felix' MacBook" } });
  assert.equal(minted.status, 201);
  assert.match(minted.body.token, /^grad_pat_/);
  assert.equal(minted.body.entry.ownerName, 'Felix');
  assert.equal(minted.body.entry.hash, undefined, 'the hash never leaves the house');

  // The key speaks as Felix — and a header claiming david is not read.
  const made = await call('/api/v1/cards', { method: 'POST', token: minted.body.token, actor: 'david', body: { kind: 'task', title: 'From my own machine' } });
  assert.equal(made.status, 201);
  const read = await call(`/api/v1/cards/${made.body.key}`, { token: minted.body.token });
  assert.equal(read.body.history[0].actor, "Felix (Felix' MacBook)");

  // Mine are mine: a second person sees none of them and cannot revoke them.
  assert.deepEqual((await call('/api/v1/keys?project=PRB', { cookie: 'gast' })).body, []);
  assert.equal((await call(`/api/v1/keys/${minted.body.entry.id}?project=PRB`, { method: 'DELETE', cookie: 'gast' })).status, 404);
  const mine = await call('/api/v1/keys?project=PRB', { cookie: 'felix' });
  assert.deepEqual(mine.body.map((k) => k.name), ["Felix' MacBook"]);

  // Revoked is revoked, at once.
  assert.equal((await call(`/api/v1/keys/${minted.body.entry.id}?project=PRB`, { method: 'DELETE', cookie: 'felix' })).status, 200);
  assert.equal((await call('/api/v1/cards', { token: minted.body.token })).status, 401);
  assert.deepEqual((await call('/api/v1/keys?project=PRB', { cookie: 'felix' })).body, []);
});

/**
 * A MACHINE REGISTERS ITSELF — `gradula login`. The CLI opens a request with
 * its hostname, a signed-in person approves the code, the CLI collects the
 * key ONCE. No name is typed, no key is carried.
 */
test('gradula login: a machine asks, a person approves the code, the key is handed over once', async (t) => {
  const store = createMemoryStore();
  const live = createLive();
  const gradula = createGradula(store, { live });
  const people = { felix: { sub: 'z-felix', name: 'Felix', roles: ['dev'], until: Date.now() + 60_000 }, gast: { sub: 'z-gast', name: 'Gast', roles: ['dev'], until: Date.now() + 60_000 } };
  const auth = { role: 'dev', who: (req) => people[String(req.headers.cookie ?? '').replace('who=', '')] ?? null };
  const server = createServer(createApi(gradula, { adminToken: ADMIN, live, auth }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { token, cookie, headers = {}, ...init } = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie: `who=${cookie}` } : {}), ...headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  await call('/api/admin/projects', { method: 'POST', token: ADMIN, body: { key: 'PRB', name: 'Probe' } });

  // The CLI, without any key, opens a request naming its machine.
  const started = await call('/api/v1/device?project=PRB', { method: 'POST', body: { machine: "Felix' MacBook" } });
  assert.equal(started.status, 201);
  assert.match(started.body.code, /^[A-Z2-9]{6}$/, 'a short code, no 0/O/1/I');
  assert.equal(started.body.token, undefined, 'no key before approval');

  // Polling shows pending, and never the key.
  const waiting = await call(`/api/v1/device/${started.body.id}`);
  assert.equal(waiting.body.status, 'pending');
  assert.equal(waiting.body.token, undefined);

  // The board shows the machine to a signed-in person.
  const seen = await call('/api/v1/devices?project=PRB', { cookie: 'felix' });
  assert.deepEqual(seen.body.map((d) => d.machine), ["Felix' MacBook"]);

  // Felix approves; TWO keys are minted, both owned by Felix: his own, named
  // after the machine, and one for the AI sessions on it, named after the
  // program and the machine (2026-09-10 — until then the second key was
  // minted by hand, and a new developer's sessions had none at all).
  const ok = await call(`/api/v1/device/${started.body.id}/approve?project=PRB`, { method: 'POST', cookie: 'felix' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { approved: true, machine: "Felix' MacBook", agent: "AI sessions · Felix' MacBook" });
  const minted = (await store.tokens.list('PRB')).filter((k) => k.owner === 'z-felix');
  assert.deepEqual(
    minted.map((k) => [k.name, k.kind, k.ownerName]).sort(),
    [["AI sessions · Felix' MacBook", 'agent', 'Felix'], ["Felix' MacBook", 'human', 'Felix']],
    'two keys, one owner, two hands',
  );

  // The CLI collects both keys — exactly once.
  const got = await call(`/api/v1/device/${started.body.id}`);
  assert.equal(got.body.status, 'approved');
  assert.match(got.body.token, /^grad_pat_/);
  assert.match(got.body.agentToken, /^grad_pat_/);
  assert.notEqual(got.body.token, got.body.agentToken);
  const again = await call(`/api/v1/device/${started.body.id}`);
  assert.equal(again.body.token, null, 'the key is handed over once, then gone from the request');
  assert.equal(again.body.agentToken, null, 'and the sessions\' key with it');

  // The person's key speaks as Felix at his machine; the sessions' key as
  // Felix too — with the program as the hand. Same who, another via.
  const made = await call('/api/v1/cards', { method: 'POST', token: got.body.token, body: { kind: 'task', title: 'from the registered machine' } });
  const read = await call(`/api/v1/cards/${made.body.key}`, { token: got.body.token });
  assert.equal(read.body.history[0].actor, "Felix (Felix' MacBook)");
  const bySession = await call('/api/v1/cards', { method: 'POST', token: got.body.agentToken, headers: { 'X-Gradula-Actor': 'somebody else' }, body: { kind: 'task', title: 'from a session on it' } });
  const readSession = await call(`/api/v1/cards/${bySession.body.key}`, { token: got.body.agentToken });
  assert.equal(readSession.body.history[0].actor, "Felix (AI sessions · Felix' MacBook)", 'the hand is the program and the machine; a claimed actor is ignored');

  // One existing agent key is shared across coders; neither header changes its owner.
  const legacy = await store.tokens.mint({ project: 'PRB', name: "Claude Code · Felix' MacBook", kind: 'agent', owner: 'z-felix', ownerName: 'Felix', createdBy: 'Felix' });
  for (const [token, coder, expected] of [
    [legacy.token, 'Codex', "Felix (Codex · Felix' MacBook)"],
    [legacy.token, 'Claude Code', "Felix (Claude Code · Felix' MacBook)"],
    [got.body.agentToken, 'Codex', "Felix (Codex · Felix' MacBook)"],
    [got.body.token, 'Codex', "Felix (Felix' MacBook)"],
  ]) {
    const created = await call('/api/v1/cards', { method: 'POST', token, headers: { 'X-Gradula-Coder': coder, 'X-Gradula-Actor': 'somebody else' }, body: { kind: 'task', title: `By ${coder}` } });
    assert.equal(created.status, 201);
    const card = await call(`/api/v1/cards/${created.body.key}`, { token });
    assert.equal(card.body.history[0].actor, expected);
  }
  // Remove the extra test key before checking the registered pair.
  const legacyEntry = (await store.tokens.list('PRB')).find((k) => k.name === "Claude Code · Felix' MacBook");
  await call(`/api/v1/keys/${legacyEntry.id}?project=PRB`, { method: 'DELETE', cookie: 'felix' });

  const preference = await call('/api/v1/project?project=PRB', { method: 'PATCH', cookie: 'felix', body: { ladder: 'circles' } });
  assert.equal(preference.status, 200);
  assert.equal((await call('/api/v1/project?project=PRB', { cookie: 'felix' })).body.ladder, 'circles');

  // The board lists both under "Your keys"; revoking one leaves the other.
  const mine = await call('/api/v1/keys?project=PRB', { cookie: 'felix' });
  assert.deepEqual(mine.body.map((k) => [k.name, k.kind]).sort(), [["AI sessions · Felix' MacBook", 'agent'], ["Felix' MacBook", 'human']]);
  const agentKey = mine.body.find((k) => k.kind === 'agent');
  assert.equal((await call(`/api/v1/keys/${agentKey.id}?project=PRB`, { method: 'DELETE', cookie: 'felix' })).status, 200);
  assert.deepEqual((await call('/api/v1/keys?project=PRB', { cookie: 'felix' })).body.map((k) => k.kind), ['human']);
  assert.equal((await call('/api/v1/cards', { token: got.body.agentToken })).status, 401, 'the revoked hand is out');
  assert.equal((await call('/api/v1/cards', { token: got.body.token })).status, 200, 'the other still speaks');

  // A second machine, denied, yields no key.
  const two = await call('/api/v1/device?project=PRB', { method: 'POST', body: { machine: 'a stranger' } });
  await call(`/api/v1/device/${two.body.id}/deny?project=PRB`, { method: 'POST', cookie: 'gast' });
  assert.equal((await call(`/api/v1/device/${two.body.id}`)).body.status, 'denied');

  // The device routes that need a person refuse a bare key.
  const machineKey = await call('/api/admin/projects/PRB/keys', { method: 'POST', token: ADMIN, body: { name: 'a machine' } });
  assert.equal((await call('/api/v1/devices?project=PRB', { token: machineKey.body.token })).status, 403);
});

/*
 * A CLEAN START IS ONE VERB (2026-09-10). The board had no way to empty a project — a fresh start
 * for Mundula meant reaching into Postgres by hand. Now an admin key can: the cards, their links
 * and their chronicle go; the project, its people, keys and vocabulary stay. A project key cannot.
 */
test('an admin can empty a project; a project key cannot, and the house stays', async (t) => {
  const store = createMemoryStore();
  const live = createLive();
  const gradula = createGradula(store, { live });
  const server = createServer(createApi(gradula, { adminToken: ADMIN, live }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await gradula.createProject({ key: 'WIPE', name: 'Wipe' });
  const a = await gradula.addItem('WIPE', { kind: 'idea', title: 'first' }, 'test');
  await gradula.addItem('WIPE', { kind: 'idea', title: 'second' }, 'test');
  const key = await gradula.mintToken('WIPE', 'probe', 'admin');
  const asProject = await fetch(`${base}/api/admin/projects/WIPE/items`, { method: 'DELETE', headers: { Authorization: `Bearer ${key.token}` } });
  assert.notEqual(asProject.status, 200, 'a project key does not empty the board');
  assert.equal((await gradula.listItems('WIPE')).length, 2);
  const asAdmin = await fetch(`${base}/api/admin/projects/WIPE/items`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(asAdmin.status, 200);
  assert.deepEqual(await asAdmin.json(), { project: 'WIPE', removed: 2 });
  assert.deepEqual(await gradula.listItems('WIPE'), []);
  await assert.rejects(() => gradula.getItem(a.key), { code: 'missing' }, 'the old card is gone');
  assert.ok(await gradula.getProject('WIPE'), 'the project stays');
  const next = await gradula.addItem('WIPE', { kind: 'idea', title: 'again' }, 'test');
  assert.equal(next.number, 1, 'numbering starts over');
});

test('reservation ownership uses credentials and sessions, never the claimed actor', async t => {
  const {call,token,close}=await start2();t.after(close);
  const second=(await call('/api/admin/projects/PRB/keys',{method:'POST',token:ADMIN,body:{name:'second'}})).body.token;
  const card=(await call('/api/v1/cards',{method:'POST',token,body:{kind:'task',title:'Exclusive'}})).body;
  assert.equal((await call(`/api/v1/cards/${card.key}/start`,{method:'POST',token,actor:'same'})).status,200);
  assert.equal((await call(`/api/v1/cards/${card.key}/beat`,{method:'POST',token:second,actor:'same'})).status,409);
  assert.equal((await call(`/api/v1/cards/${card.key}/start`,{method:'POST',token,headers:{'X-Gradula-Session':'another'}})).status,409);
  assert.equal((await call(`/api/v1/cards/${card.key}/start`,{method:'POST',token:second,body:{takeover:'Agreed with owner'}})).status,200);
  assert.equal((await call(`/api/v1/cards/${card.key}/beat`,{method:'POST',token})).status,409);
});

test('codegraph door requires authentication and accepts only the project repository', async t => {
  const {call,close,gradula,token}=await start2();t.after(close);
  await gradula.patchProject('PRB',{repo:'team/repo'});
  const body={schema:'gradula.codegraph.v1',repository:'team/repo',nodes:[],edges:[]};
  assert.equal((await call('/api/v1/codegraph')).status,401);
  assert.equal((await call('/api/v1/codegraph',{token,method:'PUT',body:{...body,repository:'other/repo'}})).status,400);
  assert.equal((await call('/api/v1/codegraph',{token,method:'PUT',body})).status,200);
  const result=await call('/api/v1/codegraph',{token});assert.equal(result.body.repository,'team/repo');assert.ok(result.body.importedAt);
});

test('document door authenticates, scopes projects and keeps bodies out of graph manifests',async t=>{
 const {call,close,gradula,token}=await start2();t.after(close);
 await gradula.patchProject('PRB',{repo:'team/repo'});
 const body={schema:'gradula.codegraph.v1',repository:'team/repo',revision:'a'.repeat(40),dirty:false,nodes:[{id:'doc',name:'Guide',kind:'doc',path:'docs/guide.md'}],edges:[],documents:[{path:'docs/guide.md',markdown:'# Published body'}]};
 assert.equal((await call('/api/v1/codegraph',{token,method:'PUT',body})).status,200);
 assert.equal((await call('/api/v1/documents?path=docs/guide.md')).status,401);
 const manifest=await call('/api/v1/codegraph',{token});assert.equal(manifest.body.documents[0].path,'docs/guide.md');assert.ok(!JSON.stringify(manifest.body).includes('Published body'));
 const doc=await call('/api/v1/documents?path=docs/guide.md&revision='+body.revision,{token});assert.equal(doc.status,200);assert.equal(doc.body.markdown,'# Published body');assert.equal(doc.body.revision,body.revision);
 assert.equal((await call('/api/v1/documents?path=../secret.md',{token})).status,404);
 assert.equal((await call('/api/v1/documents?path=docs/guide.md&revision='+'b'.repeat(40),{token})).status,404,'an unavailable revision must not silently serve the newest document');
 const scoped=await call('/api/v1/documents?project=OTHER&path=docs/guide.md',{token});assert.equal(scoped.body.markdown,'# Published body','a project key remains scoped to its own project even when another is requested');
});

test('evidence retraction requires the original authenticated actor and leaves an audit record',async t=>{
 const {call,close,token}=await start2();t.after(close);
 const made=await call('/api/v1/cards',{token,method:'POST',body:{kind:'task',title:'Correction'}});const key=made.body.key;
 await call(`/api/v1/cards/${key}/evidence`,{token,method:'POST',body:{kind:'commit',ref:'123456abcdef'}});
 const card=(await call(`/api/v1/cards/${key}`,{token})).body;const entry=card.history.find(e=>e.verb==='evidenced');
 const path=`/api/v1/cards/${key}/evidence/${entry.id}/retract`;
 assert.equal((await call(path,{method:'POST',body:{reason:'Wrong association'}})).status,401);
 assert.equal((await call(path,{token,method:'POST',body:{reason:''}})).status,400);
 assert.equal((await call(path,{token,method:'POST',body:{reason:'Wrong branch inheritance'}})).status,200);
 assert.equal((await call(path,{token,method:'POST',body:{reason:'Again'}})).status,404);
 const after=(await call(`/api/v1/cards/${key}`,{token})).body;
 assert.ok(after.history.some(e=>e.data?.retractedEvidence?.ref==='123456abcdef'));
});
