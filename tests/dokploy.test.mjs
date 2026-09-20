/**
 * The standing — the third room. It does not answer "is it done" (the gate
 * proves that) but "where has it arrived".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { verify, fetchDeployments, standingOf, publicConnection } from '../src/dokploy.mjs';

const answer = (body, status = 200) => async () => ({ status, json: async () => body });

test('without credentials nothing is asked', async () => {
  assert.deepEqual(await verify({}), { ok: false, reason: 'not set up' });
  assert.deepEqual(await fetchDeployments({ base: 'x', token: 'y' }), { ok: false, reason: 'not set up' });
});

test('a wrong key is an answer, not a crash', async () => {
  const out = await verify({ base: 'https://x/api', token: 'no' }, { fetchImpl: answer(null, 401) });
  assert.deepEqual(out, { ok: false, reason: 'the key is not valid' });
});

test('if something is running that wins — "on its way" is the message', () => {
  const deployments = [
    { standing: 'deploying', title: 'Manual deployment', at: 'b' },
    { standing: 'live', title: 'The herald speaks', at: 'a' },
  ];
  assert.equal(standingOf(deployments).standing, 'deploying');
  // Without a running one the newest wins, and it stands in front.
  assert.equal(standingOf(deployments.slice(1)).standing, 'live');
  assert.equal(standingOf([]).standing, 'unknown');
});

test('one line is left of a deployment, not a log', async () => {
  // Whoever rebuilds Dokploy's log maintains a worse copy of it forever.
  const out = await fetchDeployments(
    { base: 'https://x/api', token: 't', composeId: 'c' },
    { fetchImpl: answer([{ status: 'done', title: 'A title\n\nand a long body', createdAt: '2026-09-09' }]) },
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.deployments[0], {
    status: 'done', standing: 'live', title: 'A title', at: '2026-09-09', carries: [],
  }, 'one line means the FIRST line — otherwise a paragraph stands where a line belongs');
  assert.ok(!('logs' in out.deployments[0]), 'no log');
});

test('the key does not leave the service', () => {
  const shown = publicConnection({ base: 'https://x/api', token: 'secret', composeId: 'c' });
  assert.equal(shown.token, 'set');
  assert.equal(shown.base, 'https://x/api');
});

test('a deployment carries the cards its commit names, and its head line', async () => {
  const out = await fetchDeployments(
    { base: 'https://x/api', token: 't', composeId: 'c' },
    { fetchImpl: answer([
      { status: 'running', title: 'On its way', createdAt: '2026-09-10', description: 'The server speaks English\n\nPlan: MDLA-3\nPlan: MDLA-7\nPlan: MDLA-3\n' },
      { status: 'done', title: 'Before', createdAt: '2026-09-09', finishedAt: '2026-09-09T10:00:00Z', description: 'Before\n\nnothing named' },
    ]) },
  );
  assert.deepEqual(out.deployments[0], {
    status: 'running', standing: 'deploying', title: 'On its way', at: '2026-09-10', head: 'The server speaks English', carries: ['MDLA-3', 'MDLA-7'],
  }, 'one line, once each, in order — and a deployment on its way carries them too');
  assert.deepEqual(out.deployments[1].carries, []);
  assert.equal(out.deployments[1].finishedAt, '2026-09-09T10:00:00Z');
});

test('a person copies the Dokploy connection from another project on the server; an agent may not', async () => {
  const { createMemoryStore } = await import('../src/store.mjs');
  const { createGradula } = await import('../src/gradula.mjs');
  const g = createGradula(createMemoryStore());
  await g.createProject({ key: 'MOLD', name: 'Legacy' });
  await g.createProject({ key: 'MDLA', name: 'Mundus' });
  await g.setDokploy('MOLD', { base: 'https://dokploy.test/api', token: 'secret', composes: { production: 'old' } }, { person: true });
  await assert.rejects(g.setDokploy('MDLA', { from: 'MOLD', composes: { production: 'new' } }), (e) => e.code === 'person-only');
  await assert.rejects(g.setDokploy('MDLA', { from: 'NONE', composes: { production: 'new' } }, { person: true }));
  const set = await g.setDokploy('MDLA', { from: 'MOLD', composes: { production: 'new', development: 'new-dev' } }, { person: true });
  assert.equal(set.base, 'https://dokploy.test/api');
  assert.ok(!JSON.stringify(set).includes('secret'), 'the key never comes back');
  const raw = await g.getDokploy('MDLA', { raw: true });
  assert.equal(raw.token, 'secret');
  assert.deepEqual(raw.composes, { production: 'new', development: 'new-dev' });
  assert.deepEqual((await g.getDokploy('MOLD', { raw: true })).composes, { production: 'old' }, 'the source is untouched');
});
