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
    status: 'done', standing: 'live', title: 'A title', at: '2026-09-09',
  }, 'one line means the FIRST line — otherwise a paragraph stands where a line belongs');
  assert.ok(!('logs' in out.deployments[0]), 'no log');
});

test('the key does not leave the service', () => {
  const shown = publicConnection({ base: 'https://x/api', token: 'secret', composeId: 'c' });
  assert.equal(shown.token, 'set');
  assert.equal(shown.base, 'https://x/api');
});
