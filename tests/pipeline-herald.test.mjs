import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createPipelineHerald, pipelineText, stepMark } from '../src/pipeline-herald.mjs';
import { send, edit } from '../src/telegram.mjs';

const now = '2026-09-12T12:00:00Z';
const run = { id: 10, run_attempt: 1, name: 'Release', head_branch: 'main', head_sha: 'abcdef1234567890abcdef1234567890abcdef12', status: 'in_progress', conclusion: null, updated_at: now };
const job = { name: 'Ship iOS', status: 'in_progress', steps: [
  { name: 'Build', status: 'completed', conclusion: 'success' },
  { name: 'Upload', status: 'in_progress' },
  { name: 'Publish', status: 'queued' },
] };

async function fixture() {
  const store = createMemoryStore();
  await store.projects.create({ key: 'PRB', name: 'Probe' });
  await store.github.set('PRB', { repo: 'owner/repo', token: 'private-github-token' });
  const herald = await store.heralds.set('PRB', { kind: 'probe', name: 'Workshop', chat: 'team', token: 'private-bot-token', filter: { pipeline: true } });
  const calls = [];
  const data = { runs: [structuredClone(run)], jobs: [structuredClone(job)], fail: false };
  const fetchImpl = async (url) => {
    if (data.fail) throw new Error('offline');
    if (url.includes('/commits/')) return { status: data.localUnavailable ? 403 : 200, json: async () => ({ statuses: data.local ? [data.local] : [] }) };
    assert.ok(url.startsWith('https://api.github.com/repos/owner/repo/actions/runs'));
    return { status: 200, json: async () => url.includes('/jobs?') ? { jobs: data.jobs, total_count: data.jobs.length } : { workflow_runs: data.runs } };
  };
  const kind = {
    async send(connection, text) { calls.push({ method: 'send', chat: connection.chat, text }); return { sent: true, messageId: 42 }; },
    async edit(connection, id, text) { calls.push({ method: 'edit', chat: connection.chat, id, text }); return { sent: true, messageId: id }; },
  };
  const make = () => createPipelineHerald({ store, heraldKinds: { probe: kind }, keyOf: (h) => h.token, fetchImpl, now: () => now });
  return { store, herald, calls, data, kind, make };
}

test('real step states form squares, failures are explicit and never become success', () => {
  assert.equal(job.steps.map(stepMark).join(''), '■▩□');
  assert.equal(stepMark({ status: 'completed', conclusion: 'failure' }), '□');
  assert.equal(stepMark({ status: 'completed', conclusion: 'skipped' }), '·');
  const text = pipelineText('PRB', { ...run, attempt: 1, branch: 'main', url: 'https://github.com/owner/repo/actions/runs/10', status: 'completed', conclusion: 'failure' }, [{ ...job, status: 'completed', conclusion: 'failure' }]);
  assert.match(text, /failure/);
  assert.match(text, /■▩□ Ship iOS/);
  assert.ok(text.length < 3900);
});

test('send once, keep quiet, edit step progress, survive restart and retain final failure', async () => {
  const f = await fixture();
  let monitor = f.make();
  await Promise.all([monitor.poll('PRB'), monitor.poll('PRB')]);
  assert.equal(f.calls.length, 1, 'overlapping polls share the same pass');
  assert.equal(f.calls[0].method, 'send');
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 1, 'unchanged steps send nothing');
  f.data.jobs[0].steps[1] = { name: 'Upload', status: 'completed', conclusion: 'success' };
  f.data.jobs[0].steps[2].status = 'in_progress';
  await monitor.poll('PRB');
  assert.equal(f.calls[1].method, 'edit');
  assert.equal(f.calls[1].id, 42);
  assert.match(f.calls[1].text, /■■▩/);
  monitor = f.make();
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 2, 'restart reuses durable fingerprint');
  f.data.runs[0] = { ...run, status: 'completed', conclusion: 'failure', updated_at: '2026-09-12T12:02:00Z' };
  f.data.jobs[0].status = 'completed'; f.data.jobs[0].conclusion = 'failure';
  f.data.jobs[0].steps[2] = { name: 'Publish', status: 'completed', conclusion: 'failure' };
  await monitor.poll('PRB');
  assert.equal(f.calls[2].method, 'edit');
  assert.match(f.calls[2].text, /failure/);
  assert.match(f.calls[2].text, /■■□/);
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => !c.text.includes('private-')));
});

test('no historical flood, new attempts get new messages, and changed destinations never edit old messages', async () => {
  const f = await fixture();
  f.data.runs.push({ ...run, id: 9, status: 'completed', conclusion: 'success', updated_at: '2026-09-11T12:00:00Z' });
  const monitor = f.make();
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 1);
  f.data.runs = [{ ...run, run_attempt: 2 }];
  await monitor.poll('PRB');
  assert.equal(f.calls[1].method, 'send');
  await f.store.heralds.set('PRB', { ...f.herald, token: '', chat: 'another' });
  await monitor.poll('PRB');
  assert.equal(f.calls[2].method, 'send');
  assert.equal(f.calls[2].chat, 'another');
});

test('Outside and disabled heralds never receive pipeline data, even with a malformed stored filter', async () => {
  const f = await fixture();
  await f.store.heralds.set('PRB', { ...f.herald, token: '', filter: { pipeline: true, visibility: 'public' } });
  await f.make().poll('PRB');
  assert.equal(f.calls.length, 0);
  const gradula = createGradula(f.store);
  await assert.rejects(gradula.setHerald('PRB', { kind: 'telegram', filter: { pipeline: true, visibility: 'public' } }, 'david'), /internal/);
  await f.store.heralds.set('PRB', { ...f.herald, token: '', active: false });
  await f.make().poll('PRB');
  assert.equal(f.calls.length, 0);
});

test('failed edits do not repost; only an explicitly missing message gets a replacement', async () => {
  const f = await fixture(); const monitor = f.make();
  await monitor.poll('PRB');
  f.data.jobs[0].steps[2].status = 'in_progress';
  f.kind.edit = async () => ({ sent: false, reason: 'rate limited' });
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 1);
  f.kind.edit = async () => ({ sent: false, missing: true });
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].method, 'send');
});

test('Telegram returns message ids, edits only that id, and treats unchanged content as success', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { status: 200, json: async () => ({ ok: true, result: { message_id: 17 } }) }; };
  const address = { token: 'test', chat: 'team' };
  assert.deepEqual(await send(address, 'first', { fetchImpl }), { sent: true, messageId: 17 });
  assert.deepEqual(await edit(address, 17, 'second', { fetchImpl }), { sent: true, messageId: 17 });
  assert.ok(requests[1].url.endsWith('/editMessageText'));
  assert.equal(requests[1].body.message_id, 17);
  assert.equal(requests[1].body.disable_web_page_preview, true);
  assert.deepEqual(await edit(address, 17, 'second', { fetchImpl: async () => ({ status: 400, json: async () => ({ ok: false, description: 'Bad Request: message is not modified' }) }) }), { sent: true, messageId: 17 });
});


test('local evidence arriving after hosted completion edits the same message without inventing hosted success', async () => {
  const f = await fixture();
  f.data.runs[0] = { ...run, status: 'completed', conclusion: 'cancelled' };
  f.data.jobs = [];
  const monitor = f.make();
  await monitor.poll('PRB');
  f.data.local = { context: 'mundus/local-ci', state: 'success', description: 'Passed locally' };
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].method, 'edit');
  assert.equal(f.calls[1].id, 42);
  assert.match(f.calls[1].text, /Local CI · success/);
  assert.match(f.calls[1].text, /Attempt 1 · cancelled/);
  assert.doesNotMatch(f.calls[1].text, /deployed/);
  await monitor.poll('PRB');
  assert.equal(f.calls.length, 2);
  f.data.local.state = 'failure';
  await monitor.poll('PRB');
  assert.match(f.calls[2].text, /Local CI · failure/);
});


test('missing commit-status access never hides hosted job progress', async () => {
  const f = await fixture(); f.data.localUnavailable = true;
  await f.make().poll('PRB');
  assert.match(f.calls[0].text, /Local CI · unavailable/);
  assert.match(f.calls[0].text, /Ship iOS · in_progress/);
});
