/**
 * Deployed — a card knows where it is, a deployment knows what it carries.
 * Everything here runs against a stubbed fetch: the GitHub calls are
 * counted, never made.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  carriesOf, candidatesOf, evidenceOf, deployedOf, foreignIdOf, branchOf,
  createDeployedCache, resolveDeployedSha, contained, gatherDeployed, BUDGET,
} from '../src/deployed.mjs';
import { gatherSystem } from '../src/system.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';

const json = (body, status = 200) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

/**
 * A GitHub that answers what the test holds: `commits` per branch,
 * `compares` per "base...head" — and counts every ask.
 */
const hub = ({ commits = {}, compares = {}, deployments = {} } = {}) => {
  const asked = [];
  const fetchImpl = async (url) => {
    const at = String(url);
    asked.push(at);
    if (at.includes('deployment.allByCompose')) return json(deployments[new URL(at).searchParams.get('composeId')] ?? []);
    if (at.includes('/commits?sha=')) {
      const branch = new URL(at).searchParams.get('sha');
      return commits[branch] ? json(commits[branch]) : json(null, 404);
    }
    if (at.includes('/compare/')) {
      const pair = decodeURIComponent(at.split('/compare/')[1]);
      return compares[pair] ? json({ status: compares[pair] }) : json(null, 404);
    }
    if (at.includes('/actions/runs')) return json({ workflow_runs: [] });
    if (at.includes('/releases')) return json([]);
    return json(null, 404);
  };
  // The calls the join costs — the pipeline and the releases are the picture's own.
  return { fetchImpl, asked, github: () => asked.filter((u) => u.includes('/commits?sha=') || u.includes('/compare/')).length };
};

const commit = (sha, title, at = '2026-09-10T08:00:00Z') => ({ sha, commit: { message: `${title}\n\nPlan: X-1`, committer: { date: at } } });
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('the description names the cards it carries: one Plan line each, once, in order', () => {
  assert.deepEqual(carriesOf('Ship it\n\nPlan: MDLA-3\nsome words\nPlan: MDLA-12\nPlan: MDLA-3\n'), ['MDLA-3', 'MDLA-12']);
  assert.deepEqual(carriesOf('Ship it\n\n  Plan: GRD-7  \n'), ['GRD-7'], 'whitespace around the line is nothing');
  assert.deepEqual(carriesOf('Plan: MDLA-3 and more'), [], 'the line is the key and nothing else — the bracket gradula sync reads');
  assert.deepEqual(carriesOf('Plan:MDLA-3'), ['MDLA-3']);
  assert.deepEqual(carriesOf(null), []);
  assert.deepEqual(carriesOf('nothing named'), []);
});

test('the deployed sha is found by the title on the branch, newest first, and the listing is held a minute', async () => {
  const world = hub({ commits: { main: [commit(HEAD, 'Ship it'), commit(OLD, 'Ship it', '2026-09-01T08:00:00Z'), commit('c'.repeat(40), 'Before')] } });
  const cache = createDeployedCache();
  const ask = (title, now) => resolveDeployedSha({ repo: 'acc/repo', token: 't', branch: 'main', title }, { fetchImpl: world.fetchImpl, cache, now });

  const found = await ask('Ship it\n\nthe body', 1_000);
  assert.deepEqual(found, { sha: HEAD, at: '2026-09-10T08:00:00Z' }, 'the first line, and the newest of two commits with the same title');
  assert.equal(world.github(), 1);

  const again = await ask('Before', 30_000);
  assert.equal(again.sha, 'c'.repeat(40));
  assert.equal(world.github(), 1, 'within the minute the listing is not asked again');

  const miss = await ask('Never built', 40_000);
  assert.equal(miss.sha, null);
  assert.match(miss.reason, /no commit on main is titled "Never built"/);

  await ask('Before', 61_000);
  assert.equal(world.github(), 2, 'after the minute, a fresh listing');

  const none = await ask('', 70_000);
  assert.equal(none.sha, null, 'a deployment without a head line names no commit');
  assert.equal(world.github(), 2, 'and costs nothing');

  assert.equal(branchOf({ repo: 'a/b' }, 'production'), 'main');
  assert.equal(branchOf({ repo: 'a/b' }, 'development'), 'dev');
  assert.equal(branchOf({ repo: 'a/b', branches: { development: 'develop' } }, 'development'), 'develop', 'a connection may name its branches');
});

test('contained: behind and identical mean yes, ahead and diverged mean no — and the answer is kept forever', async () => {
  const world = hub({ compares: { [`${HEAD}...${OLD}`]: 'behind', [`${HEAD}...${HEAD}`]: 'identical', [`${HEAD}...d1`]: 'ahead', [`${HEAD}...d2`]: 'diverged' } });
  const cache = createDeployedCache();
  const ask = (evidenceSha) => contained({ repo: 'acc/repo', token: 't', deployedSha: HEAD, evidenceSha }, { fetchImpl: world.fetchImpl, cache });
  assert.equal(await ask(OLD), true);
  assert.equal(await ask(HEAD), true);
  assert.equal(await ask('d1'), false);
  assert.equal(await ask('d2'), false);
  assert.equal(await ask('gone'), null, 'a compare GitHub cannot answer is unknown, not false');
  assert.equal(world.github(), 5);
  assert.equal(await ask(OLD), true);
  assert.equal(await ask('d2'), false);
  assert.equal(world.github(), 5, 'between two fixed commits the answer never changes — asked once');
  assert.equal(await ask('gone'), null);
  assert.equal(world.github(), 6, 'an unanswered compare is not kept — it may be answered next time');
});

test('the chronicle folds to evidence per card and to where a card was seen', () => {
  const evidence = evidenceOf([
    { verb: 'evidenced', card: 'P-1', data: { kind: 'commit', ref: 'a1' }, at: '2026-09-09T10:00:00Z' },
    { verb: 'evidenced', card: 'P-1', data: { kind: 'commit', ref: 'a2' }, at: '2026-09-10T10:00:00Z' },
    { verb: 'evidenced', card: 'P-1', data: { kind: 'run', ref: 'https://gh/run/1' }, at: '2026-09-10T11:00:00Z' },
    { verb: 'moved', card: 'P-2', data: { from: 'ready', to: 'making' }, at: '2026-09-10T11:00:00Z' },
    { verb: 'evidenced', card: null, data: { kind: 'commit', ref: 'zz' }, at: '2026-09-10T11:00:00Z' },
  ]);
  assert.deepEqual([...evidence.keys()], ['P-1'], 'commits only — a run is evidence, not a sha');
  assert.deepEqual(evidence.get('P-1').map((e) => e.sha), ['a2', 'a1'], 'newest first');

  assert.deepEqual(deployedOf([]), { development: false, production: false, at: { development: null, production: null } });
  assert.deepEqual(deployedOf([
    { verb: 'deployed', data: { environment: 'development', sha: 'a', at: '2026-09-10T10:41:00Z' }, at: '2026-09-10T10:42:00Z' },
    { verb: 'deployed', data: { environment: 'development', sha: 'b', at: '2026-09-10T12:00:00Z' }, at: '2026-09-10T12:01:00Z' },
    { verb: 'deployed', data: { environment: 'staging', sha: 'b', at: '2026-09-10T12:00:00Z' } },
  ]), { development: true, production: false, at: { development: '2026-09-10T12:00:00Z', production: null } }, 'the last note per lane; a lane the board does not have is nobody\'s');

  assert.equal(foreignIdOf('production', 'MDLA-3', HEAD), `dokploy:production:MDLA-3:${HEAD}`);

  const now = new Date('2026-09-10T10:00:00Z').getTime();
  const picked = candidatesOf([
    { key: 'P-1', state: 'making', changed: '2026-09-01T00:00:00Z' },
    { key: 'P-2', state: 'done', changed: '2026-09-09T00:00:00Z' },
    { key: 'P-3', state: 'done', changed: '2026-08-01T00:00:00Z' },
    { key: 'P-4', state: 'review', changed: '2026-09-10T00:00:00Z' },
    { key: 'P-5', state: 'ready', changed: '2026-09-10T00:00:00Z' },
    { key: 'P-6', state: 'done' },
  ], { now });
  assert.deepEqual(picked.map((c) => c.key), ['P-4', 'P-2', 'P-1'], 'making, review and done within the week — newest change first; ready and old done are out');
});

test('the join: named by the head or contained in it → deployed; ahead → not; without a token → unknown', async () => {
  const world = hub({
    commits: {
      main: [commit(HEAD, 'Ship it')],
      dev: [commit('d'.repeat(40), 'Later')],
    },
    compares: {
      [`${HEAD}...e1`]: 'behind', [`${HEAD}...e2`]: 'ahead', [`${HEAD}...e3`]: 'identical', [`${HEAD}...e4`]: 'behind',
      [`${'d'.repeat(40)}...e1`]: 'behind', [`${'d'.repeat(40)}...e2`]: 'behind', [`${'d'.repeat(40)}...e3`]: 'behind', [`${'d'.repeat(40)}...e4`]: 'diverged',
    },
  });
  const environments = [
    { id: 'production', deployments: [
      { status: 'deploying', title: 'Next', head: 'Next', carries: ['P-9'], at: '2026-09-10T09:30:00Z' },
      { status: 'live', title: 'Ship it', head: 'Ship it', carries: ['P-5', 'OTHER-1'], at: '2026-09-10T08:00:00Z', finishedAt: '2026-09-10T08:03:00Z' },
    ] },
    { id: 'development', deployments: [{ status: 'live', title: 'Later', head: 'Later', carries: [], at: '2026-09-10T09:00:00Z' }] },
  ];
  const cards = [
    { key: 'P-1', state: 'review', changed: '2026-09-10T00:00:00Z' },
    { key: 'P-2', state: 'making', changed: '2026-09-09T00:00:00Z' },
    { key: 'P-3', state: 'done', changed: '2026-09-08T00:00:00Z' },
    { key: 'P-4', state: 'making', changed: '2026-09-07T00:00:00Z' },
    { key: 'P-5', state: 'done', changed: '2026-08-01T00:00:00Z' },
    { key: 'P-6', state: 'making', changed: '2026-09-06T00:00:00Z' },
    { key: 'P-9', state: 'review', changed: '2026-09-10T01:00:00Z' },
  ];
  const evidence = new Map([
    ['P-1', [{ sha: 'e1' }]],
    ['P-2', [{ sha: 'e2' }]],
    ['P-3', [{ sha: 'e3' }]],
    ['P-4', [{ sha: 'e4' }, { sha: 'e1' }]],
  ]);
  const now = new Date('2026-09-10T10:00:00Z').getTime();

  const joined = await gatherDeployed({ github: { repo: 'acc/repo', token: 't' }, environments, cards, evidence, fetchImpl: world.fetchImpl, cache: createDeployedCache(), now });
  assert.deepEqual(joined.deployed, {
    production: { sha: HEAD, at: '2026-09-10T08:03:00Z', cards: ['P-5', 'P-1', 'P-3', 'P-4'] },
    development: { sha: 'd'.repeat(40), at: '2026-09-10T09:00:00Z', cards: ['P-1', 'P-2', 'P-3'] },
  }, 'the newest FINISHED head per lane; the one still deploying is not what runs — and a key the board does not know is not a card');
  assert.deepEqual(joined.cards.get('P-1'), { development: true, production: true });
  assert.deepEqual(joined.cards.get('P-2'), { development: true, production: false }, 'ahead of production, behind dev');
  assert.deepEqual(joined.cards.get('P-3'), { development: true, production: true }, 'identical is contained');
  assert.deepEqual(joined.cards.get('P-4'), { development: false, production: true }, 'EVERY commit must be inside — one diverged, and the card is not on dev');
  assert.deepEqual(joined.cards.get('P-6'), { development: false, production: false }, 'no evidence, not named: nothing of it is anywhere');
  assert.deepEqual(joined.cards.get('P-9'), { development: false, production: false }, 'named by a head still on its way: carried, not deployed');
  assert.equal(joined.cards.has('P-5'), false, 'done a month ago is not a candidate — but the head names it, so the lane lists it');
  assert.equal(joined.line, null, 'everything was seen');
  assert.equal(joined.calls, 2 + 4 + 4, 'two listings, and one compare per (head, evidence) that was needed — P-4 on production reused P-1\'s answer for e1, and on dev stopped at its first diverged commit');

  // Without a token nothing is asked: unknown, and the picture says so.
  const blind = await gatherDeployed({ github: { repo: 'acc/repo' }, environments, cards, evidence, fetchImpl: world.fetchImpl, cache: createDeployedCache(), now });
  assert.deepEqual(blind.deployed.production, { sha: null, at: '2026-09-10T08:03:00Z', cards: ['P-5'] }, 'what the head names is still known — it needs no call');
  assert.deepEqual(blind.cards.get('P-1'), { development: null, production: null });
  assert.equal(blind.line, 'deployed unknown: no token');
  assert.equal(blind.calls, 0);
});

test('the budget: never more than ~40 GitHub calls per gathering; what does not fit stays unknown and sources says so', async () => {
  const cards = Array.from({ length: 60 }, (_, i) => ({ key: `P-${i + 1}`, state: 'making', changed: new Date(Date.UTC(2026, 8, 1, 0, 60 - i)).toISOString() }));
  const evidence = new Map(cards.map((card) => [card.key, [{ sha: `sha-${card.key}` }]]));
  const compares = Object.fromEntries(cards.map((card) => [`${HEAD}...sha-${card.key}`, 'behind']));
  const world = hub({ commits: { main: [commit(HEAD, 'Ship it')] }, compares });
  const environments = [{ id: 'production', deployments: [{ status: 'live', title: 'Ship it', head: 'Ship it', carries: [], at: '2026-09-10T08:00:00Z' }] }];
  const cache = createDeployedCache();
  const now = new Date('2026-09-10T10:00:00Z').getTime();

  const first = await gatherDeployed({ github: { repo: 'acc/repo', token: 't' }, environments, cards, evidence, fetchImpl: world.fetchImpl, cache, now });
  assert.equal(world.github(), BUDGET, 'the listing and 39 compares — then the door stays shut');
  assert.equal(first.calls, BUDGET);
  assert.equal(first.deployed.production.cards.length, BUDGET - 1);
  assert.deepEqual(first.cards.get('P-1'), { development: null, production: true }, 'the newest card was answered first');
  assert.deepEqual(first.cards.get('P-60'), { development: null, production: null }, 'the oldest is what the budget ran out on');
  assert.equal(first.line, `deployed: 21 cards past the budget of ${BUDGET} calls`);

  // The next gathering pays only for what is not yet known.
  const second = await gatherDeployed({ github: { repo: 'acc/repo', token: 't' }, environments, cards, evidence, fetchImpl: world.fetchImpl, cache, now: now + 1_000 });
  assert.equal(second.calls, 21, 'the listing is held, the 39 answers are kept forever, 21 remain');
  assert.equal(second.deployed.production.cards.length, 60);
  assert.equal(second.line, null);
});

test('the whole picture: the head names a card, the notes are written once, and the board answers without the network', async () => {
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  await gradula.setDokploy('PRB', { base: 'https://dok.test/api', token: 't', composes: { production: 'c-prod', development: 'c-dev' } });
  await gradula.setGithub('PRB', { repo: 'acc/repo', token: 't' });

  const named = await gradula.addItem('PRB', { title: 'Named by the head', kind: 'task' }, 'david');
  const proven = await gradula.addItem('PRB', { title: 'Proven by a commit', kind: 'task' }, 'david');
  const ahead = await gradula.addItem('PRB', { title: 'Still ahead', kind: 'task' }, 'david');
  for (const card of [named, proven, ahead]) { await gradula.moveItem(card.key, 'ready', 'david'); await gradula.startItem(card.key, 'david'); }
  await gradula.addEvidence(proven.key, { kind: 'commit', ref: 'e1' }, 'hook');
  await gradula.addEvidence(ahead.key, { kind: 'commit', ref: 'e2' }, 'hook');

  const world = hub({
    deployments: {
      'c-prod': [{ status: 'done', title: 'Ship it', createdAt: '2026-09-10T08:00:00Z', finishedAt: '2026-09-10T08:03:00Z', description: `Ship it\n\nPlan: ${named.key}\n` }],
      'c-dev': [{ status: 'running', title: 'Next', createdAt: '2026-09-10T09:00:00Z', description: `Next\n\nPlan: ${ahead.key}\n` }],
    },
    commits: { main: [commit(HEAD, 'Ship it')] },
    compares: { [`${HEAD}...e1`]: 'behind', [`${HEAD}...e2`]: 'ahead' },
  });
  let clock = new Date('2026-09-10T10:00:00Z').getTime();
  const cache = createDeployedCache();
  const doc = await gradula.system('PRB', { fetchImpl: world.fetchImpl, now: () => clock, fresh: true, deployedCache: cache });

  assert.deepEqual(doc.deployed, { production: { sha: HEAD, at: '2026-09-10T08:03:00Z', cards: [named.key, proven.key] } });
  assert.deepEqual(doc.environments[1].deployments[0].carries, [ahead.key], 'what is deploying right now');
  const byKey = Object.fromEntries(doc.cards.map((c) => [c.key, c.deployed]));
  assert.deepEqual(byKey, {
    [named.key]: { development: null, production: true },
    [proven.key]: { development: null, production: true },
    [ahead.key]: { development: null, production: false },
  });
  assert.equal(doc.sources.github, 'ok');

  // ONE note per card and lane, from the system hand, with the sha and the time — and no state change.
  const seen = (await gradula.getItem(named.key)).history.filter((e) => e.verb === 'deployed');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].actor, 'dokploy');
  assert.deepEqual(seen[0].data, { environment: 'production', sha: HEAD, at: '2026-09-10T08:03:00Z', foreignId: `dokploy:production:${named.key}:${HEAD}` });
  assert.equal((await gradula.getItem(named.key)).state, 'making', 'a hand moves to done; the gate proves — this only writes down');
  assert.equal((await gradula.getItem(ahead.key)).history.filter((e) => e.verb === 'deployed').length, 0, 'ahead of the head: not seen, not noted');

  // The same picture again — nothing written twice.
  clock += 40_000;
  await gradula.system('PRB', { fetchImpl: world.fetchImpl, now: () => clock, fresh: true, deployedCache: cache });
  assert.equal((await gradula.getItem(named.key)).history.filter((e) => e.verb === 'deployed').length, 1, 'idempotent by the foreign id');
  assert.equal((await gradula.getItem(proven.key)).history.filter((e) => e.verb === 'deployed').length, 1);

  // The board answers from the notes — no network.
  const card = await gradula.getItem(proven.key);
  assert.deepEqual(card.deployed, { development: false, production: true, at: { development: null, production: '2026-09-10T08:03:00Z' } });
  const listed = await gradula.listItems('PRB', {});
  assert.deepEqual(listed.find((c) => c.key === proven.key).deployed, card.deployed, 'the list says the same as the card');
  assert.deepEqual(listed.find((c) => c.key === ahead.key).deployed, { development: false, production: false, at: { development: null, production: null } });

  // Held picture within the period: a card that was not measured is unknown, not "not deployed".
  const fresh = await gradula.addItem('PRB', { title: 'Just now', kind: 'task' }, 'david');
  await gradula.moveItem(fresh.key, 'ready', 'david'); await gradula.startItem(fresh.key, 'david');
  const held = await gradula.system('PRB', { fetchImpl: world.fetchImpl, now: () => clock + 5_000, deployedCache: cache });
  assert.deepEqual(held.cards.find((c) => c.key === fresh.key).deployed, { development: null, production: null });
  assert.deepEqual(held.cards.find((c) => c.key === named.key).deployed, { development: null, production: true }, 'the measured ones keep their answer');
});

test('without a GitHub token the picture says so in sources.github, and deployed stays unknown', async () => {
  const world = hub({ deployments: { 'c-prod': [{ status: 'done', title: 'Ship it', createdAt: '2026-09-10T08:00:00Z', description: 'Ship it\n\nPlan: PRB-1\n' }] } });
  const doc = await gatherSystem({
    connections: { dokploy: { base: 'https://dok.test/api', token: 't', composes: { production: 'c-prod' } }, github: { repo: 'acc/repo' } },
    board: { history: [{ verb: 'evidenced', card: 'PRB-2', data: { kind: 'commit', ref: 'e2' }, at: '2026-09-10T09:00:00Z' }], cards: [{ key: 'PRB-1', state: 'making' }, { key: 'PRB-2', state: 'review' }] },
    fetchImpl: world.fetchImpl,
  });
  assert.equal(doc.sources.github, 'ok (deployed unknown: no token)');
  assert.deepEqual(doc.deployed, { production: { sha: null, at: '2026-09-10T08:00:00Z', cards: ['PRB-1'] } }, 'what the head names is known without a call');
  assert.deepEqual(doc.cards.map((c) => [c.key, c.deployed]), [['PRB-1', { development: null, production: true }], ['PRB-2', { development: null, production: null }]]);
  assert.equal(world.github(), 0, 'no listing, no compare — nothing is asked without a token');
});
