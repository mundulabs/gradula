/**
 * The store is a CONTRACT, not a database.
 *
 * The shape stands here once, and two implementations keep to it: the one in
 * memory (below, for tests and for `npm run dev` without a database) and the
 * one on Postgres (store-pg.mjs). `tests/store.test.mjs` runs against both —
 * against Postgres only when `GRADULA_DB_URL` is set, or the test would be a
 * claim about a database nobody started.
 *
 * It is the same idea as Mundula's audio graph: the implementation may
 * change, the contract may not. And a test that only checks the imitation
 * checks nothing — which is why the same sentences run over both.
 *
 * ALL methods are async, the in-memory ones too. Whoever writes them
 * synchronously writes a caller that breaks on Postgres.
 */

import { isDeepStrictEqual } from 'node:util';
import { mintId, itemKey } from './ids.mjs';
import { bornIn } from './spec.mjs';
import { createHash, randomBytes } from 'node:crypto';

export const hashToken = (raw) => createHash('sha256').update(String(raw)).digest('hex');
export const mintToken = () => `grad_pat_${randomBytes(24).toString('hex')}`;
export const deviceCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
export const DEVICE_TTL = 10 * 60_000;


const clone = (value) => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));
const now = () => new Date().toISOString();

/** A card as it looks from outside — one place, not a second format. */
export function shapeItem(row) {
  return {
    id: row.id,
    key: row.key,
    project: row.project,
    number: row.number,
    kind: row.kind,
    state: row.state,
    title: row.title,
    text: row.text ?? '',
    module: row.module ?? [],
    stack: row.stack ?? [],
    suggestions: row.suggestions ?? { module: [], stack: [] },
    person: row.person ?? null,
    gate: row.gate ?? null,
    target: row.target ?? null,
    runner: row.runner ?? 'here',
    // Releasing is its own gesture. The default is and stays internal.
    visibility: row.visibility ?? 'internal',
    // The runner's lease. Null until someone starts; stale by itself afterwards.
    heartbeat: row.heartbeat ?? null,
    reservation: row.reservation ?? null,
    due: row.due ?? null,
    files: row.files ?? [],
    source: row.source ?? 'human',
    // The fingerprint of an incident. It does NOT come from us: Sentry groups
    // already, and a second grouping beside it would be a second truth.
    foreignId: row.foreignId ?? null,
    count: row.count ?? null,
    lastSeen: row.lastSeen ?? null,
    permalink: row.permalink ?? null,
    level: row.level ?? null,
    created: row.created,
    changed: row.changed,
    createdBy: row.createdBy ?? null,
  };
}

export function createMemoryStore() {
  const projects = new Map();
  const vocab = new Map();
  const items = new Map();       // id → row
  const byKey = new Map();       // KEY → id
  const counters = new Map();    // projectKey → last number
  const links = new Map();
  const events = [];
  let seqCounter = 0;
  const tokens = new Map();
  const sentry = new Map();
  const heralds = new Map();
  const heraldDeliveries = new Map();
  const releases = new Map();
  const dokploy = new Map();
  const github = new Map();
  const eas = new Map();
  const devices = new Map();     // id → a machine asking to register

  const project = (key) => {
    const found = projects.get(key);
    if (!found) throw Object.assign(new Error(`There is no project ${key}`), { code: 'no-project' });
    return found;
  };

  return {
    kind: 'memory',

    projects: {
      async create({ key, name, repo = null }) {
        if (projects.has(key)) throw Object.assign(new Error(`Project ${key} already exists`), { code: 'taken' });
        const row = { id: mintId(), key, name, repo, people: {}, language: null, publish: null, ladder: null, created: now() };
        projects.set(key, row);
        counters.set(key, 0);
        return clone(row);
      },
      async get(key) { return clone(projects.get(key) ?? null); },
      async moveRuntimeConnections(from, to) {
        project(from); project(to);
        if (from === to) throw new Error('Different projects required');
        const sources = { sentry, dokploy, eas };
        if (Object.values(sources).some((map) => map.has(to))) throw new Error('Destination already has runtime connections');
        const moved = [];
        for (const [name, map] of Object.entries(sources)) if (map.has(from)) { map.set(to, map.get(from)); map.delete(from); moved.push(name); }
        return { from, to, moved };
      },
      /**
       * Change the key itself. That is not the same as renaming: every card
       * key carries it, so every card moves with it.
       *
       * It is the only change that touches the past — a `Plan: DRM-3` line in
       * an old commit finds no card afterwards. That is why it has a method
       * of its own and not a branch in `patch`: whoever calls it should have
       * known what they were doing.
       */
      async rekey(oldKey, newKey) {
        const row = [...projects.values()].find((p) => p.key === oldKey);
        if (!row) return null;
        if ([...projects.values()].some((p) => p.key === newKey)) return null;
        // The shelf is sorted by the key — the entry has to move, not just
        // its field.
        projects.delete(oldKey);
        row.key = newKey;
        projects.set(newKey, row);
        for (const item of items.values()) {
          if (item.project !== oldKey) continue;
          byKey.delete(item.key);
          item.project = newKey;
          item.key = `${newKey}-${item.number}`;
          byKey.set(item.key, item.id);
        }
        for (const link of links.values()) if (link.project === oldKey) link.project = newKey;
        const counter = counters.get(oldKey);
        if (counter !== undefined) { counters.set(newKey, counter); counters.delete(oldKey); }
        return clone(row);
      },

      async patch(key, changes) {
        const row = [...projects.values()].find((p) => p.key === key);
        if (!row) return null;
        if (changes.name !== undefined) row.name = changes.name;
        if (changes.repo !== undefined) row.repo = changes.repo;
        if (changes.people !== undefined) row.people = changes.people;
        if (changes.language !== undefined) row.language = changes.language;
        if (changes.publish !== undefined) row.publish = changes.publish;
        if (changes.ladder !== undefined) row.ladder = changes.ladder;
        return clone(row);
      },
      async list() { return clone([...projects.values()]); },
      /** A clean start for one project: every card, link and chronicle line goes; the project, its people and keys stay. */
      async wipe(key) {
        project(key);
        const gone = [...items.values()].filter((item) => item.project === key);
        const ids = new Set(gone.map((item) => item.id));
        for (const item of gone) { items.delete(item.id); byKey.delete(item.key); }
        for (const [id, link] of links) if (link.project === key || ids.has(link.from) || ids.has(link.to)) links.delete(id);
        for (let i = events.length - 1; i >= 0; i--) if (ids.has(events[i].item)) events.splice(i, 1);
        for (const [rid, r] of releases) if (r.project === key) releases.delete(rid);
        counters.set(key, 0);
        return { project: key, removed: gone.length };
      },
    },

    vocab: {
      async set(projectKey, entries) { project(projectKey); vocab.set(projectKey, clone(entries)); return clone(entries); },
      async get(projectKey) { return clone(vocab.get(projectKey) ?? []); },
    },

    items: {
      async create(projectKey, fields) {
        project(projectKey);
        const number = (counters.get(projectKey) ?? 0) + 1;
        counters.set(projectKey, number);
        const stamp = now();
        const row = {
          id: mintId(),
          key: itemKey(projectKey, number),
          project: projectKey,
          number,
          kind: fields.kind,
          state: fields.state ?? bornIn(fields.kind),
          title: fields.title,
          text: fields.text ?? '',
          module: fields.module ?? [],
          stack: fields.stack ?? [],
          suggestions: fields.suggestions ?? { module: [], stack: [] },
          person: fields.person ?? null,
          gate: fields.gate ?? null,
          target: fields.target ?? null,
          runner: fields.runner ?? 'here',
          visibility: fields.visibility ?? 'internal',
          heartbeat: null,
          reservation: null,
          due: fields.due ?? null,
          files: fields.files ?? [],
          source: fields.source ?? 'human',
          foreignId: fields.foreignId ?? null,
          count: fields.count ?? null,
          lastSeen: fields.lastSeen ?? null,
          permalink: fields.permalink ?? null,
          level: fields.level ?? null,
          created: stamp,
          changed: stamp,
          createdBy: fields.createdBy ?? null,
        };
        items.set(row.id, row);
        byKey.set(row.key, row.id);
        return shapeItem(clone(row));
      },
      async byId(id) { const row = items.get(id); return row ? shapeItem(clone(row)) : null; },
      /** The card behind a foreign fingerprint — the path that keeps two hundred notes from becoming two hundred cards. */
      async byForeign(projectKey, foreignId) {
        for (const row of items.values()) {
          if (row.project === projectKey && row.foreignId === foreignId) return shapeItem(clone(row));
        }
        return null;
      },
      async get(key) { const id = byKey.get(key); return id ? shapeItem(clone(items.get(id))) : null; },
      /**
       * Change the key itself. That is not the same as renaming: every card
       * key carries it, so every card moves with it.
       *
       * It is the only change that touches the past — a `Plan: DRM-3` line in
       * an old commit finds no card afterwards. That is why it has a method
       * of its own and not a branch in `patch`: whoever calls it should have
       * known what they were doing.
       */
      async rekey(oldKey, newKey) {
        const row = [...projects.values()].find((p) => p.key === oldKey);
        if (!row) return null;
        if ([...projects.values()].some((p) => p.key === newKey)) return null;
        // The shelf is sorted by the key — the entry has to move, not just
        // its field.
        projects.delete(oldKey);
        row.key = newKey;
        projects.set(newKey, row);
        for (const item of items.values()) {
          if (item.project !== oldKey) continue;
          byKey.delete(item.key);
          item.project = newKey;
          item.key = `${newKey}-${item.number}`;
          byKey.set(item.key, item.id);
        }
        for (const link of links.values()) if (link.project === oldKey) link.project = newKey;
        const counter = counters.get(oldKey);
        if (counter !== undefined) { counters.set(newKey, counter); counters.delete(oldKey); }
        return clone(row);
      },

      async patch(key, changes, { expected = {} } = {}) {
        const id = byKey.get(key);
        if (!id) return null;
        const row = items.get(id);
        if (Object.entries(expected).some(([field, value]) => !isDeepStrictEqual(row[field], value))) return null;
        Object.assign(row, clone(changes), { changed: now() });
        return shapeItem(clone(row));
      },
      /** The card goes, with its links and its chronicle — gradula.mjs decides whether it may. */
      async remove(key) {
        const id = byKey.get(key);
        if (!id) return false;
        items.delete(id); byKey.delete(key);
        for (const [lid, link] of links) if (link.from === id || link.to === id) links.delete(lid);
        for (let i = events.length - 1; i >= 0; i--) if (events[i].item === id) events.splice(i, 1);
        return true;
      },
      async list(projectKey, filter = {}) {
        let rows = [...items.values()].filter((row) => row.project === projectKey);
        if (filter.state) rows = rows.filter((r) => r.state === filter.state);
        if (filter.kind) rows = rows.filter((r) => r.kind === filter.kind);
        if (filter.module) rows = rows.filter((r) => r.module.includes(filter.module));
        if (filter.stack) rows = rows.filter((r) => r.stack.includes(filter.stack));
        if (filter.person) rows = rows.filter((r) => r.person === filter.person);
        if (filter.q) {
          const needle = String(filter.q).toLowerCase();
          rows = rows.filter((r) => `${r.title}\n${r.text}`.toLowerCase().includes(needle));
        }
        rows.sort((a, b) => (a.id < b.id ? -1 : 1));
        return rows.slice(0, filter.limit ?? 500).map((row) => shapeItem(clone(row)));
      },
    },

    links: {
      async add({ project, from, to, kind, source = 'human', reason = null, confirmed = true }) {
        const row = { id: mintId(), project, from, to, kind, source, reason, confirmed, created: now() };
        links.set(row.id, row);
        return clone(row);
      },
      async list(projectKey) { return clone([...links.values()].filter((l) => l.project === projectKey)); },
      async of(itemId) { return clone([...links.values()].filter((l) => l.from === itemId || l.to === itemId)); },
      async remove(id) { return links.delete(id); },
    },

    events: {
      async add({ item, actor, verb, data = null }) {
        seqCounter += 1;
        // `at`, the same name Postgres uses. It was `time` here, and the two
        // stores are meant to be indistinguishable: the board read `e.at` on a
        // card's chronicle and got undefined from memory, so the sheet threw
        // the moment anybody opened a card — but only against the memory
        // store, which is exactly where nobody was looking.
        const row = { id: mintId(), seq: seqCounter, item, actor, verb, data, at: now() };
        events.push(row);
        return clone(row);
      },
      async of(itemId) { return clone(events.filter((e) => e.item === itemId)); },
      /** The cards a commit already stands on as evidence — so a commit is adopted once, never twice. */
      async byRef(projectKey, ref) {
        const short = String(ref).slice(0, 12);
        const ids = new Set(events.filter((e) => e.verb === 'evidenced' && String(e.data?.ref ?? '').slice(0, 12) === short).map((e) => e.item));
        return [...items.values()].filter((it) => it.project === projectKey && ids.has(it.id)).map((it) => it.key);
      },
      /**
       * A PROJECT's history. The chronicle per card answers "what happened to
       * this thing"; this answers "what happened while I was away" — and that
       * is the question a team asks.
       */
      async all(projectKey, { since = null, after = null, limit = 200 } = {}) {
        const mine = new Set([...items.values()].filter((i) => i.project === projectKey).map((i) => i.id));
        // The insertion order IS the order. Sorting by identifier would be
        // wrong: two entries from the same millisecond differ only in their
        // random part — for a log that is no order at all.
        //
        // `at` is what Postgres calls the column and `time` is what this store
        // calls the field. Asking for only one of them here meant that every
        // report over a period came back EMPTY from memory and full from
        // Postgres — the two stores are meant to be indistinguishable, and a
        // test suite that runs against both saw nothing, because no test asked
        // for a period.
        const when = (e) => e.at;
        return clone(
          events
            .filter((e) => mine.has(e.item)
              && (after === null || e.seq > Number(after))
              && (!since || when(e) > since))
            .slice()
            .reverse()
            .slice(0, limit),
        );
      },
      /**
       * When each card was last touched — one pass over the chronicle, so the
       * board can say how long something has lain there without asking per
       * card.
       */
      async lastTouched(projectKey) {
        const mine = new Set([...items.values()].filter((i) => i.project === projectKey).map((i) => i.id));
        const out = new Map();
        for (const event of events) {
          if (!mine.has(event.item)) continue;
          const when = event.at;
          if (!out.has(event.item) || when > out.get(event.item)) out.set(event.item, when);
        }
        return out;
      },
      /**
       * Where each card was last seen deployed, per lane — the `deployed`
       * notes folded to one answer per card, in one pass (deployed.mjs,
       * deployedOf, has the same fold for one card's chronicle).
       */
      async deployed(projectKey) {
        const mine = new Set([...items.values()].filter((i) => i.project === projectKey).map((i) => i.id));
        const out = new Map();
        for (const event of events) {
          if (event.verb !== 'deployed' || !mine.has(event.item)) continue;
          const environment = event.data?.environment;
          if (environment !== 'development' && environment !== 'production') continue;
          const when = event.data?.at ?? event.at;
          const row = out.get(event.item) ?? { development: false, production: false, at: { development: null, production: null } };
          if (!row.at[environment] || when > row.at[environment]) row.at[environment] = when;
          row[environment] = true;
          out.set(event.item, row);
        }
        return new Map([...out].map(([id, row]) => [id, clone(row)]));
      },
    },

    sentry: {
      async set(projectKey, connection) { project(projectKey); sentry.set(projectKey, clone(connection)); return clone(connection); },
      async get(projectKey) { return clone(sentry.get(projectKey) ?? null); },
    },

    /**
     * A project's heralds. The key lies here and goes out only when `raw` is
     * asked for explicitly — outward it reads "set".
     */
    dokploy: {
      async set(projectKey, connection) {
        project(projectKey);
        const before = dokploy.get(projectKey);
        // A key sent empty does NOT delete — the same rule as at the herald
        const row = { ...clone(connection), token: connection.token ? String(connection.token) : before?.token ?? null };
        dokploy.set(projectKey, row);
        return clone(row);
      },
      async get(projectKey) { return clone(dokploy.get(projectKey) ?? null); },
    },

    eas: {
      async set(projectKey, connection) {
        project(projectKey);
        const before = eas.get(projectKey);
        const row = { ...clone(connection), token: connection.token ? String(connection.token) : before?.token ?? null };
        eas.set(projectKey, row);
        return clone(row);
      },
      async get(projectKey) { return clone(eas.get(projectKey) ?? null); },
    },

    github: {
      async set(projectKey, connection) {
        project(projectKey);
        const before = github.get(projectKey);
        const row = { ...clone(connection), token: connection.token ? String(connection.token) : before?.token ?? null };
        github.set(projectKey, row);
        return clone(row);
      },
      async get(projectKey) { return clone(github.get(projectKey) ?? null); },
    },

    /** The releases the board has spoken about — one row per lane and head, so a release is announced once. */
    releases: {
      async list(projectKey) { return [...releases.values()].filter((r) => r.project === projectKey).map(clone); },
      async add(projectKey, release) {
        project(projectKey);
        const row = { ...clone(release), project: projectKey, created: now() };
        releases.set(`${projectKey}:${row.id}`, row);
        return clone(row);
      },
    },
    heraldDeliveries: {
      async get(herald, key) { return clone(heraldDeliveries.get(JSON.stringify([herald, key])) ?? null); },
      async set(herald, key, data) {
        if (!heralds.has(herald)) throw new Error('No such herald.');
        heraldDeliveries.set(JSON.stringify([herald, key]), clone(data));
      },
    },
    heralds: {
      async list(projectKey, { raw = false } = {}) {
        const out = [...heralds.values()].filter((b) => b.project === projectKey);
        out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return out.map((b) => (raw ? clone(b) : { ...clone(b), token: b.token ? 'set' : null }));
      },
      async set(projectKey, herald) {
        project(projectKey);
        const id = herald.id ?? mintId();
        const alt = heralds.get(id);
        if (alt && alt.project !== projectKey) throw new Error('No such herald.');
        const row = {
          ...(alt ?? { created: now() }),
          ...clone(herald),
          id,
          project: projectKey,
          // A key sent empty does NOT delete — otherwise a form that only
          // changes the filter takes the herald's voice.
          schedule: herald.schedule ?? alt?.schedule ?? {},
          token: herald.token ? String(herald.token) : alt?.token ?? null,
        };
        heralds.set(id, row);
        return { ...clone(row), token: row.token ? 'set' : null };
      },
      async remove(id) {
        for (const key of heraldDeliveries.keys()) if (JSON.parse(key)[0] === String(id)) heraldDeliveries.delete(key);
        return heralds.delete(String(id));
      },
    },

    tokens: {
      async mint({ project, name, createdBy = null, kind = 'human', owner = null, ownerName = null }) {
        const raw = mintToken();
        const row = { id: mintId(), project, name, kind, hash: hashToken(raw), created: now(), createdBy, owner, ownerName, usedAt: null, revokedAt: null };
        tokens.set(row.id, row);
        return { token: raw, entry: clone(row) };
      },
      async verify(raw) {
        const hash = hashToken(raw);
        for (const row of tokens.values()) {
          if (row.hash === hash && !row.revokedAt) { row.usedAt = now(); return clone({ ...row, kind: row.kind ?? 'human' }); }
        }
        return null;
      },
      async list(projectKey) {
        return clone([...tokens.values()].filter((t) => t.project === projectKey).map(({ hash, ...rest }) => rest));
      },
      async revoke(id) { const row = tokens.get(id); if (!row) return false; row.revokedAt = now(); return true; },
    },

    /**
     * A MACHINE ASKING TO REGISTER. The CLI creates one, a signed-in person
     * approves it, and the CLI collects the key — so a key is never carried by
     * hand. Short-lived (DEVICE_TTL); an unresolved request simply expires,
     * the same design as a runner's lease: nothing to clean up.
     */
    devices: {
      async open({ project, machine }) {
        const row = { id: mintId(), project, machine, code: deviceCode(), status: 'pending', token: null, agentToken: null, owner: null, ownerName: null, created: now() };
        devices.set(row.id, row);
        return clone(row);
      },
      async get(id) {
        const row = devices.get(String(id));
        if (!row) return null;
        if (row.status === 'pending' && Date.now() - new Date(row.created).getTime() > DEVICE_TTL) { row.status = 'expired'; }
        return clone(row);
      },
      async pending(projectKey) {
        const fresh = Date.now() - DEVICE_TTL;
        return clone([...devices.values()]
          .filter((r) => r.project === projectKey && r.status === 'pending' && new Date(r.created).getTime() > fresh)
          .map(({ token, agentToken, ...rest }) => rest));
      },
      // Two keys ride on one request: the person's and the one for their AI
      // sessions (src/gradula.mjs approveDevice). Both are handed over together.
      async resolve(id, { status, token = null, agentToken = null, owner = null, ownerName = null }) {
        const row = devices.get(String(id));
        if (!row || row.status !== 'pending') return null;
        Object.assign(row, { status, token, agentToken, owner, ownerName, resolvedAt: now() });
        return clone(row);
      },
      // The tokens are handed over EXACTLY ONCE: the CLI reads them, and they
      // are gone from the record — a device request is not a place a key lives.
      async claim(id) {
        const row = devices.get(String(id));
        if (!row || row.status !== 'approved' || !row.token) return null;
        const out = { token: row.token, agentToken: row.agentToken ?? null };
        row.token = null;
        row.agentToken = null;
        return out;
      },
    },
  };
}
