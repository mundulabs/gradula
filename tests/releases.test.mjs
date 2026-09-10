import test from 'node:test';
import assert from 'node:assert/strict';
import { releasesIn, previousOf, cardsBetween } from '../src/releases.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';

test('the picture shows releases per lane: the web head, finished production builds, production updates — dev clients are none', () => {
  const doc = {
    deployed: { production: { sha: 'a'.repeat(40), at: '2026-09-10T16:00:00Z', cards: ['P-1'] } },
    environments: [{ id: 'production', deployments: [{ status: 'live', title: 'Ship it' }] }],
    builds: [
      { profile: 'beta', platform: 'ios', status: 'built', at: '2026-09-10T15:00:00Z', url: 'https://expo.dev/b/1', version: '0.0.1 · 3', commit: 'bbbbbbbbbbbb' },
      { profile: 'development', platform: 'ios', status: 'built', at: '2026-09-10T15:30:00Z', url: 'https://expo.dev/b/2', version: '0.0.1 · 4' },
      { profile: 'production', platform: 'android', status: 'building', at: '2026-09-10T15:40:00Z', url: 'https://expo.dev/b/3' },
    ],
    updates: [{ channel: 'production', at: '2026-09-10T14:00:00Z', message: 'Fix the knob', runtime: '0.0.1' }, { channel: 'dev', at: '2026-09-10T14:30:00Z', message: 'x', runtime: '0.0.1' }],
  };
  const found = releasesIn(doc);
  assert.deepEqual(found.map((r) => [r.lane, r.id]), [['ota', 'update:production:2026-09-10T14:00:00Z'], ['ios', 'build:https://expo.dev/b/1'], ['web', `web:${'a'.repeat(40)}`]], 'oldest first; the dev client and the unfinished build are none');
  assert.deepEqual(previousOf(found[2], [{ lane: 'web', at: '2026-09-09T10:00:00Z', id: 'web:old' }, { lane: 'ios', at: '2026-09-10T10:00:00Z' }]), { lane: 'web', at: '2026-09-09T10:00:00Z', id: 'web:old' });
  assert.deepEqual(cardsBetween([{ key: 'P-1', deployed: { at: { production: '2026-09-10T12:00:00Z' } } }, { key: 'P-2', deployed: { at: { production: '2026-09-08T12:00:00Z' } } }], '2026-09-09T00:00:00Z', '2026-09-10T16:00:00Z'), ['P-1']);
});

test('a release is remembered once and spoken once; an app build carries the cards of the commits since the previous build; the first picture speaks only the newest per lane', async () => {
  const said = [];
  const store = createMemoryStore();
  const gradula = createGradula(store, { heraldKinds: { probe: { async send({ chat }, text) { said.push({ chat, text }); return { sent: true }; } } } });
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  await gradula.setHerald('PRB', { kind: 'probe', name: 'Team', chat: 'team', token: 'x', template: 'release' }, 'david');
  const a = await gradula.addItem('PRB', { title: 'First thing', kind: 'task' }, 'david');
  const b = await gradula.addItem('PRB', { title: 'Second thing', kind: 'task' }, 'david');
  const web = (sha, cards, at) => ({ deployed: { production: { sha, at, cards } }, environments: [{ id: 'production', deployments: [{ status: 'live', title: 'Ship' }] }], builds: [], updates: [] });
  // two web heads in the first picture: both remembered, only the newest spoken
  const first = { ...web('b'.repeat(40), [b.key], '2026-09-10T12:00:00Z') };
  first.deployed.production = { sha: 'b'.repeat(40), at: '2026-09-10T12:00:00Z', cards: [b.key] };
  const clock = Date.parse('2026-09-10T16:00:00Z');
  const spoken = await gradula.noteReleases('PRB', first, { now: clock });
  assert.equal(spoken.length, 1);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Web bbbbbbb — released\nShip\n• PRB-2 ■▩□□□ ready\n  Second thing$/);
  // the same head again: silence
  assert.deepEqual(await gradula.noteReleases('PRB', first), []);
  assert.equal(said.length, 1);
  // an app build: the commits between the previous build and this one name the cards (one compare)
  const fetchImpl = async (url) => {
    const at = String(url);
    if (at.includes('/compare/')) return { ok: true, status: 200, json: async () => ({ status: 'ahead', commits: [{ sha: 'c1', commit: { message: `First\n\nPlan: ${a.key}` } }] }) };
    return { ok: false, status: 404, json: async () => null, text: async () => '' };
  };
  const build = (url, commit, at) => ({ deployed: {}, environments: [], updates: [], builds: [{ profile: 'beta', platform: 'ios', status: 'built', at, url, version: '0.0.1 · 3', commit, title: 'A build' }] });
  await gradula.noteReleases('PRB', build('https://expo.dev/b/1', 'aaaaaaaaaaaa', '2026-09-10T13:00:00Z'), { now: clock });
  assert.equal(said.length, 2, 'the first iOS build speaks');
  const second = build('https://expo.dev/b/2', 'cccccccccccc', '2026-09-10T14:00:00Z');
  second.builds[0].version = '0.0.1 · 4';
  await gradula.noteReleases('PRB', second, { github: { repo: 'acc/repo', token: 't' }, fetchImpl, now: clock });
  assert.equal(said.length, 3);
  assert.equal(said[2].text, `iOS 0.0.1 · 4 · TestFlight — released\nA build\n• ${a.key} ■▩□□□ ready\n  First thing\nhttps://expo.dev/b/2`, 'since the previous build: the cards its commits name');
  const list = await gradula.listReleases('PRB');
  assert.deepEqual(list.map((r) => r.lane), ['ios', 'ios', 'web'], 'newest first');
});

test('beta and production are two audiences: testers hear every beta with its notes, the public hears the store', async () => {
  const { releasesIn, stageOf } = await import('../src/releases.mjs');
  assert.equal(stageOf('beta'), 'beta'); assert.equal(stageOf('production'), 'production'); assert.equal(stageOf(null), 'production');
  const found = releasesIn({ deployed: {}, environments: [], updates: [], builds: [
    { profile: 'beta', platform: 'ios', status: 'built', at: '2026-09-10T15:00:00Z', url: 'b/1', version: '1 · 3' },
    { profile: 'production', platform: 'ios', status: 'built', at: '2026-09-10T16:00:00Z', url: 'b/2', version: '1 · 4' },
  ] });
  assert.deepEqual(found.map((r) => r.stage), ['beta', 'production']);
  const said = [];
  const store = createMemoryStore();
  const gradula = createGradula(store, { heraldKinds: { probe: { async send({ chat }, text) { said.push({ chat, text }); return { sent: true }; } } } });
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  await gradula.setHerald('PRB', { kind: 'probe', name: 'Testers', chat: 'testers', token: 'x', template: 'beta' }, 'david');
  await gradula.setHerald('PRB', { kind: 'probe', name: 'World', chat: 'world', token: 'x', template: 'public-release' }, 'david');
  await gradula.fileNotes('PRB', { lane: 'ios', stage: 'beta', version: '1.2.0 · 3', text: 'Try the new bass line.' }, 'david');
  await gradula.fileNotes('PRB', { lane: 'ios', stage: 'production', version: '1.2.0', text: 'Hum a melody, get a bass line.' }, 'david');
  assert.deepEqual(said.map((m) => [m.chat, m.text.split('\n')[0]]), [['testers', 'Probe 1.2.0 · 3 · iOS · TestFlight'], ['world', 'Probe 1.2.0 · iOS']], 'the beta to the testers, the store to the world — and never the other way');
  await assert.rejects(gradula.setHerald('PRB', { kind: 'probe', name: 'x', chat: 'x', token: 'x', filter: { stages: ['alpha'] } }, 'david'), (e) => e.code === 'stages');
});
