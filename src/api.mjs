/**
 * The doors. Plain node:http — no framework, because there is nothing here to
 * frame: twenty routes, one format, one check at the entrance.
 *
 * Two sorts of caller, deliberately kept apart:
 *
 * MACHINES arrive with a PROJECT KEY (`Authorization: Bearer grad_pat_…`). It
 * holds for EXACTLY ONE project — the path never names a project, the key
 * decides it. That way a mistyped path cannot write into somebody else's
 * board, and that is the whole rights check for W0.
 *
 * PEOPLE arrive later through the Mundula sign-in (W1). Until then the header
 * `X-Gradula-Actor` says on whose behalf a machine is acting — that is a
 * claim, not a check, and it stands in the chronicle exactly as such: `felix
 * (via the key "David's machine")`. Whoever derives a right from it is
 * mistaken; whoever makes a mirror of it is right.
 *
 * The ADMIN DOOR (create projects, issue keys) hangs on its own secret from
 * the environment. Without `GRADULA_ADMIN_TOKEN` it does not exist — a door
 * that stands open when unconfigured is the mistake you make once.
 */

import { sessionKeyName } from './spec.mjs';
import { GRAPH_LIMITS } from './codegraph.mjs';
import { LIVE_HEADERS } from './live.mjs';
import { Refusal } from './gradula.mjs';
import { signatureOk } from './sentry.mjs';
import { SESSION, ATTEMPT, cookiesOf } from './auth.mjs';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';

const JSON_TYPE = 'application/json; charset=utf-8';
const MAX_BODY = 512 * 1024;

/**
 * A counter per address. Without it a wrong key costs nothing, and one try
 * per millisecond is as good as a key. The house next door counts at its
 * workbook door in the same way.
 */
function counter({ window = 60_000, atMost = 240, now = Date.now } = {}) {
  const seen = new Map();
  return (who) => {
    const time = now();
    const entry = seen.get(who);
    if (!entry || time > entry.until) { seen.set(who, { count: 1, until: time + window }); return { ok: true }; }
    entry.count += 1;
    if (seen.size > 5000) for (const [k, v] of seen) if (time > v.until) seen.delete(k);
    return entry.count <= atMost ? { ok: true } : { ok: false, inSeconds: Math.ceil((entry.until - time) / 1000) };
  };
}

export function send(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

/**
 * The RAW body. Mandatory for the Sentry hook: what is signed is exactly this
 * text, and JSON reassembled from it has a different signature.
 */
async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Refusal(413, 'too-large', 'That is too much.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req, maximum = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new Refusal(413, 'too-large', 'That is too much for one card.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Refusal(400, 'form', 'The body must be an object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(400, 'json', 'That was not JSON.');
  }
}

/** Equal or not, without giving the length away. */
function same(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** A move, not content: sign-in and the way back answer with 302, not JSON. */
function redirect(res, place, cookies = []) {
  res.writeHead(302, {
    Location: place,
    'Cache-Control': 'no-store',
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
  });
  res.end();
}

const bearer = (req) => {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

export function createApi(gradula, { adminToken = null, auth = null, staticFiles = null, origin = null, live = null, watcher = null, beat = counter() } = {}) {
  /**
   * The actor, as they stand in the chronicle — never empty, never invented.
   *
   * A signed-in PERSON beats any key: their name is checked, the claim in the
   * header `X-Gradula-Actor` is not. That is why they stand there alone,
   * without a "via …".
   */
  const actorOf = (req, token, human) => {
    if (human) return human.name;
    // A system key acts for NOBODY. So it may not claim a name either: what it
    // does stands there as "Gradula (…)", with the reason the caller sends in
    // the header — the rule that ran.
    if (token?.kind === 'system') {
      const rule = String(req.headers['x-gradula-rule'] ?? '').trim().slice(0, 80);
      return rule ? `Gradula (rule: ${rule})` : `Gradula (${token.name})`;
    }
    // The header was renamed Akteur -> Actor. The OLD name still counts,
    // because a CLI lives on somebody's machine and updates on its own day —
    // and for one afternoon it did not: the server had already moved, the
    // clients had not, and the chronicle quietly stopped naming who acted. It
    // still said what happened, so nothing looked broken.
    // A key a person minted for themselves IS that person: the name was
    // checked when the key was made, so no header is read — a claim cannot
    // improve on a check.
    const handName = sessionKeyName(token, req.headers['x-gradula-coder']);
    if (token?.owner && token.ownerName) return `${token.ownerName} (${handName})`;
    const claimed = String(req.headers['x-gradula-actor'] ?? req.headers['x-gradula-akteur'] ?? '').trim().slice(0, 80);
    // The name, then the hand in brackets — `david (Davids Rechner)`. It read
    // `david (via key "Davids Rechner")` for two days, and the person whose
    // board it is asked for the shorter line: the brackets already say "via",
    // and a key is the only thing a machine can bring. Old lines stay as they
    // are and are read by the same rule (src/people.mjs).
    const machine = token ? `key "${token.name}"` : 'unknown';
    return claimed ? `${claimed} (${token ? handName : 'unknown'})` : machine;
  };

  const routes = [
    ['GET', /^\/api\/health$/, async () => ({ status: 200, body: { ok: true, store: gradula.store.kind, watching: Boolean(watcher) } })],

    // ---- Admin: only with the admin secret -----------------------------------
    ['POST', /^\/api\/admin\/projects$/, async (req, _m, ctx) => {
      ctx.needAdmin();
      const body = await readJson(req);
      return { status: 201, body: await gradula.createProject(body, 'admin') };
    }],
    ['GET', /^\/api\/admin\/projects$/, async (_req, _m, ctx) => {
      ctx.needAdmin();
      return { status: 200, body: await gradula.listProjects() };
    }],
    ['POST', /^\/api\/admin\/projects\/([A-Z]{2,8})\/runtime-connections$/, async (req, m, ctx) => {
      ctx.needAdmin();
      const { destination } = await readJson(req);
      await gradula.getProject(m[1]); await gradula.getProject(destination);
      return { status: 200, body: await gradula.store.projects.moveRuntimeConnections(m[1], destination) };
    }],
    ['POST', /^\/api\/admin\/projects\/([A-Z]{2,8})\/rekey$/, async (req, m, ctx) => ({
      status: 200, body: await gradula.rekeyProject(m[1], (await readJson(req)).key, ctx.actor),
    })],
    ['PATCH', /^\/api\/admin\/projects\/([A-Z]{2,8})$/, async (req, m, ctx) => ({
      status: 200, body: await gradula.patchProject(m[1], await readJson(req), ctx.actor),
    })],
    ['POST', /^\/api\/admin\/projects\/([A-Z]{2,8})\/keys$/, async (req, m, ctx) => {
      ctx.needAdmin();
      const body = await readJson(req);
      return { status: 201, body: await gradula.mintToken(m[1], body.name ?? 'unnamed', 'admin', body.kind) };
    }],
    // A clean start: DELETE …/projects/MDUS/items empties the board of that project. Admin key only,
    // and the project itself (people, keys, vocabulary) stays — it is the cards that go, not the house.
    ['DELETE', /^\/api\/admin\/projects\/([A-Z]{2,8})\/items$/, async (_req, m, ctx) => {
      ctx.needAdmin();
      return { status: 200, body: await gradula.wipeProject(m[1]) };
    }],
    ['GET', /^\/api\/admin\/projects\/([A-Z]{2,8})\/keys$/, async (_req, m, ctx) => {
      ctx.needAdmin();
      return { status: 200, body: await gradula.listTokens(m[1]) };
    }],
    ['DELETE', /^\/api\/admin\/keys\/([0-9A-Z]{26})$/, async (_req, m, ctx) => {
      ctx.needAdmin();
      return { status: 200, body: await gradula.revokeToken(m[1]) };
    }],

    // ---- The sign-in (moves, no JSON) ----------------------------------------
    ['GET', /^\/auth\/start$/, async (_req, _m, ctx) => {
      if (!auth) throw new Refusal(503, 'no-sign-in', 'No sign-in is set up for this service.');
      // Only our own destinations: a way back that a stranger writes into the
      // address is a redirect to their page with our name in front of it.
      const raw = ctx.url.searchParams.get('target') ?? '/';
      const target = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      const { ort, cookie } = auth.start(target);
      return { redirectTo: ort, cookies: [cookie] };
    }],
    ['GET', /^\/auth$/, async (req, _m, ctx) => {
      if (!auth) throw new Refusal(503, 'no-sign-in', 'No sign-in is set up for this service.');
      const code = ctx.url.searchParams.get('code');
      if (!code) throw new Refusal(400, 'no-code', ctx.url.searchParams.get('error') ?? 'The identity provider sent no code.');
      const { target, cookies } = await auth.finish(code, cookiesOf(req)[ATTEMPT]);
      return { redirectTo: target, cookies };
    }],
    ['POST', /^\/auth\/sign-out$/, async () => {
      if (!auth) throw new Refusal(503, 'no-sign-in', 'No sign-in is set up for this service.');
      return { redirectTo: '/', cookies: [auth.signOut()] };
    }],

    // ---- Wer bin ich ---------------------------------------------------------
    ['GET', /^\/api\/v1\/me$/, async (_req, _m, ctx) => ({
      status: 200,
      body: ctx.human
        ? { kind: 'human', name: ctx.human.name, sub: ctx.human.sub, roles: ctx.human.roles, until: new Date(ctx.human.until).toISOString() }
        : { kind: 'maschine', keys: ctx.tokenName, project: ctx.project },
    })],

    /** Every project — only for signed-in people; a key knows exactly one. */
    // ---- A person's own keys: minted here, never handed over ---------------
    // ---- A machine registering itself: `gradula login` --------------------
    // The first two need no key — the CLI has none yet — so they read the
    // project from the query and are listed in isOpen below.
    ['POST', /^\/api\/v1\/device$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      const project = String(ctx.url.searchParams.get('project') ?? body.project ?? '').toUpperCase();
      return { status: 201, body: await gradula.openDevice(project, body.machine) };
    }],
    ['GET', /^\/api\/v1\/device\/([0-9A-Z]{26})$/, async (_req, m) => ({ status: 200, body: await gradula.pollDevice(m[1]) })],
    ['GET', /^\/api\/v1\/devices$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.pendingDevices(ctx.project, ctx.human) })],
    ['POST', /^\/api\/v1\/device\/([0-9A-Z]{26})\/approve$/, async (_req, m, ctx) => ({ status: 200, body: await gradula.approveDevice(ctx.project, m[1], ctx.human) })],
    ['POST', /^\/api\/v1\/device\/([0-9A-Z]{26})\/deny$/, async (_req, m, ctx) => ({ status: 200, body: await gradula.denyDevice(ctx.project, m[1], ctx.human) })],

    ['GET', /^\/api\/v1\/keys$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.ownKeys(ctx.project, ctx.human, { holder: ctx.holder }) })],
    ['POST', /^\/api\/v1\/keys$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.mintOwnKey(ctx.project, body.name, ctx.human, { holder: ctx.holder }) };
    }],
    ['DELETE', /^\/api\/v1\/keys\/([0-9A-Z]{26})$/, async (_req, m, ctx) => ({ status: 200, body: await gradula.revokeOwnKey(ctx.project, m[1], ctx.human, { holder: ctx.holder }) })],

    ['GET', /^\/api\/v1\/projects$/, async (_req, _m, ctx) => {
      if (!ctx.human) throw new Refusal(403, 'humans-only', 'This list exists only for signed-in people.');
      return { status: 200, body: await gradula.listProjects() };
    }],

    // ---- The key's project ---------------------------------------------------
    ['GET', /^\/api\/v1\/project$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getProject(ctx.project) })],
    /**
     * Only the aliases. Renaming a project or moving its repository stays
     * behind the admin door: a project KEY is a working credential handed to
     * machines, and a machine that can rename the thing it works on is one
     * bad prompt away from a board nobody recognises.
     */
    ['PATCH', /^\/api\/v1\/project$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.patchProject(ctx.project, { people: body.people, language: body.language, publish: body.publish, ladder: body.ladder, manualAcceptance: body.manualAcceptance, integration: body.integration }, ctx.actor) };
    }],

    ['PUT', /^\/api\/v1\/codegraph$/, async (req, _m, ctx) => ({ status:200, body:await gradula.putCodegraph(ctx.project, await readJson(req, GRAPH_LIMITS.bytes), ctx.actor) })],
    ['GET', /^\/api\/v1\/codegraph$/, async (_req, _m, ctx) => {const graph=await gradula.getCodegraph(ctx.project,ctx.url.searchParams.get('revision'));return {status:200,body:graph?{...graph,documents:(graph.documents??[]).map(({markdown,...entry})=>entry)}:null};}],
    ['GET', /^\/api\/v1\/documents$/, async (_req,_m,ctx) => ({status:200,body:await gradula.publishedDocument(ctx.project,ctx.url.searchParams.get('path'),ctx.url.searchParams.get('revision'))})],
    ['POST', /^\/api\/v1\/decision-trials$/, async (req,_m,ctx) => ({status:200,body:await gradula.decisionTrial(ctx.project,await readJson(req,16000),ctx.actor,req.headers['x-gradula-typesafe-key']??null)})],
    ['POST', /^\/api\/v1\/decision-trials\/([0-9A-Z]{26})\/feedback$/, async (req,m,ctx) => ({status:200,body:await gradula.decisionFeedback(ctx.project,m[1],await readJson(req,4000),ctx.actor,ctx.person?'human':'agent')})],
    ['GET', /^\/api\/v1\/decision-trials$/, async (_req,_m,ctx) => ({status:200,body:await gradula.decisionReport(ctx.project)})],
    ['POST', /^\/api\/v1\/task-runs$/, async (req,_m,ctx) => ({status:200,body:await gradula.beginTaskRun(ctx.project,await readJson(req,4000),ctx.actor)})],
    ['POST', /^\/api\/v1\/task-runs\/([0-9A-Z]{26})\/observation$/, async (req,m,ctx) => ({status:200,body:await gradula.observeTaskRun(ctx.project,m[1],await readJson(req,4000),ctx.actor)})],
    ['GET', /^\/api\/v1\/context$/, async (_req, _m, ctx) => {
      const q = ctx.url.searchParams;
      return {status:200, body:await gradula.getContext(ctx.project, {
        q:q.get('q') ?? '', card:q.get('card'), files:q.getAll('file'), revision:q.get('revision'),
        mode:q.get('mode') ?? undefined, detail:q.get('detail') ?? undefined, from:q.get('from') ?? undefined, to:q.get('to') ?? undefined,
        depth:q.has('depth') ? Number(q.get('depth')) : undefined,
        includeInferred:q.has('includeInferred') ? q.get('includeInferred')==='true' ? true : q.get('includeInferred')==='false' ? false : 'invalid' : undefined,
        localDirty:q.has('localDirty') ? q.get('localDirty')==='true' ? true : q.get('localDirty')==='false' ? false : 'invalid' : undefined,
        limit:q.has('limit') ? Number(q.get('limit')) : undefined,
        maxBytes:q.has('maxBytes') ? Number(q.get('maxBytes')) : undefined,
      })};
    }],

    ['PUT', /^\/api\/v1\/vocabulary$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      const entries = Array.isArray(body) ? body : body.module;
      return { status: 200, body: await gradula.putVocabulary(ctx.project, entries ?? []) };
    }],
    ['GET', /^\/api\/v1\/vocabulary$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getVocabulary(ctx.project) })],

    ['GET', /^\/api\/v1\/cards$/, async (_req, _m, ctx) => {
      const q = ctx.url.searchParams;
      const filter = {};
      for (const name of ['state', 'kind', 'module', 'stack', 'area', 'person', 'q']) {
        if (q.get(name)) filter[name] = q.get(name);
      }
      if (q.get('limit')) filter.limit = Math.min(Number(q.get('limit')) || 100, 500);
      return { status: 200, body: await gradula.listItems(ctx.project, filter) };
    }],
    ['POST', /^\/api\/v1\/cards$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.addItem(ctx.project, body, ctx.actor, { system: ctx.system }) };
    }],
    ['GET', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})$/, async (_req, m) => ({ status: 200, body: await gradula.getItem(m[1]) })],
    ['PATCH', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.patchItem(m[1], body, ctx.actor) };
    }],
    ['DELETE', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})$/, async (_req, m, ctx) => ({ status: 200, body: await gradula.removeItem(m[1], ctx.actor) })],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/move$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.moveItem(m[1], body.state, ctx.actor, body.reason ?? null) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/beat$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.beat(m[1], ctx.actor, ctx.work),
    })],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/release-work$/, async (_req, m, ctx) => ({ status: 200, body: await gradula.releaseWork(m[1], ctx.actor, ctx.work) })],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/start$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.startItem(m[1], ctx.actor, { ...ctx.work, anyway: body.anyway ?? null, takeover: body.takeover ?? null, files: body.files ?? null, workspaceReason: body.workspaceReason ?? null }) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/suggest$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.suggestLabels(m[1], body, ctx.actor) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/say$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.say(m[1], body.text, ctx.actor) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/decide$/, async (req, m, ctx) => {
      // DECIDING IS RESERVED FOR PEOPLE. A machine may suggest, add evidence,
      // move — but not decide. Otherwise in three weeks a card
      // carries a reason nobody ever thought.
      if (ctx.system) throw new Refusal(403, 'humans-only', 'Only a person may decide.');
      const body = await readJson(req);
      return { status: 201, body: await gradula.decide(m[1], body, ctx.actor) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/evidence\/([0-9A-Z]{26})\/retract$/, async (req,m,ctx) => {const body=await readJson(req);return {status:200,body:await gradula.retractEvidence(m[1],m[2],body.reason,ctx.actor)};}],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/evidence$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.addEvidence(m[1], body, ctx.actor) };
    }],
    ['POST', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/confirm$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.confirmLabels(m[1], ctx.actor),
    })],

    // ---- Sentry -----------------------------------------------------------
    ['PUT', /^\/api\/v1\/sentry$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.setSentry(ctx.project, body) };
    }],
    ['GET', /^\/api\/v1\/sentry$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getSentry(ctx.project) })],
    ['POST', /^\/api\/v1\/sentry\/fetch$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.pullSentry(ctx.project, ctx.actor) })],

    /**
     * The hook. NO project key — Sentry has none. The credential is the
     * signature over the raw body, and the project stands in the path. Without
     * a stored hook secret the door answers 503: a door that accepts anything
     * while unconfigured is an open gate for invented incidents.
     */
    ['POST', /^\/api\/v1\/sentry\/hook\/([A-Z]{2,8})$/, async (req, m) => {
      const project = m[1];
      const connection = await gradula.getSentry(project, { raw: true });
      if (!connection?.hookSecret) throw new Refusal(503, 'no-hook', 'No webhook is set up for this project.');
      const raw = await readRaw(req);
      const given = req.headers['sentry-hook-signature'] ?? req.headers['sentry-hook-signature-v2'];
      if (!signatureOk(raw, connection.hookSecret, given)) throw new Refusal(401, 'signature', 'This signature does not match.');
      let payload;
      try { payload = JSON.parse(raw); } catch { throw new Refusal(400, 'json', 'That was not JSON.'); }
      const result = await gradula.ingestIssue(project, payload, 'sentry (hook)');
      /*
       * NOT EVERY INGEST HAS A CARD. `resolved` or `archived` for something
       * this board never took in is news about nothing — `ingestIssue` says
       * so with `ignored` and no card, and this line read `result.card.key`
       * regardless. The first webhook that ever arrived (12:18, GRADULA-3)
       * hit exactly that and got a 500; from Sentry's side that looks like a
       * board that is down, and it retries into the same wall.
       */
      return {
        status: 200,
        body: {
          fresh: result.fresh,
          card: result.card?.key ?? null,
          ...(result.ignored ? { ignored: true, reason: result.reason } : {}),
          ...(result.unchanged ? { unchanged: true } : {}),
        },
      };
    }],

    ['GET', /^\/api\/v1\/history$/, async (_req, _m, ctx) => ({
      status: 200,
      body: await gradula.history(ctx.project, {
        since: ctx.url.searchParams.get('since'),
        after: ctx.url.searchParams.get('after'),
        limit: Math.min(Number(ctx.url.searchParams.get('limit')) || 200, 1000),
      }),
    })],

    // --- The heralds: the outward direction -----------------------------------
    ['GET', /^\/api\/v1\/heralds$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.listHeralds(ctx.project) })],
    ['GET', /^\/api\/v1\/heralds\/templates$/, async () => ({ status: 200, body: gradula.templates() })],
    ['GET', /^\/api\/v1\/evidence\/([0-9a-f]{7,40})$/, async (_req, m, ctx) => ({ status: 200, body: { ref: m[1], cards: await gradula.cardsOfRef(ctx.project, m[1]) } })],
    ['POST', /^\/api\/v1\/releases\/notes$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.fileNotes(ctx.project, { lane: body.lane ?? 'web', stage: body.stage ?? 'production', version: body.version, text: body.text ?? null, locales: body.locales ?? null, name: body.name ?? null }, ctx.actor) };
    }],
    ['GET', /^\/api\/v1\/releases$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.listReleases(ctx.project) })],
    ['GET', /^\/api\/v1\/releases\/next$/, async (req, _m, ctx) => {
      const url = new URL(req.url, 'http://x');
      return { status: 200, body: await gradula.nextRelease(ctx.project, { lane: url.searchParams.get('lane') ?? 'ios', visibility: url.searchParams.get('visibility') ?? 'public' }) };
    }],
    ['GET', /^\/api\/v1\/heralds\/house$/, async () => ({ status: 200, body: { available: gradula.houseKeyAvailable() } })],
    ['PUT', /^\/api\/v1\/heralds$/, async (req, _m, ctx) => ({
      status: 200, body: await gradula.setHerald(ctx.project, await readJson(req), ctx.actor),
    })],
    // The channels a key can see, before the herald exists. The key comes in
    // the body, is used once and is not stored — see gradula.chatsFor().
    ['POST', /^\/api\/v1\/heralds\/chats$/, async (req, _m, _ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.chatsFor({ kind: body.kind, token: body.token }) };
    }],
    ['GET', /^\/api\/v1\/heralds\/([0-9A-Z]{26})\/chats$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.heraldChats(ctx.project, m[1]),
    })],
    ['POST', /^\/api\/v1\/heralds\/([0-9A-Z]{26})\/say$/, async (req, m, ctx) => {
      const body = await readJson(req);
      return { status: 200, body: await gradula.heraldSay(ctx.project, m[1], body.html ?? body.text ?? '') };
    }],
    /**
     * The address a card used to have. Links have gone out into Telegram
     * under it, and an address that once left the house is kept — moved, not
     * broken. A 302: the board is one deploy away from moving again, and a
     * permanent redirect is the kind a browser remembers longer than we do.
     */
    ['GET', /^\/c\/([A-Z]{2,8}-[0-9]{1,7})$/, async (_req, m) => ({ redirectTo: `/${m[1]}` })],

    ['GET', /^\/api\/v1\/dokploy$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getDokploy(ctx.project) })],
    ['GET', /^\/api\/v1\/eas$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getEas(ctx.project) })],
    ['PUT', /^\/api\/v1\/eas$/, async (req, _m, ctx) => ({ status: 200, body: await gradula.setEas(ctx.project, await readJson(req)) })],
    // Where the app has arrived. A build is not a release — see eas.mjs.
    ['GET', /^\/api\/v1\/app$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.appStanding(ctx.project) })],
    ['PUT', /^\/api\/v1\/dokploy$/, async (req, _m, ctx) => ({
      status: 200, body: await gradula.setDokploy(ctx.project, await readJson(req), { person: ctx.person }),
    })],
    /**
     * The long line. It never answers finished — which is why it does not go
     * through `send` but writes itself and stays open.
     */
    ['GET', /^\/api\/v1\/live$/, async (req, _m, ctx) => {
      if (!live) throw new Refusal(503, 'no-live', 'This service has no live channel.');
      ctx.res.writeHead(200, LIVE_HEADERS);
      ctx.res.write(`event: hello\ndata: ${JSON.stringify({ project: ctx.project })}\n\n`);
      live.join(ctx.project, ctx.res);
      return { open: true };
    }],
    ['POST', /^\/api\/v1\/reports\/due$/, async (_req, _m, ctx) => ({
      status: 200, body: await gradula.sendDueReports(ctx.project),
    })],
    ['GET', /^\/api\/v1\/github$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.getGithub(ctx.project) })],
    ['PUT', /^\/api\/v1\/github$/, async (req, _m, ctx) => ({
      status: 200, body: await gradula.setGithub(ctx.project, await readJson(req)),
    })],
    ['GET', /^\/api\/v1\/cards\/([A-Z]{2,8}-[0-9]{1,7})\/github$/, async (_req, m) => ({
      status: 200, body: await gradula.cardOnGithub(m[1]),
    })],
    ['GET', /^\/api\/v1\/health$/, async (req, _m, ctx) => ({
      status: 200,
      body: await gradula.health(ctx.project, { quiet: Number(ctx.url.searchParams.get('quiet')) || 14 }),
    })],
    ['GET', /^\/api\/v1\/goals$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.goals(ctx.project) })],
    // Five questions, one answer — see gradula.pulse().
    ['GET', /^\/api\/v1\/pulse$/, async (_req, _m, ctx) => ({
      status: 200,
      body: await gradula.pulse(ctx.project, {
        since: ctx.url.searchParams.get('since') || null,
        quiet: Number(ctx.url.searchParams.get('quiet')) || 14,
      }),
    })],
    ['GET', /^\/api\/v1\/standing$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.standing(ctx.project) })],
    // One picture of the whole system — every connection and the board, one
    // shape, with `sources` saying what is not being seen (system.mjs).
    ['GET', /^\/api\/v1\/system$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.system(ctx.project,{background:ctx.url.searchParams.get('wait')==='0'}) })],
    ['GET', /^\/api\/v1\/report$/, async (_req, _m, ctx) => ({
      status: 200,
      body: await gradula.report(ctx.project, {
        since: ctx.url.searchParams.get('since'),
        after: ctx.url.searchParams.get('after'),
        voice: ctx.url.searchParams.get('voice') ?? 'human',
        period: ctx.url.searchParams.get('period'),
        milestone: ctx.url.searchParams.get('milestone'),
      }),
    })],
    ['POST', /^\/api\/v1\/heralds\/([0-9A-Z]{26})\/probe$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.probeHerald(ctx.project, m[1]),
    })],
    ['DELETE', /^\/api\/v1\/heralds\/([0-9A-Z]{26})$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.removeHerald(ctx.project, m[1]),
    })],

    // Run the label rules over the cards that already exist. It PROPOSES —
    // never sets — so a system may call it; that is the same seam as the
    // cartographer's.
    ['POST', /^\/api\/v1\/relabel$/, async (_req, _m, ctx) => ({
      status: 200, body: await gradula.relabel(ctx.project, ctx.actor),
    })],
    ['GET', /^\/api\/v1\/suggestions$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.suggestions(ctx.project) })],
    ['GET', /^\/api\/v1\/wave$/, async (req, _m, ctx) => ({
      status: 200,
      body: await gradula.wave(ctx.project, new URL(req.url, 'http://x').searchParams.get('root') || null),
    })],

    ['GET', /^\/api\/v1\/links$/, async (_req, _m, ctx) => ({ status: 200, body: await gradula.links(ctx.project) })],
    ['POST', /^\/api\/v1\/links$/, async (req, _m, ctx) => {
      const body = await readJson(req);
      return { status: 201, body: await gradula.link(body, ctx.actor) };
    }],
    ['DELETE', /^\/api\/v1\/links\/([0-9A-Z]{26})$/, async (_req, m, ctx) => ({
      status: 200, body: await gradula.unlink(m[1], ctx.actor),
    })],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'gradula'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Whoever knocks is counted — before anything else, so a 404 counts too.
    const who = String(req.headers['x-real-ip'] ?? req.socket?.remoteAddress ?? 'unknown');
    const allowed = beat(who);
    if (!allowed.ok) { send(res, 429, { error: 'too-fast', line: 'Too many requests.' }, { 'Retry-After': String(allowed.inSeconds) }); return; }

    try {
      /*
       * THE ADDRESS OF A CARD: `/MDUS-2`. One segment, no query string, and
       * the same link for a person and for a crawler.
       *
       * It used to be `/?card=MDUS-2` for the board and `/c/MDUS-2` for a
       * crawler, and the second was a redirect to the first — so every link
       * that ever left the house pointed at a bounce. Now the page IS the
       * address: a browser gets the board and opens the card, a crawler reads
       * the tags that were put into the very same page.
       *
       * ONE SEGMENT, because the bundle's links are relative (the board is
       * served under two addresses) and `base-uri 'none'` forbids the tag that
       * would repair a deeper path.
       *
       * The tags only for a RELEASED card, and nothing but the title — no
       * text, no reason, no labels, no actor. An internal card gets the board
       * like any other path, and the board asks for a sign-in.
       */
      const asCard = req.method === 'GET' && /^\/[A-Z]{2,8}-[0-9]{1,7}$/.test(path);
      if (asCard) {
        const [prefix, number] = path.slice(1).split('-');
        const canonical = await gradula.store.projects.resolve(prefix);
        if (canonical && canonical !== prefix) {
          redirect(res, `/${canonical}-${number}${url.search}`); return;
        }
      }
      if (asCard && staticFiles) {
        const card = await gradula.publicCard(path.slice(1)).catch(() => null);
        const safe = (text) => String(text ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        const head = card ? [
          `<title>${safe(card.key)} — ${safe(card.title)}</title>`,
          `<meta property="og:title" content="${safe(card.title)}">`,
          '<meta property="og:site_name" content="Gradula">',
          '<meta property="og:type" content="website">',
          `<meta property="og:url" content="${safe(`${origin ?? ''}/${card.key}`)}">`,
          '<meta name="twitter:card" content="summary">',
        ].join('') : '<meta name="robots" content="noindex">';
        if (await staticFiles(req, res, '/', { head })) return;
      }

      const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path));
      if (!route) {
        // Not a route of the service — then perhaps it is the board.
        if (staticFiles && await staticFiles(req, res, path)) return;
        throw new Refusal(404, 'no-route', 'There is no such route.');
      }

      const [, pattern, run] = route;
      const match = pattern.exec(path);
      const isAdmin = path.startsWith('/api/admin');
    // The hook brings its credential in the signature, not in a header.
      const isHook = path.startsWith('/api/v1/sentry/hook/');
    // `/c/…` is a card's old address and only redirects now; the new one is
    // handled above, before the routes, because it IS the board's page.
      // `gradula login` opens a request and polls for the key before it has
      // one — those two are open (the code the person matches is the guard).
      const isDeviceStart = req.method === 'POST' && path === '/api/v1/device';
      const isDevicePoll = req.method === 'GET' && /^\/api\/v1\/device\/[0-9A-Z]{26}$/.test(path);
      const isOpen = path === '/api/health' || isHook || path.startsWith('/auth') || isDeviceStart || isDevicePoll || /^\/c\/[A-Z]{2,8}-[0-9]+$/.test(path);

      let token = null;
      let project = null;
      let human = null;
      if (!isOpen && !isAdmin) {
        const raw = bearer(req);
        if (raw) {
          token = await gradula.store.tokens.verify(raw);
          if (!token) throw new Refusal(401, 'key', 'I do not know this key.');
          project = token.project;
        } else {
          // A person brings no key but a note — and therefore no project
          // either. They have to say which one they mean, because a board for
          // several projects has no default that is right for all of them.
          human = auth?.who(req) ?? null;
          if (!human) throw new Refusal(401, 'no-key', 'Nothing happens here without a project key or a sign-in.');
          if (!human.roles?.includes(auth.role)) throw new Refusal(403, 'no-role', `Gradula needs the role "${auth.role}".`);
          const chosen = String(url.searchParams.get('project') ?? '').toUpperCase();
          const needs = !['/api/v1/me', '/api/v1/projects'].includes(path);
          if (needs) {
            if (!chosen) throw new Refusal(400, 'no-project', 'Which project? (?project=MDUS)');
            project = (await gradula.getProject(chosen)).key;
          }
        }
      }

      const ctx = {
        res,
        url,
        project,
        actor: actorOf(req, token, human),
        work: { owner: token ? `token:${token.id}` : `user:${human?.sub}`, session: String(req.headers['x-gradula-session'] ?? randomUUID()) },
        human,
        system: token?.kind === 'system',
        tokenName: token?.name ?? null,
        // A person: signed in, or holding their own key (not an agent's, not a system's).
        person: !!human || token?.kind === 'human',
        holder: token ? { kind: token.kind, owner: token.owner ?? null, ownerName: token.ownerName ?? null, name: token.name } : null,
        needAdmin() {
          if (!adminToken) throw new Refusal(503, 'no-door', 'The admin door is not set up.');
          const raw = bearer(req);
          if (!raw || !same(raw, adminToken)) throw new Refusal(401, 'admin', 'Not for this door.');
        },
      };

      // A card belongs to the key's project. The path must not get around
      // that: MDUS-1 with another project's key is a 404, not a 403 —
      // otherwise the answer gives away that this card exists.
      if (project && match?.[1]?.includes('-') && await gradula.store.projects.resolve(match[1].split('-')[0]) !== project) {
        throw new Refusal(404, 'no-card', `${match[1]} does not exist.`);
      }

      const result = await run(req, match, ctx);
      // A long line has written itself and stays open.
      if (result?.open) return;
      if (result.html !== undefined) {
        const body = Buffer.from(result.html);
        res.writeHead(result.status ?? 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'same-origin',
        });
        res.end(body);
        return;
      }
      if (result.redirectTo) redirect(res, result.redirectTo, result.cookies);
      else send(res, result.status, result.body);
    } catch (error) {
      const status = error instanceof Refusal ? error.status : 500;
      const code = error instanceof Refusal ? error.code : 'broken';
      if (status >= 500) {
        console.error('[gradula]', error);
        // A CAUGHT refusal reaches no global handler. Without this line the
        // crash reporter only reports what kills the service — and
        // that happens least often. The common case is a 500 that one person
        // sees and nobody else.
        watcher?.captureException?.(error, { extra: { path, method: req.method } });
      }
      send(res, status, { error: code, line: status >= 500 ? 'Something is broken in here.' : error.message });
    }
  };
}
