/**
 * The incidents. No network: the hook is knocked on with a real signature,
 * and the fetching gets a `fetch` that reproduces Sentry's answer — the shape
 * of the answer stands in the payload below, not in a claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';
import { createApi } from '../src/api.mjs';
import { issueToCard, issueOf, actionOf, environmentOf, readEnvironments, environmentsOf, takesEnvironment, signatureOk, publicConnection, BASE_EU } from '../src/sentry.mjs';

const ADMIN = 'verwaltung-secret';
const HOOK = 'the-integrations-hook-secret';

/** An issue as Sentry delivers it. */
const ISSUE = {
  id: '4512053257109584',
  shortId: 'MUNDULA-7',
  title: 'TypeError: Cannot read properties of undefined (reading Skin)',
  culprit: 'packages/panels/src/PanelFrame.tsx in PanelFrame',
  permalink: 'https://mundulabs-67.sentry.io/issues/4512053257109584/',
  level: 'error',
  count: '23',
  lastSeen: '2026-09-08T20:14:11Z',
  metadata: { type: 'TypeError', value: 'Cannot read properties of undefined', filename: 'packages/panels/src/PanelFrame.tsx', function: 'PanelFrame' },
};

const VOKABULAR = [{ id: 'panels', paths: ['packages/panels'], words: [] }];

/**
 * No network: whatever the service would ask Sentry on its own — the
 * environment of an issue whose hook did not say — gets this fetch, and a
 * test that wants an answer hands one in.
 */
async function start2({ fetchImpl = async () => { throw new Error('nobody may be asked'); } } = {}) {
  const store = createMemoryStore();
  const gradula = createGradula(store, { fetchImpl });
  const server = createServer(createApi(gradula, { adminToken: ADMIN }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, { token, actor, raw, ...init } = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body || raw ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(actor ? { 'X-Gradula-Actor': actor } : {}),
        ...init.headers,
      },
      body: raw ?? (init.body ? JSON.stringify(init.body) : undefined),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  await call('/api/admin/projects', { method: 'POST', token: ADMIN, body: { key: 'MDLA', name: 'Mundula' } });
  const key = await call('/api/admin/projects/MDLA/keys', { method: 'POST', token: ADMIN, body: { name: 'the test' } });
  const token = key.body.token;
  await call('/api/v1/vocabulary', { method: 'PUT', token, body: { module: VOKABULAR } });

  return { gradula, call, token, close: () => new Promise((done) => server.close(done)) };
}

test('an issue becomes a card — the module comes from the stack trace', () => {
  const card = issueToCard(ISSUE, { vocabulary: VOKABULAR });
  assert.equal(card.source, 'sentry');
  assert.equal(card.foreignId, 'sentry:4512053257109584');
  assert.equal(card.count, 23, 'Sentry sends the number as a string');
  assert.deepEqual(card.module, ['panels'], 'the path in the stack says where it belongs');
  assert.deepEqual(card.files, ['packages/panels/src/PanelFrame.tsx']);
  assert.equal(card.permalink, ISSUE.permalink);
  assert.match(card.title, /TypeError/);
});

test('both shapes of a payload are read', () => {
  assert.equal(issueOf({ action: 'created', data: { issue: ISSUE } })?.id, ISSUE.id);
  assert.equal(issueOf(ISSUE)?.id, ISSUE.id, "the old, flat shape of an alert");
  assert.equal(issueOf({ data: {} }), null);
});

test('a signature matches only the unchanged body', () => {
  const body = JSON.stringify({ data: { issue: ISSUE } });
  const good = createHmac('sha256', HOOK).update(body, 'utf8').digest('hex');
  assert.equal(signatureOk(body, HOOK, good), true);
  assert.equal(signatureOk(`${body} `, HOOK, good), false, 'one space more and nothing matches');
  assert.equal(signatureOk(body, 'anderes', good), false);
  assert.equal(signatureOk(body, HOOK, null), false);
  assert.equal(signatureOk(body, null, good), false, 'without a secret nothing matches');
});

test('secrets do not leave the service', () => {
  const shown = publicConnection({ org: 'mundulabs-67', project: 'mundula', base: BASE_EU, token: 'secret', hookSecret: 'also secret' });
  assert.equal(shown.token, 'set');
  assert.equal(shown.hookSecret, 'set');
  assert.equal(shown.org, 'mundulabs-67');
  assert.deepEqual(shown.environments, ['production', 'prod'], 'a connection that never said shows what counts, not a null');
  assert.deepEqual(shown.lanes, {});
});

/**
 * WHERE IT HAPPENED.
 *
 * The apps tag every event with an environment (prod, dev, local). A hook
 * carries it in one of a few places, depending on the kind of integration;
 * the reader has to know them all, and say `null` — not a guess — when
 * none of them speaks.
 */
test('the environment is read from every shape a hook has', () => {
  // An issue alert: the event says where.
  assert.equal(environmentOf({ action: 'triggered', data: { event: { event_id: 'e1', environment: 'dev', tags: [['level', 'error']] }, issue: ISSUE } }), 'dev');
  // The same, only in the event's tags (pairs).
  assert.equal(environmentOf({ data: { event: { event_id: 'e1', tags: [['environment', 'prod'], ['os', 'iOS']] } } }), 'prod');
  // The issue webhook (`{ action, data: { issue } }`): the issue's own field, or its tags.
  assert.equal(environmentOf({ action: 'created', data: { issue: { ...ISSUE, environment: 'local' } } }), 'local');
  assert.equal(environmentOf({ action: 'created', data: { issue: { ...ISSUE, tags: [{ key: 'environment', value: 'dev' }] } } }), 'dev');
  // The old flat alert, with its event.
  assert.equal(environmentOf({ ...ISSUE, event: { environment: 'prod' } }), 'prod');
  assert.equal(environmentOf({ ...ISSUE, event: { tags: { environment: 'dev' } } }), 'dev', 'tags as an object, the oldest shape');
  // A bare issue from a pull says nothing — and that is null, not production.
  assert.equal(environmentOf(ISSUE), null);
  assert.equal(environmentOf({ action: 'created', data: { issue: ISSUE } }), null);
  assert.equal(environmentOf({ data: { event: { environment: '   ' } } }), null, 'blank is nothing');
  assert.equal(environmentOf(null), null);
});

test('which environments become cards: what the connection says, or production', () => {
  assert.deepEqual(readEnvironments('prod,dev'), ['prod', 'dev'], 'the CLI sends a comma list');
  assert.deepEqual(readEnvironments(['prod', ' dev ', '']), ['prod', 'dev']);
  assert.equal(readEnvironments('all'), 'all');
  assert.equal(readEnvironments('prod,all'), 'all', 'all among names is all');
  assert.equal(readEnvironments(null), null, 'null goes back to the default');
  assert.equal(readEnvironments(undefined), undefined, 'not said keeps what was there');
  assert.deepEqual(environmentsOf({}), ['production', 'prod']);
  assert.deepEqual(environmentsOf({ environments: null }), ['production', 'prod']);
  assert.deepEqual(environmentsOf({ environments: ['dev'] }), ['dev']);
  assert.equal(environmentsOf({ environments: 'all' }), 'all');
  assert.equal(takesEnvironment({}, 'prod'), true);
  assert.equal(takesEnvironment({}, 'dev'), false);
  assert.equal(takesEnvironment({}, 'Production'), true, 'Sentry spells it as it likes');
  assert.equal(takesEnvironment({}, null), true, 'a crash nobody can place counts as production');
  assert.equal(takesEnvironment({ environments: 'all' }, 'local'), true);
  assert.equal(takesEnvironment({ environments: ['prod', 'dev'] }, 'dev'), true);
});

test('the hook accepts only what is signed', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);

  await call('/api/v1/sentry', {
    method: 'PUT', token,
    body: { org: 'mundulabs-67', project: 'mundula', base: BASE_EU, hookSecret: HOOK },
  });

  const body = JSON.stringify({ action: 'created', data: { issue: ISSUE } });
  const signature = createHmac('sha256', HOOK).update(body, 'utf8').digest('hex');

  const without = await call('/api/v1/sentry/hook/MDLA', { method: 'POST', raw: body });
  assert.equal(without.status, 401, 'without a signature, nothing');

  const falsch = await call('/api/v1/sentry/hook/MDLA', { method: 'POST', raw: body, headers: { 'sentry-hook-signature': 'a'.repeat(64) } });
  assert.equal(falsch.status, 401);

  const good = await call('/api/v1/sentry/hook/MDLA', { method: 'POST', raw: body, headers: { 'sentry-hook-signature': signature } });
  assert.equal(good.status, 200);
  assert.equal(good.body.fresh, true);
  assert.equal(good.body.card, 'MDLA-1');

  const card = await call('/api/v1/cards/MDLA-1', { token });
  assert.equal(card.body.source, 'sentry');
  assert.deepEqual(card.body.module, ['panels']);
  assert.equal(card.body.count, 23);
});

test('the same crash stays ONE card — and surfaces again when it comes back', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, hookSecret: HOOK } });

  const first = await gradula.ingestIssue('MDLA', ISSUE, 'probe');
  assert.equal(first.fresh, true);

  const again = await gradula.ingestIssue('MDLA', { ...ISSUE, count: '41', lastSeen: '2026-09-09T08:00:00Z' }, 'probe');
  assert.equal(again.fresh, false);
  assert.equal(again.card.key, 'MDLA-1', 'no second note');
  assert.equal(again.card.count, 41);

  const all = await call('/api/v1/cards', { token });
  assert.equal(all.body.length, 1);

  await call('/api/v1/cards/MDLA-1/move', { method: 'POST', token, body: { state: 'done' } });
  const back = await gradula.ingestIssue('MDLA', { ...ISSUE, count: '42' }, 'probe');
  assert.equal(back.resurfaced, true);
  assert.equal(back.card.state, 'ready');
  // A verb the house knows: a herald filters on verbs and the board reads
  // them, so a free string here is a line no filter has ever heard of.
  assert.equal(back.card.history.at(-1).verb, 'resurfaced');
});

test('fetching asks Sentry and creates what is missing', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'mundulabs-67', project: 'mundula', base: BASE_EU, token: 'sntrys_probe' } });

  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url, auth: init.headers.Authorization });
    return { ok: true, status: 200, json: async () => [ISSUE, { ...ISSUE, id: '999', title: 'Zweiter', metadata: {} }] };
  };

  const result = await gradula.pullSentry('MDLA', 'david', { fetchImpl });
  assert.deepEqual(result, { seen: 2, fresh: 2, again: 0 });
  assert.match(asked[0].url, /^https:\/\/de\.sentry\.io\/api\/0\/projects\/mundulabs-67\/mundula\/issues\/\?/);
  assert.match(asked[0].url, /query=is%3Aunresolved/);
  assert.equal(asked[0].auth, 'Bearer sntrys_probe');

  const again2 = await gradula.pullSentry('MDLA', 'david', { fetchImpl });
  assert.deepEqual(again2, { seen: 2, fresh: 0, again: 2 }, 'fetching twice lays nothing down twice');
});

test('no token means no fetching, and a wrong base is refused', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  await assert.rejects(() => gradula.pullSentry('MDLA'), /No Sentry token/);

  const wrong = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: 'http://evil.example/api/0' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'base');
});

test('setting it a second time does not take the hook its secret', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, hookSecret: HOOK, token: 'sntrys_x' } });
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'fresh', project: 'p', base: BASE_EU } });
  const raw = await gradula.getSentry('MDLA', { raw: true });
  assert.equal(raw.org, 'fresh');
  assert.equal(raw.hookSecret, HOOK, 'otherwise a form takes the hook its key');
  assert.equal(raw.token, 'sntrys_x');
});

test('writing back only when it is explicitly allowed', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_x' } });
  await gradula.ingestIssue('MDLA', ISSUE, 'probe');

  let angefasst = 0;
  const fetchImpl = async () => { angefasst += 1; return { ok: true, status: 200, json: async () => ({}) }; };

  const card = await gradula.getItem('MDLA-1');
  assert.equal(await gradula.closeInSentry(card, 'david', { fetchImpl }), null, 'without permission: nothing at all');
  assert.equal(angefasst, 0);

  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, writeBack: true } });
  assert.equal(await gradula.closeInSentry(card, 'david', { fetchImpl }), true);
  assert.equal(angefasst, 1);
});

test('a failure at Sentry does not hold the card up', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'x', writeBack: true } });
  await gradula.ingestIssue('MDLA', ISSUE, 'probe');
  const card = await gradula.getItem('MDLA-1');

  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'broken', json: async () => ({}) });
  assert.equal(await gradula.closeInSentry(card, 'david', { fetchImpl }), false);
  const history = (await gradula.getItem('MDLA-1')).history.at(-1);
  assert.equal(history.verb, 'Sentry did not answer', 'the failure stands in the chronicle, not in nothing');
});

test('what Sentry DID stands in the field action — and is read', () => {
  assert.equal(actionOf({ action: 'created' }), 'created');
  assert.equal(actionOf({ action: 'ignored' }), 'archived', "Sentry's older name for archived");
  assert.equal(actionOf({ action: 'RESOLVED' }), 'resolved');
  assert.equal(actionOf({}), null, 'the old, flat shape of an alert has no action');
});

test('resolved does not close the card, it puts it up for review', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE } }, 'probe');

  const resolved = await gradula.ingestIssue('MDLA', { action: 'resolved', data: { issue: ISSUE } }, 'probe');
  assert.equal(resolved.action, 'resolved');
  assert.equal(resolved.card.state, 'review', 'a person confirms, the machine does not');
  const line = resolved.card.history.at(-1);
  assert.equal(line.verb, 'moved', 'somebody moved it — in Sentry, but moved');
  assert.equal(line.data.reason, 'resolved in Sentry');
});

test('archived means ice, and a regression means open again', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE } }, 'probe');

  const path = await gradula.ingestIssue('MDLA', { action: 'archived', data: { issue: ISSUE } }, 'probe');
  assert.equal(path.card.state, 'ice');

  const rueckfall = await gradula.ingestIssue('MDLA', { action: 'unresolved', data: { issue: ISSUE } }, 'probe');
  assert.equal(rueckfall.resurfaced, true);
  assert.equal(rueckfall.card.state, 'ready');
});

test('news about a card that does not exist is not a note', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  const nothing = await gradula.ingestIssue('MDLA', { action: 'resolved', data: { issue: ISSUE } }, 'probe');
  assert.equal(nothing.ignored, true);
  assert.deepEqual((await call('/api/v1/cards', { token })).body, [], 'no noise');
});

/**
 * HOW BAD IT IS, IS A FIELD.
 *
 * It stood in the card's body as the line "Stufe: fatal" — readable, and
 * invisible to everything that is not a person with the sheet open. A card
 * carrying a fatal crash looked like every other card on the board.
 */
test('the level travels as a field, and only the ones Sentry sends', () => {
  assert.equal(issueToCard({ id: '1', title: 'x', level: 'fatal' }).level, 'fatal');
  assert.equal(issueToCard({ id: '1', title: 'x', level: 'warning' }).level, 'warning');
  assert.equal(issueToCard({ id: '1', title: 'x' }).level, null, 'no level is null, not a guess');
  assert.equal(issueToCard({ id: '1', title: 'x', level: 'katastrophal' }).level, null, 'an invented level is none');
  assert.match(issueToCard({ id: '1', title: 'x', level: 'fatal' }).text, /level: fatal/, 'and it still reads in the body');
});

/**
 * NOTHING NEW IS NOT NEWS.
 *
 * Sentry lists an issue until somebody resolves it THERE, and the board pulls
 * every quarter of an hour. Measured on the live board: GRD-44 and GRD-45 were
 * closed at 12:07 and stood open again at 12:09, with a chronicle line saying
 * the crash had come back — about events whose last one was five hours old.
 */
test('a pull does not reopen a closed card when nothing has happened since', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);

  const issue = {
    id: '77', shortId: 'GRADULA-7', title: 'TypeError: nope', culprit: 'POST /api/v1/cards',
    level: 'error', count: '9', lastSeen: '2026-09-09T06:43:00.000Z',
    permalink: 'https://mundulabs.sentry.io/issues/77/',
    metadata: { type: 'TypeError', value: 'nope' },
  };
  const put = await gradula.ingestIssue('MDLA', issue, 'sentry');
  assert.equal(put.fresh, true);
  const key = put.card.key;

  await call(`/api/v1/cards/${key}/move`, { method: 'POST', token, actor: 'david', body: { state: 'done', reason: 'fixed' } });
  assert.equal((await call(`/api/v1/cards/${key}`, { token })).body.state, 'done');

  // The same issue again, unchanged: Sentry has simply not been told.
  const again = await gradula.ingestIssue('MDLA', issue, 'sentry');
  assert.equal(again.unchanged, true, 'nothing happened, so nothing is said');
  assert.equal((await call(`/api/v1/cards/${key}`, { token })).body.state, 'done', 'and the card stays closed');

  // And now it really does come back.
  const back = await gradula.ingestIssue('MDLA', { ...issue, count: '10', lastSeen: '2026-09-09T18:00:00.000Z' }, 'sentry');
  assert.equal(back.resurfaced, true);
  const read = await call(`/api/v1/cards/${key}`, { token });
  assert.equal(read.body.state, 'ready', 'a crash that comes back is open again');
  assert.equal(read.body.history.at(-1).verb, 'resurfaced', 'and the verb is one the house knows');
});

/**
 * NOT EVERY INGEST HAS A CARD.
 *
 * `resolved` for something this board never took in is news about nothing.
 * The hook door read `result.card.key` regardless and answered 500 — and the
 * very first webhook that ever arrived hit exactly that (GRADULA-3, 12:18 on
 * the day the integration was set up). From Sentry's side a 500 looks like a
 * board that is down, so it retries into the same wall.
 */
test('the hook door survives news about a card this board never took in', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_probe', hookSecret: HOOK } });

  const payload = JSON.stringify({ action: 'resolved', data: { issue: { ...ISSUE, id: 'never-seen-here' } } });
  const answered = await call('/api/v1/sentry/hook/MDLA', {
    method: 'POST',
    raw: payload,
    headers: { 'sentry-hook-signature': createHmac('sha256', HOOK).update(payload, 'utf8').digest('hex') },
  });
  assert.equal(answered.status, 200, 'a 200 with nothing to report, not a 500');
  assert.equal(answered.body.card, null);
  assert.equal(answered.body.ignored, true);
});

/**
 * A DOOR FOR MDLA TAKES MDLA'S ISSUES.
 *
 * An internal Sentry integration is set up per ORGANISATION and carries
 * exactly one webhook URL — so every project in the organisation posts to the
 * same door, and the door names ONE board project in its path. Measured:
 * MDLA-48 on the Mundula board was GRADULA-3, a crash in the planning board
 * itself.
 */
test('a crash from another Sentry project is not made into a card here', async (t) => {
  const { call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', {
    method: 'PUT', token,
    body: { org: 'mundulabs', project: 'mundula', base: BASE_EU, token: 'sntrys_probe', hookSecret: HOOK },
  });

  const foreign = JSON.stringify({
    action: 'created',
    data: { issue: { ...ISSUE, id: 'from-elsewhere', project: { slug: 'gradula', name: 'Gradula' } } },
  });
  const turned = await call('/api/v1/sentry/hook/MDLA', {
    method: 'POST', raw: foreign,
    headers: { 'sentry-hook-signature': createHmac('sha256', HOOK).update(foreign, 'utf8').digest('hex') },
  });
  assert.equal(turned.status, 200, 'a 200, so Sentry does not retry into a wall');
  assert.equal(turned.body.card, null);
  assert.match(turned.body.reason, /not this project/);
  assert.deepEqual((await call('/api/v1/cards', { token })).body, [], 'and nothing was written');

  // The same door, its own project: taken in.
  const mine = JSON.stringify({
    action: 'created',
    data: { issue: { ...ISSUE, project: { slug: 'mundula', name: 'Mundula' } } },
  });
  const taken = await call('/api/v1/sentry/hook/MDLA', {
    method: 'POST', raw: mine,
    headers: { 'sentry-hook-signature': createHmac('sha256', HOOK).update(mine, 'utf8').digest('hex') },
  });
  assert.equal(taken.body.fresh, true);
  assert.equal(taken.body.card, 'MDLA-1');
});

/**
 * A DEV CRASH IS NOT AN INCIDENT ON THE BOARD.
 *
 * MDLA-79, 2026-09-10: a WatchdogTermination from a developer's own dev
 * build on his own phone, environment `dev`, taken in five times — an
 * incident card in Ready about a crash nobody in production ever saw. The
 * crash is real; the card is noise. So only the connection's environments
 * become cards, and production is the default.
 */
test('an issue from an environment the connection does not watch becomes no card and no note', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_x' } });

  const dev = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE, event: { environment: 'dev' } } }, 'probe');
  assert.equal(dev.ignored, true);
  assert.equal(dev.environment, 'dev');
  assert.match(dev.reason, /environment dev is not watched/);
  assert.equal(dev.card, undefined, 'no card');
  assert.deepEqual((await call('/api/v1/cards', { token })).body, [], 'and nothing was written');

  // The same crash from production: a card, as before.
  const prod = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE, event: { environment: 'prod' } } }, 'probe');
  assert.equal(prod.fresh, true);
  assert.equal(prod.card.key, 'MDLA-1');
});

test('with `all`, every environment becomes a card', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  const set = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: 'all' } });
  assert.equal(set.body.environments, 'all');
  const dev = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE, event: { environment: 'dev' } } }, 'probe');
  assert.equal(dev.fresh, true);
  const local = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: { ...ISSUE, id: '2' }, event: { environment: 'local' } } }, 'probe');
  assert.equal(local.fresh, true);
});

test('an environment nobody can place counts as production — a card', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  // No token: Sentry cannot be asked, so the environment stays unknown.
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  const unknown = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE } }, 'probe');
  assert.equal(unknown.fresh, true, 'a crash you cannot place is worse than a card you have to close');
  assert.equal(unknown.card.key, 'MDLA-1');
});

test('when the hook does not say, Sentry is asked once per issue — and the answer decides', async (t) => {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url: String(url), auth: init.headers.Authorization });
    const id = String(url).match(/issues\/([^/]+)\/events\/latest/)?.[1];
    return { ok: true, status: 200, json: async () => ({ eventID: 'e', environment: id === 'in-dev' ? 'dev' : 'prod' }), text: async () => '' };
  };
  const { gradula, call, token, close } = await start2({ fetchImpl });
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_x' } });

  const dev = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: { ...ISSUE, id: 'in-dev' } } }, 'probe');
  assert.equal(dev.ignored, true);
  assert.equal(dev.environment, 'dev');
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, /^https:\/\/de\.sentry\.io\/api\/0\/issues\/in-dev\/events\/latest\/$/);
  assert.equal(asked[0].auth, 'Bearer sntrys_x');

  // The same issue again: the answer is held, Sentry is not asked twice.
  await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: { ...ISSUE, id: 'in-dev' } } }, 'probe');
  assert.equal(asked.length, 1, 'once per issue id');

  const prod = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: { ...ISSUE, id: 'in-prod' } } }, 'probe');
  assert.equal(prod.fresh, true);
  assert.equal(asked.length, 2);
  assert.equal((await call('/api/v1/cards', { token })).body.length, 1, 'one card: the production one');

  // A Sentry that does not answer leaves the environment unknown — a card, and no answer is held.
  const down = await start2({ fetchImpl: async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }) });
  t.after(down.close);
  await down.call('/api/v1/sentry', { method: 'PUT', token: down.token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_x' } });
  const blind = await down.gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE } }, 'probe');
  assert.equal(blind.fresh, true, 'unknown is production');
});

test('a foreign hook on an existing card leaves one seen line and moves nothing', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, hookSecret: HOOK } });

  // The card exists — from production.
  const made = await gradula.ingestIssue('MDLA', { action: 'created', data: { issue: ISSUE, event: { environment: 'prod' } } }, 'probe');
  assert.equal(made.fresh, true);
  await call('/api/v1/cards/MDLA-1/move', { method: 'POST', token, body: { state: 'done', reason: 'fixed' } });

  // Then it happens again, on a developer's phone, with a higher count: one line, no move.
  const body = JSON.stringify({ action: 'created', data: { issue: { ...ISSUE, count: '30', lastSeen: '2026-09-10T09:00:00Z' }, event: { environment: 'dev' } } });
  const hooked = await call('/api/v1/sentry/hook/MDLA', { method: 'POST', raw: body, headers: { 'sentry-hook-signature': createHmac('sha256', HOOK).update(body, 'utf8').digest('hex') } });
  assert.equal(hooked.status, 200);
  assert.equal(hooked.body.ignored, true);
  assert.equal(hooked.body.card, 'MDLA-1', 'the door names the card the line landed on');

  const card = (await call('/api/v1/cards/MDLA-1', { token })).body;
  assert.equal(card.state, 'done', 'never resurrected, never moved');
  assert.equal(card.count, 23, "the counter is production's — the dev count does not touch it");
  const seen = card.history.filter((e) => e.verb === 'seen');
  assert.equal(seen.length, 1, 'exactly one line');
  assert.equal(seen[0].data.environment, 'dev');
  assert.equal(seen[0].data.count, 30);
  assert.equal((await call('/api/v1/cards', { token })).body.length, 1, 'and no second card');
});

test('a pull asks Sentry for the watched environments only — or for everything with `all`', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, token: 'sntrys_x' } });

  const asked = [];
  const fetchImpl = async (url) => { asked.push(new URL(String(url)).searchParams.getAll('environment')); return { ok: true, status: 200, json: async () => [ISSUE], text: async () => '[]' }; };
  const pulled = await gradula.pullSentry('MDLA', 'david', { fetchImpl });
  assert.deepEqual(pulled, { seen: 1, fresh: 1, again: 0 });
  assert.deepEqual(asked, [['production', 'prod']], 'the default: production, in both spellings — and no second call to place what Sentry already filtered');

  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: 'prod,dev' } });
  await gradula.pullSentry('MDLA', 'david', { fetchImpl });
  assert.deepEqual(asked.at(-1), ['prod', 'dev']);

  await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: 'all' } });
  await gradula.pullSentry('MDLA', 'david', { fetchImpl });
  assert.deepEqual(asked.at(-1), [], 'all means no filter');
});

test('the connection door sets, keeps and shows the environments', async (t) => {
  const { gradula, call, token, close } = await start2();
  t.after(close);
  const first = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  assert.deepEqual(first.body.environments, ['production', 'prod'], 'unset shows the default');
  assert.equal((await gradula.getSentry('MDLA', { raw: true })).environments, null, 'and is stored as not said');

  const set = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: ['prod', 'dev'], lanes: { production: 'prod', development: ['dev'] } } });
  assert.deepEqual(set.body.environments, ['prod', 'dev']);
  assert.deepEqual(set.body.lanes, { production: ['prod'], development: ['dev'] });

  const kept = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU } });
  assert.deepEqual(kept.body.environments, ['prod', 'dev'], 'not said keeps what was there');
  assert.deepEqual(kept.body.lanes, { production: ['prod'], development: ['dev'] });
  assert.deepEqual((await call('/api/v1/sentry', { token })).body.environments, ['prod', 'dev'], 'GET shows the same');

  const reset = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: null } });
  assert.deepEqual(reset.body.environments, ['production', 'prod'], 'null goes back to the default');

  // The lane map under its old name is still the lane map, not the list.
  const old = await call('/api/v1/sentry', { method: 'PUT', token, body: { org: 'o', project: 'p', base: BASE_EU, environments: { production: 'live' } } });
  assert.deepEqual(old.body.lanes, { production: ['live'] });
  assert.deepEqual(old.body.environments, ['production', 'prod'], 'and the list is untouched');
});
