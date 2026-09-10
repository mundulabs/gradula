/**
 * EAS — and the one distinction the board must never blur: a build is not a
 * release. Everything here runs against a fake fetch, like the other
 * connections: a test that needs a token is a test nobody runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { verify, fetchWork, standingOf, publicConnection } from '../src/eas.mjs';

const answer = (body, status = 200) => async () => ({
  status, json: async () => body,
});

const app = (fields) => ({ data: { app: { byFullName: { id: 'app-1', name: 'mundula', fullName: '@mundulabs/mundula', ...fields } } } });

test('without a token nothing is asked at all', async () => {
  assert.deepEqual(await verify({ token: null, app: '@a/b' }), { ok: false, reason: 'not set up' });
  assert.deepEqual(await fetchWork({ token: 'x', app: null }), { ok: false, reason: 'not set up' });
});

test('a bad token is named, not swallowed', async () => {
  const got = await verify({ token: 'x', app: '@a/b' }, { fetchImpl: answer({ errors: [{ message: 'Unauthorized' }] }, 401) });
  assert.deepEqual(got, { ok: false, reason: 'the token is not valid' });
});

test('a good token comes back with the app it opened', async () => {
  const got = await verify({ token: 'x', app: '@mundulabs/mundula' }, { fetchImpl: answer(app({})) });
  assert.deepEqual(got, { ok: true, app: '@mundulabs/mundula', id: 'app-1' });
});

test('builds and submissions come back cut down to what a board may show', async () => {
  const got = await fetchWork({ token: 'x', app: '@a/b' }, {
    fetchImpl: answer(app({
      builds: [{
        id: 'b1', status: 'FINISHED', platform: 'IOS', appVersion: '1.4.0', appBuildVersion: '31',
        createdAt: '2026-09-08T10:00:00Z', completedAt: '2026-09-08T10:20:00Z',
        gitCommitHash: 'abcdef0123456789', gitCommitMessage: 'the first line\nand a body nobody needs',
      }],
      submissions: [{ id: 's1', status: 'IN_PROGRESS', platform: 'IOS', createdAt: '2026-09-08T10:30:00Z', updatedAt: null }],
    })),
  });
  assert.equal(got.ok, true);
  assert.deepEqual(got.builds[0], {
    id: 'b1', platform: 'ios', status: 'FINISHED', standing: 'built', version: '1.4.0 · 31',
    commit: 'abcdef012345', title: 'the first line', at: '2026-09-08T10:20:00Z',
  });
  assert.equal(got.submissions[0].standing, 'sending');
});

/**
 * Every sentence in standingOf reads `[0]` as "the newest". The API returns
 * them in an order that is usually newest-first and is nowhere promised to be.
 */
test('what comes back is sorted newest first, whatever order it arrived in', async () => {
  const got = await fetchWork({ token: 'x', app: '@a/b' }, {
    fetchImpl: answer(app({
      builds: [
        { id: 'old', status: 'FINISHED', platform: 'IOS', completedAt: '2026-09-01T10:00:00Z' },
        { id: 'new', status: 'FINISHED', platform: 'IOS', completedAt: '2026-09-08T10:00:00Z' },
      ],
      submissions: [
        { id: 'old', status: 'FINISHED', platform: 'IOS', updatedAt: '2026-09-01T10:00:00Z' },
        { id: 'new', status: 'ERRORED', platform: 'IOS', updatedAt: '2026-09-08T10:00:00Z' },
      ],
    })),
  });
  assert.deepEqual(got.builds.map((b) => b.id), ['new', 'old']);
  assert.deepEqual(got.submissions.map((s) => s.id), ['new', 'old']);
});

/**
 * The whole reason this connection exists. A finished build is an artifact;
 * saying "live" about it is the most expensive kind of wrong, because
 * everybody stops looking.
 */
test('a build that nobody submitted is built, never live', () => {
  const standing = standingOf({
    builds: [{ platform: 'ios', standing: 'built', title: 'a commit', at: '2026-09-08T10:00:00Z', version: '1.4.0' }],
    submissions: [],
  });
  assert.equal(standing.ios.standing, 'built');
});

/**
 * MEASURED ON THE REAL BOARD. Android's last submission failed on the 7th and
 * a successful one from the 6th stood in front of it — and the board said
 * `live` about a store upload that had not happened. Preferring the newest
 * SUCCESSFUL submission looks kind and lies.
 */
test('a newer failed submission is not made live by an older good one', () => {
  const standing = standingOf({
    builds: [{ platform: 'android', standing: 'built', title: 'a commit', at: '2026-09-06T08:00:00Z' }],
    submissions: [
      { platform: 'android', standing: 'failed', status: 'ERRORED', at: '2026-09-07T08:30:00Z' },
      { platform: 'android', standing: 'live', status: 'FINISHED', at: '2026-09-06T08:34:00Z' },
    ],
  });
  assert.equal(standing.android.standing, 'failed');
});

test('a submission that landed after the build is what live means', () => {
  const standing = standingOf({
    builds: [{ platform: 'ios', standing: 'built', title: 'a commit', at: '2026-09-08T10:00:00Z', version: '1.4.0' }],
    submissions: [{ platform: 'ios', standing: 'live', status: 'FINISHED', at: '2026-09-08T11:00:00Z' }],
  });
  assert.deepEqual(standing.ios, { standing: 'live', line: 'a commit', at: '2026-09-08T11:00:00Z', version: '1.4.0' });
});

/**
 * Otherwise a fresh build reads as live because an OLD one once reached the
 * store — and that is exactly the week you ship nothing and think you did.
 */
test('an older submission does not make a newer build live', () => {
  const standing = standingOf({
    builds: [{ platform: 'ios', standing: 'built', title: 'today', at: '2026-09-09T10:00:00Z', version: '1.5.0' }],
    submissions: [{ platform: 'ios', standing: 'live', at: '2026-09-01T10:00:00Z' }],
  });
  assert.equal(standing.ios.standing, 'built');
});

test('something happening now wins over something that succeeded', () => {
  const standing = standingOf({
    builds: [
      { platform: 'android', standing: 'building', title: 'on its way', at: '2026-09-09T12:00:00Z' },
      { platform: 'android', standing: 'built', title: 'yesterday', at: '2026-09-08T12:00:00Z' },
    ],
    submissions: [{ platform: 'android', standing: 'live', at: '2026-09-08T13:00:00Z' }],
  });
  assert.equal(standing.android.standing, 'building');
});

test('each platform answers for itself', () => {
  const standing = standingOf({
    builds: [
      { platform: 'ios', standing: 'built', title: 'a', at: '2026-09-09T10:00:00Z' },
      { platform: 'android', standing: 'failed', title: 'b', at: '2026-09-09T10:00:00Z' },
    ],
    submissions: [],
  });
  assert.deepEqual(Object.keys(standing).sort(), ['android', 'ios']);
  assert.equal(standing.android.standing, 'failed');
});

test('a platform nothing is known about says so', () => {
  assert.deepEqual(standingOf({}), {});
  assert.equal(standingOf({ submissions: [{ platform: 'ios', standing: 'idle', at: null }] }).ios.standing, 'idle');
});

test('a connection never shows its key outward', () => {
  assert.deepEqual(publicConnection({ app: '@a/b', token: 'secret', setAt: 'x' }), { app: '@a/b', token: 'set', setAt: 'x' });
  assert.equal(publicConnection(null), null);
});
