/**
 * The system — one picture from every connection, in one shape, and a line
 * in `sources` for every piece that is not being seen. Everything here runs
 * against fake fetches: a test that needs four tokens is a test nobody runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { gatherSystem, emptySystem, boardPicture, changedParts, createSystemPoll, ENVIRONMENTS, sentryEnvironmentsOf } from '../src/system.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';
import { createLive } from '../src/live.mjs';
import { createApi } from '../src/api.mjs';

/** One fake for every door: answered by what the URL (or the GraphQL query) contains. */
const world = ({ deployments = {}, builds = [], updates = [], runs = [], releases = [], issues = [], commits = {}, compares = {} } = {}) => async (url, init = {}) => {
  const at = String(url);
  const json = (body, status = 200) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });
  if (at.includes('deployment.allByCompose')) {
    const compose = new URL(at).searchParams.get('composeId');
    return json(deployments[compose] ?? []);
  }
  // The branch listing answers by branch name; a compare by "base...head".
  if (at.includes('/commits?sha=')) return json(commits[new URL(at).searchParams.get('sha')] ?? [], commits[new URL(at).searchParams.get('sha')] ? 200 : 404);
  if (at.includes('/compare/')) {
    const pair = decodeURIComponent(at.split('/compare/')[1]);
    return compares[pair] ? json({ status: compares[pair] }) : json(null, 404);
  }
  if (at.includes('api.expo.dev')) {
    const asked = JSON.parse(init.body ?? '{}').query ?? '';
    if (asked.includes('updateChannels')) return json({ data: { app: { byFullName: { id: 'a', updateChannels: updates } } } });
    return json({ data: { app: { byFullName: { id: 'a', builds, submissions: [] } } } });
  }
  if (at.includes('/actions/runs')) return json({ workflow_runs: runs });
  if (at.includes('/releases')) return json(releases);
  if (at.includes('/issues/')) {
    // Asked per lane, Sentry answers with the issues OF that lane; an issue
    // may carry `environments` in this fake to say where it fires.
    const lanes = new URL(at).searchParams.getAll('environment');
    return json(lanes.length ? issues.filter((issue) => (issue.environments ?? []).some((e) => lanes.includes(e))) : issues);
  }
  return json(null, 404);
};

const CONNECTIONS = {
  dokploy: { base: 'https://dok.test/api', token: 't', composes: { production: 'c-prod', development: 'c-dev' } },
  eas: { token: 't', app: '@acc/slug' },
  github: { repo: 'acc/repo', token: 't' },
  sentry: { base: 'https://de.sentry.io/api/0', org: 'acc', project: 'slug', token: 't' },
};

test('the picture has every part, every source says ok, and each lane carries its own deployments', async () => {
  const fetchImpl = world({
    deployments: {
      'c-prod': [{ status: 'done', title: 'Ship it\n\nbody', createdAt: '2026-09-10T08:00:00Z', finishedAt: '2026-09-10T08:03:00Z', description: 'Ship it\n\nPlan: PRB-1\nHash: abcdef1234567890' }],
      'c-dev': [{ status: 'running', title: 'On its way', createdAt: '2026-09-10T09:00:00Z', description: 'On its way\n\nPlan: PRB-2' }],
    },
    commits: { main: [{ sha: 'abcdef1234567890abcdef1234567890abcdef12', commit: { message: 'Ship it\n\nPlan: PRB-1', committer: { date: '2026-09-10T07:50:00Z' } } }] },
    builds: [{ id: 'b1', status: 'FINISHED', platform: 'IOS', appVersion: '1.4.0', appBuildVersion: '31', completedAt: '2026-09-09T10:00:00Z', buildProfile: 'production', channel: 'production', gitCommitMessage: 'A build' }],
    updates: [{ name: 'production', updateBranches: [{ name: 'main', updates: [
      { id: 'u1', group: 'g1', message: 'Fix the knob', runtimeVersion: '1.4.0', platform: 'ios', createdAt: '2026-09-09T11:00:00Z' },
      { id: 'u2', group: 'g1', message: 'Fix the knob', runtimeVersion: '1.4.0', platform: 'android', createdAt: '2026-09-09T11:00:00Z' },
    ] }] }],
    runs: [{ name: 'gate', head_branch: 'main', status: 'completed', conclusion: 'success', updated_at: '2026-09-10T07:00:00Z', html_url: 'https://gh/run/1', head_sha: 'abcdef1234567890', display_title: 'Ship it' }],
    releases: [{ tag_name: 'mundula-v1.4.0', name: 'v1.4.0', published_at: '2026-09-09T12:00:00Z', html_url: 'https://gh/rel/1' }],
    issues: [
      { id: '9', title: 'TypeError in StageView', lastSeen: '2026-09-10T06:00:00Z', permalink: 'https://sentry/9', count: '400', level: 'error', stats: { '24h': [[1, 3], [2, 4]] }, environments: ['prod'] },
      { id: '10', title: 'Nowhere in particular', lastSeen: '2026-09-10T05:00:00Z', permalink: 'https://sentry/10', count: '2', stats: { '24h': [[1, 1]] } },
    ],
  });
  const doc = await gatherSystem({
    connections: CONNECTIONS,
    board: {
      history: [{ at: '2026-09-10T09:30:00Z', card: 'PRB-1', verb: 'moved', actor: 'david' }],
      cards: [{ key: 'PRB-1', title: 'A card', state: 'making', module: ['core'], stack: ['web'] }],
    },
    fetchImpl,
    now: () => new Date('2026-09-10T10:00:00Z').getTime(),
  });

  assert.equal(doc.at, '2026-09-10T10:00:00.000Z');
  assert.deepEqual(doc.sources, { dokploy: 'ok', eas: 'ok', github: 'ok', sentry: 'ok', board: 'ok' });
  assert.deepEqual(doc.environments.map((e) => e.id), ENVIRONMENTS);
  const [production, development] = doc.environments;
  assert.deepEqual(production.deployments, [{ status: 'live', title: 'Ship it', at: '2026-09-10T08:00:00Z', finishedAt: '2026-09-10T08:03:00Z', head: 'Ship it', commit: 'abcdef123456', carries: ['PRB-1'] }], 'one line, the hash from the description, and the cards the commit names');
  assert.deepEqual(development.deployments[0].carries, ['PRB-2'], 'a deployment on its way carries its cards too — that is what is deploying right now');
  assert.deepEqual(doc.deployed, { production: { sha: 'abcdef1234567890abcdef1234567890abcdef12', at: '2026-09-10T08:03:00Z', cards: ['PRB-1'] } }, 'the head found by its title on main; the lane on its way has no live head yet');
  assert.equal(production.standing.standing, 'live');
  assert.equal(development.standing.standing, 'deploying', 'the lanes do not borrow from each other');
  assert.deepEqual(doc.builds[0], { profile: 'production', channel: 'production', platform: 'ios', status: 'built', at: '2026-09-09T10:00:00Z', url: 'https://expo.dev/accounts/acc/projects/slug/builds/b1', version: '1.4.0 · 31', title: 'A build' });
  assert.deepEqual(doc.updates, [{ channel: 'production', at: '2026-09-09T11:00:00Z', message: 'Fix the knob', runtime: '1.4.0', branch: 'main', platforms: ['ios', 'android'] }], 'one publish, two platforms, one line');
  assert.deepEqual(doc.pipeline, [{ name: 'gate', branch: 'main', status: 'green', at: '2026-09-10T07:00:00Z', url: 'https://gh/run/1', commit: 'abcdef123456', title: 'Ship it' }]);
  assert.deepEqual(doc.releases, [{ tag: 'mundula-v1.4.0', at: '2026-09-09T12:00:00Z', url: 'https://gh/rel/1', name: 'v1.4.0' }]);
  assert.deepEqual(doc.errors, [
    { environment: 'production', count24h: 7, lastAt: '2026-09-10T06:00:00Z', title: 'TypeError in StageView', url: 'https://sentry/9', level: 'error' },
    { environment: null, count24h: 1, lastAt: '2026-09-10T05:00:00Z', title: 'Nowhere in particular', url: 'https://sentry/10' },
  ], 'the day count from the stats, not the lifetime count — per lane where Sentry names one, null where it does not');
  assert.deepEqual(doc.people, [{ actor: 'david', card: 'PRB-1', verb: 'moved', at: '2026-09-10T09:30:00Z', labels: ['core', 'web'] }]);
  assert.deepEqual(doc.cards, [{ key: 'PRB-1', title: 'A card', state: 'making', labels: ['core', 'web'], actor: 'david', deployed: { development: null, production: true }, evidence: 0 }], 'named by the head of production; development has no live head, so nobody knows — and no commit stands behind it yet');
});

test('the errors are asked per lane, under the names Sentry knows the lane by', async () => {
  const asked = [];
  const fetchImpl = async (url) => { asked.push(new URL(String(url)).searchParams.getAll('environment')); return { ok: true, status: 200, json: async () => [], text: async () => '[]' }; };
  await gatherSystem({ connections: { sentry: CONNECTIONS.sentry }, fetchImpl });
  assert.deepEqual(asked.sort(), [[], ['development', 'dev'], ['production', 'prod']], 'both lanes and the whole, the lane by its name and its short form');
  assert.deepEqual(sentryEnvironmentsOf({ environments: { production: 'live', development: ['dev', 'staging'] } }, 'production'), ['live']);
  assert.deepEqual(sentryEnvironmentsOf({ environments: { production: 'live' } }, 'development'), ['development', 'dev'], 'a lane the connection does not name keeps the default');
  // One issue firing in both lanes stands twice, once per lane, never as a guess.
  const both = world({ issues: [{ id: '1', title: 'Both', lastSeen: '2026-09-10T06:00:00Z', stats: { '24h': [[1, 2]] }, environments: ['prod', 'dev'] }] });
  const doc = await gatherSystem({ connections: { sentry: CONNECTIONS.sentry }, fetchImpl: both });
  assert.deepEqual(doc.errors.map((e) => e.environment), ['production', 'development']);
});

test('a connection that is not set up yields an empty list AND says so', async () => {
  const doc = await gatherSystem({ connections: {}, fetchImpl: async () => { throw new Error('nobody may be asked'); } });
  const bare = emptySystem(doc.at);
  assert.deepEqual(doc, bare, 'nothing was asked, nothing was invented');
  assert.deepEqual(doc.sources, { dokploy: 'not configured', eas: 'not configured', github: 'not configured', sentry: 'not configured', board: 'ok' });
  for (const environment of doc.environments) assert.equal(environment.standing.standing, 'unknown');

  // A Dokploy key without a single compose is not a watched lane either.
  const half = await gatherSystem({ connections: { dokploy: { base: 'https://d/api', token: 't' } }, fetchImpl: async () => { throw new Error('no'); } });
  assert.equal(half.sources.dokploy, 'not configured');
});

test('a connection that is down costs its own list and a line in sources, never the document', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/issues/')) return { ok: false, status: 502, text: async () => 'bad gateway' };
    throw new Error('ECONNREFUSED');
  };
  const doc = await gatherSystem({ connections: CONNECTIONS, fetchImpl });
  assert.match(doc.sources.dokploy, /^error: ECONNREFUSED/);
  assert.match(doc.sources.eas, /^error: /);
  assert.match(doc.sources.github, /^error: /);
  assert.match(doc.sources.sentry, /^error: Sentry answers 502/);
  assert.deepEqual(doc.builds, []);
  assert.deepEqual(doc.errors, []);
  assert.equal(doc.environments[0].standing.standing, 'unknown');
});

test('the board half: who moved what in the last day, and what is in hand', () => {
  const now = new Date('2026-09-10T10:00:00Z').getTime();
  const picture = boardPicture({
    now,
    history: [
      { at: '2026-09-10T09:00:00Z', card: 'P-2', verb: 'moved', actor: 'anna' },
      { at: '2026-09-08T09:00:00Z', card: 'P-1', verb: 'moved', actor: 'david' },
      { at: '2026-09-07T09:00:00Z', card: 'P-3', verb: 'created', actor: 'bot' },
    ],
    cards: [
      { key: 'P-1', title: 'old', state: 'making', module: ['core'] },
      { key: 'P-2', title: 'new', state: 'review', stack: ['web'] },
      { key: 'P-3', title: 'done', state: 'done' },
    ],
  });
  assert.deepEqual(picture.people.map((p) => p.card), ['P-2'], 'two days ago is not the last day');
  assert.deepEqual(picture.cards.map((c) => `${c.key}:${c.actor}`), ['P-1:david', 'P-2:anna'], 'the last hand on each, whenever it moved');
  assert.deepEqual(picture.cards[0].deployed, { development: null, production: null }, 'this half asks nobody — where a card is stays unknown here');

  // Done within the week stays in the picture: that is what is on its way
  // to a lane. Done earlier is out.
  const week = boardPicture({ now, cards: [
    { key: 'P-4', title: 'fresh', state: 'done', changed: '2026-09-08T10:00:00Z' },
    { key: 'P-5', title: 'stale', state: 'done', changed: '2026-08-20T10:00:00Z' },
  ] });
  assert.deepEqual(week.cards.map((c) => c.key), ['P-4']);
});

test('changedParts names the parts that differ, never the clock', () => {
  const a = emptySystem('2026-09-10T10:00:00Z');
  const b = { ...emptySystem('2026-09-10T10:00:30Z'), builds: [{ platform: 'ios' }] };
  assert.deepEqual(changedParts(a, b), ['builds']);
  assert.deepEqual(changedParts(a, emptySystem('2026-09-10T11:00:00Z')), []);
  assert.ok(changedParts(null, b).includes('environments'), 'against nothing, everything is new');
});

/** The whole road: a project with stubbed connections, the door, the cache, the line. */
async function start() {
  const store = createMemoryStore();
  const poll = { current: null };
  const live = createLive({ onPresence: (key, count) => poll.current?.presence(key, count) });
  const gradula = createGradula(store, { live });
  const server = createServer(createApi(gradula, { adminToken: 'admin', live }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { token, ...init } = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  await call('/api/admin/projects', { method: 'POST', token: 'admin', body: { key: 'PRB', name: 'Probe' } });
  const key = await call('/api/admin/projects/PRB/keys', { method: 'POST', token: 'admin', body: { name: 'the test' } });
  return { store, live, gradula, poll, base, call, token: key.body.token, close: () => new Promise((done) => server.close(done)) };
}

test('GET /api/v1/system answers one picture through the project key, and holds it for half a minute', async (t) => {
  const { call, token, gradula, close } = await start();
  t.after(close);
  assert.equal((await call('/api/v1/system')).status, 401, 'no key, no picture');

  const first = await call('/api/v1/system', { token });
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ['at', 'builds', 'cards', 'deployed', 'environments', 'errors', 'people', 'pipeline', 'releases', 'sources', 'updates']);
  assert.equal(first.body.sources.dokploy, 'not configured');

  // The verb itself, with the clock in hand: a second ask within the
  // period is the same document; after it, a new one.
  let clock = 1_000_000;
  let asked = 0;
  const fetchImpl = async () => { asked += 1; return { status: 200, ok: true, json: async () => [] }; };
  await gradula.setDokploy('PRB', { base: 'https://dok.test/api', token: 't', composes: { production: 'c-prod' } });
  const a = await gradula.system('PRB', { fetchImpl, now: () => clock, fresh: true });
  assert.deepEqual(a.cards, []);
  // A card moves in between: the board's half is ours and is read anew on
  // every ask — the connections are not asked again within the period.
  const card = await gradula.addItem('PRB', { title: 'In hand', kind: 'task' }, 'david');
  await gradula.moveItem(card.key, 'ready', 'david');
  await gradula.startItem(card.key, 'david');
  const b = await gradula.system('PRB', { fetchImpl, now: () => clock + 10_000 });
  assert.equal(asked, 1, 'two askers, one gather');
  assert.equal(b.at, a.at, 'the fetched picture is the held one');
  assert.deepEqual(b.environments, a.environments);
  assert.deepEqual(b.cards.map((c) => `${c.key}:${c.state}:${c.actor}`), [`${card.key}:making:david`], 'the card that moved a second ago is in the picture');
  await gradula.system('PRB', { fetchImpl, now: () => clock + 31_000 });
  assert.equal(asked, 2, 'after the period, a fresh one');
});

test('the live line announces a changed picture — and polls only while somebody listens', async (t) => {
  const { live, gradula, poll, base, token, close } = await start();
  t.after(close);

  // The connection answers whatever the test holds in `deployments`.
  let deployments = [];
  await gradula.setDokploy('PRB', { base: 'https://dok.test/api', token: 't', composes: { production: 'c-prod' } });
  const original = gradula.system.bind(gradula);
  gradula.system = (key, opts = {}) => original(key, { ...opts, fetchImpl: async () => ({ status: 200, ok: true, json: async () => deployments }) });
  poll.current = createSystemPoll({ gradula, live, everyMs: 60_000, log: { warn: () => {} } });
  t.after(() => poll.current.stop());

  assert.deepEqual(poll.current.polling(), [], 'nobody listens, nobody polls');

  const controller = new AbortController();
  const res = await fetch(`${base}/api/v1/live`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = async (pattern) => {
    while (!pattern.test(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
  };
  await until(/event: hello/);
  // The first listener started the beat, and the first tick is the baseline.
  for (let i = 0; i < 50 && !poll.current.polling().length; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(poll.current.polling(), ['PRB'], 'the first listener starts the beat');
  await poll.current.tick('PRB');
  assert.doesNotMatch(seen, /event: system/, 'the baseline is not an announcement');

  deployments = [{ status: 'done', title: 'Ship it', createdAt: '2026-09-10T08:00:00Z' }];
  await poll.current.tick('PRB');
  await until(/event: system/);
  const said = JSON.parse(seen.match(/event: system\ndata: (.*)\n/)[1]);
  assert.deepEqual(said.changed, ['environments', 'deployed'], 'what changed, and nothing of the content');
  assert.doesNotMatch(seen, /Ship it/, 'the line carries no content — the door does');
  assert.ok(said.at);

  // The same picture again: silence.
  const before = seen.length;
  await poll.current.tick('PRB');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.length, before, 'no change, no announcement');

  controller.abort();
  for (let i = 0; i < 50 && poll.current.polling().length; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(poll.current.polling(), [], 'the last listener stops the beat');
});
