/**
 * The store's contract — ONE set of sentences, two implementations.
 *
 * In memory it always runs. Against Postgres it runs as soon as
 * `GRADULA_DB_URL` stands; without the address it is skipped and says so out
 * loud. A test that only imitates the database does not check the database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore, hashToken } from '../src/store.mjs';

const implementations = [['memory', async () => createMemoryStore()]];

if (process.env.GRADULA_DB_URL) {
  implementations.push(['Postgres', async () => {
    const { createPgStore } = await import('../src/store-pg.mjs');
    const store = await createPgStore(process.env.GRADULA_DB_URL, { schema: `probe_${Date.now()}` });
    await store.migrate();
    return store;
  }]);
}

for (const [name, build] of implementations) {
  test(`${name}: a project, a card, a key`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());

    await store.projects.create({ key: 'PRB', name: 'Probe' });
    assert.equal((await store.projects.get('PRB')).name, 'Probe');

    // Name and repository move, the key never: it stands in every card key
    // and in every commit line.
    const renamed = await store.projects.patch('PRB', { name: 'Probe II', repo: 'owner/other' });
    assert.equal(renamed.name, 'Probe II');
    assert.equal(renamed.repo, 'owner/other');
    assert.equal(renamed.key, 'PRB', 'the key stays');
    assert.equal(await store.projects.patch('GIBTSNICHT', { name: 'x' }), null);

    const one = await store.items.create('PRB', { kind: 'task', title: 'First' });
    const two = await store.items.create('PRB', { kind: 'idea', title: 'Second' });
    assert.equal(one.key, 'PRB-1');
    assert.equal(two.key, 'PRB-2', 'the numbers count up per project');

    const fetched = await store.items.get('PRB-1');
    assert.equal(fetched.title, 'First');
    assert.equal(await store.items.get('PRB-99'), null);

    await store.items.patch('PRB-1', { state: 'making', module: ['panels'] });
    assert.equal((await store.items.get('PRB-1')).state, 'making');

    const beingMade = await store.items.list('PRB', { state: 'making' });
    assert.deepEqual(beingMade.map((i) => i.key), ['PRB-1']);
    const looked = await store.items.list('PRB', { q: 'second' });
    assert.deepEqual(looked.map((i) => i.key), ['PRB-2']);

    const link = await store.links.add({ project: 'PRB', from: one.id, to: two.id, kind: 'needs' });
    assert.equal((await store.links.of(one.id)).length, 1);
    assert.equal(await store.links.remove(link.id), true);
    assert.equal((await store.links.list('PRB')).length, 0);

    await store.events.add({ item: one.id, actor: 'david', verb: 'created' });
    await store.events.add({ item: two.id, actor: 'Gradula (runner)', verb: 'evidenced', data: {} });
    const history = await store.events.of(one.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].actor, 'david');

    // The PROJECT's history: newest first, across all cards.
    const whole = await store.events.all('PRB', { limit: 10 });
    assert.equal(whole.length, 2);
    assert.equal(whole[0].actor, 'Gradula (runner)', 'the newest stands on top');
    assert.equal((await store.events.all('PRB', { since: new Date(Date.now() + 60_000).toISOString() })).length, 0);

    const { token, entry } = await store.tokens.mint({ project: 'PRB', name: 'Probe' });
    assert.match(token, /^grad_pat_[0-9a-f]{48}$/);
    assert.equal(entry.hash, hashToken(token), 'what is stored is the fingerprint, never the key');
    assert.equal((await store.tokens.verify(token)).project, 'PRB');
    assert.equal(await store.tokens.verify('grad_pat_falsch'), null);

    await store.tokens.revoke(entry.id);
    assert.equal(await store.tokens.verify(token), null, 'revoked means revoked');

    const list = await store.tokens.list('PRB');
    assert.ok(list.every((row) => row.hash === undefined), 'a fingerprint does not leave the store');
  });

  test(`${name}: a herald, and its key stays inside`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());
    await store.projects.create({ key: 'PRB', name: 'Probe' });

    assert.deepEqual(await store.heralds.list('PRB'), []);
    const herald = await store.heralds.set('PRB', {
      kind: 'telegram', name: 'Werkstatt', chat: '-100123',
      token: '123456:SECRET', filter: { verbs: ['moved'], voice: 'technical' },
    });
    assert.equal(herald.token, 'set', 'a key does not leave the store');
    assert.equal((await store.heralds.list('PRB'))[0].filter.voice, 'technical');
    assert.equal((await store.heralds.list('PRB', { raw: true }))[0].token, '123456:SECRET',
      'whoever has to send gets it — and only they');

    // A form that only changes the filter must not take the herald's voice.
    await store.heralds.set('PRB', { ...herald, token: undefined, filter: { verbs: ['created'] } });
    const after = (await store.heralds.list('PRB', { raw: true }))[0];
    assert.equal(after.token, '123456:SECRET', 'a key sent empty deletes nothing');
    assert.deepEqual(after.filter.verbs, ['created']);

    assert.equal(await store.heralds.remove(herald.id), true);
    assert.deepEqual(await store.heralds.list('PRB'), []);
  });

  test(`${name}: a project's key can be changed`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());
    await store.projects.create({ key: 'OLD', name: 'Alt' });
    const one = await store.items.create('OLD', { kind: 'task', title: 'A card' });
    const two = await store.items.create('OLD', { kind: 'idea', title: 'Another one' });
    await store.links.add({ project: 'OLD', from: one.id, to: two.id, kind: 'needs' });

    const moved = await store.projects.rekey('OLD', 'NEW');
    assert.equal(moved.key, 'NEW');
    assert.equal(await store.projects.get('OLD'), null, 'the old one no longer exists');

    // Every card key carries the project key — so they all move with it,
    // and the NUMBERS stay: NEW-1 was OLD-1 and is the same card.
    const cards = await store.items.list('NEW', {});
    assert.deepEqual(cards.map((c) => c.key).sort(), ['NEW-1', 'NEW-2']);
    assert.equal((await store.items.get('NEW-1')).title, 'A card');
    assert.equal(await store.items.get('OLD-1'), null, 'nothing is found under the old key');
    assert.equal((await store.items.byId(one.id)).key, 'NEW-1', 'the inner identifier did not move');
    assert.equal((await store.links.list('NEW')).length, 1, 'the links move along');

    // A new card counts on, it does not start at one again.
    assert.equal((await store.items.create('NEW', { kind: 'task', title: 'Dritte' })).key, 'NEW-3');
  });

  test(`${name}: the vocabulary belongs to the project`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());
    await store.projects.create({ key: 'PRB', name: 'Probe' });
    assert.deepEqual(await store.vocab.get('PRB'), []);
    await store.vocab.set('PRB', [{ id: 'panels', paths: ['packages/panels'], words: [] }]);
    assert.equal((await store.vocab.get('PRB'))[0].id, 'panels');
  });
}

if (!process.env.GRADULA_DB_URL) {
  test('Postgres was not checked (GRADULA_DB_URL is missing)', { skip: 'without an address this would be a claim about a database nobody started' }, () => {});
}

/**
 * THE TWO STORES MUST BE INDISTINGUISHABLE — including the NAMES of the
 * fields they answer with.
 *
 * The memory store called a chronicle entry's moment `time` and Postgres
 * called it `at`. Every sentence about the chronicle read `e.at`, so against
 * memory it read undefined — and the card sheet threw the moment anybody
 * opened a card. Nothing was red: the whole suite runs against memory, and
 * not one test had ever asked what an entry is CALLED.
 *
 * The shape below is the contract. A field renamed on one side and not the
 * other now fails here instead of in a browser.
 */
for (const [name, build] of implementations) {
  test(`${name}: a chronicle entry answers with the agreed field names`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());

    await store.projects.create({ key: 'PRB', name: 'Probe' });
    const card = await store.items.create('PRB', { kind: 'task', title: 'First' });
    await store.events.add({ item: card.id, actor: 'david', verb: 'said', data: { line: 'a word' } });

    const AGREED = ['id', 'item', 'actor', 'verb', 'data', 'at'];
    for (const entry of [(await store.events.of(card.id))[0], (await store.events.all('PRB'))[0]]) {
      for (const field of AGREED) assert.ok(field in entry, `an entry carries ${field}`);
      assert.ok(!('time' in entry), 'and does not carry a second name for the same moment');
      assert.match(String(entry.at), /^\d{4}-\d{2}-\d{2}T/, 'the moment is an ISO string, not a Date');
    }

    // And the derived answers built on top of it.
    const touched = await store.events.lastTouched('PRB');
    assert.match(String(touched.get(card.id)), /^\d{4}-\d{2}-\d{2}T/);

    // Where each card was last seen deployed, per lane — the `deployed`
    // notes folded, one read for the board (deployed.mjs has the fold for
    // one card; the two must say the same).
    await store.events.add({ item: card.id, actor: 'dokploy', verb: 'deployed', data: { environment: 'development', sha: 'a', at: '2026-09-10T10:41:00Z' } });
    await store.events.add({ item: card.id, actor: 'dokploy', verb: 'deployed', data: { environment: 'development', sha: 'b', at: '2026-09-10T12:00:00Z' } });
    const one = await store.items.create('PRB', { kind: 'task', title: 'Second' });
    await store.events.add({ item: one.id, actor: 'dokploy', verb: 'deployed', data: { environment: 'production', sha: 'b' } });
    const deployed = await store.events.deployed('PRB');
    assert.deepEqual(deployed.get(card.id), { development: true, production: false, at: { development: '2026-09-10T12:00:00Z', production: null } }, 'the last note per lane');
    assert.equal(deployed.get(one.id).production, true);
    assert.match(String(deployed.get(one.id).at.production), /^\d{4}-\d{2}-\d{2}T/, 'a note without its own time carries the chronicle\'s');
    assert.equal(deployed.get(one.id).development, false);
  });

  /**
   * THE SAME FOR A CARD, and this one had already gone wrong twice.
   *
   * Postgres answered `last_seen` where the rest of the house says `lastSeen`
   * — on the way IN as well. So on Postgres a Sentry card never carried a last
   * sighting at all: created without it, patched past it, read under a name
   * nothing looks for. The rule that says "reopen a closed incident only when
   * it has been seen since" then compared against `undefined` and reopened
   * every closed card on every pull, every quarter of an hour.
   *
   * In memory it all worked. Every test runs against memory.
   */
  /**
   * AND THE CONNECTIONS. `writeBack` — may Gradula close an issue in Sentry
   * when its card is done — was computed in the service, handed back in the
   * answer and never stored: Postgres had no column for it. The one line that
   * reads it has therefore never once been true in production, and the answer
   * to the PUT said `writeBack: true` the whole time.
   */
  test(`${name}: a connection keeps every field it was given`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());
    await store.projects.create({ key: 'PRB', name: 'Probe' });

    await store.sentry.set('PRB', {
      org: 'mundulabs', project: 'mundula', base: 'https://de.sentry.io/api/0',
      token: 'a-token', hookSecret: 'a-secret', writeBack: true,
    });
    const read = await store.sentry.get('PRB');
    assert.equal(read.org, 'mundulabs');
    assert.equal(read.project, 'mundula');
    assert.equal(read.token, 'a-token');
    assert.equal(read.hookSecret, 'a-secret');
    assert.equal(read.writeBack, true, 'a flag that is not stored is a setting that does nothing');

    // And off again — a flag that can only be switched on is not a switch.
    await store.sentry.set('PRB', { ...read, writeBack: false });
    assert.equal((await store.sentry.get('PRB')).writeBack, false);

    // Which environments become cards, and how Sentry names the lanes —
    // both stored, both read back; unset stays null (the default), `all`
    // stays the word.
    assert.equal(read.environments ?? null, null, 'not said is null, not an empty list');
    await store.sentry.set('PRB', { ...read, environments: ['prod', 'dev'], lanes: { production: ['prod'], development: ['dev'] } });
    const placed = await store.sentry.get('PRB');
    assert.deepEqual(placed.environments, ['prod', 'dev']);
    assert.deepEqual(placed.lanes, { production: ['prod'], development: ['dev'] });
    await store.sentry.set('PRB', { ...placed, environments: 'all' });
    assert.equal((await store.sentry.get('PRB')).environments, 'all');
    await store.sentry.set('PRB', { ...placed, environments: null });
    assert.equal((await store.sentry.get('PRB')).environments ?? null, null, 'back to the default');
  });

  test(`${name}: a card answers with the agreed field names, and a patch finds them`, async (t) => {
    const store = await build();
    t.after(() => store.close?.());

    await store.projects.create({ key: 'PRB', name: 'Probe' });
    const made = await store.items.create('PRB', {
      kind: 'task', title: 'First', source: 'sentry', foreignId: 'sentry:77',
      count: 3, lastSeen: '2026-09-09T06:43:00.000Z', permalink: 'https://x/1', level: 'error',
    });

    const AGREED = ['id', 'key', 'project', 'number', 'kind', 'state', 'title', 'text', 'module',
      'stack', 'suggestions', 'person', 'gate', 'target', 'runner', 'files', 'source', 'foreignId',
      'count', 'lastSeen', 'permalink', 'level', 'visibility', 'heartbeat', 'due', 'created'];
    for (const field of AGREED) assert.ok(field in made, `a card carries ${field}`);
    assert.ok(!('last_seen' in made), 'and not a second name for the same field');
    assert.ok(!('foreign_id' in made), 'nor for that one');

    // What was written must come back — a create that silently drops a field
    // is how a whole column stays empty for a week.
    assert.equal(made.lastSeen, '2026-09-09T06:43:00.000Z');
    assert.equal(made.foreignId, 'sentry:77');
    assert.equal(made.count, 3);

    const patched = await store.items.patch(made.key, { count: 4, lastSeen: '2026-09-09T18:00:00.000Z' });
    assert.equal(patched.count, 4);
    assert.equal(patched.lastSeen, '2026-09-09T18:00:00.000Z', 'a patch must reach the column it names');
    assert.equal((await store.items.get(made.key)).lastSeen, '2026-09-09T18:00:00.000Z');
  });
}
