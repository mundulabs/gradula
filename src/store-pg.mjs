/**
 * The same contract as store.mjs, only on Postgres. Word for word the same
 * methods — `tests/store.test.mjs` runs over both, and that is exactly why
 * they must not drift apart.
 *
 * Three places that are easily built wrongly and deliberately stand like this:
 *
 * ONE: the card number comes from a counter ON THE PROJECT, not from
 * `max(number)+1`. Two callers creating a card in the same instant would
 * otherwise read the same maximum and write the same number. `update … set
 * counter = counter + 1 returning counter` is a single statement and cannot
 * do that.
 *
 * TWO: times leave the store as ISO strings, as they do in memory. A `Date`
 * here and a string there would be a difference only the caller notices, and
 * only later.
 *
 * THREE: what is stored is the FINGERPRINT of a key, never the key. Whoever
 * reads the database can open nothing with it.
 */

import pg from 'pg';
import { mintId, itemKey } from './ids.mjs';
import { bornIn } from './spec.mjs';
import { hashToken, mintToken, shapeItem, deviceCode, DEVICE_TTL } from './store.mjs';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const asItem = (row) => row && shapeItem({
  id: row.id,
  key: row.key,
  project: row.project,
  number: row.number,
  kind: row.kind,
  state: row.state,
  title: row.title,
  text: row.text,
  module: row.module,
  stack: row.stack,
  suggestions: row.suggestions,
  person: row.person,
  gate: row.gate,
  target: row.target,
  runner: row.runner,
  files: row.files,
  source: row.source,
  foreignId: row.foreign_id,
  count: row.count,
  // `lastSeen`, the name the rest of the house uses. It was `last_seen` here —
  // on the way IN as well — so on Postgres a Sentry card never carried one at
  // all: created without it, patched past it, read under a name nothing looks
  // for. In memory it worked, and every test runs against memory.
  lastSeen: iso(row.last_seen),
  permalink: row.permalink,
  level: row.level ?? null,
  visibility: row.visibility ?? 'internal',
  heartbeat: iso(row.heartbeat),
  reservation: row.reservation ?? null,
  // A `date` comes back as a JS Date, and String() turns that into
  // "Wed Sep 16" — but a day here is the string YYYY-MM-DD, or nothing sorts
  // any more and a comparison with "today" reads wrongly.
  due: row.due ? new Date(row.due).toISOString().slice(0, 10) : null,
  created: iso(row.created),
  changed: iso(row.changed),
  createdBy: row.created_by,
});

/**
 * THE RENAMING. It runs BEFORE the schema and is the most dangerous code in
 * this house.
 *
 * Until 09.09. the tables and columns were German. A `create table if not
 * exists project` would have created an EMPTY table beside them and left
 * `projekt` untouched — the service would have started, the board would have
 * been empty, and everything would still be there, only out of reach. That is
 * worse than a crash: a crash is noticed.
 *
 * Every line is one rule: rename IF the old one exists and the new one does
 * not. So the block does nothing on a fresh database, exactly once on an old
 * one, and any number of times afterwards without effect.
 */
export const RENAMING = `
do $$
declare r record;
begin
  for r in select * from (values
      ('projekt','project'), ('karte','card'), ('faden','link'), ('chronik','history'),
      ('schluessel','token_key'), ('bote','herald'), ('vokabular','vocabulary')
    ) as t(from_name, to_name)
  loop
    if to_regclass(r.from_name) is not null and to_regclass(r.to_name) is null then
      execute format('alter table %I rename to %I', r.from_name, r.to_name);
    end if;
  end loop;

  for r in select * from (values
      ('card','art','kind'), ('card','zustand','state'), ('card','titel','title'),
      ('card','modul','module'), ('card','stapel','stack'), ('card','vorschlaege','suggestions'),
      ('card','tor','gate'), ('card','ziel','target'), ('card','laeufer','runner'),
      ('card','dateien','files'), ('card','quelle','source'), ('card','fremd_id','foreign_id'),
      ('card','haeufigkeit','count'), ('card','zuletzt','last_seen'), ('card','verweis','permalink'),
      ('card','sichtbar','visibility'), ('card','projekt','project'), ('card','nummer','number'),
      ('card','erstellt','created'), ('card','geaendert','changed'), ('card','erstellt_von','created_by'),
      ('project','zaehler','counter'), ('project','erstellt','created'),
      ('link','projekt','project'), ('link','von','from_id'), ('link','nach','to_id'),
      ('link','art','kind'), ('link','quelle','source'), ('link','grund','reason'),
      ('link','bestaetigt','confirmed'), ('link','erstellt','created'),
      ('history','karte','card'), ('history','akteur','actor'), ('history','daten','data'),
      ('history','zeit','at'), ('history','folge','seq'),
      ('token_key','projekt','project'), ('token_key','art','kind'), ('token_key','erstellt','created'),
      ('token_key','erstellt_von','created_by'), ('token_key','benutzt','used_at'),
      ('token_key','widerrufen','revoked_at'),
      ('herald','projekt','project'), ('herald','art','kind'), ('herald','erstellt','created'),
      ('herald','aktiv','active'),
      ('vocabulary','projekt','project'), ('vocabulary','modul','module'),
      ('sentry','projekt','project'), ('sentry','sentry_projekt','sentry_project'),
      ('sentry','basis','base'), ('sentry','haken_geheimnis','hook_secret'), ('sentry','gesetzt','set_at')
    ) as t(tbl, from_name, to_name)
  loop
    if to_regclass(r.tbl) is not null
       and exists (select 1 from information_schema.columns
                    where table_name = r.tbl and column_name = r.from_name and table_schema = current_schema())
       and not exists (select 1 from information_schema.columns
                    where table_name = r.tbl and column_name = r.to_name and table_schema = current_schema())
    then
      execute format('alter table %I rename column %I to %I', r.tbl, r.from_name, r.to_name);
    end if;
  end loop;
end $$;
`;

/**
 * THE WORDS IN THE DATA. The columns are now called by English names, their
 * CONTENT is not: a card still stands in "arbeit". This too is repeatable — a second run
 * finds nothing left to do.
 *
 * Order does not matter among the verbs (the sets are disjoint), nor among
 * the states. What is NOT here stays as it is and shows up later as an
 * unknown value — better than quietly guessing something wrong.
 */
export const WORDS_IN_DATA = `
update card set kind = case kind
  when 'idee' then 'idea' when 'aufgabe' then 'task' when 'vorhaben' then 'venture'
  when 'meilenstein' then 'milestone' when 'entscheidung' then 'decision' else kind end;
update card set state = case state
  when 'ideen' then 'ideas' when 'bereit' then 'ready' when 'arbeit' then 'making'
  when 'pruefung' then 'review' when 'fertig' then 'done' when 'eis' then 'ice' else state end;
update card set target = case target
  when 'notiz' then 'note' when 'dokument' then 'document' when 'vorschau' then 'preview'
  when 'zweig' then 'branch' when 'auslieferung' then 'release' else target end;
update card set runner = case runner when 'hier' then 'here' else runner end;
update card set source = case source when 'mensch' then 'human' when 'modell' then 'model' else source end;
update card set visibility = case visibility when 'intern' then 'internal' when 'oeffentlich' then 'public' else visibility end;
update card set gate = jsonb_set(jsonb_set(gate, '{kind}', gate->'art'), '{call}', gate->'ruf') - 'art' - 'ruf'
  where gate ? 'art';
update card set gate = jsonb_set(gate, '{expect}', coalesce(gate->'erwartung','null'::jsonb)) - 'erwartung'
  where gate ? 'erwartung';
-- The VALUE inside a gate migrates too, not only its key. A gate of kind
-- "datei" was refused after the migration with "I do not know that gate kind"
-- — the card was out of reach without anything looking broken.
update card set gate = jsonb_set(gate, '{kind}', to_jsonb(
  case gate->>'kind'
    when 'befehl' then 'command' when 'datei' then 'file' when 'adresse' then 'url'
    else gate->>'kind' end))
  where gate is not null;
update link set kind = case kind
  when 'braucht' then 'needs' when 'blockiert' then 'blocks' when 'teil-von' then 'part-of'
  when 'gleicht' then 'resembles' when 'beruehrt' then 'touches' else kind end;
update link set source = case source when 'mensch' then 'human' when 'regel' then 'rule' when 'modell' then 'model' else source end;
update token_key set kind = case kind when 'mensch' then 'human' else kind end;
update history set verb = case verb
  when 'angelegt' then 'created' when 'geändert' then 'changed' when 'verschoben' then 'moved'
  when 'verknüpft' then 'linked' when 'gestartet' then 'started' when 'belegt' then 'evidenced'
  when 'vorgeschlagen' then 'suggested' when 'bestätigt' then 'confirmed' when 'gesagt' then 'said'
  when 'entschieden' then 'decided' when 'aufgenommen' then 'ingested' else verb end;
-- THE VOCABULARY STANDS IN JSON, and JSON knows no alter table. The migration
-- renamed columns and missed these two keys: the modules still carried pfade
-- and worte while labelsFor read paths and words. What one saw of it was a
-- 500 on EVERY new card (entry.paths.some on undefined) and underneath a
-- board on which nothing could be created any more.
update vocabulary set module = (
  select jsonb_agg(
    case when entry ? 'pfade'
      then jsonb_set(jsonb_set(entry, '{paths}', entry->'pfade'), '{words}', coalesce(entry->'worte', '[]'::jsonb)) - 'pfade' - 'worte'
      else entry end
    order by entry->>'id')
  from jsonb_array_elements(module) as entry)
where exists (select 1 from jsonb_array_elements(module) e where e ? 'pfade' or e ? 'worte');
`;

/**
 * THE GUARD. After the migration no German column may still stand.
 *
 * Twice I missed a column while renaming — `folge`, then `aktiv`. Both times
 * the service started, both times only the first write broke, and both times
 * the log said no more than "500". A forgotten line in a list is not noticed
 * by reading; a query that asks the database itself is.
 *
 * It throws with the names it found. A service that came up on half a
 * migration is worse than one that does not start at all.
 */
/**
 * THE SECOND GUARD: German keys INSIDE the JSON.
 *
 * The first guard asks information_schema and so falls exactly at the border
 * of a column. `card.gate` and `vocabulary.module` are columns with an inner
 * life, and a migration has already left something there twice: first the
 * gate kind, then `pfade`/`worte`. Both times the service started, both times
 * a 500 appeared only on the first write.
 */
export const GUARD_IN_DATA = `
select 'card.gate' as place, count(*)::int as rows from card
 where gate ?| array['art','ruf','erwartung']
union all
select 'vocabulary.module', count(*)::int from vocabulary
 where exists (select 1 from jsonb_array_elements(module) e where e ?| array['pfade','worte'])
`;

export const GUARD = `
select table_name, column_name from information_schema.columns
 where table_schema = current_schema()
   and column_name in (
     'art','zustand','titel','modul','stapel','vorschlaege','tor','ziel','laeufer',
     'dateien','quelle','fremd_id','haeufigkeit','zuletzt','verweis','sichtbar',
     'projekt','nummer','erstellt','geaendert','erstellt_von','zaehler','von','nach',
     'grund','bestaetigt','karte','akteur','daten','zeit','folge','benutzt','widerrufen',
     'aktiv','basis','gesetzt','haken_geheimnis','sentry_projekt'
   )
 order by table_name, column_name
`;

export const SCHEMA = `
create table if not exists project (
  id text primary key,
  key text unique not null,
  name text not null,
  repo text,
  counter integer not null default 0,
  created timestamptz not null default now()
);
create table if not exists codegraph_import (
 project text not null references project(key) on delete cascade on update cascade,
 digest text not null, actor text not null, at timestamptz not null
);
create table if not exists codegraph (
  project text primary key references project(key) on delete cascade on update cascade,
  snapshot jsonb not null
);
create table if not exists codegraph_revision (
  project text not null references project(key) on delete cascade on update cascade,
  revision text not null,
  snapshot jsonb not null,
  imported_at timestamptz not null default now(),
  primary key(project,revision)
);
create table if not exists vocabulary (
  project text primary key references project(key) on delete cascade,
  module jsonb not null default '[]'::jsonb
);
create table if not exists card (
  id text primary key,
  key text unique not null,
  project text not null references project(key) on delete cascade,
  number integer not null,
  kind text not null,
  state text not null,
  title text not null,
  text text not null default '',
  module text[] not null default '{}',
  stack text[] not null default '{}',
  suggestions jsonb not null default '{"module":[],"stack":[]}'::jsonb,
  person text,
  gate jsonb,
  target text,
  runner text not null default 'here',
  files text[] not null default '{}',
  source text not null default 'human',
  foreign_id text,
  count integer,
  last_seen timestamptz,
  permalink text,
  level text,
  created timestamptz not null default now(),
  changed timestamptz not null default now(),
  created_by text,
  unique (project, number)
);
create index if not exists karte_projekt_zustand on card (project, state);
create table if not exists link (
  id text primary key,
  project text not null references project(key) on delete cascade,
  from_id text not null references card(id) on delete cascade,
  to_id text not null references card(id) on delete cascade,
  kind text not null,
  source text not null default 'human',
  reason text,
  confirmed boolean not null default true,
  created timestamptz not null default now()
);
create index if not exists link_project on link (project);
create table if not exists history (
  id text primary key,
  -- A strict order. The identifier will not do for it: two entries from the
  -- same millisecond differ only in their random part, and a log whose order
  -- is a guess is no log.
  seq bigserial,
  card text not null references card(id) on delete cascade,
  actor text not null,
  verb text not null,
  data jsonb,
  at timestamptz not null default now()
);
create index if not exists history_card on history (card, id);
create table if not exists sentry (
  project text primary key references project(key) on delete cascade,
  org text not null,
  sentry_project text not null,
  base text not null default 'https://sentry.io/api/0',
  token text,
  hook_secret text,
  set_at timestamptz not null default now()
);
create table if not exists dokploy (
  project text primary key references project(key) on delete cascade,
  base text not null,
  token text,
  compose_id text,
  set_at timestamptz not null default now()
);
create table if not exists github (
  project text primary key references project(key) on delete cascade,
  repo text not null,
  token text,
  set_at timestamptz not null default now()
);
create table if not exists eas (
  project text primary key references project(key) on delete cascade,
  app text not null,
  token text,
  set_at timestamptz not null default now()
);
create table if not exists herald (
  id text primary key,
  project text not null references project(key) on delete cascade,
  kind text not null default 'telegram',
  name text not null,
  chat text,
  token text,
  filter jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  schedule jsonb not null default '{}'::jsonb,
  created timestamptz not null default now()
);
create index if not exists herald_project on herald (project);
-- The releases the board has spoken about: one row per lane and head (releases.mjs), so a release is announced once.
create table if not exists release (
  project text not null references project(key) on delete cascade,
  id text not null,
  lane text not null,
  at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created timestamptz not null default now(),
  primary key (project, id)
);
create table if not exists token_key (
  id text primary key,
  project text not null references project(key) on delete cascade,
  name text not null,
  -- human acts on behalf of a person, system is a rule with nobody behind it.
  -- The difference is not a label: a system may not
  -- decide.
  kind text not null default 'human',
  hash text not null unique,
  created timestamptz not null default now(),
  created_by text,
  used_at timestamptz,
  revoked_at timestamptz
);

-- A machine asking to register. It carries a token only between approval and
-- the CLI collecting it, then the column is nulled — a request is not where a
-- key lives. Unresolved rows expire by time (DEVICE_TTL), nothing cleans them.
create table if not exists device_request (
  id text primary key,
  project text not null references project(key) on delete cascade,
  machine text not null,
  code text not null,
  status text not null default 'pending',
  token text,
  agent_token text,
  owner text,
  owner_name text,
  created timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists device_pending on device_request (project, status, created);

-- Durable progress message ids survive restarts and disappear with their herald.
create table if not exists herald_delivery (
  herald text not null references herald(id) on delete cascade,
  key text not null,
  data jsonb not null,
  primary key (herald, key)
);
-- MIGRATIONS. A create table if not exists creates a MISSING table and does
-- NOT touch an existing one — a column added later is missing from every
-- database that already existed. Measured on 09.09.: kind and seq ran locally
-- (fresh tables) and would have been missing in production, broken on the
-- first key.
--
-- Every line here is repeatable on its own and must never change an existing
-- column; whoever has to rebuild something writes a new line underneath.
alter table token_key add column if not exists kind text not null default 'human';
-- A key a person minted for their own machine. The owner is the OIDC subject
-- (stable), the name is what the chronicle prints; both checked at the door,
-- so such a key never needs — and never obeys — an actor header.
alter table token_key add column if not exists owner text;
alter table token_key add column if not exists owner_name text;
-- The second key a device request carries: the one for the person's AI
-- sessions, minted beside their own on approval (src/gradula.mjs approveDevice).
alter table device_request add column if not exists agent_token text;
alter table history   add column if not exists seq bigserial;
alter table card     add column if not exists source text not null default 'human';
alter table card     add column if not exists foreign_id text;
alter table card     add column if not exists count integer;
alter table card     add column if not exists last_seen timestamptz;
alter table card     add column if not exists permalink text;
-- How bad an incident is, in Sentry's own words. Not a state: moving the card
-- does not change what the crash weighed.
alter table card     add column if not exists level text;
alter table card     add column if not exists visibility text not null default 'internal';
-- A runner's lease. Null until somebody starts; it goes stale by itself.
alter table card     add column if not exists heartbeat timestamptz;
alter table card add column if not exists reservation jsonb;
-- A date something should stand by. Only a milestone or a venture carries one
-- sensibly — a task with a deadline is a task with pressure.
alter table card     add column if not exists due date;
-- A report you have to trigger is, after two weeks, one nobody triggers. The
-- schedule belongs to the HERALD: daily for the workshop, weekly for the
-- clients, both on the same board.
alter table herald   add column if not exists schedule jsonb not null default '{}'::jsonb;
-- Aliases: one person, one name. The chronicle stored a SENTENCE where a name
-- belongs -- david, via key, in brackets -- and the German build of the same
-- service wrote a second spelling of it: four rows on the real board, all of
-- them one person. The sentences stay (a chronicle nobody may edit is the
-- point of having one); this says which names mean the same person.
alter table project  add column if not exists people jsonb not null default '{}'::jsonb;
-- The language the CARDS are written in — one per board, not one per person.
-- The surface has always been switchable per reader; what was missing was the
-- other half: half a board in German and half in English is a board you
-- cannot search, and neither reader can fix it alone.
alter table project  add column if not exists language text;
-- How a card becomes public: 'hand' (someone publishes it) or 'done' (whatever reaches production, incidents excepted).
alter table project add column if not exists manual_acceptance boolean not null default false;
alter table project add column if not exists integration text not null default 'pr';
alter table project  add column if not exists publish text;
-- The ladder's style: squares, circles, diamonds (spec.mjs, LADDER_STYLES).
alter table project  add column if not exists ladder text;
-- May Gradula close an issue in Sentry when its card is done? It was computed
-- in the service, handed back in the answer, and never stored — so the one
-- line that reads it -- closeInSentry -- has never once been true on Postgres.
alter table sentry   add column if not exists write_back boolean not null default false;
-- Which Sentry environments become cards (a list, "all", or null for the
-- default: production), and how Sentry names the board's lanes. The lane map
-- was computed in the service and never stored; a dev crash on a developer's
-- own phone became an incident card (MDUS-79) because nothing said where it
-- happened.
alter table sentry   add column if not exists environments jsonb;
alter table sentry   add column if not exists lanes jsonb not null default '{}'::jsonb;
-- One compose per environment. compose_id stays as the production lane
-- for a connection made before the development lane existed.
alter table dokploy  add column if not exists composes jsonb not null default '{}'::jsonb;
-- A project key may change (DRM was the leftover of a dead name). That works
-- only when the foreign keys move with it: without ON UPDATE CASCADE the
-- first line breaks at the first card.
do $$
declare r record;
begin
  for r in select conname, conrelid::regclass as tab from pg_constraint
            where contype = 'f' and confrelid = 'project'::regclass
              and confupdtype <> 'c'
  loop
    execute format('alter table %s drop constraint %I', r.tab, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (project) references project(key) on update cascade on delete cascade',
      r.tab, r.conname);
  end loop;
end $$;
-- Pilot attempts are reserved before any paid call, including failures and crashes.
create table if not exists decision_trial (id text primary key, project text not null references project(key) on update cascade on delete cascade, campaign text not null, request_id text not null, data jsonb not null, unique(project,campaign,request_id));
-- Historical addresses cannot be reassigned to another tenant.
create table if not exists project_alias (alias text primary key, project text not null references project(key) on update cascade on delete cascade);
-- One incident per cause: the same foreign fingerprint may have only ONE
-- card in the same project. That is not convenience, it is the rule without which
-- the board drowns in its first week. It stands down here because foreign_id
-- migrated.
create unique index if not exists card_foreign on card (project, foreign_id) where foreign_id is not null;
-- Only AFTER the alter: an index on a column that does not yet exist in an
-- existing database brings the whole stack down — that is exactly how
-- production lay for seven minutes on 09.09.
create index if not exists history_seq on history (seq);
create index if not exists history_card_folge on history (card, seq);

`;

export async function createPgStore(url, { schema = null } = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.GRADULA_DB_POOL ?? 8),
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  const q = (text, values) => pool.query(text, values);

  if (schema) await pool.query(`create schema if not exists ${schema}`);

  const store = {
    kind: schema ? `postgres (${schema})` : 'postgres',
    /**
     * Three steps, and the order is the whole thing: first rename the tables
     * and columns (or the schema creates empty twins), then create and
     * migrate the schema, then the words inside the data.
     */
    async migrate() {
      await q(RENAMING);
      await q(SCHEMA);
      await q(WORDS_IN_DATA);
      const { rows } = await q(GUARD);
      if (rows.length) {
        const left = rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ');
        throw new Error(`Migration incomplete — these columns were never renamed: ${left}`);
      }
      const inside = (await q(GUARD_IN_DATA)).rows.filter((r) => r.rows > 0);
      if (inside.length) {
        const left = inside.map((r) => `${r.place} (${r.rows})`).join(', ');
        throw new Error(`Migration incomplete — German keys are still inside JSON: ${left}`);
      }
      return true;
    },
    async close() { await pool.end(); },

    projects: {
      async create({ key, name, repo = null }) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query('lock table project, project_alias in share row exclusive mode');
          if ((await client.query('select alias from project_alias where alias=$1', [key])).rowCount) throw Object.assign(new Error('Project key is a historical address'), { code: 'taken' });
          const { rows } = await client.query(
            'insert into project (id, key, name, repo) values ($1,$2,$3,$4) returning id, key, name, repo, people, language, publish, ladder, manual_acceptance as "manualAcceptance", integration, created',
            [mintId(), key, name, repo]);
          await client.query('commit');
          return { ...rows[0], created: iso(rows[0].created) };
        } catch (error) { await client.query('rollback'); throw error; }
        finally { client.release(); }
      },
      /** A clean start for one project: cards, links and history go (cascade); the project row, people and keys stay. */
      async wipe(key) {
        const { rowCount } = await q('delete from card where project = $1', [key]);
        await q('delete from release where project = $1', [key]);
        // the counter lives ON the project (see the header): a clean start begins at 1 again, as in memory
        await q('update project set counter = 0 where key = $1', [key]);
        return { project: key, removed: rowCount };
      },
      async get(key) {
        const { rows } = await q('select id, key, name, repo, people, language, publish, ladder, manual_acceptance as "manualAcceptance", integration, created from project where key = $1', [key]);
        return rows[0] ? { ...rows[0], created: iso(rows[0].created) } : null;
      },
      /** Runtime connections can move separately from the project identity. */
      async moveRuntimeConnections(from, to) {
        if (from === to) throw new Error('Different projects required');
        const client = await pool.connect();
        try {
          await client.query('begin');
          const projects = await client.query('select key from project where key = any($1::text[]) order by key for update', [[from, to]]);
          if (projects.rowCount !== 2) throw new Error('Both projects must exist');
          const tables = ['sentry', 'dokploy', 'eas'];
          for (const table of tables) {
            const found = await client.query(`select project from ${table} where project = $1`, [to]);
            if (found.rowCount) throw new Error('Destination already has runtime connections');
          }
          const moved = [];
          for (const table of tables) {
            const result = await client.query(`update ${table} set project = $2 where project = $1`, [from, to]);
            if (result.rowCount) moved.push(table);
          }
          await client.query('commit');
          return { from, to, moved };
        } catch (error) { await client.query('rollback'); throw error; }
        finally { client.release(); }
      },

      async resolve(key) {
        const { rows } = await q('select key from project where key=$1 union all select project as key from project_alias where alias=$1 limit 1', [key]);
        return rows[0]?.key ?? null;
      },
      async aliases(key) {
        const { rows } = await q('select alias from project_alias where project=$1 order by alias', [key]);
        return rows.map(row => row.alias);
      },
      async rekey(oldKey, newKey, actor = 'admin') {
        const client = await pool.connect();
        try {
          await client.query('begin');
          // Serialize namespace changes, including concurrent project creation.
          await client.query('lock table project, project_alias in share row exclusive mode');
          const taken = await client.query('select key from project where key=$1 union all select alias from project_alias where alias=$1', [newKey]);
          if (taken.rowCount) { await client.query('rollback'); return null; }
          const { rows } = await client.query(
            'update project set key = $2 where key = $1 returning id, key, name, repo, people, language, publish, ladder, manual_acceptance as "manualAcceptance", integration, created',
            [oldKey, newKey],
          );
          if (!rows[0]) { await client.query('rollback'); return null; }
          // The foreign key has already migrated (on update cascade), so the
          // cards already carry the NEW project key. Only their own key is
          // text and has to be written again.
          const cards = await client.query(
            `update card set key = $1 || '-' || number,
             title = regexp_replace(title, $2, $3, 'g'),
             text = regexp_replace(text, $2, $3, 'g') where project = $1 returning id, key, number`,
            [newKey, `\\y${oldKey}-([0-9]+)\\y`, `${newKey}-\\1`]);
          for (const card of cards.rows) await client.query(
            'insert into history (id, card, actor, verb, data) values ($1,$2,$3,$4,$5::jsonb)',
            [mintId(), card.id, actor, 'changed', JSON.stringify({ rekey: { from: `${oldKey}-${card.number}`, to: card.key } })]);
          await client.query('insert into project_alias(alias, project) values($1,$2)', [oldKey, newKey]);
          await client.query('commit');
          return { ...rows[0], created: iso(rows[0].created) };
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      },

      /** Name and repository change; the key only through `rekey`. */
      async patch(key, changes) {
        const sets = [];
        const values = [];
        for (const [name, column] of [['name', 'name'], ['repo', 'repo'], ['language', 'language'], ['publish', 'publish'], ['ladder', 'ladder'], ['manualAcceptance', 'manual_acceptance'], ['integration', 'integration']]) {
          if (changes[name] !== undefined) { values.push(changes[name]); sets.push(`${column} = $${values.length}`); }
        }
        // A map, not a column of its own: an alias is a word about a word.
        if (changes.people !== undefined) { values.push(JSON.stringify(changes.people)); sets.push(`people = $${values.length}::jsonb`); }
        if (!sets.length) return store.projects.get(key);
        values.push(key);
        const { rows } = await q(
          `update project set ${sets.join(', ')} where key = $${values.length} returning id, key, name, repo, people, language, publish, ladder, manual_acceptance as "manualAcceptance", integration, created`,
          values,
        );
        return rows[0] ? { ...rows[0], created: iso(rows[0].created) } : null;
      },
      async list() {
        const { rows } = await q('select id, key, name, repo, people, language, publish, ladder, manual_acceptance as "manualAcceptance", integration, created from project order by key');
        return rows.map((row) => ({ ...row, created: iso(row.created) }));
      },
    },

    decisions: {
      async reserve(project,trial,limits) {
        const client=await pool.connect();
        const shape=r=>r?{...r.data,project:r.project}:null;
        try {
          await client.query('begin');
          await client.query('lock table decision_trial in exclusive mode');
          const old=await client.query('select project,data from decision_trial where project=$1 and campaign=$2 and request_id=$3',[project,trial.campaign,trial.requestId]);
          if(old.rows[0]){await client.query('commit');return {fresh:false,trial:shape(old.rows[0])};}
          const count=await client.query('select count(*)::int as total, count(*) filter(where project=$1)::int as own from decision_trial where campaign=$2',[project,trial.campaign]);
          if(count.rows[0].total>=limits.total||count.rows[0].own>=limits.perProject){await client.query('commit');return null;}
          const row={...trial,feedback:[]};
          await client.query('insert into decision_trial(id,project,campaign,request_id,data) values($1,$2,$3,$4,$5)',[trial.id,project,trial.campaign,trial.requestId,JSON.stringify(row)]);
          await client.query('commit');return {fresh:true,trial:{...row,project}};
        } catch(error){await client.query('rollback');throw error;} finally {client.release();}
      },
      async finish(project,id,result) {const {rows}=await q("update decision_trial set data=jsonb_set(data,'{result}',$3::jsonb) where project=$1 and id=$2 returning project,data",[project,id,JSON.stringify(result)]);return rows[0]?{...rows[0].data,project:rows[0].project}:null;},
      async get(project,id) {const {rows}=await q('select project,data from decision_trial where project=$1 and id=$2',[project,id]);return rows[0]?{...rows[0].data,project:rows[0].project}:null;},
      async list(project,campaign) {const {rows}=await q('select project,data from decision_trial where project=$1 and campaign=$2 order by id',[project,campaign]);return rows.map(r=>({...r.data,project:r.project}));},
      async feedback(project,id,entry) {
        const {rows}=await q("update decision_trial set data=jsonb_set(data,'{feedback}',data->'feedback' || $3::jsonb) where project=$1 and id=$2 and jsonb_array_length(data->'feedback')<10 returning project,data",[project,id,JSON.stringify([entry])]);
        if(!rows[0])throw Error('Trial missing or feedback limit reached');return {...rows[0].data,project:rows[0].project};
      },
    },
    codegraphs: {
      async history(key) { const {rows}=await q('select digest,actor,at from codegraph_import where project=$1 order by at',[key]); return rows.map(r=>({...r,at:iso(r.at)})); },
      async get(key,revision=null) { const {rows}=await q(revision ? 'select snapshot from codegraph_revision where project=$1 and revision=$2' : 'select snapshot from codegraph where project=$1',revision?[key,revision]:[key]); return rows[0]?.snapshot ?? null; },
      async set(key, snapshot) {
        await q(`with saved as (
          insert into codegraph(project,snapshot) values($1,$2::jsonb)
          on conflict(project) do update set snapshot=excluded.snapshot
          where codegraph.snapshot->>'digest' is distinct from excluded.snapshot->>'digest' returning project
        ), archived as (
          insert into codegraph_revision(project,revision,snapshot)
          select project,$2::jsonb->>'revision',$2::jsonb from saved
          where $2::jsonb->>'revision' is not null and $2::jsonb->>'dirty' = 'false'
          on conflict(project,revision) do update set snapshot=excluded.snapshot,imported_at=clock_timestamp()
        ) insert into codegraph_import(project,digest,actor,at)
          select project,$2::jsonb->>'digest',$2::jsonb->>'actor',($2::jsonb->>'importedAt')::timestamptz from saved`,[key,JSON.stringify(snapshot)]);
        await q(`delete from codegraph_revision where project=$1 and revision not in
          (select revision from codegraph_revision where project=$1 order by imported_at desc,revision limit 8)`,[key]);
        return this.get(key);
      },
    },
    vocab: {
      async set(projectKey, entries) {
        await q(
          `insert into vocabulary (project, module) values ($1, $2::jsonb)
           on conflict (project) do update set module = excluded.module`,
          [projectKey, JSON.stringify(entries)],
        );
        return entries;
      },
      async get(projectKey) {
        const { rows } = await q('select module from vocabulary where project = $1', [projectKey]);
        return rows[0]?.module ?? [];
      },
    },

    items: {
      async create(projectKey, fields) {
        const { rows: counted } = await q('update project set counter = counter + 1 where key = $1 returning counter', [projectKey]);
        if (!counted[0]) throw Object.assign(new Error(`There is no project ${projectKey}`), { code: 'no-project' });
        const number = counted[0].counter;
        const { rows } = await q(
          `insert into card (id, key, project, number, kind, state, title, text, module, stack, suggestions,
                              person, gate, target, runner, files, created_by,
                              source, foreign_id, count, last_seen, permalink, level, visibility)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           returning *`,
          [
            mintId(), itemKey(projectKey, number), projectKey, number,
            fields.kind, fields.state ?? bornIn(fields.kind), fields.title, fields.text ?? '',
            fields.module ?? [], fields.stack ?? [], JSON.stringify(fields.suggestions ?? { module: [], stack: [] }),
            fields.person ?? null, fields.gate ? JSON.stringify(fields.gate) : null, fields.target ?? null,
            fields.runner ?? 'here', fields.files ?? [], fields.createdBy ?? null,
            fields.source ?? 'human', fields.foreignId ?? null, fields.count ?? null,
            fields.lastSeen ?? null, fields.permalink ?? null, fields.level ?? null, fields.visibility ?? 'internal',
          ],
        );
        return asItem(rows[0]);
      },
      async byId(id) {
        const { rows } = await q('select * from card where id = $1', [id]);
        return asItem(rows[0]) ?? null;
      },
      async byForeign(projectKey, foreignId) {
        const { rows } = await q('select * from card where project = $1 and foreign_id = $2', [projectKey, foreignId]);
        return asItem(rows[0]) ?? null;
      },
      async get(key) {
        const { rows } = await q(`select * from card where key = coalesce((select project from project_alias where alias = split_part($1, '-', 1)), split_part($1, '-', 1)) || '-' || split_part($1, '-', 2)`, [key]);
        return asItem(rows[0]) ?? null;
      },
      /** The card goes; links and chronicle follow by cascade. gradula.mjs decides whether it may. */
      async remove(key) {
        const { rowCount } = await q('delete from card where key = $1', [key]);
        return rowCount > 0;
      },
      async patch(key, changes, { expected = {} } = {}) {
        const columns = {
          kind: 'kind', state: 'state', title: 'title', text: 'text', module: 'module', stack: 'stack',
          person: 'person', target: 'target', runner: 'runner', files: 'files',
          source: 'source', foreignId: 'foreign_id', count: 'count', lastSeen: 'last_seen', permalink: 'permalink', level: 'level',
          visibility: 'visibility', heartbeat: 'heartbeat', due: 'due',
        };
        const sets = [];
        const values = [];
        for (const [name, column] of Object.entries(columns)) {
          if (changes[name] !== undefined) { values.push(changes[name]); sets.push(`${column} = $${values.length}`); }
        }
        for (const name of ['gate', 'suggestions', 'reservation']) {
          if (changes[name] !== undefined) {
            values.push(changes[name] === null ? null : JSON.stringify(changes[name]));
            sets.push(`${name} = $${values.length}::jsonb`);
          }
        }
        if (!sets.length) return store.items.get(key);
        values.push(key);
        const where = [`key = $${values.length}`];
        for (const [field, value] of Object.entries(expected)) {
          if (!['title', 'text', 'person', 'gate', 'reservation', 'state'].includes(field)) throw new Error('Unsupported comparison field');
          values.push(['gate', 'reservation'].includes(field) && value !== null ? JSON.stringify(value) : value);
          where.push(`${field} is not distinct from $${values.length}::${['gate', 'reservation'].includes(field) ? 'jsonb' : 'text'}`);
        }
        const { rows } = await q(`update card set ${sets.join(', ')}, changed = now() where ${where.join(' and ')} returning *`, values);
        return asItem(rows[0]) ?? null;
      },
      async list(projectKey, filter = {}) {
        const where = ['project = $1'];
        const values = [projectKey];
        const add = (clause, value) => { values.push(value); where.push(clause.replace('$?', `$${values.length}`)); };
        if (filter.state) add('state = $?', filter.state);
        if (filter.kind) add('kind = $?', filter.kind);
        if (filter.module) add('$? = any(module)', filter.module);
        if (filter.stack) add('$? = any(stack)', filter.stack);
        if (filter.person) add('person = $?', filter.person);
        if (filter.q) add('(title || E\'\\n\' || text) ilike $?', `%${filter.q}%`);
        values.push(Math.min(filter.limit ?? 500, 500));
        const { rows } = await q(
          `select * from card where ${where.join(' and ')} order by id asc limit $${values.length}`,
          values,
        );
        return rows.map(asItem);
      },
    },

    links: {
      async add({ project, from, to, kind, source = 'human', reason = null, confirmed = true }) {
        const { rows } = await q(
          `insert into link (id, project, from_id, to_id, kind, source, reason, confirmed)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [mintId(), project, from, to, kind, source, reason, confirmed],
        );
        return { ...rows[0], created: iso(rows[0].created) };
      },
      async list(projectKey) {
        const { rows } = await q('select * from link where project = $1 order by id', [projectKey]);
        return rows.map((row) => ({ ...row, created: iso(row.created) }));
      },
      async of(itemId) {
        const { rows } = await q('select * from link where from_id = $1 or to_id = $1 order by id', [itemId]);
        return rows.map((row) => ({ ...row, created: iso(row.created) }));
      },
      async remove(id) {
        const { rowCount } = await q('delete from link where id = $1', [id]);
        return rowCount > 0;
      },
    },

    events: {
      async retract(item, id, actor, reason) {
        const client=await pool.connect();
        try {
          await client.query('begin');
          const {rows}=await client.query("select * from history where card=$1 and id=$2 and actor=$3 and verb='evidenced' for update",[item,id,actor]);
          if(!rows.length){await client.query('rollback');return null;}
          const original=rows[0].data,at=new Date().toISOString();
          const text=`Retracted evidence ${original.ref}: ${reason}`;
          await client.query("update history set verb='said',data=$2::jsonb where id=$1",[id,JSON.stringify({line:text,retractedEvidence:original,retraction:{actor,at,reason}})]);
          const result=await client.query("insert into history (id,card,actor,verb,data) values ($1,$2,$3,'said',$4::jsonb) returning *",[mintId(),item,actor,JSON.stringify({line:text,retractedEvent:id})]);
          await client.query('commit');const row=result.rows[0];return {id:row.id,item:row.card,actor:row.actor,verb:row.verb,data:row.data,at:iso(row.at)};
        }catch(error){await client.query('rollback');throw error;}finally{client.release();}
      },
      async add({ item, actor, verb, data = null }) {
        const { rows } = await q(
          'insert into history (id, card, actor, verb, data) values ($1,$2,$3,$4,$5::jsonb) returning *',
          [mintId(), item, actor, verb, data === null ? null : JSON.stringify(data)],
        );
        const row = rows[0];
        return { id: row.id, item: row.card, actor: row.actor, verb: row.verb, data: row.data, at: iso(row.at) };
      },
      /** The cards a commit already stands on as evidence — so a commit is adopted once, never twice. */
      async byRef(projectKey, ref) {
        const { rows } = await q(
          `select distinct k.key from history h join card k on k.id = h.card where k.project = $1 and h.verb = 'evidenced' and left(h.data->>'ref', 12) = $2`,
          [projectKey, String(ref).slice(0, 12)],
        );
        return rows.map((r) => r.key);
      },
      async all(projectKey, { since = null, after = null, limit = 200 } = {}) {
        const values = [projectKey];
        let where = 'k.project = $1';
        // `to` is the STRICT mark (the sequence), `since` the human one (time).
        // Whoever wants to know exactly what they have not seen takes the sequence.
        if (after !== null) { values.push(Number(after)); where += ` and c.seq > $${values.length}`; }
        if (since) { values.push(since); where += ` and c.at > $${values.length}`; }
        values.push(Math.min(limit, 1000));
        const { rows } = await q(
          `select c.*, k.key as card_key, k.title as card_title from history c
             join card k on k.id = c.card
            where ${where} order by c.seq desc limit $${values.length}`,
          values,
        );
        return rows.map((row) => ({
          id: row.id, seq: Number(row.seq), item: row.card, card: row.card_key, title: row.card_title,
          actor: row.actor, verb: row.verb, data: row.data, at: iso(row.at),
        }));
      },
      async of(itemId, {limit=null,verbs=null}={}) {
        const values=[itemId];let where='card = $1';
        if(verbs){values.push(verbs);where+=` and verb = any($${values.length}::text[])`;}
        const order=limit===null?'asc':'desc';
        const tail=limit===null?'':` limit $${values.push(Math.max(1,Math.min(40,limit)))}`;
        const { rows } = await q(`select * from history where ${where} order by seq ${order}${tail}`,values);
        if(limit!==null)rows.reverse();
        return rows.map((row) => ({ id: row.id, item: row.card, actor: row.actor, verb: row.verb, data: row.data, at: iso(row.at) }));
      },
      /**
       * When each card was last touched. ONE grouped query for the whole
       * board — asking per card would be a request per card, and the board
       * shows forty of them.
       */
      async lastTouched(projectKey) {
        const { rows } = await q(
          `select c.card, max(c.at) as touched from history c
             join card k on k.id = c.card
            where k.project = $1 group by c.card`,
          [projectKey],
        );
        return new Map(rows.map((row) => [row.card, iso(row.touched)]));
      },
      /**
       * Where each card was last seen deployed, per lane — ONE grouped query
       * over the `deployed` notes for the whole board.
       */
      async deployed(projectKey) {
        const { rows } = await q(
          `select c.card, c.data->>'environment' as environment, max(coalesce(c.data->>'at', to_char(c.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) as at
             from history c join card k on k.id = c.card
            where k.project = $1 and c.verb = 'deployed' and c.data->>'environment' in ('development', 'production')
            group by c.card, c.data->>'environment'`,
          [projectKey],
        );
        const out = new Map();
        for (const row of rows) {
          const entry = out.get(row.card) ?? { development: false, production: false, at: { development: null, production: null } };
          entry[row.environment] = true;
          entry.at[row.environment] = row.at;
          out.set(row.card, entry);
        }
        return out;
      },
    },

    sentry: {
      async set(projectKey, connection) {
        await q(
          `insert into sentry (project, org, sentry_project, base, token, hook_secret, write_back, environments, lanes)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
           on conflict (project) do update set org = excluded.org, sentry_project = excluded.sentry_project,
             base = excluded.base, token = excluded.token, hook_secret = excluded.hook_secret,
             write_back = excluded.write_back, environments = excluded.environments, lanes = excluded.lanes, set_at = now()`,
          [projectKey, connection.org, connection.project, connection.base, connection.token ?? null,
            connection.hookSecret ?? null, connection.writeBack === true,
            connection.environments === undefined || connection.environments === null ? null : JSON.stringify(connection.environments),
            JSON.stringify(connection.lanes ?? {})],
        );
        return connection;
      },
      async get(projectKey) {
        const { rows } = await q('select * from sentry where project = $1', [projectKey]);
        const row = rows[0];
        return row ? {
          org: row.org, project: row.sentry_project, base: row.base,
          token: row.token, hookSecret: row.hook_secret,
          writeBack: row.write_back === true,
          environments: row.environments ?? null, lanes: row.lanes ?? {},
          setAt: iso(row.set_at),
        } : null;
      },
    },

    dokploy: {
      async set(projectKey, connection) {
        await q(
          `insert into dokploy (project, base, token, compose_id, composes)
           values ($1,$2,$3,$4,$5::jsonb)
           on conflict (project) do update set base = excluded.base,
             token = coalesce(excluded.token, dokploy.token),
             compose_id = excluded.compose_id, composes = excluded.composes, set_at = now()`,
          [projectKey, connection.base, connection.token ?? null, connection.composeId ?? null, JSON.stringify(connection.composes ?? {})],
        );
        return connection;
      },
      async get(projectKey) {
        const { rows } = await q('select * from dokploy where project = $1', [projectKey]);
        const row = rows[0];
        return row ? { base: row.base, token: row.token, composeId: row.compose_id, composes: row.composes ?? {}, setAt: iso(row.set_at) } : null;
      },
    },

    eas: {
      async set(projectKey, connection) {
        await q(
          `insert into eas (project, app, token) values ($1,$2,$3)
           on conflict (project) do update set app = excluded.app,
             token = coalesce(excluded.token, eas.token), set_at = now()`,
          [projectKey, connection.app, connection.token ?? null],
        );
        return connection;
      },
      async get(projectKey) {
        const { rows } = await q('select * from eas where project = $1', [projectKey]);
        const row = rows[0];
        return row ? { app: row.app, token: row.token, setAt: iso(row.set_at) } : null;
      },
    },

    github: {
      async set(projectKey, connection) {
        await q(
          `insert into github (project, repo, token) values ($1,$2,$3)
           on conflict (project) do update set repo = excluded.repo,
             token = coalesce(excluded.token, github.token), set_at = now()`,
          [projectKey, connection.repo, connection.token ?? null],
        );
        return connection;
      },
      async get(projectKey) {
        const { rows } = await q('select * from github where project = $1', [projectKey]);
        const row = rows[0];
        return row ? { repo: row.repo, token: row.token, setAt: iso(row.set_at) } : null;
      },
    },

    releases: {
      async list(projectKey) {
        const { rows } = await q('select id, lane, at, data from release where project = $1 order by at', [projectKey]);
        return rows.map((r) => ({ ...(r.data ?? {}), id: r.id, lane: r.lane, at: iso(r.at), project: projectKey }));
      },
      async add(projectKey, release) {
        await q('insert into release (project, id, lane, at, data) values ($1,$2,$3,$4,$5::jsonb) on conflict (project, id) do nothing',
          [projectKey, release.id, release.lane, release.at ?? null, JSON.stringify(release)]);
        return { ...release, project: projectKey };
      },
    },
    heraldDeliveries: {
      async get(herald, key) {
        const { rows } = await q('select data from herald_delivery where herald = $1 and key = $2', [herald, key]);
        return rows[0]?.data ?? null;
      },
      async set(herald, key, data) {
        await q('insert into herald_delivery (herald, key, data) values ($1,$2,$3) on conflict (herald, key) do update set data = excluded.data', [herald, key, JSON.stringify(data)]);
      },
    },
    heralds: {
      async list(projectKey, { raw = false } = {}) {
        const { rows } = await q('select * from herald where project = $1 order by id', [projectKey]);
        return rows.map((row) => ({
          id: row.id, project: row.project, kind: row.kind, name: row.name, chat: row.chat,
          token: raw ? row.token : (row.token ? 'set' : null),
          filter: row.filter ?? {}, schedule: row.schedule ?? {}, active: row.active, created: iso(row.created),
        }));
      },
      async set(projectKey, herald) {
        const id = herald.id ?? mintId();
        await q(
          `insert into herald (id, project, kind, name, chat, token, filter, active, schedule)
           values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::jsonb, (select schedule from herald where id = $1 and project = $2), '{}'::jsonb))
           on conflict (id) do update set kind = excluded.kind, name = excluded.name, chat = excluded.chat,
             -- A key sent empty does NOT delete.
             token = coalesce(excluded.token, herald.token),
             filter = excluded.filter, active = excluded.active, schedule = coalesce(excluded.schedule, herald.schedule)
           where herald.project = excluded.project`,
          [id, projectKey, herald.kind ?? 'telegram', herald.name ?? 'Herald', herald.chat ?? null,
           herald.token ? String(herald.token) : null, JSON.stringify(herald.filter ?? {}), herald.active !== false,
           herald.schedule === undefined ? null : JSON.stringify(herald.schedule)],
        );
        const { rows } = await q('select * from herald where id = $1 and project = $2', [id, projectKey]);
        const row = rows[0];
        if (!row) throw new Error('No such herald.');
        return { id: row.id, project: row.project, kind: row.kind, name: row.name, chat: row.chat,
          token: row.token ? 'set' : null, filter: row.filter ?? {}, schedule: row.schedule ?? {}, active: row.active, created: iso(row.created) };
      },
      async remove(id) {
        const { rowCount } = await q('delete from herald where id = $1', [String(id)]);
        return rowCount > 0;
      },
    },

    tokens: {
      async mint({ project, name, createdBy = null, kind = 'human', owner = null, ownerName = null }) {
        const raw = mintToken();
        const { rows } = await q(
          'insert into token_key (id, project, name, kind, hash, created_by, owner, owner_name) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
          [mintId(), project, name, kind, hashToken(raw), createdBy, owner, ownerName],
        );
        const row = rows[0];
        return {
          token: raw,
          entry: {
            id: row.id, project: row.project, name: row.name, kind: row.kind, hash: row.hash,
            created: iso(row.created), createdBy: row.created_by, owner: row.owner ?? null, ownerName: row.owner_name ?? null, used_at: null, revoked_at: null,
          },
        };
      },
      async verify(raw) {
        const { rows } = await q(
          'update token_key set used_at = now() where hash = $1 and revoked_at is null returning *',
          [hashToken(raw)],
        );
        const row = rows[0];
        return row ? {
          id: row.id, project: row.project, name: row.name, kind: row.kind ?? 'human', created: iso(row.created), usedAt: iso(row.used_at),
          owner: row.owner ?? null, ownerName: row.owner_name ?? null,
        } : null;
      },
      async list(projectKey) {
        const { rows } = await q(
          'select id, project, name, kind, created, created_by, owner, owner_name, used_at, revoked_at from token_key where project = $1 order by id',
          [projectKey],
        );
        return rows.map((row) => ({
          id: row.id, project: row.project, name: row.name, kind: row.kind,
          created: iso(row.created), createdBy: row.created_by, owner: row.owner ?? null, ownerName: row.owner_name ?? null,
          usedAt: iso(row.used_at), revokedAt: iso(row.revoked_at),
        }));
      },
      async revoke(id) {
        const { rowCount } = await q('update token_key set revoked_at = now() where id = $1 and revoked_at is null', [id]);
        return rowCount > 0;
      },
    },

    devices: {
      async open({ project, machine }) {
        const { rows } = await q(
          'insert into device_request (id, project, machine, code) values ($1,$2,$3,$4) returning *',
          [mintId(), project, machine, deviceCode()],
        );
        return asDevice(rows[0]);
      },
      async get(id) {
        const { rows } = await q('select * from device_request where id = $1', [String(id)]);
        if (!rows[0]) return null;
        const row = asDevice(rows[0]);
        if (row.status === 'pending' && Date.now() - new Date(row.created).getTime() > DEVICE_TTL) row.status = 'expired';
        return row;
      },
      async pending(projectKey) {
        const { rows } = await q(
          "select * from device_request where project = $1 and status = 'pending' and created > now() - ($2 || ' milliseconds')::interval order by created",
          [projectKey, String(DEVICE_TTL)],
        );
        return rows.map((r) => { const d = asDevice(r); delete d.token; delete d.agentToken; return d; });
      },
      // Two keys ride on one request: the person's and the one for their AI
      // sessions (src/gradula.mjs approveDevice). Both are handed over together.
      async resolve(id, { status, token = null, agentToken = null, owner = null, ownerName = null }) {
        const { rows } = await q(
          "update device_request set status = $2, token = $3, agent_token = $6, owner = $4, owner_name = $5, resolved_at = now() where id = $1 and status = 'pending' returning *",
          [String(id), status, token, owner, ownerName, agentToken],
        );
        return rows[0] ? asDevice(rows[0]) : null;
      },
      // Read and clear in ONE statement: a CTE selects the tokens, the update
      // nulls them, and the select returns what was there — two CLIs racing get
      // the keys at most once between them.
      async claim(id) {
        // A CTE locks and reads the tokens, then the update nulls them: the
        // values come from BEFORE the update (picked), so they are handed back
        // exactly once even if two CLIs poll at the same millisecond.
        const { rows } = await q(
          `with picked as (
             select token, agent_token from device_request where id = $1 and status = 'approved' and token is not null for update
           )
           update device_request set token = null, agent_token = null from picked where device_request.id = $1
           returning picked.token, picked.agent_token`,
          [String(id)],
        );
        return rows[0]?.token ? { token: rows[0].token, agentToken: rows[0].agent_token ?? null } : null;
      },
    },
  };

  return store;
}

// The token must be read in the SAME statement that clears it, or two CLIs
// racing both see it. So claim is a returning-update that hands back the old
// value; asDevice is only for the reads above.
function asDevice(row) {
  return {
    id: row.id, project: row.project, machine: row.machine, code: row.code,
    status: row.status, token: row.token ?? null, agentToken: row.agent_token ?? null, owner: row.owner ?? null,
    ownerName: row.owner_name ?? null,
    created: iso(row.created), resolvedAt: iso(row.resolved_at),
  };
}
