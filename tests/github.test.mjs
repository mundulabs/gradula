/**
 * GitHub: the connection that makes a piece of evidence clickable — and that
 * delivers exactly one line of truth per branch, not a second CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { verify, billingBlocked, branchStanding, commitUrl, publicConnection } from '../src/github.mjs';

const replies = (map) => async (url) => {
  const key = Object.keys(map).find((k) => String(url).includes(k));
  const body = key ? map[key] : null;
  return { status: body === null ? 404 : 200, json: async () => body };
};

test('a link is a string, not a request', () => {
  // Going onto the network for one would be waste with a waiting time attached.
  assert.equal(commitUrl('mundulabs/gradula', 'abc1234'), 'https://github.com/mundulabs/gradula/commit/abc1234');
  assert.equal(commitUrl(null, 'abc'), null);
});

test('a repository you cannot see is an answer, not a crash', async () => {
  const out = await verify({ repo: 'x/y', token: 't' }, { fetchImpl: replies({}) });
  assert.deepEqual(out, { ok: false, reason: 'the repository is not visible with this key' });
});

test('red beats running beats green', async () => {
  // Whoever sees "green" because one check out of ten was green is wrong —
  // and precisely when it matters.
  const cases = [
    [[{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }], 'red'],
    [[{ status: 'completed', conclusion: 'success' }, { status: 'in_progress' }], 'running'],
    [[{ status: 'completed', conclusion: 'success' }], 'green'],
    [[], 'idle'],
    [[{ status:'completed', conclusion:'skipped' }], 'idle'],
    [[{ status:'completed', conclusion:'success' }, {status:'completed', conclusion:'neutral'}], 'idle'],
  ];
  for (const [runs, want] of cases) {
    const fetchImpl = replies({
      '/pulls': [],
      '/commits/plan': { sha: 'abcdef1234567890', commit: { message: 'A title\n\nand a long body' } },
      'check-runs': { check_runs: runs.map((r, i) => ({ ...r, name: `check ${i}`, html_url: 'https://x' })) },
    });
    await branchStanding({ repo: 'a/b', token: 't', branch: 'plan/GRD-33' }, { fetchImpl })
      .then((out) => assert.equal(out.standing, want, `${JSON.stringify(runs)} → ${want}`));
  }
});

test('one line and one link are left of a commit', async () => {
  const out = await branchStanding(
    { repo: 'a/b', token: 't', branch: 'plan/GRD-33' },
    { fetchImpl: replies({
      '/pulls': [{ number: 7, state: 'open', title: 'Der dritte Raum\n\nRumpf', html_url: 'https://x/7' }],
      '/commits/plan': { sha: 'abcdef1234567890', commit: { message: 'A title\n\nand a long body' } },
      'check-runs': { check_runs: [] },
    }) },
  );
  assert.equal(out.commit.hash, 'abcdef123456');
  assert.equal(out.commit.title, 'A title', 'one line means the first line');
  assert.equal(out.pull.title, 'Der dritte Raum');
  assert.match(out.commit.url, /github\.com\/a\/b\/commit\//);
  assert.ok(!('logs' in out), 'no log — that is what the link is for');
});

test('a branch that does not exist is not a failure', async () => {
  const out = await branchStanding({ repo: 'a/b', token: 't', branch: 'plan/GRD-99' }, { fetchImpl: replies({ '/pulls': [] }) });
  assert.equal(out.ok, true);
  assert.equal(out.exists, false);
});

test('the key does not leave the service', () => {
  assert.equal(publicConnection({ repo: 'a/b', token: 'secret' }).token, 'set');
});


test('local fallback requires explicit GitHub pre-start billing evidence', async () => {
  for (const [message,expected] of [
    ['The job was not started because recent account payments have failed or your spending limit needs to be increased.',true],
    ['The test failed with a payment validation error.',false],
    ['Job cancelled',false],
  ]) assert.equal(await billingBlocked({repo:'a/b',token:'t'},'123',{fetchImpl:replies({'/annotations':[{message}]})}),expected);
  assert.equal(await billingBlocked({repo:'a/b'},'123',{fetchImpl:replies({})}),false);
});
