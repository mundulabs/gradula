/**
 * The start. Deliberately few lines: all that stands here is the question of
 * which store holds and which port the doors hang on.
 *
 * `GRADULA_STORE=memory` starts without a database — for `npm run dev` and
 * for a first look. The state is then gone the moment the process is, and the
 * opening line says so. Everything else needs `GRADULA_DB_URL`.
 */

import { createServer } from 'node:http';
import { createGradula } from './gradula.mjs';
import { createMemoryStore } from './store.mjs';
import { createApi } from './api.mjs';
import { createAuth } from './auth.mjs';
import { createStatic } from './static.mjs';
import { createLive } from './live.mjs';
import { createSystemPoll } from './system.mjs';
import { withoutKey as telegramError } from './telegram.mjs';
import { watch } from './watch.mjs';
import { importHostedGraph } from './hosted-graph.mjs';

const port = Number(process.env.PORT ?? 3200);
const host = process.env.HOST ?? '0.0.0.0';
const adminToken = process.env.GRADULA_ADMIN_TOKEN ?? null;

async function chooseStore() {
  if (process.env.GRADULA_STORE === 'memory' || !process.env.GRADULA_DB_URL) {
    if (!process.env.GRADULA_DB_URL && process.env.GRADULA_STORE !== 'memory') {
      console.warn('[gradula] Without GRADULA_DB_URL the store lives in memory — every card is gone at the next restart.');
    }
    return createMemoryStore();
  }
  const { createPgStore } = await import('./store-pg.mjs');
  const store = await createPgStore(process.env.GRADULA_DB_URL);
  // Create the tables when they are missing. `create table if not exists` is
  // no stopgap here but the whole path: a service that finds an empty
  // database on its first start should run, not wait for a person with an
  // SQL file.
  await store.migrate();
  return store;
}

const store = await chooseStore();
/**
 * The live channel. It belongs to the service, not to the door: the verbs
 * arise in the verbs, and that is where it is called.
 */
// Our own crash first: a tool that puts other people's crashes on the board
// should be able to put its own there.
const sentry = await watch();

/**
 * The system poll hangs on the live line's audience: it beats while a
 * project has a listener and stops when the last one leaves. `createLive`
 * needs the poll and the poll needs `gradula`, which needs `live` — so the
 * poll is wired through a holder that is filled one line later.
 */
const poll = { current: null };
const live = createLive({ onPresence: (projectKey, count) => poll.current?.presence(projectKey, count) });
const gradula = createGradula(store, { origin: process.env.PUBLIC_ORIGIN ?? null, live, houseKey: process.env.TELEGRAM_BOT_TOKEN || null });
poll.current = createSystemPoll({ gradula, live });
// Failure retains the last valid graph and is visible in deployment logs.
// Retry only this image's artifact; never scan developer checkouts here.
if (process.env.GRADULA_HOSTED_GRAPH) {
  let pending = false;
  const publish = async () => {
    if (pending) return;
    pending = true;
    try { await importHostedGraph(gradula, {path:process.env.GRADULA_HOSTED_GRAPH}); clearInterval(retry); }
    catch (error) { console.error(`[gradula] hosted graph unavailable: ${error.message}`); }
    finally { pending = false; }
  };
  const retry = setInterval(publish, 60_000); retry.unref();
  void publish();
}

/**
 * The sign-in is optional: without its four values it does not exist, and the
 * service runs anyway — machines come in with their project key. A service
 * that refuses to start without a sign-in would, in development, only be
 * in the way.
 */
const auth = createAuth({
  issuer: process.env.OIDC_ISSUER,
  clientId: process.env.OIDC_CLIENT_ID,
  audience: process.env.OIDC_AUDIENCE,
  secret: process.env.GRADULA_SESSION_SECRET,
  origin: process.env.PUBLIC_ORIGIN,
  role: process.env.GRADULA_ROLE ?? 'dev',
  rollenClaim: process.env.OIDC_ROLLEN_CLAIM,
  secure: (process.env.PUBLIC_ORIGIN ?? '').startsWith('https://'),
});

/** The built board. If it is missing the service still answers — only without a surface. */
const staticFiles = createStatic(process.env.GRADULA_WEB ?? new URL('../web/dist', import.meta.url).pathname);

/**
 * The quiet beat. Look once a quarter of an hour to see whether a report is
 * due — not every minute: a schedule whose finest unit is an hour needs no
 * minute accuracy, and a service that keeps waking up costs without giving
 * anything back.
 *
 * `unref` is deliberate: this beat must not hold up a restart.
 */
const TICK_MS = 15 * 60_000;
const tick = setInterval(async () => {
  try {
    for (const project of await store.projects.list()) {
      const sent = await gradula.sendDueReports(project.key);
      for (const one of sent.filter((o) => o.sent)) console.log(`[gradula] report → ${one.name}`);
      // And put back what was left lying. On the same beat on purpose: a
      // second timer is a second thing that can quietly stop.
      for (const back of await gradula.releaseStalled(project.key)) {
        console.log(`[gradula] ${back.card} → ready (nothing for ${back.hours}h)`);
      }
      // And ask Sentry. The webhook is the fast road; this is the one that
      // still works when the hook was misconfigured, refused or simply never
      // set up — which was the case for every incident until today.
      try {
        const pulled = await gradula.pullSentry(project.key);
        if (pulled.fresh) console.log(`[gradula] ${project.key}: ${pulled.fresh} new incidents from Sentry`);
      } catch { /* no connection, no crash reports — that is not an error */ }
    }
  } catch (error) {
    // A quiet beat must not take the service with it.
    console.error('[gradula] schedule:', error.message);
  }
}, TICK_MS);
tick.unref?.();

// Pipeline subscriptions remain live even when nobody has the board open.
// Each pass finishes before the next starts; unchanged progress is silent.
let pipelineBusy = false;
const pipelineTick = async () => {
  if (pipelineBusy) return;
  pipelineBusy = true;
  try {
    for (const project of await store.projects.list()) {
      try {
        const results = await gradula.pollPipelines(project.key);
        for (const result of results) if (!result.sent) console.warn(`[gradula] pipeline ${project.key}: ${result.reason ?? 'not delivered'}`);
      } catch (error) { console.warn(`[gradula] pipeline ${project.key}: ${telegramError(error.message)}`); }
    }
  } catch (error) { console.warn(`[gradula] pipeline: ${telegramError(error.message)}`); }
  finally { pipelineBusy = false; }
};
const pipelineClock = setInterval(pipelineTick, 60_000);
pipelineClock.unref?.();
void pipelineTick().catch((error) => console.warn(`[gradula] pipeline: ${telegramError(error.message)}`));

const handle = createApi(gradula, { adminToken, auth, staticFiles, live, watcher: sentry, origin: process.env.PUBLIC_ORIGIN ?? null });

if (!adminToken) console.warn('[gradula] Without GRADULA_ADMIN_TOKEN there is no admin door (503).');
if (!auth) console.warn('[gradula] Without OIDC_ISSUER/CLIENT_ID/AUDIENCE and GRADULA_SESSION_SECRET nobody can sign in — machines still can.');

createServer(handle).listen(port, host, () => {
  console.log(`[gradula] listening on http://${host}:${port} — store: ${store.kind}`);
});
