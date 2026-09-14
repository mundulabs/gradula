/**
 * What Gradula DOES — the verbs, once, over a store.
 *
 * The server calls them, the CLI calls them through the server, the MCP tool
 * does the same. They stand here and not in the router, so that the rules do
 * not hang on somebody arriving over HTTP: a rule that stands only in the
 * router no longer holds for the next caller.
 *
 * Two laws hold this module together:
 *
 * NO CHANGE WITHOUT A CHRONICLE. Every change writes an entry, and every
 * entry names an actor. When a model moves something on Felix's behalf, it
 * says `felix` and `via /start`, not "bot". A mirror that flatters is
 * worthless.
 *
 * PROPOSALS CHANGE NOTHING. What a rule knows for certain is set; what a
 * model thinks lands in `suggestions` and waits for a hand.
 */

import { normalizeGraph } from './codegraph.mjs';
import { randomUUID } from 'node:crypto';
import { plannedPaths, activeReservation, workWarnings } from './reservations.mjs';
import { labelsFor, mergeLabels, normalizeVocabulary, areaOf } from './labels.mjs';
import { cycleWith, blockedBy, filesOf } from './links.mjs';
import { suggestions as cartograph } from './cartographer.mjs';
import { wave, ripe, coverage } from './wave.mjs';
import { messages, linkify, TEMPLATES, VOICES, VISIBILITIES } from './heralds.mjs';
import { releasesIn, previousOf, cardsBetween, releaseNote, LANES, STAGES } from './releases.mjs';
import { carriesOf } from './deployed.mjs';
import { createActivityBatch, activitySummary } from './activity-batch.mjs';
import { createPipelineHerald } from './pipeline-herald.mjs';
import * as telegram from './telegram.mjs';
import * as dokploy from './dokploy.mjs';
import * as github from './github.mjs';
import * as eas from './eas.mjs';
import { gatherSystem, boardPicture, FRESH_MS } from './system.mjs';
import { candidatesOf, evidenceOf, deployedOf, foreignIdOf, unknownDeployed } from './deployed.mjs';
import { gather, plainReport, humanReport, htmlReport, escapeHtml, clip } from './report.mjs';
import { findings, whoDidWhat } from './health.mjs';
import { energy, pace, outlook, hangs, within } from './pulse.mjs';
import { nameOf } from './people.mjs';
import { dueHeralds, CADENCES } from './schedule.mjs';
import { isRunning, isKind, isState, isTarget, isRunner, isVisibility, isLinkKind, isLinkSource, isStack, STACKS, normalizeGate as rawGate, bornIn, RUNNING_MS, LANGUAGES, AGENT_KEY_KIND, agentKeyName, CARD_STYLE, INTEGRATIONS } from './spec.mjs';
import { isProjectKey, parseItemKey, mentionedKeys } from './ids.mjs';
import { DEVICE_TTL } from './store.mjs';
import { issueToCard, issueOf, projectOf, actionOf, environmentOf, readEnvironments, environmentsOf, lanesOf, takesEnvironment, fetchIssues, fetchLatestEnvironment, resolveIssue, issueIdOf, publicConnection, BASE_EU, BASE_US } from './sentry.mjs';

export class Refusal extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const bad = (code, message) => new Refusal(400, code, message);

/**
 * A wrong gate is an input error, not a crash. `spec.mjs` throws a TypeError
 * because it knows nothing of HTTP — here it is given its number.
 */
const normalizeGate = (gate) => {
  try { return rawGate(gate); } catch (error) { throw bad('gate', error.message); }
};
const missing = (message = 'There is no such thing.') => new Refusal(404, 'missing', message);

const text = (value, max, name) => {
  const out = String(value ?? '').trim();
  if (!out) throw bad('empty', `${name} must not be empty.`);
  if (out.length > max) throw bad('too-long', `${name}: at most ${max} characters.`);
  return out;
};

/**
 * Paths are NOT labels. `list` lowercases, because a label may exist only
 * once — but a file path on a case-sensitive disk is a different path the
 * moment you touch it. The test "start reports who touches the same file"
 * found exactly that.
 */
const paths = (value, name) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw bad('form', `${name}: a list.`);
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].slice(0, 50);
};

const list = (value, name, allow) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw bad('form', `${name}: a list.`);
  const out = [...new Set(value.map((v) => String(v).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (allow) for (const v of out) if (!allow(v)) throw bad('word', `${name}: "${v}" is not one of them.`);
  return out;
};

/**
 * A LABEL IS A WORD FROM THE LIST, OR IT IS NOT A LABEL.
 *
 * The crafts are a closed list (spec.mjs) and the modules are the project's
 * vocabulary — and only the RULES ever kept to them. Labels sent by hand went
 * in as typed: on the live board six cards carried five crafts no filter, no
 * map and no report knew (`studio`, `dev`, `auth`, `sdk`, `incident`). A
 * word outside the list is not a craft with a typo; it is a second list
 * starting. Refused with the list in the answer, so the next try is right.
 */
const labelled = (fields, vocabulary) => {
  const known = new Set((vocabulary ?? []).map((entry) => entry.id));
  const module = list(fields.module, 'module');
  const stack = list(fields.stack, 'stack');
  for (const word of module ?? []) {
    if (!known.has(word)) throw bad('module', `module: "${word}" is not a module of this project. gradula vocabulary push tells the board what the repository has.`);
  }
  for (const word of stack ?? []) {
    if (!isStack(word)) throw bad('stack', `stack: "${word}" is not a craft. The crafts: ${STACKS.join(', ')}.`);
  }
  return { module, stack };
};

/**
 * `send` is injected so a test never reaches into the network — and so that
 * a second herald (Slack, Matrix, mail) costs one line here.
 */
const HERALD_KINDS = { telegram };

/**
 * THE HOUSE KEY. A bot key typed into a form on the board is a key that lives
 * in a browser's memory and a person's clipboard on its way in. The house has
 * one bot already, and its key lives where keys live — in the server's
 * environment (TELEGRAM_BOT_TOKEN). A herald may say "the house key" instead
 * of carrying one: the sentinel is stored, the key never is, and the seam
 * below resolves it every time a herald speaks.
 */
export const HOUSE_KEY = 'house';

export function createGradula(store, { heraldKinds = HERALD_KINDS, origin = null, live = null, fetchImpl: defaultFetch = fetch, houseKey = null, activityWindowMs = 5000 } = {}) {
  const keyOf = (herald) => (herald?.token === HOUSE_KEY ? houseKey : herald?.token ?? null);
  const pipelineHerald = createPipelineHerald({ store, heraldKinds, keyOf, fetchImpl: defaultFetch });
  const findItem = async (key) => {
    const parsed = parseItemKey(key);
    if (!parsed) throw bad('id', `"${key}" is not a card key (example: MDLA-142).`);
    const item = await store.items.get(`${parsed.project}-${parsed.number}`);
    if (!item) throw missing(`There is no ${key}.`);
    return item;
  };

  // What is going out right now. `settle()` waits for it — a test needs that,
  // and so does a service being shut down.
  const inFlight = new Set();
  const activityBatch = createActivityBatch({ delay: activityWindowMs });

  // Where a Sentry issue happened, when its payload did not say: asked once
  // per issue id for the life of the process (see ingestIssue).
  const issueEnvironments = new Map();

  /** The last system picture per project — see `system()`. */
  const systemHeld = new Map();

  const note = (item, actor, verb, data) => {
    const entry = store.events.add({ item: item.id, actor, verb, data });
    // The long line gets ONLY the verb and the key. Whoever wants more asks
    // through the door that knows their rights.
    live?.announce(item.project, { verb, card: item.key, actor });
    // The herald holds nothing up. Telegram is down, the move goes through
    // anyway — a planning board that stops because a chat does not answer is
    // switched off the second time it happens.
    const herald = entry.then(() => announce(item, actor, verb, data)).catch(() => {});
    inFlight.add(herald);
    herald.finally(() => inFlight.delete(herald));
    return entry;
  };

  /**
   * Carry a move outward. Falls silent when nobody listens — and a herald's
   * key does not leave this function.
   */
  async function announce(item, actor, verb, data) {
    let sent = [];
    try {
      const heralds = await store.heralds.list(item.project, { raw: true });
      if (!heralds.length) return sent;
      // The fresh standing: in some places `item` is the card BEFORE the move.
      const card = (await store.items.get(item.key)) ?? item;
      // A card the hook created and started in the same breath is ONE moment, not two messages.
      if (verb === 'started' && card.created && Date.now() - Date.parse(card.created) < 60_000) return sent;
      // Read only when somebody is actually listening — no herald, no query.
      const board = await store.projects.get(item.project);
      for (const { herald, text } of messages(heralds, { card, verb, actor, data: data ?? {} }, { language: board?.language ?? 'en', style: CARD_STYLE })) {
      // The link leads to the card, and it IS the key at the head of the line —
      // not a second key beneath it. The PREVIEW stays off as long as the card
      // is internal: Telegram's crawler fetches the address itself and
      // without a sign-in, and what it fetches it stores. Only a released
      // card may show itself — the same rule as for the sentence itself.
        const link = origin ? `${origin}/${card.key}` : null;
        const kind = heraldKinds[herald.kind];
        if (!kind?.send) continue;
        const html = Boolean(link);
        // every key and every hash in the text is a link — the card's, the commit's (heralds.mjs, linkify)
        const repo = (await store.github.get(item.project))?.repo ?? board?.repo ?? null;
        const body = html ? linkify(escapeHtml(text), { origin, repo }) : text;
        const send = (text, options) => kind.send({ token: keyOf(herald), chat: herald.chat }, text, options);
        const result = ['created', 'started', 'moved', 'evidenced', 'decided', 'changed'].includes(verb)
          ? await activityBatch.enqueue(`${item.project}:${herald.id}`, { card, body, verb, to: data?.to }, async (entries) => {
            if (new Set(entries.map(entry => entry.card.key)).size === 1) {
              const latest = entries.at(-1);
              return send(latest.body, { html, preview: latest.card.visibility === 'public' });
            }
            let formatted;
            for (let limit = 12; limit >= 0; limit--) {
              const summary = activitySummary(entries, board?.name ?? item.project, { language: board?.language, limit });
              formatted = html ? linkify(escapeHtml(summary), { origin, repo }) : summary;
              if (formatted.length <= 3600) break;
            }
            return send(formatted, { html, preview: false });
          })
          : await send(body, { html, preview: card.visibility === 'public' });
        sent.push({ herald: herald.id, name: herald.name, ...result });
      }
    } catch { /* a mute herald is not the card's failure */ }
    return sent;
  }

  /**
   * Carry a release outward: every herald that listens to `released` (or to
   * everything) gets one note, in its visibility and language. A public
   * channel with nothing public in the release hears nothing.
   */
  async function announceRelease(projectKey, release, cards) {
    const sent = [];
    try {
      const heralds = await store.heralds.list(projectKey, { raw: true });
      if (!heralds.length) return sent;
      const board = await store.projects.get(projectKey);
      for (const herald of heralds) {
        if (herald.active === false) continue;
        const filter = herald.filter ?? {};
        if (Array.isArray(filter.verbs) && filter.verbs.length && !filter.verbs.includes('released')) continue;
        if (Array.isArray(filter.stages) && filter.stages.length && !filter.stages.includes(release.stage ?? 'production')) continue;
        const kind = heraldKinds[herald.kind];
        if (!kind?.send) continue;
        const visibility = filter.visibility ?? 'internal';
        const text = releaseNote(release, cards, { visibility, language: filter.language ?? board?.language ?? 'en', origin, style: CARD_STYLE });
        if (!text) continue;
        const repo = (await store.github.get(projectKey))?.repo ?? board?.repo ?? null;
        const result = await kind.send({ token: keyOf(herald), chat: herald.chat }, linkify(escapeHtml(text), { origin: visibility === 'public' ? origin : origin, repo: visibility === 'public' ? null : repo }), { html: true, preview: false });
        sent.push({ herald: herald.id, name: herald.name, ...result });
      }
      live?.announce(projectKey, { verb: 'released', card: null, actor: 'system', data: { lane: release.lane, id: release.id } });
    } catch { /* a mute herald is not the release's failure */ }
    return sent;
  }

  /**
   * THE NOTES A PERSON REVIEWED. A raw release note lists card titles, and a
   * card's title is a commit subject — right for the workshop, wrong for the
   * people outside ("the MCP server for Cursor and Gemini in the repository"
   * is not a sentence for a customer). What the outside gets is the text the
   * store gets: the release notes written for the version and reviewed by a
   * hand (Mundula: release:notes → release:version). Those are filed here,
   * once per lane and version, and spoken to every herald that listens to
   * `notes` — the Outside channel listens to nothing else.
   */
  async function announceNotes(projectKey, note) {
    const sent = [];
    try {
      const heralds = await store.heralds.list(projectKey, { raw: true });
      const board = await store.projects.get(projectKey);
      for (const herald of heralds) {
        if (herald.active === false) continue;
        const filter = herald.filter ?? {};
        if (Array.isArray(filter.verbs) && filter.verbs.length && !filter.verbs.includes('notes')) continue;
        if (Array.isArray(filter.stages) && filter.stages.length && !filter.stages.includes(note.stage ?? 'production')) continue;
        const kind = heraldKinds[herald.kind];
        if (!kind?.send) continue;
        const language = filter.language ?? board?.language ?? 'en';
        const text = note.locales?.[language] ?? note.locales?.[`${language}-${language.toUpperCase()}`] ?? note.text;
        const head = `${note.name ?? board?.name ?? projectKey} ${note.version}${note.lane && note.lane !== 'web' ? ` · ${note.lane === 'ios' ? 'iOS' : note.lane === 'android' ? 'Android' : note.lane}` : ''}${note.stage === 'beta' ? (note.lane === 'ios' ? ' · TestFlight' : ' · beta') : ''}`;
        const result = await kind.send({ token: keyOf(herald), chat: herald.chat }, escapeHtml(`${head}\n${text}`), { html: true, preview: false });
        sent.push({ herald: herald.id, name: herald.name, ...result });
      }
    } catch { /* a mute herald is not the note's failure */ }
    return sent;
  }

  const heraldOut = (herald) => ({ ...herald, token: herald.token ? 'set' : null, house: herald.token === HOUSE_KEY });

  return {
    store,
    pollPipelines(projectKey) { return pipelineHerald.poll(projectKey); },

    async createProject({ key, name, repo = null }, actor = 'system') {
      const projectKey = String(key ?? '').trim().toUpperCase();
      if (!isProjectKey(projectKey)) throw bad('id', 'A project key: two to eight capital letters, MDLA for instance.');
      if (await store.projects.get(projectKey)) throw new Refusal(409, 'duplicate', `${projectKey} already exists.`);
      const project = await store.projects.create({ key: projectKey, name: text(name, 120, 'name'), repo: repo ? String(repo).slice(0, 300) : null });
      return { ...project, from: actor };
    },

    async getProject(key) {
      const project = await store.projects.get(String(key ?? '').toUpperCase());
      if (!project) throw missing(`There is no project ${key}.`);
      return { ...project, manualAcceptance: project.manualAcceptance === true, integration: INTEGRATIONS.includes(project.integration) ? project.integration : 'pr', ladder: CARD_STYLE };
    },

    /** The vocabulary comes from the project — Gradula reads no foreign repository. */
    async getCodegraph(projectKey) {
      const project = await this.getProject(projectKey);
      const graph = await store.codegraphs.get(project.key);
      return graph?.repository === project.repo ? graph : null;
    },
    async putCodegraph(projectKey, input, actor) {
      const project = await this.getProject(projectKey);
      let graph;
      try { graph = normalizeGraph(input, project.repo); } catch (error) { throw bad('codegraph', error.message); }
      const previous = await store.codegraphs.get(project.key);
      if (previous?.digest === graph.digest) return previous;
      return store.codegraphs.set(project.key, {...graph, importedAt:new Date().toISOString(), actor,
        previousDigest:previous?.digest ?? null});
    },
    async putVocabulary(projectKey, entries) {
      await this.getProject(projectKey);
      const clean = normalizeVocabulary(entries);
      await store.vocab.set(String(projectKey).toUpperCase(), clean);
      return clean;
    },

    /**
     * A vocabulary stored before areas existed carries none; it is read with
     * the same rule that would have been applied, so no project has to push
     * again to see its areas.
     */
    async getVocabulary(projectKey) {
      const entries = await store.vocab.get(String(projectKey).toUpperCase());
      return (entries ?? []).map((entry) => ({ ...entry, area: (entry.area && /^[a-z0-9][a-z0-9-]{0,40}$/.test(entry.area) ? entry.area : areaOf(entry.paths)) ?? entry.id }));
    },

    async addItem(projectKey, fields, actor, { system = false } = {}) {
      const project = await this.getProject(projectKey);
      const kind = String(fields.kind ?? 'idea');
      if (!isKind(kind)) throw bad('kind', `kind: idea, task, venture, milestone or decision.`);
      /**
       * A SYSTEM CREATES ONLY IDEAS. It may see what is missing and write it
       * down — but it may not invent a task for somebody to work through, and
       * certainly not a decision that would then only need agreeing to.
       * Whoever turns an idea into a task is a person.
       */
      if (system && kind !== 'idea') throw new Refusal(403, 'ideas-only', 'A system creates only ideas — everything else a person decides.');
      const title = text(fields.title, 200, 'title');
      const body = String(fields.text ?? '').slice(0, 20000);

      const state = fields.state ? String(fields.state) : bornIn(kind);
      if (!isState(state)) throw bad('state', 'I do not know that state.');

      const target = fields.target === undefined || fields.target === null ? null : String(fields.target);
      if (target !== null && !isTarget(target)) throw bad('target', 'target: note, document, preview, branch or release.');

      const runner = fields.runner ? String(fields.runner) : 'here';
      if (!isRunner(runner)) throw bad('runner', 'runner: here or server.');

      const vocabulary = await store.vocab.get(project.key);
      const files = paths(fields.files, 'files') ?? [];
      const found = labelsFor({ title, text: body, files, vocabulary });
      const given = labelled(fields, vocabulary);

      const item = await store.items.create(project.key, {
        kind,
        state,
        title,
        text: body,
        module: mergeLabels(given.module ?? [], found.module),
        stack: mergeLabels(given.stack ?? [], found.stack),
        person: fields.person ? String(fields.person).slice(0, 120) : null,
        gate: normalizeGate(fields.gate ?? null),
        target,
        runner,
        files,
        createdBy: actor,
      });

      await note(item, actor, 'created', { kind, title, module: item.module, stack: item.stack });

      // Whoever names another card in the text MEANS it — but says nothing
      // about the order things are worked in. So `touches` and not `needs`: a
      // mention is a neighbourhood, not a claim about dependency. Measured on
      /*
       * A NAME IN A SENTENCE IS A MENTION, NOT A COLLISION.
       *
       * This laid `touches`, and `touches` means "these two cards name the
       * same FILE" — it is the reason for the warning at `start`. So sixteen
       * links on the live board claimed a file collision because somebody had
       * written "MDLA-14" in a sentence, and a warning that is usually wrong
       * is a warning nobody reads.
       *
       * 2026-09-09: "part of MDLA-1" in the text also made MDLA-6 the blocked
       * card, although it was exactly the other way round — which is why a
       * mention claims no order either.
       */
      const mentioned = mentionedKeys(`${title}\n${body}`).filter((key) => key !== item.key);
      const laid = [];
      for (const key of mentioned) {
        const other = await store.items.get(key);
        if (!other || other.project !== project.key) continue;
        const link = await this.link({ from: item.key, to: other.key, kind: 'mentions', source: 'rule', reason: 'named in the text' }, actor).catch(() => null);
        if (link) laid.push(other.key);
      }

      return { ...item, running: isRunning(item.heartbeat), links: laid };
    },

    async getItem(key) {
      const item = await findItem(key);
      const links = await store.links.of(item.id);
      const items = await store.items.list(item.project, {});
      const blocked = blockedBy(await store.links.list(item.project), items).get(item.id) ?? [];
      const byId = new Map(items.map((i) => [i.id, i]));
      return {
        ...item,
        // Computed, never stored: a flag saying "running" is wrong at the
        // first closed laptop, and afterwards nobody knows which one.
        running: isRunning(item.heartbeat),
        gateStanding: await this.gateStanding(item),
        warnings: workWarnings(item, items),
        blockedBy: blocked.map((id) => byId.get(id)?.key).filter(Boolean),
        links: links.map((link) => ({
          id: link.id,
          kind: link.kind,
          source: link.source,
          confirmed: link.confirmed,
          reason: link.reason,
          from: byId.get(link.from)?.key ?? null,
          to: byId.get(link.to)?.key ?? null,
        })),
        history: await store.events.of(item.id),
        // Where it has been seen, from the last `deployed` notes — no network.
        deployed: deployedOf(await store.events.of(item.id)),
      };
    },

    /**
     * The cards, with the two things a card cannot know about itself: what it
     * waits on, and when it was last touched.
     *
     * `touched` is the honest answer to "how long has this been lying here".
     * Not `changed`: a card whose text was edited three weeks ago and which
     * somebody said something about yesterday is not three weeks old, and the
     * chronicle knows the difference.
     */
    async listItems(projectKey, filter = {}) {
      const project = await this.getProject(projectKey);
      const { area, ...rest } = filter;
      let items = await store.items.list(project.key, rest);
      // An area is not stored on a card — it is the area of the card's
      // modules, read from the vocabulary at the moment of asking.
      if (area) {
        const inside = new Set((await this.getVocabulary(project.key)).filter((m) => m.area === String(area).toLowerCase()).map((m) => m.id));
        items = items.filter((item) => item.module.some((m) => inside.has(m)));
      }
      const all = await store.items.list(project.key, {});
      const blocked = blockedBy(await store.links.list(project.key), all);
      const byId = new Map(all.map((i) => [i.id, i]));
      const [touched, deployed] = await Promise.all([store.events.lastTouched(project.key), store.events.deployed(project.key)]);
      return items.map((item) => ({
        ...item,
        running: isRunning(item.heartbeat),
        blockedBy: (blocked.get(item.id) ?? []).map((id) => byId.get(id)?.key).filter(Boolean),
        touched: touched.get(item.id) ?? item.created ?? null,
        // Where it has been seen — one grouped read for the whole board.
        deployed: deployed.get(item.id) ?? deployedOf([]),
      }));
    },

    /**
     * What the cartographer sees. A READING door: it changes nothing, it says
     * what somebody could confirm. That is exactly why a system may call it.
     */
    /** A project's history — the question "what happened while I outcome away". */
    async history(projectKey, { since = null, after = null, limit = 200 } = {}) {
      const project = await this.getProject(projectKey);
      const raw = await store.events.all(project.key, { since, after, limit });
      if (raw[0]?.card) return raw;
      // The in-memory store does not know the card keys — looked up here, so
      // that both implementations serve the same shape.
      const cards = await store.items.list(project.key, {});
      const byId = new Map(cards.map((k) => [k.id, k]));
      return raw.map((e) => ({ ...e, card: byId.get(e.item)?.key ?? null, title: byId.get(e.item)?.title ?? null }));
    },

    /** Every link of a project, with card keys instead of identifiers. */
    async links(projectKey) {
      const project = await this.getProject(projectKey);
      const [cards, links] = await Promise.all([
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);
      const byId = new Map(cards.map((c) => [c.id, c.key]));
      return links.map((l) => ({
        id: l.id, kind: l.kind, source: l.source, reason: l.reason,
        from: byId.get(l.from ?? l.from_id) ?? null,
        to: byId.get(l.to ?? l.to_id) ?? null,
      }));
    },

    async suggestions(projectKey) {
      const project = await this.getProject(projectKey);
      const [cards, links] = await Promise.all([
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);
      return cartograph(cards, links);
    },

    /**
     * The wave: what can start now, in which order, and what must not run
     * side by side. It only computes — it changes nothing, so anyone who may
     * see the project may read it.
     */
    async wave(projectKey, root = null) {
      const project = await this.getProject(projectKey);
      const [cards, links] = await Promise.all([
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);
      return wave(cards, links, { root });
    },

    // ---- Heralds: the outward direction ---------------------------------

    announce,
    /** The live channel, so a test can listen through it. */
    live,
    /** Wait until everything outbound has gone through. */
    async settle() { while (inFlight.size) await Promise.all([...inFlight]); },
    templates: () => TEMPLATES,

    /**
     * Change the project key. Kept apart from `patchProject`, because it is
     * the only thing that touches the past — afterwards, old `Plan:` lines
     * point at nothing.
     */
    async rekeyProject(oldKey, newKey, actor = 'admin') {
      const project = await this.getProject(oldKey);
      const wanted = String(newKey ?? '').trim().toUpperCase();
      if (!isProjectKey(wanted)) throw bad('key', 'Project key: two to eight capital letters.');
      if (wanted === project.key) return project;
      if (await store.projects.get(wanted)) throw new Refusal(409, 'taken', `${wanted} already exists.`);
      const moved = await store.projects.rekey(project.key, wanted);
      if (!moved) throw new Refusal(409, 'not-moved', 'The key could not be changed.');
      return moved;
    },

    /** Rename a project or move its repository. The key stays. */
    async patchProject(key, changes, actor = 'admin') {
      const project = await this.getProject(key);
      const next = {};
      if (changes.manualAcceptance !== undefined) {
        if (typeof changes.manualAcceptance !== 'boolean') throw bad('manualAcceptance', 'manualAcceptance must be boolean.');
        next.manualAcceptance = changes.manualAcceptance;
      }
      // How a verified task branch reaches the main line: straight onto it, or
      // through a pull request. The repository's tooling reads this; the board
      // itself merges nothing.
      if (changes.integration !== undefined) {
        if (!INTEGRATIONS.includes(changes.integration)) throw bad('integration', `integration must be one of ${INTEGRATIONS.join(', ')}.`);
        next.integration = changes.integration;
      }
      if (changes.name !== undefined) next.name = text(changes.name, 120, 'name');
      if (changes.repo !== undefined) next.repo = changes.repo === null ? null : String(changes.repo).slice(0, 200);
      // Aliases: which names mean the same person. DECLARED, never guessed —
      // a board that folds similar spellings together will one day put two
      // people's work under one name, and nothing about it looks wrong.
      if (changes.people !== undefined) {
        if (changes.people === null) next.people = {};
        else if (typeof changes.people !== 'object' || Array.isArray(changes.people)) throw bad('people', 'people: a map of alias to name.');
        else {
          next.people = {};
          for (const [alias, name] of Object.entries(changes.people).slice(0, 200)) {
            next.people[String(alias).trim().slice(0, 80)] = String(name).trim().slice(0, 80);
          }
        }
      }
      // The language the CARDS are written in. The surface has always been
      // switchable per reader; this is the other half. Half a board in German
      // and half in English is a board you cannot search, and neither reader
      // can put that right alone.
      if (changes.language !== undefined) {
        if (changes.language === null) next.language = null;
        else if (!LANGUAGES.includes(String(changes.language))) throw bad('language', `language: ${LANGUAGES.join(', ')}.`);
        else next.language = String(changes.language);
      }
      /*
       * HOW A CARD BECOMES PUBLIC. By hand — someone publishes it, and nothing
       * leaves the house otherwise — or by the rule 'done': whatever reaches
       * production is public, incidents excepted (a crash is never news for
       * the outside). One rule per board, chosen in the open; the Outside
       * herald then needs no tap per card.
       */
      // THE LADDER'S STYLE: squares, circles or diamonds — the glyphs, never the meaning.
      if (changes.ladder !== undefined) {
        if (changes.ladder === null) next.ladder = null;
        else if (changes.ladder !== CARD_STYLE) throw bad('ladder', 'Cards use circles; pipeline steps use squares. Their shapes are fixed.');
        else next.ladder = String(changes.ladder);
      }
      if (changes.publish !== undefined) {
        if (changes.publish === null || changes.publish === 'hand') next.publish = null;
        else if (changes.publish !== 'done') throw bad('publish', 'publish: hand or done.');
        else next.publish = 'done';
      }
      if (!Object.keys(next).length) return project;
      return store.projects.patch(project.key, next);
    },

    /**
     * THE NEXT RELEASE, BEFORE IT HAPPENS: what an app store's "What's New" or
     * TestFlight's "What to Test" may say for the build that is about to go —
     * the cards that reached production since the last release on that lane,
     * public ones for the outside, all for the inside. The release tooling
     * asks this instead of a person typing the brief.
     */
    async nextRelease(projectKey, { lane = 'ios', visibility = 'public' } = {}) {
      const project = await this.getProject(projectKey);
      if (!LANES.includes(lane)) throw bad('lane', `lane: ${LANES.join(', ')}.`);
      const known = await store.releases.list(project.key);
      const previous = known.filter((r) => r.lane === lane).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null;
      const cards = await store.items.list(project.key, { limit: 2000 });
      const since = previous?.at ?? new Date(Date.now() - 30 * 86400e3).toISOString();
      const carried = cardsBetween(cards, since, null).map((k) => cards.find((c) => c.key === k)).filter((c) => c && (visibility !== 'public' || c.visibility === 'public'));
      return {
        lane, since, previous: previous ? { id: previous.id, version: previous.version ?? null, at: previous.at } : null,
        cards: carried.map((c) => ({ key: c.key, title: c.title, visibility: c.visibility })),
        text: carried.map((c) => (visibility === 'public' ? `• ${c.title}` : `• ${c.key} ${c.title}`)).join('\n'),
      };
    },

    /** Which cards a commit already stands on — the question `sync --adopt` asks before it makes a card. */
    async cardsOfRef(projectKey, ref) {
      const project = await this.getProject(projectKey);
      if (!/^[0-9a-f]{7,40}$/i.test(String(ref))) throw bad('ref', 'ref: a commit hash.');
      return store.events.byRef(project.key, String(ref).toLowerCase());
    },

    /**
     * File the reviewed release notes for a lane and version — the text the
     * store shows — and speak them to the heralds that listen to `notes`.
     * Filed once: the same version again changes nothing and says nothing.
     */
    async fileNotes(projectKey, { lane = 'web', stage = 'production', version, text = null, locales = null, name = null }, actor) {
      const project = await this.getProject(projectKey);
      if (!LANES.includes(lane)) throw bad('lane', `lane: ${LANES.join(', ')}.`);
      if (!STAGES.includes(stage)) throw bad('stage', `stage: ${STAGES.join(', ')}.`);
      const v = String(version ?? '').trim();
      if (!v) throw bad('version', 'version: the version these notes are for.');
      const body = text ? String(text).trim() : null;
      const byLocale = locales && typeof locales === 'object' ? Object.fromEntries(Object.entries(locales).map(([k, t]) => [String(k), String(t).trim()]).filter(([, t]) => t)) : null;
      if (!body && !(byLocale && Object.keys(byLocale).length)) throw bad('text', 'text or locales: the notes themselves.');
      const id = `notes:${lane}:${stage}:${v}`;
      const known = await store.releases.list(project.key);
      if (known.some((r) => r.id === id)) return { id, lane, version: v, filed: false };
      const note = { id, lane, stage, version: v, at: new Date().toISOString(), text: body ?? Object.values(byLocale)[0], locales: byLocale, name: name ? String(name).slice(0, 80) : null, by: actor ?? null, cards: [] };
      await store.releases.add(project.key, note);
      const sent = await announceNotes(project.key, note);
      live?.announce(project.key, { verb: 'released', card: null, actor: actor ?? 'system', data: { lane, id, notes: true } });
      return { id, lane, version: v, filed: true, sent };
    },

    async listReleases(projectKey) {
      const project = await this.getProject(projectKey);
      return (await store.releases.list(project.key)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },

    async listHeralds(projectKey) {
      const project = await this.getProject(projectKey);
      // raw, then veiled here: the list must say WHICH heralds speak with the house key, and only heraldOut knows
      return (await store.heralds.list(project.key, { raw: true })).map(heraldOut);
    },

    /**
     * Set up or change a herald. A template is only a pre-filled filter —
     * whoever takes one and changes a line has their own, and nothing about
     * it is special.
     */
    async setHerald(projectKey, input, actor) {
      const project = await this.getProject(projectKey);
      // An id is scoped to this project, including partial updates from the UI.
      if (input.id) {
        const previous = (await store.heralds.list(project.key, { raw: true })).find((h) => h.id === input.id);
        if (!previous) throw missing('No such herald.');
        input = { ...previous, ...input, token: input.token,
          schedule: input.schedule === undefined ? previous.schedule : { ...previous.schedule, ...input.schedule } };
      }
      const kind = String(input.kind ?? 'telegram');
      if (!heraldKinds[kind]) throw bad('kind', `herald kind: ${Object.keys(heraldKinds).join(', ')}.`);
      const template = input.template ? TEMPLATES[String(input.template)] : null;
      if (input.template && !template) throw bad('template', `template: ${Object.keys(TEMPLATES).join(', ')}.`);
      /*
       * A CHOSEN TEMPLATE WINS. The form sends the herald as it is — its old
       * filter included — plus the template that was picked; merging the old
       * filter over the template meant a picked template never applied, and
       * "Save" changed nothing (2026-09-10). A template is the filter; a
       * filter given without a template is a hand's own.
       */
      const filter = template ? { ...template.filter } : { ...(input.filter ?? {}) };
      if (filter.pipeline !== undefined && typeof filter.pipeline !== 'boolean') throw bad('pipeline', 'pipeline must be true or false.');
      if (filter.pipeline && filter.visibility === 'public') throw bad('pipeline', 'Pipeline progress is internal; Outside receives published updates.');
      if (filter.voice && !VOICES.includes(filter.voice)) throw bad('voice', `voice: ${VOICES.join(', ')}.`);
      // The channel's own language. Not the developer's: a workshop channel in
      // German and a client channel in English is one board and two audiences.
      if (filter.language && !LANGUAGES.includes(filter.language)) throw bad('language', `language: ${LANGUAGES.join(', ')}.`);
      if (filter.visibility && !VISIBILITIES.includes(filter.visibility)) throw bad('visibility', `visibility: ${VISIBILITIES.join(', ')}.`);
      if (filter.stages !== undefined && (!Array.isArray(filter.stages) || filter.stages.some((st) => !STAGES.includes(st)))) throw bad('stages', `stages: ${STAGES.join(', ')}.`);
      const schedule = input.schedule === undefined ? undefined : {
        cadence: String(input.schedule?.cadence ?? 'off'),
        hour: Number.isFinite(Number(input.schedule?.hour)) ? Math.max(0, Math.min(23, Number(input.schedule.hour))) : 8,
        weekday: Number.isFinite(Number(input.schedule?.weekday)) ? Math.max(0, Math.min(6, Number(input.schedule.weekday))) : 1,
        lastRun: input.schedule?.lastRun ?? null,
      };
      if (filter.visibility === 'public' && schedule?.cadence && schedule.cadence !== 'off') throw bad('public-report', 'Reports contain internal work. Public channels receive published updates only.');
      if (schedule && !CADENCES.includes(schedule.cadence)) throw bad('cadence', `cadence: ${CADENCES.join(', ')}.`);
      const kept = await store.heralds.set(project.key, {
        id: input.id,
        kind,
        name: text(input.name ?? template?.name ?? 'Herald', 80, 'name'),
        chat: input.chat ? String(input.chat).slice(0, 120) : null,
        token: input.token,
        filter,
        active: input.active !== false,
        ...(schedule ? { schedule } : {}),
      });
      return kept;
    },

    async removeHerald(projectKey, id) {
      const project = await this.getProject(projectKey);
      if (!(await store.heralds.list(project.key)).some((h) => h.id === id)) throw missing('No such herald.');
      const path = await store.heralds.remove(id);
      if (!path) throw missing('No such herald.');
      return { entfernt: true };
    },

    /**
     * A greeting into the channel. That is the only honest way to claim "set
     * up": not by looking at the stored values but by saying something and
     * seeing whether it arrives.
     */
    /**
     * Which channels does this herald see? The key stays in the service —
     * the CLI gets identifiers, never the key.
     */
    /**
     * Which channels a key can see — BEFORE the herald exists.
     *
     * The chicken and the egg: the channel list needs the bot's key, and the
     * key is stored on a herald that has not been saved yet. So the person
     * typed a channel id into a field, from a place the board could not tell
     * them about. Now the key that is already in the form asks Telegram
     * directly, and the answer is a list to pick from.
     *
     * The key is NOT stored by this call. It comes in, it asks, it is gone.
     */
    /** Whether the house has a bot key — the form offers "the house key" only then. */
    houseKeyAvailable() { return Boolean(houseKey); },

    async chatsFor({ kind = 'telegram', token }) {
      const door = heraldKinds[String(kind)];
      if (!door) throw bad('kind', `herald kind: ${Object.keys(heraldKinds).join(', ')}.`);
      if (!door.chats) return { ok: false, reason: `${kind} cannot list chats` };
      if (!token) return { ok: false, reason: 'no key' };
      if (String(token) === HOUSE_KEY && !houseKey) return { ok: false, reason: 'the house has no key (TELEGRAM_BOT_TOKEN)' };
      return door.chats({ token: String(token) === HOUSE_KEY ? houseKey : String(token) });
    },

    async heraldChats(projectKey, id) {
      const project = await this.getProject(projectKey);
      const herald = (await store.heralds.list(project.key, { raw: true })).find((b) => b.id === String(id));
      if (!herald) throw missing('No such herald.');
      const kind = heraldKinds[herald.kind];
      if (!kind?.chats) return { ok: false, reason: `${herald.kind} cannot list chats` };
      return kind.chats({ token: keyOf(herald) });
    },

    /**
     * The report: many moves become one message. Built from the chronicle,
     * never from a second list.
     */
    async report(projectKey, { since = null, after = null, limit = 500, voice = 'human', period = null, milestone = null } = {}) {
      const project = await this.getProject(projectKey);
      const [entries, cards, links] = await Promise.all([
        store.events.all(project.key, { since, after, limit }),
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);

      // A report PER MILESTONE: only the cards hanging under it, and the
      // parts of the parts. Without that, "report on W2" would be a claim
      // about everything that happened to be going on at the same time.
      let mine = cards;
      if (milestone) {
        const root = cards.find((c) => c.key === String(milestone).toUpperCase());
        if (!root) throw missing(`${milestone} does not exist.`);
        const children = new Map();
        for (const l of links) {
          if (l.kind !== 'part-of') continue;
          const to = l.to ?? l.to_id;
          if (!children.has(to)) children.set(to, []);
          children.get(to).push(l.from ?? l.from_id);
        }
        const inside = new Set([root.id]);
        const open = [root.id];
        while (open.length) for (const child of children.get(open.pop()) ?? []) {
          if (inside.has(child)) continue;
          inside.add(child); open.push(child);
        }
        mine = cards.filter((c) => inside.has(c.id));
      }

      const found = gather(entries, mine);
      /*
       * A bar needs a whole, and only a bundle has one. The report gets the
       * OPEN goals with their coverage — everything else in it is a count
       * without a denominator, and a bar over that would invent the
       * denominator.
       */
      const edges = links.map((l) => ({ ...l, from: l.from ?? l.from_id, to: l.to ?? l.to_id }));
      found.goals = coverage(mine, edges)
        .filter((g) => g.total > 0 && !['done', 'ice'].includes(g.card.state))
        .slice(0, 6)
        .map((g) => ({ key: g.card.key, title: g.card.title, share: g.share, done: g.done, dropped: g.dropped ?? 0, total: g.total }));
      return {
        project: project.key,
        period,
        milestone: milestone ? String(milestone).toUpperCase() : null,
        counts: { done: found.done.length, decided: found.decided.length, incidents: found.incidents.length, touched: found.touched },
        plain: plainReport(found, { project: project.key, period, style: CARD_STYLE }),
        human: humanReport(found, { period }),
        html: htmlReport(found, { project: project.key, period, voice, style: CARD_STYLE }),
      };
    },

    /** Put a finished text into a channel — for the report. */
    async heraldSay(projectKey, id, text) {
      const project = await this.getProject(projectKey);
      const herald = (await store.heralds.list(project.key, { raw: true })).find((b) => b.id === String(id));
      if (!herald) throw missing('No such herald.');
      const kind = heraldKinds[herald.kind];
      if (!kind?.send) return { sent: false, reason: `${herald.kind} cannot send` };
      if (herald.filter?.visibility === 'public') throw new Refusal(403, 'public-report', 'Reports contain internal work. Public channels receive published updates only.');
      if (herald.active === false) throw new Refusal(409, 'paused', 'This channel is paused.');
      // the report's keys and hashes become links here — the text is already HTML, so linkify only what is not inside a tag
      const repo = (await store.github.get(project.key))?.repo ?? project.repo ?? null;
      const linked = String(text).split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : linkify(part, { origin, repo }))).join('');
      return kind.send({ token: keyOf(herald), chat: herald.chat }, clip(linked), { html: true });
    },

    async probeHerald(projectKey, id) {
      const project = await this.getProject(projectKey);
      const herald = (await store.heralds.list(project.key, { raw: true })).find((b) => b.id === String(id));
      if (!herald) throw missing('No such herald.');
      const kind = heraldKinds[herald.kind];
      if (herald.token === HOUSE_KEY && !houseKey) return { ok: false, sent: false, reason: 'the house has no key (TELEGRAM_BOT_TOKEN)' };
      const checked = kind.verify ? await kind.verify({ token: keyOf(herald), chat: herald.chat }) : { ok: true };
      if (!checked.ok) return { ...checked, sent: false };
      const said = await kind.send(
        { token: keyOf(herald), chat: herald.chat },
        `${project.key} · Gradula reporting in. This channel receives: ${herald.name}.`,
      );
      return { ...checked, ...said };
    },

    /**
     * What a crawler may see: key and title, nothing else — and only when a
     * person has released the card. `null` for everything else, so the door
     * can answer 404 instead of 403.
     */
    async publicCard(key) {
      const parsed = parseItemKey(key);
      if (!parsed) return null;
      const item = await store.items.get(`${parsed.project}-${parsed.number}`);
      if (!item || item.visibility !== 'public') return null;
      return { key: item.key, title: item.title };
    },

    /**
     * The housekeeping and who is where. NO number — every finding names its
     * cards, or it can only be believed or ignored.
     */
    async health(projectKey, { quiet = 14 } = {}) {
      const project = await this.getProject(projectKey);
      const [cards, links, entries] = await Promise.all([
        store.items.list(project.key, {}),
        store.links.list(project.key),
        store.events.all(project.key, { limit: 1000 }),
      ]);
      const edges = links.map((l) => ({ ...l, from: l.from ?? l.from_id, to: l.to ?? l.to_id }));
      return {
        findings: findings(cards, edges, entries, { quiet, language: project.language ?? null }),
        people: whoDidWhat(entries, cards, { aliases: project.people ?? {} }),
        cards: cards.length,
      };
    },

    /**
     * The pulse — the five questions in one answer.
     *
     * ONE CALL, because they are one question asked five ways: a week's moves
     * mean nothing without the goals they were aimed at, and a goal means
     * nothing without the pace that carries it. Five requests would let a
     * surface show four fresh panels and one from a minute ago, and the reader
     * would never know which.
     *
     * The period defaults to seven days. Not a rule about weeks — a default
     * that can be overruled by a date, so the same view answers "this week"
     * and "since the release" without a second door.
     */
    async pulse(projectKey, { since = null, now = Date.now(), quiet = 14 } = {}) {
      const project = await this.getProject(projectKey);
      const from = since ?? new Date(now - 7 * 86_400_000).toISOString();
      const [entries, cards, links] = await Promise.all([
        store.events.all(project.key, { limit: 2000 }),
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);
      const edges = links.map((l) => ({ ...l, from: l.from ?? l.from_id, to: l.to ?? l.to_id }));

      const speed = pace(entries, { since: from, now });
      const goals = coverage(cards, edges).map((g) => ({
        key: g.card.key, title: g.card.title, kind: g.card.kind, state: g.card.state,
        due: g.due, total: g.total, done: g.done, dropped: g.dropped ?? 0, share: g.share, open: g.open ?? [],
        outlook: outlook({ due: g.due, open: g.open ?? [], total: g.total, done: g.done, dropped: g.dropped ?? 0 }, speed.perDay, { now }),
      }));

      return {
        since: from,
        until: new Date(now).toISOString(),
        happened: (() => {
          const found = gather(within(entries, { since: from, now }), cards);
          const named = (list) => list.map((r) => ({ card: r.card.key, title: r.card.title }));
          return {
            done: named(found.done), released: named(found.released), decided: named(found.decided),
            incidents: named(found.incidents), started: named(found.started),
            // Folded here rather than in the report: a herald's message names
            // whoever the chronicle names, and that is right for a message.
            // A PANEL that lists four spellings of one person is just wrong.
            actors: [...new Set(found.actors.map((a) => nameOf(a, project.people ?? {})).filter(Boolean))].sort(),
            touched: found.touched,
          };
        })(),
        goals,
        pace: speed,
        energy: energy(entries, cards, { since: from, now, aliases: project.people ?? {} }),
        hangs: hangs(cards, edges),
        findings: findings(cards, edges, entries, { now, quiet, language: project.language ?? null }),
      };
    },

    /**
     * Cards that were left lying — put back, by themselves.
     *
     * THIS IS THE ANSWER TO "WHAT IF SOMEBODY JUST STOPS". A chat closes, a
     * laptop shuts, a person moves on to something else, and a card stays in
     * `making` forever with nobody at it. Until now the board only REPORTED
     * that (findings, `stalled`) on a page nobody has open while they work,
     * and the column quietly filled up with work that was not happening.
     *
     * The rule: a card in `making` that NOTHING has happened to for a whole
     * day goes back to `ready`. Not deleted, not decided, not blamed — put
     * back on the shelf it came from, with a chronicle line that says why.
     * Whoever really was working on it moves it forward again in one gesture,
     * and has lost nothing.
     *
     * A LIVE LEASE ALWAYS WINS. A runner that is beating right now is working,
     * however long it has been at it — a long-running build is not a stall.
     *
     * The day is not a guess dressed as a rule: it is one working day, the
     * span after which "I am on it" has stopped being true without anybody
     * saying so. It can be given another number, and the answer says which
     * one it used.
     */
    async releaseStalled(projectKey, { hours = 24, now = Date.now() } = {}) {
      const project = await this.getProject(projectKey);
      const cards = await store.items.list(project.key, { state: 'making' });
      if (!cards.length) return [];
      const touched = await store.events.lastTouched(project.key);
      const out = [];
      for (const card of cards) {
        if (card.reservation || isRunning(card.heartbeat, now)) continue;
        const last = new Date(touched.get(card.id) ?? card.created ?? now).getTime();
        const idle = (now - last) / 3_600_000;
        if (idle < hours) continue;
        await this.moveItem(
          card.key, 'ready',
          'Gradula (rule: left lying)',
          `Nothing happened here for ${Math.floor(idle)} hours and no runner was holding it. Put back on ready — start it again and it goes straight back.`,
        );
        out.push({ card: card.key, hours: Math.floor(idle) });
      }
      return out;
    },

    /**
     * Send the reports that are due. The service calls this on a quiet beat;
     * the decision WHETHER something is due is pure, in schedule.mjs.
     *
     * The last run is stored AFTER sending. The other way round we would lose
     * a report whenever Telegram happens not to answer — and a report that
     * quietly falls away is worse than one that arrives twice.
     */
    async sendDueReports(projectKey, { now = Date.now() } = {}) {
      const project = await this.getProject(projectKey);
      const heralds = await store.heralds.list(project.key, { raw: true });
      const out = [];
      for (const { herald, since, period } of dueHeralds(heralds.filter((h) => h.filter?.visibility !== 'public'), { now })) {
        const built = await this.report(project.key, {
          since, period, voice: herald.filter?.voice === 'plain' ? 'plain' : 'human',
        });
        if (!built.counts.touched) { out.push({ herald: herald.id, sent: false, reason: 'nothing moved' }); continue; }
        const sent = await this.heraldSay(project.key, herald.id, built.html);
        if (sent.sent) {
          await store.heralds.set(project.key, {
            ...herald, token: undefined,
            schedule: { ...herald.schedule, lastRun: new Date(now).toISOString() },
          });
        }
        out.push({ herald: herald.id, name: herald.name, ...sent });
      }
      return out;
    },

    /**
     * The connection to GitHub. It only FETCHES — `writeBack` is empty, and a
     * read token is enough: anything else would be a planning board that
     * writes source code.
     */
    async setGithub(projectKey, input) {
      const project = await this.getProject(projectKey);
      const repo = String(input.repo ?? '').trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw bad('repo', 'repo: owner/name.');
      const stored = await store.github.set(project.key, { repo, token: input.token });
      return github.publicConnection({ ...stored, setAt: new Date().toISOString() });
    },

    async getGithub(projectKey, { raw = false } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.github.get(project.key);
      return raw ? connection : github.publicConnection(connection);
    },

    /**
     * What hangs on ONE card in GitHub: its branch, the open PR on it, the
     * standing of its check runs — and its evidence as links.
     */
    async cardOnGithub(key, { fetchImpl } = {}) {
      const item = await findItem(key);
      const connection = (await store.github.get(item.project)) ?? { repo: (await store.projects.get(item.project))?.repo };
      if (!connection?.repo) return { ok: false, reason: 'no repository for this project' };

      const history = await store.events.of(item.id);
      const evidence = history
        .filter((e) => e.verb === 'evidenced' && e.data?.kind === 'commit')
        .map((e) => ({ hash: e.data.ref, note: e.data.comment ?? null, url: github.commitUrl(connection.repo, e.data.ref) }));

      let branch = `codex/${item.key}`;
      let standing = await github.branchStanding(
        { ...connection, branch }, fetchImpl ? { fetchImpl } : {},
      );
      if (standing.ok && standing.exists === false) {
        const legacy = await github.branchStanding({ ...connection, branch: `plan/${item.key}` }, fetchImpl ? { fetchImpl } : {});
        if (legacy.ok && legacy.exists) { standing = legacy; branch = `plan/${item.key}`; }
      }
      return { repo: connection.repo, branch, branchUrl: github.branchUrl(connection.repo, branch), evidence, ...standing };
    },

    /**
     * The goals: milestones and ventures with their coverage, the nearest
     * date first. NO global percentage — that one rises whenever fewer cards
     * are written down, which is the opposite of what it claims to measure.
     */
    async goals(projectKey) {
      const project = await this.getProject(projectKey);
      const [cards, links] = await Promise.all([
        store.items.list(project.key, {}),
        store.links.list(project.key),
      ]);
      const byId = new Map(cards.map((c) => [c.id, c]));
      const edges = links.map((l) => ({ ...l, from: l.from ?? l.from_id, to: l.to ?? l.to_id }));
      return coverage(cards, edges).map((g) => ({
        key: g.card.key, title: g.card.title, kind: g.card.kind, state: g.card.state,
        due: g.due, total: g.total, done: g.done, dropped: g.dropped ?? 0, share: g.share, open: g.open ?? [],
      }));
    },

    async patchItem(key, changes, actor) {
      const item = await findItem(key);
      const next = {};
      if (changes.title !== undefined) next.title = text(changes.title, 200, 'title');
      if (changes.text !== undefined) next.text = String(changes.text).slice(0, 20000);
      if (changes.kind !== undefined) {
        if (!isKind(String(changes.kind))) throw bad('kind', 'I do not know that kind.');
        next.kind = String(changes.kind);
      }
      if (changes.person !== undefined) next.person = changes.person === null ? null : String(changes.person).slice(0, 120);
      if (changes.gate !== undefined) next.gate = normalizeGate(changes.gate);
      if (changes.target !== undefined) {
        if (changes.target !== null && !isTarget(String(changes.target))) throw bad('target', 'I do not know that target.');
        next.target = changes.target === null ? null : String(changes.target);
      }
      if (changes.runner !== undefined) {
        if (!isRunner(String(changes.runner))) throw bad('runner', 'runner: here or server.');
        next.runner = String(changes.runner);
      }
      // Releasing is its own gesture, not a side effect. A card does not
      // become public by slipping through a filter.
      // A date carries only where it means something: a milestone or a
      // venture has one, a task with a deadline is a task with pressure.
      if (changes.due !== undefined) {
        if (changes.due === null) next.due = null;
        else {
          const day = String(changes.due).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad('due', 'due: a day, as YYYY-MM-DD.');
          if (!['milestone', 'venture'].includes(item.kind)) {
            throw bad('due', 'Only a milestone or a venture carries a date.');
          }
          next.due = day;
        }
      }
      if (changes.visibility !== undefined) {
        if (!isVisibility(String(changes.visibility))) throw bad('visibility', 'visibility: internal or public.');
        next.visibility = String(changes.visibility);
      }
      if (changes.module !== undefined || changes.stack !== undefined) {
        const given = labelled(changes, await store.vocab.get(item.project));
        if (changes.module !== undefined) next.module = given.module ?? [];
        if (changes.stack !== undefined) next.stack = given.stack ?? [];
      }
      if (changes.files !== undefined) next.files = paths(changes.files, 'files') ?? [];
      if (!Object.keys(next).length) return this.getItem(item.key);

      const expected = changes.expected ?? {};
      if (typeof expected !== 'object' || Array.isArray(expected) || Object.keys(expected).some((field) => !['title', 'text', 'person', 'gate'].includes(field))) throw bad('expected', 'Unsupported edit comparison.');
      const updated = await store.items.patch(item.key, next, { expected });
      if (!updated) throw new Refusal(409, 'edit-conflict', 'This field changed while you were editing. Reopen the editor to review the latest version.');
      await note(item, actor, 'changed', { fields: Object.keys(next) });
      return this.getItem(updated.key);
    },

    /**
     * A model's proposal. It changes nothing — it lies down beside the card,
     * and the card shows it dashed until a hand confirms it.
     */
    async suggestLabels(key, { module = [], stack = [] }, actor) {
      const item = await findItem(key);
      const given = labelled({ module, stack }, await store.vocab.get(item.project));
      const suggestions = {
        module: (given.module ?? []).filter((m) => !item.module.includes(m)),
        stack: (given.stack ?? []).filter((s) => !item.stack.includes(s)),
      };
      await store.items.patch(item.key, { suggestions });
      await note(item, actor, 'suggested', suggestions);
      return this.getItem(item.key);
    },

    /**
     * RUN THE RULES OVER WHAT IS ALREADY THERE.
     *
     * Labels are given once, at creation. Everything written before a module
     * existed or before the vocabulary was refreshed keeps whatever it got
     * then — measured on this board: 22 of 35 cards with no craft at all. A
     * board that cannot say where its work sits cannot group it, cannot warn
     * about a collision and cannot fill a milestone.
     *
     * WHEN IT SETS AND WHEN IT ASKS. The first version proposed everything,
     * and that was incoherent: the SAME rule already sets the labels of a new
     * card. Either it is good enough or it is not. The honest line is not
     * rule-versus-hand, it is what the label rests on:
     *
     *   an EMPTY axis gets filled.   Nothing is overwritten, nothing is lost,
     *                                and the chronicle says a rule did it. A
     *                                board that leaves 22 cards blank to avoid
     *                                being wrong is wrong 22 times.
     *   a TOUCHED axis is asked.     Something already stands there. Whether a
     *                                person put it or confirmed it, adding to
     *                                it silently is editing somebody's answer.
     *
     * So the common case — a card nobody has labelled — needs no hand at all,
     * and the only thing that waits is the case where a hand already spoke.
     */
    async relabel(projectKey, actor) {
      const project = await this.getProject(projectKey);
      const [cards, vocabulary] = await Promise.all([
        store.items.list(project.key, {}),
        store.vocab.get(project.key),
      ]);
      const out = [];
      for (const card of cards) {
        if (['done', 'ice'].includes(card.state)) continue;
        const found = labelsFor({ title: card.title, text: card.text, files: card.files, vocabulary });
        const module = found.module.filter((m) => !card.module.includes(m));
        const stack = found.stack.filter((s) => !card.stack.includes(s));
        if (!module.length && !stack.length) continue;

        // An empty axis is filled; a touched one is asked.
        const set = {};
        const ask = { module: [], stack: [] };
        for (const axis of ['module', 'stack']) {
          const fresh = axis === 'module' ? module : stack;
          if (!fresh.length) continue;
          if (card[axis].length) ask[axis] = fresh;
          else set[axis] = fresh;
        }

        if (set.module || set.stack) {
          await store.items.patch(card.key, set);
          await note(card, actor, 'changed', { module: set.module, stack: set.stack, by: 'rule' });
        }
        if (ask.module.length || ask.stack.length) await this.suggestLabels(card.key, ask, actor);
        out.push({ card: card.key, set: { module: set.module ?? [], stack: set.stack ?? [] }, asked: ask });
      }
      return out;
    },

    /** A proposal becomes a label — the only way there leads through a hand. */
    async confirmLabels(key, actor) {
      const item = await findItem(key);
      const updated = await store.items.patch(item.key, {
        module: mergeLabels(item.module, item.suggestions?.module ?? []),
        stack: mergeLabels(item.stack, item.suggestions?.stack ?? []),
        suggestions: { module: [], stack: [] },
      });
      await note(item, actor, 'confirmed', { module: updated.module, stack: updated.stack });
      return this.getItem(item.key);
    },

    /**
     * A piece of evidence — what shows that something really happened on this
     * card: a commit, a run, a file. It goes into the chronicle and nowhere
     * else; a second place for the same truth drifts apart eventually.
     *
     * THE SAME EVIDENCE TWICE IS NONE. `gradula sync` runs more than once
     * over the same history, and a card with forty identical lines is one
     * nobody reads any more.
     */
    /**
     * Evidence. A commit may bring its AUTHOR along, and that is the only
     * identity on this board nobody typed in about themselves: the actor
     * header is a claim, a signed-in name is a claim about a session, but a
     * commit was signed by whoever wrote it. It is stored beside the evidence,
     * never instead of the actor — who pushed and who wrote are two questions.
     */
    async addEvidence(key, {
      kind, ref, comment = null, note: sentNote = null, author = null, email = null, files = null,
    }, actor) {
      // `note` is what the CLI has always sent and `comment` is what this
      // method has always read, so every commit title since the first day
      // landed as null. Nothing went red: evidence without its line still
      // counts as evidence, it just says nothing. (Renamed on the way in:
      // `note` is also the function that writes the chronicle, one line down.)
      const line = comment ?? sentNote;
      const item = await findItem(key);
      const evidenceKind = String(kind ?? 'commit');
      if (!['commit', 'run', 'file', 'url'].includes(evidenceKind)) throw bad('kind', 'evidence.kind: commit, run, file or url.');
      const mark = text(ref, 300, 'ref');

      const history = await store.events.of(item.id);
      if (history.some((e) => e.verb === 'evidenced' && e.data?.ref === mark)) {
        return { fresh: false, card: await this.getItem(item.key) };
      }
      // GitHub writes `12345+login@users.noreply.github.com` for anyone who
      // keeps their address private — the login is in there, and it is the
      // name the repository knows them by.
      const noreply = String(email ?? '').match(/^(?:\d+\+)?([\w-]+)@users\.noreply\.github\.com$/i);
      /*
       * A COMMIT KNOWS WHICH FILES IT TOUCHED, AND NOBODY WILL EVER TYPE THEM.
       *
       * `files` is the one field that makes the wave, the collision warning at
       * `start` and half the cartographer real — and on the live board 2 of 49
       * cards carried any. Of course they did: it asked a person to write down
       * paths they had just written code in.
       *
       * The commit already knows. They are ADDED, never replaced: a card is
       * usually several commits, and the second one must not erase what the
       * first one touched.
       */
      if (Array.isArray(files) && files.length) {
        const before = item.files ?? [];
        const all = [...new Set([...before, ...files.map((f) => String(f).replace(/^\/+/, '').slice(0, 200))])].slice(0, 60);
        if (all.length !== before.length) {
          /*
           * THE FILES LABEL THE CARD. A card born from a commit carries a
           * subject and no path — the board's rules found no module in "The
           * board moves by itself", and four of five cards stood unlabelled
           * on the map. The commit's files are the clearest hint there is,
           * and the vocabulary maps every path to a module: read them now,
           * add what they say (never remove what a hand set).
           */
          const vocabulary = await store.vocab.get(item.project);
          const found = labelsFor({ title: item.title, text: item.text, files: all, vocabulary });
          const module = mergeLabels(item.module ?? [], found.module);
          const stack = mergeLabels(item.stack ?? [], found.stack);
          await store.items.patch(item.key, { files: all, ...(module.length !== (item.module ?? []).length ? { module } : {}), ...(stack.length !== (item.stack ?? []).length ? { stack } : {}) });
        }
      }

      await note(item, actor, 'evidenced', {
        kind: evidenceKind, ref: mark, comment: line ? String(line).slice(0, 300) : null,
        ...(author ? { author: String(author).slice(0, 120) } : {}),
        ...(email ? { email: String(email).slice(0, 200) } : {}),
        ...(noreply ? { github: noreply[1] } : {}),
      });
      return { fresh: true, card: await this.getItem(item.key) };
    },

    /**
     * A word on the card. It stands in the same chronicle as everything else
     * — a card has ONE timeline of deeds and words, not two views you have to
     * lay side by side.
     */
    async say(key, line, actor) {
      const item = await findItem(key);
      const word = text(line, 4000, 'text');
      await note(item, actor, 'said', { line: word });
      return this.getItem(item.key);
    },

    /**
     * A decision. It ALWAYS carries a reason — a decision without one is, in
     * three weeks, no longer a decision but a claim somebody renegotiates.
     * And it names whoever made it.
     *
     * A decided card moves to `done`: the question is answered. What is to be
     * DONE about it is a card of its own — otherwise what outcome decided gets
     * mixed up with what is still outstanding.
     */
    async decide(key, { result, reason }, actor) {
      const item = await findItem(key);
      const outcome = text(result, 500, 'result');
      const why = text(reason, 4000, 'reason');
      await note(item, actor, 'decided', { result: outcome, reason: why });
      if (item.state !== 'done') await store.items.patch(item.key, { state: 'done' });
      return this.getItem(item.key);
    },

    /**
     * What the gate last said — `green`, `red`, or `null` when it never ran.
     *
     * The service does not run gates; a hand does (`gradula gates`), and
     * what came out stands in the chronicle as a `run`. So this is a
     * reading, not a measurement — the newest run counts, older ones are
     * history.
     */
    async gateStanding(item) {
      if (!item.gate) return null;
      const history = await store.events.of(item.id);
      const runs = history.filter((e) => e.verb === 'evidenced' && e.data?.kind === 'run');
      const last = runs[runs.length - 1];
      if (!last) return null;
      return /^green\b/i.test(String(last.data?.comment ?? '')) ? 'green' : 'red';
    },

    /**
     * A CARD MAY GO ONLY WHILE IT IS NOTHING BUT WORDS. A test idea, a
     * misheard sentence, a duplicate: gone, and nothing is lost. A card that
     * carries evidence, was seen deployed, or ever left ideas is history —
     * a commit names it, a deployment carried it, someone worked on it —
     * and history is not deleted; it goes on ice, where it stays findable.
     */
    async removeItem(key, actor) {
      const item = await findItem(key);
      const history = await store.events.of(item.id);
      const touched = history.some((e) => ['evidenced', 'deployed', 'started', 'moved'].includes(e.verb));
      if (!['ideas', 'ice'].includes(item.state) || touched) {
        throw new Refusal(409, 'has-history', `${item.key} is not just words any more (${item.state}${touched ? ', with a chronicle' : ''}) — put it on ice: gradula move ${item.key} ice --reason "…"`);
      }
      await store.items.remove(item.key);
      live?.announce(item.project, { verb: 'removed', card: item.key, actor });
      return { key: item.key, removed: true };
    },

    async moveItem(key, state, actor, reason = null) {
      const item = await findItem(key);
      const target = String(state);
      if (!isState(target)) throw bad('state', 'I do not know that state.');
      if (item.state === target) return this.getItem(item.key);
      /*
       * A RED GATE IS NOT OVERRULED BY A HAND.
       *
       * A gate is the card's own claim of what proves it done. Until this
       * check, "approve" on the board and `→ done` by hand walked past it:
       * a card whose test was red could be filed as done by anybody, and
       * the sheet merely SAID "the gate proves it, the hand agrees". Now the
       * sentence is true. A card with a gate reaches done through the gate
       * — or the gate is changed first, in the open, in the chronicle.
       *
       * A card WITHOUT a gate is untouched: there the hand is the only judge,
       * which is what review is for.
       */
      if (target === 'done' && item.gate) {
        const standing = await this.gateStanding(item);
        if (standing !== 'green') {
          const call = `${item.gate.kind} ${item.gate.call}`;
          throw new Refusal(409, 'gate-red', standing === 'red'
            ? `The gate is red (${call}). Make it green — gradula gates — or change the gate; a hand does not overrule it.`
            : `The gate has not run yet (${call}). Run it — gradula gates — or change the gate; a hand does not stand in for it.`);
        }
      }
      await store.items.patch(item.key, { state: target, ...(target !== 'making' ? { reservation: null, heartbeat: null } : {}) });
      await note(item, actor, 'moved', { from: item.state, to: target, reason });
      if (target === 'done') await this.closeInSentry(item, actor);
      /* the board's rule: what reaches done is public — incidents excepted, and only what is not public already */
      if (target === 'done' && item.visibility !== 'public' && item.source !== 'sentry') {
        const board = await store.projects.get(item.project);
        if (board?.publish === 'done') {
          await store.items.patch(item.key, { visibility: 'public' });
          await note(item, actor, 'changed', { fields: ['visibility'], visibility: 'public', by: 'rule', rule: 'done' });
        }
      }
      const alsoClosed = ['done', 'ice'].includes(target) ? await this.ripen(item.project) : [];
      return { ...(await this.getItem(item.key)), ...(alsoClosed.length ? { alsoClosed } : {}) };
    },

    /**
     * What is ripe gets harvested: a venture whose parts are all settled goes
     * to done by itself.
     *
     * That is the ONLY place a card without a gate moves by itself — and it
     * may, because nothing here is guessed: the parts are counted, not
     * estimated. The chronicle names the rule as the actor, so the move can be
     * seen and turned back. A tool that tidies up quietly loses trust exactly
     * once.
     *
     * It runs on EVERY move to done or ice, not on demand: a rule you have to
     * trigger is not a rule.
     */
    async ripen(projectKey) {
      const [cards, links] = await Promise.all([
        store.items.list(projectKey, {}),
        store.links.list(projectKey),
      ]);
      const harvested = [];
      for (const { card, parts } of ripe(cards, links)) {
        await store.items.patch(card.key, { state: 'done' });
        await note(card, `Gradula (rule: all parts done)`, 'moved', {
          from: card.state, to: 'done', reason: `${parts.length} parts done: ${parts.join(', ')}`,
        });
        harvested.push(card.key);
      }
      return harvested;
    },

    async link({ from, to, kind, source = 'human', reason = null }, actor) {
      const a = await findItem(from);
      const b = await findItem(to);
      if (a.project !== b.project) throw bad('foreign', 'Two projects, one link — that cannot be.');
      if (a.id === b.id) throw bad('self', 'A card does not hang on itself.');
      if (!isLinkKind(String(kind))) throw bad('kind', `kind: needs, blocks, part-of, resembles or touches.`);
      if (!isLinkSource(String(source))) throw bad('source', 'source: human, rule or model.');

      const existing = await store.links.list(a.project);
      if (existing.some((l) => l.from === a.id && l.to === b.id && l.kind === kind)) {
        throw new Refusal(409, 'duplicate', 'That link already exists.');
      }
      const chain = cycleWith(existing, { from: a.id, to: b.id, kind });
      if (chain) {
        const byId = new Map((await store.items.list(a.project, {})).map((i) => [i.id, i.key]));
        throw new Refusal(409, 'cycle', `That would close a cycle: ${chain.map((id) => byId.get(id) ?? id).join(' → ')}`);
      }

      const link = await store.links.add({
        project: a.project, from: a.id, to: b.id, kind, source, reason,
        confirmed: source !== 'model',
      });
      await note(a, actor, 'linked', { kind, to: b.key, source });
      return { ...link, from: a.key, to: b.key };
    },

    async unlink(id, actor) {
      const gone = await store.links.remove(String(id));
      if (!gone) throw missing('There is no such link.');
      return { entfernt: true, from: actor };
    },

    /**
     * Begin a card. The state changes, the chronicle names the person, and
     * who else is touching the same files right now stands in the answer. The
     * warning stops nobody: you should just not walk in blind.
     */
    /**
     * A runner's heartbeat — a LEASE, not a switch.
     *
     * A runner does not say "I am stopping", it stops saying. Going stale IS
     * the stop signal, so nobody has to reset a flag; the same rule as with
     * `blocked`. A stored "running" is wrong at the first closed laptop, and
     * afterwards nobody knows which one.
     *
     * It writes NO chronicle line. A log with a heartbeat in every minute is
     * not a log any more.
     */
    async beat(key, actor, { owner = actor, session = actor } = {}) {
      const item = await findItem(key);
      const reservation = item.reservation;
      if (!reservation) throw new Refusal(409, 'not-reserved', 'Start this card before sending a heartbeat.');
      if (reservation.owner !== owner || reservation.session !== session) throw new Refusal(409, 'reserved', `This card belongs to ${reservation.actor}. Start with an explicit takeover reason.`);
      if (!activeReservation(reservation) || item.state !== 'making') throw new Refusal(409, 'expired', 'The reservation expired. Start the card again before continuing.');
      const until = new Date(Date.now() + RUNNING_MS).toISOString();
      const changed = await store.items.patch(key, { reservation: { ...reservation, until }, heartbeat: new Date().toISOString() }, { expected: { reservation, state: 'making' } });
      if (!changed) throw new Refusal(409, 'reservation-changed', 'The reservation changed. Refresh before continuing.');
      return { card: key, until, warnings: workWarnings(changed, await store.items.list(item.project, { state: 'making' })) };
    },

    async releaseWork(key, actor, { owner = actor, session = actor } = {}) {
      const item = await findItem(key);
      if (!item.reservation) return this.getItem(key);
      if (item.reservation.owner !== owner || item.reservation.session !== session) throw new Refusal(409, 'reserved', 'Only the owning session can release its reservation.');
      const changed = await store.items.patch(key, { reservation: null, heartbeat: null }, { expected: { reservation: item.reservation } });
      if (!changed) throw new Refusal(409, 'reservation-changed', 'The reservation changed. Refresh before continuing.');
      await note(changed, actor, 'changed', { fields: ['reservation'], reservation: 'released' });
      return this.getItem(key);
    },

    async startItem(key, actor, { anyway = null, takeover = null, files = null, workspaceReason = null, owner = actor, session = actor } = {}) {
      const item = await findItem(key);
      /*
       * AN IDEA IS NOT AN ORDER, AND ICE IS OFF THE BOARD.
       *
       * Start used to take any card from any column, so the one move that
       * means "yes, build this" — ideas to ready — could be skipped by
       * whoever was quickest. It cannot now: the yes is a move a person
       * makes, and the chronicle names who made it.
       */
      if (!['ready', 'making'].includes(item.state)) {
        throw new Refusal(409, 'not-ready', `${item.key} is in ${item.state}. Move it to ready first — that move is the yes, and the chronicle names who gave it.`);
      }
      const running = (await store.items.list(item.project, { state: 'making' })).filter((r) => r.id !== item.id);
      let paths;
      try { paths = files === null ? (item.reservation?.files ?? filesOf(item)) : plannedPaths(files); }
      catch (error) { throw bad('files', error.message); }
      if (typeof session !== 'string' || !session.trim() || session.length > 200) throw bad('session', 'A session identifier of at most 200 characters is required.');
      const localReason = workspaceReason === null ? null : text(workspaceReason, 500, 'workspaceReason');
      const previous = item.reservation;
      const same = previous?.owner === owner && previous?.session === session;
      const handover = takeover === null ? null : text(takeover, 500, 'takeover');
      if (activeReservation(previous) && !same && !handover) throw new Refusal(409, 'reserved', `${key} is reserved by ${previous.actor} until ${previous.until}. Take over only with a reason.`);
      const reservation = { owner, session, actor, files: paths, until: new Date(Date.now() + RUNNING_MS).toISOString(), id: same ? previous.id : randomUUID() };
      const warnings = workWarnings({ ...item, reservation }, running);
      const blocked = (await this.getItem(item.key)).blockedBy;
      /*
       * BLOCKED MEANS BLOCKED — unless somebody says why not.
       *
       * Nineteen `needs` links lay on the live board and not one of them
       * stopped anything: the warning stood under the brief, and whoever
       * read it there had already begun. Now start refuses a card that waits
       * — with a way through, because a lock nobody can open is a lock that
       * gets worked around: a reason, and the reason stands in the chronicle
       * beside the start. Collisions (the same files in making) stay a
       * warning; in a small team that is normal, not a fault.
       */
      const why = anyway === null || anyway === undefined ? null : text(anyway, 500, 'anyway');
      if (blocked.length && !why) {
        throw new Refusal(409, 'blocked', `${item.key} waits on ${blocked.join(', ')}. Finish those first — or start anyway with a reason; the reason stands in the chronicle.`);
      }
      const claimed = await store.items.patch(item.key, { state: 'making', reservation, heartbeat: new Date().toISOString() }, { expected: { reservation: previous, state: item.state } });
      if (!claimed) throw new Refusal(409, 'reservation-changed', 'Another session changed this card. Refresh and check its reservation.');
      await note(claimed, actor, 'started', { warnings, blockedBy: blocked, reservation: { actor, session, files: paths }, ...(localReason ? { workspaceReason: localReason } : {}), ...(handover ? { takeover: handover, previousActor: previous?.actor } : {}), ...(blocked.length && why ? { anyway: why } : {}) });
      return { ...(await this.getItem(item.key)), warnings };
    },

    // ---- The standing: where something has arrived -----------------------

    /**
     * The connection to Dokploy. It only FETCHES — `mayWrite` is empty, and
     * it stays that way: no deploy button. Watching yes, triggering later and
     * then with a confirmation (manifest, "what deliberately does NOT stand here").
     */
    async setDokploy(projectKey, input) {
      const project = await this.getProject(projectKey);
      const base = String(input.base ?? '').trim();
      if (!/^https:\/\/[a-z0-9.-]+(\/[a-z0-9/_-]*)?$/i.test(base)) {
        throw bad('base', 'base: the Dokploy API address, e.g. https://dokploy.example.dev/api');
      }
      // One compose per environment: `{ production, development }`. The old
      // single `composeId` still counts and means production.
      const composes = {};
      for (const [environment, id] of Object.entries(input.composes && typeof input.composes === 'object' ? input.composes : {})) {
        if (!/^(production|development)$/.test(environment)) throw bad('composes', 'composes: production and development only.');
        if (id) composes[environment] = String(id).slice(0, 120);
      }
      const stored = await store.dokploy.set(project.key, {
        base,
        token: input.token,
        composeId: input.composeId ? String(input.composeId).slice(0, 120) : composes.production ?? null,
        composes,
      });
      return dokploy.publicConnection({ ...stored, setAt: new Date().toISOString() });
    },

    async getDokploy(projectKey, { raw = false } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.dokploy.get(project.key);
      return raw ? connection : dokploy.publicConnection(connection);
    },

    /**
     * The standing in one line. It does not answer "is it done" — the gate
     * proves that — but "where has it arrived".
     */
    async standing(projectKey, { fetchImpl } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.dokploy.get(project.key);
      if (!connection?.token) return { standing: 'unknown', line: 'no Dokploy connection', deployments: [] };
      const fetched = await dokploy.fetchDeployments(connection, fetchImpl ? { fetchImpl } : {});
      if (!fetched.ok) return { standing: 'unknown', line: fetched.reason, deployments: [] };
      return { ...dokploy.standingOf(fetched.deployments), deployments: fetched.deployments };
    },

    /**
     * The connection to EAS — the app on a phone.
     *
     * `app` is the full name Expo knows it by: @account/slug. Not the project
     * id: an id is right for a machine and unreadable for the person who has
     * to check whether the board is watching the right thing.
     */
    async setEas(projectKey, input) {
      const project = await this.getProject(projectKey);
      const app = String(input.app ?? '').trim();
      if (!/^@[\w.-]+\/[\w.-]+$/.test(app)) throw bad('app', 'app: @account/slug, the full name Expo knows it by.');
      const stored = await store.eas.set(project.key, { app, token: input.token });
      return eas.publicConnection({ ...stored, setAt: new Date().toISOString() });
    },

    async getEas(projectKey, { raw = false } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.eas.get(project.key);
      return raw ? connection : eas.publicConnection(connection);
    },

    /**
     * Where the app has arrived, per platform. A BUILD IS NOT A RELEASE: a
     * finished build with nothing submitted behind it says `built`, and the
     * board must not round that up.
     */
    async appStanding(projectKey, { fetchImpl } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.eas.get(project.key);
      if (!connection?.token) return { platforms: {}, line: 'no EAS connection', builds: [] };
      const fetched = await eas.fetchWork(connection, fetchImpl ? { fetchImpl } : {});
      if (!fetched.ok) return { platforms: {}, line: fetched.reason, builds: [] };
      return {
        app: connection.app,
        platforms: eas.standingOf(fetched),
        builds: fetched.builds,
        submissions: fetched.submissions,
      };
    },

    /**
     * The system — one picture from every connection and the board, in one
     * shape (system.mjs). The FETCHED parts — what Dokploy, EAS, GitHub and
     * Sentry answered — are held for FRESH_MS per project, however many ask:
     * the second viewer costs nothing, and a page that polls costs one round
     * per half minute, not one per viewer. The board's half (people, cards)
     * is ours and costs two reads: it is taken anew on every ask, so a card
     * that moved a second ago is in the next picture, not the one after
     * the cache.
     *
     * `fresh` skips the cache — the live poll uses it, so its beat IS the
     * cache's clock. Single-flight: two askers during a gather share it.
     */
    async system(projectKey, { fetchImpl, fresh = false, now = Date.now, deployedCache, budget } = {}) {
      const project = await this.getProject(projectKey);
      const board = async () => {
        const [history, cards] = await Promise.all([this.history(project.key, { limit: 500 }), store.items.list(project.key, {})]);
        return { history, cards };
      };
      const held = systemHeld.get(project.key);
      if (held?.promise) return held.promise;
      if (held && !fresh && now() - held.at < FRESH_MS) {
        const picture = boardPicture({ ...(await board()), now: now() });
        // Where a card has arrived was measured with the held picture; a
        // card that was not in it yet has not been measured — unknown, not
        // "not deployed".
        const measured = new Map((held.doc.cards ?? []).map((card) => [card.key, { deployed: card.deployed, evidence: card.evidence ?? 0 }]));
        return { ...held.doc, people: picture.people, cards: picture.cards.map((card) => ({ ...card, ...(measured.get(card.key) ?? { deployed: unknownDeployed(), evidence: 0 }) })) };
      }
      const promise = (async () => {
        const [dokployConnection, easConnection, githubConnection, sentryConnection, boardNow] = await Promise.all([
          store.dokploy.get(project.key),
          store.eas.get(project.key),
          store.github.get(project.key).then((c) => c ?? (project.repo ? { repo: project.repo } : null)),
          store.sentry.get(project.key),
          board(),
        ]);
        /*
         * The evidence of the cards in question, COMPLETE. The project's
         * history above is cut at 500 entries — enough for "who moved what
         * today", not for "every commit of a card done last week" on a
         * busy board. So the candidates' own chronicles are read, one per
         * card, and only for the cards the picture will ask about.
         */
        const candidates = candidatesOf(boardNow.cards, { now: now() });
        const chronicles = new Map(await Promise.all(candidates.map(async (card) => [card.key, await store.events.of(card.id)])));
        const evidence = new Map();
        for (const [key, history] of chronicles) {
          const found = evidenceOf(history, () => key).get(key);
          if (found) evidence.set(key, found);
        }
        const doc = await gatherSystem({
          connections: { dokploy: dokployConnection, eas: easConnection, github: githubConnection, sentry: sentryConnection },
          board: { ...boardNow, evidence },
          ...(fetchImpl ? { fetchImpl } : {}),
          now,
          ...(deployedCache ? { deployedCache } : {}),
          ...(budget !== undefined ? { budget } : {}),
        });
        await this.noteDeployed(project.key, doc, { cards: boardNow.cards, chronicles });
        await this.noteReleases(project.key, doc, { github: githubConnection, fetchImpl, now: now() });
        return doc;
      })();
      systemHeld.set(project.key, { ...(held ?? { at: 0, doc: null }), promise });
      try {
        const doc = await promise;
        systemHeld.set(project.key, { at: now(), doc, promise: null });
        return doc;
      } catch (error) {
        systemHeld.set(project.key, { ...(held ?? { at: 0, doc: null }), promise: null });
        throw error;
      }
    },

    /**
     * The chronicle's memory of a lane: the FIRST time a card is seen
     * deployed in an environment, one note — verb `deployed`, hand
     * `dokploy`, with the sha and the time of the head that carried it. A
     * second look at the same lane writes nothing: the foreign id
     * (`dokploy:<environment>:<card>:<sha>`) is looked up in the card's own
     * chronicle first, the way the Sentry door looks its issue up before it
     * creates a card.
     *
     * AND THE CARD MOVES. This is where the board learns that work has
     * arrived, so this is where a card goes on by itself: seen on
     * development it goes to REVIEW (it can be looked at on dev now), seen on
     * production it goes to DONE (it is out). Before this the sentence was
     * "a hand moves a card to done" — and the hand never came: cards with
     * two commits on production sat in making for a day, and the board said
     * nothing was finished. A card with a gate keeps its law: done only
     * through a green gate — a red or unrun gate leaves it in review with the
     * refusal as the reason, and `gradula gates` finishes it.
     */
    async noteDeployed(projectKey, doc, { cards = [], chronicles = new Map() } = {}) {
      const byKey = new Map(cards.map((card) => [card.key, card]));
      const written = [];
      for (const [environment, lane] of Object.entries(doc.deployed ?? {})) {
        if (!lane?.sha) continue;
        for (const key of lane.cards ?? []) {
          const item = byKey.get(key);
          if (!item) continue;
          const history = chronicles.get(key) ?? await store.events.of(item.id);
          const foreignId = foreignIdOf(environment, key, lane.sha);
          const seen = history.some((e) => e.verb === 'deployed'
            && (e.data?.foreignId === foreignId || e.data?.environment === environment));
          if (seen) continue;
          await note(item, 'dokploy', 'deployed', { environment, sha: lane.sha, at: lane.at ?? doc.at, foreignId });
          written.push({ card: key, environment, moved: await this.arrived(key, environment, lane.sha) });
        }
      }
      return written;
    },

    /**
     * A RELEASE IS SPOKEN ONCE. Every release the picture shows (releases.mjs:
     * the web head, an app build, an update) that memory does not know is
     * remembered and announced — one note per lane with the cards it carries.
     * The web's cards the picture already knows; an app build's are the
     * `Plan:` lines of the commits between the previous build and this one
     * (one compare); without commits, what reached production in between.
     * The first release on a lane carries what stands on production.
     */
    async noteReleases(projectKey, doc, { github: connection = null, fetchImpl = defaultFetch, now = Date.now() } = {}) {
      const found = releasesIn(doc);
      if (!found.length) return [];
      const known = await store.releases.list(projectKey);
      const seen = new Set(known.map((r) => r.id));
      const fresh = found.filter((r) => !seen.has(r.id));
      if (!fresh.length) return [];
      // the first picture after the memory was empty: remember everything, speak only the newest per lane
      const firstTime = known.length === 0;
      const newestPerLane = new Map();
      for (const r of fresh) if (!newestPerLane.has(r.lane) || String(newestPerLane.get(r.lane).at) < String(r.at)) newestPerLane.set(r.lane, r);
      const cards = await store.items.list(projectKey, { limit: 2000 });
      const byKey = new Map(cards.map((c) => [c.key, c]));
      const spoken = [];
      const remembered = [...known];
      for (const release of fresh) {
        const previous = previousOf(release, remembered);
        let keys = release.cards;
        if (!keys) {
          if (previous?.commit && release.commit && connection?.repo && connection?.token) {
            const between = await github.compareCommits({ repo: connection.repo, token: connection.token, base: previous.commit, head: release.commit }, { fetchImpl }).catch(() => ({ ok: false }));
            if (between.ok) keys = [...new Set(between.commits.flatMap((c) => carriesOf(c.message)))];
          }
          // without a previous build: what reached production in the week before this release — never what came later
          if (!keys) keys = cardsBetween(cards, previous ? previous.at : new Date(Date.parse(release.at) - 7 * 86400e3).toISOString(), release.at);
        }
        const held = { ...release, cards: keys.filter((k) => byKey.has(k)) };
        await store.releases.add(projectKey, held);
        remembered.push(held);
        // memory was empty: everything is remembered, and only what is news — the newest per lane, and younger than a day — is spoken
        if (firstTime && (newestPerLane.get(release.lane)?.id !== release.id || now - Date.parse(release.at) > 86400e3)) continue;
        spoken.push(held);
        await announceRelease(projectKey, held, held.cards.map((k) => byKey.get(k)));
      }
      return spoken;
    },

    /**
     * Where a card goes when it is seen in a lane — see noteDeployed. Returns
     * the state it went to, or null when it stayed.
     */
    async arrived(key, environment, sha) {
      const item = await findItem(key);
      const project = await store.projects.get(item.project);
      if (environment === 'production' && project.manualAcceptance === true) {
        if (['ideas','ready','making'].includes(item.state)) {
          await this.moveItem(key, 'review', 'dokploy', 'Production delivered; manual acceptance is required.');
          return 'review';
        }
        return null;
      }
      const reason = `seen on ${environment} (${String(sha).slice(0, 7)})`;
      if (environment === 'development' && ['ideas', 'ready', 'making'].includes(item.state)) {
        await this.moveItem(key, 'review', 'dokploy', reason);
        return 'review';
      }
      if (environment === 'production' && ['ideas', 'ready', 'making', 'review'].includes(item.state)) {
        try {
          await this.moveItem(key, 'done', 'dokploy', reason);
          return 'done';
        } catch (error) {
          if (!(error instanceof Refusal) || error.code !== 'gate-red') throw error;
          if (item.state === 'review') return null;
          await this.moveItem(key, 'review', 'dokploy', `${reason} — ${error.message}`);
          return 'review';
        }
      }
      return null;
    },

    // ---- Sentry: the incidents -------------------------------------------

    /**
     * A project's connection to ITS Sentry project. One per Gradula project —
     * another repository has other crashes and another Sentry project.
     */
    async setSentry(projectKey, connection) {
      const project = await this.getProject(projectKey);
      const org = text(connection.org, 80, 'org');
      const sentryProject = text(connection.project, 80, 'project');
      const base = connection.base ? String(connection.base) : BASE_US;
      if (!/^https:\/\/[a-z0-9.-]+\/api\/0$/.test(base)) {
        throw bad('base', `base: ${BASE_EU} (EU) or ${BASE_US} (US).`);
      }
      const before = await store.sentry.get(project.key);
      const laneMapGiven = connection.environments && typeof connection.environments === 'object' && !Array.isArray(connection.environments);
      const laneMap = laneMapGiven ? connection.environments : connection.lanes;
      const lanes = laneMap && typeof laneMap === 'object'
        ? Object.fromEntries(Object.entries(laneMap).map(([lane, names]) => [text(lane, 40, 'lanes'), [].concat(names).map((n) => text(n, 80, 'lanes'))]))
        : undefined;
      const environments = laneMapGiven ? undefined : readEnvironments(connection.environments);
      if (Array.isArray(environments)) for (const one of environments) text(one, 80, 'environments');
      const kept = {
        org,
        project: sentryProject,
        base,
        // A secret sent empty DELETES nothing — otherwise a form that only
        // changes the organization takes the hook's key.
        token: connection.token ? String(connection.token) : before?.token ?? null,
        hookSecret: connection.hookSecret ? String(connection.hookSecret) : before?.hookSecret ?? null,
        writeBack: connection.writeBack === true,
        /*
         * WHICH ENVIRONMENTS BECOME CARDS. A list of Sentry environment
         * names (`['prod', 'dev']`), the word `all`, or nothing — then
         * production in both spellings the apps use. Not said (undefined)
         * keeps what was there; `null` goes back to the default. The map of
         * lane names used to live under this name; it is a map, and a map
         * given here still means the lanes.
         */
        environments: environments === undefined ? readEnvironments(Array.isArray(before?.environments) || before?.environments === 'all' ? before.environments : null) : environments,
        // How Sentry names the lanes — optional; the system picture asks each
        // lane's errors under these names (see system.mjs, sentryEnvironmentsOf).
        lanes: lanes === undefined ? lanesOf(before) : lanes,
      };
      await store.sentry.set(project.key, kept);
      return publicConnection(kept);
    },

    async getSentry(projectKey, { raw = false } = {}) {
      const project = await this.getProject(projectKey);
      const connection = await store.sentry.get(project.key);
      return raw ? connection : publicConnection(connection);
    },

    /**
     * Take in an issue — ONE card per cause. If the same issue comes back,
     * the counter rises; if the card was already done it surfaces again and
     * the chronicle says why. A crash that comes back is not a new note but
     * bad news about an old one.
     */
    async ingestIssue(projectKey, raw, actor = 'sentry', { askSentry = true, fetchImpl = defaultFetch } = {}) {
      const project = await this.getProject(projectKey);
      const issue = issueOf(raw) ?? (raw?.id ? raw : null);
      if (!issue) throw bad('form', 'There is no issue in this payload.');

      /*
       * A DOOR FOR MDLA TAKES MDLA'S ISSUES.
       *
       * An internal Sentry integration is per ORGANISATION and carries one
       * webhook URL, so every project in it posts to the same door — and the
       * door names ONE board project in its path. Without this line a crash in
       * the `gradula` project became a card on the Mundula board, which is
       * exactly what MDLA-48 was.
       *
       * Only checked when the payload says which project it is: a pull hands
       * over bare issues that carry no project, and those came from the
       * connection in the first place.
       */
      const from = projectOf(raw);
      const connection = await store.sentry.get(project.key);
      if (from && connection?.project && from !== connection.project) {
        return { fresh: false, ignored: true, reason: `${from} is not this project's Sentry project` };
      }


      const vocabulary = await store.vocab.get(project.key);
      const fields = issueToCard(issue, { vocabulary });
      const existing = await store.items.byForeign(project.key, fields.foreignId);
      const action = actionOf(raw);

      // Settled or put away: that is news ABOUT a card, not a new incident.
      // If the card does not exist there is nothing to say either — a note
      // for something already over is only noise.
      if (action === 'resolved' || action === 'archived') {
        if (!existing) return { fresh: false, ignored: true, reason: `${action} without a card` };
        const target = action === 'archived' ? 'ice' : 'review';
        if (existing.state !== target && existing.state !== 'done') {
          await store.items.patch(existing.key, { state: target });
        }
        // `moved` even when the state did not change: a herald filters on
        // verbs, and "somebody resolved this in Sentry" is a move somebody
        // made, not a word of its own that no filter has ever heard of.
        await note(existing, actor, 'moved', {
          from: existing.state, to: existing.state === 'done' ? 'done' : target,
          reason: action === 'archived' ? 'archived in Sentry' : 'resolved in Sentry',
          foreignId: fields.foreignId,
        });
        return { fresh: false, action, card: await this.getItem(existing.key) };
      }

      /*
       * WHERE IT HAPPENED DECIDES WHETHER IT IS AN INCIDENT.
       *
       * The apps tag every event with an environment (prod, dev, local), and
       * a crash from a developer's own dev build on their own phone is real
       * and still not the board's business: MDLA-79 (a WatchdogTermination
       * from `dev`, taken in five times) stood in Ready like a production
       * fire. So only the connection's environments become cards — production
       * unless it says otherwise. The payload says where it happened when it
       * can; when it cannot, Sentry is asked once per issue (the latest
       * event), and an environment nobody can place counts as production: a
       * crash you cannot place is worse than a card you have to close.
       *
       * A foreign issue touches nothing — except that a card which already
       * exists for it gets one `seen` line, so the chronicle shows it keeps
       * happening. Never a new card, never a move, never a resurrection.
       * A pull hands over issues Sentry already filtered by environment; it
       * says so (`askSentry: false`) and no issue is asked about twice.
       */
      const environment = environmentOf(raw)
        ?? (askSentry ? await this.environmentOfIssue(connection, issue.id, { fetchImpl }) : null);
      if (!takesEnvironment(connection, environment)) {
        const reason = `environment ${environment} is not watched`;
        if (!existing) return { fresh: false, ignored: true, environment, reason };
        await note(existing, actor, 'seen', { environment, count: fields.count, lastSeen: fields.lastSeen, foreignId: fields.foreignId });
        return { fresh: false, ignored: true, environment, reason, card: await this.getItem(existing.key) };
      }

      if (!existing) {
        const card = await store.items.create(project.key, { ...fields, createdBy: actor });
        await note(card, actor, 'ingested', { foreignId: fields.foreignId, count: fields.count });
        return { fresh: true, card: await this.getItem(card.key) };
      }

      /*
       * NOTHING NEW IS NOT NEWS.
       *
       * Sentry lists an issue until somebody resolves it THERE. The board
       * pulls every quarter of an hour — so a card closed at noon was pushed
       * back to `ready` at ten past, with a chronicle line saying it had come
       * back, about a crash whose last event was five hours old. Measured on
       * GRD-44 and GRD-45: closed at 12:07, open again at 12:09, `lastSeen`
       * unchanged at 07:47.
       *
       * The question is not "does Sentry still list it" but "has it happened
       * since we last looked". `lastSeen` answers that, and the count catches
       * the case of two events in the same second.
       */
      const seenBefore = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
      const seenNow = fields.lastSeen ? new Date(fields.lastSeen).getTime() : 0;
      const somethingHappened = seenNow > seenBefore || (fields.count ?? 0) > (existing.count ?? 0);
      if (!somethingHappened && action !== 'unresolved') {
        return { fresh: false, unchanged: true, card: await this.getItem(existing.key) };
      }

      // "unresolved" is Sentry's word for a regression — then the card is
      // explicitly open again, not merely seen again.
      const resurrected = existing.state === 'done' || action === 'unresolved';
      await store.items.patch(existing.key, {
        count: fields.count ?? existing.count,
        lastSeen: fields.lastSeen ?? existing.lastSeen,
        permalink: fields.permalink ?? existing.permalink,
        level: fields.level ?? existing.level,
        ...(resurrected ? { state: 'ready' } : {}),
      });
      await note(existing, actor, resurrected ? 'resurfaced' : 'ingested', {
        again: true, count: fields.count, lastSeen: fields.lastSeen,
      });
      return { fresh: false, resurfaced: resurrected, card: await this.getItem(existing.key) };
    },

    /**
     * Where an issue happened, when its hook did not say: Sentry's latest
     * event for it, asked ONCE per issue id and held for the process. No
     * token, or a Sentry that does not answer: unknown (`null`) — and not
     * held, so the next ask may do better.
     */
    async environmentOfIssue(connection, id, { fetchImpl = defaultFetch } = {}) {
      if (!connection?.token || !id) return null;
      const key = `${connection.base}|${connection.org}|${id}`;
      if (issueEnvironments.has(key)) return issueEnvironments.get(key);
      try {
        const environment = await fetchLatestEnvironment({ base: connection.base, token: connection.token, id }, fetchImpl);
        issueEnvironments.set(key, environment);
        return environment;
      } catch {
        return null;
      }
    },

    /**
     * Fetching instead of waiting — for what a hook that was down missed.
     * Sentry is asked for the connection's environments only (all of them
     * when it says `all`), so what arrives here is already placed.
     */
    async pullSentry(projectKey, actor = 'sentry', { fetchImpl = fetch, limit = 25 } = {}) {
      const connection = await this.getSentry(projectKey, { raw: true });
      if (!connection?.token) throw bad('no-sentry', 'No Sentry token is stored for this project.');
      const environments = environmentsOf(connection);
      const issues = await fetchIssues({ ...connection, token: connection.token, limit, environments: environments === 'all' ? [] : environments }, fetchImpl);
      const result = { seen: issues.length, fresh: 0, again: 0 };
      for (const issue of issues) {
        const ingested = await this.ingestIssue(projectKey, issue, actor, { askSentry: false });
        if (ingested.fresh) result.fresh += 1; else result.again += 1;
      }
      return result;
    },

    /**
     * Write back when an incident card becomes done — but only when the
     * connection explicitly allows it. A failure here must not hold the card
     * up: whether something is fixed does not depend on whether a foreign
     * service happens to be answering right now.
     */
    async closeInSentry(item, actor, { fetchImpl = fetch } = {}) {
      if (item.source !== 'sentry') return null;
      const connection = await this.getSentry(item.project, { raw: true });
      const id = issueIdOf(item.foreignId);
      if (!connection?.writeBack || !connection.token || !id) return null;
      try {
        await resolveIssue({ base: connection.base, token: connection.token, id }, fetchImpl);
        await note(item, actor, 'resolved in Sentry', { id });
        return true;
      } catch (error) {
        await note(item, actor, 'Sentry did not answer', { id, line: error.message.slice(0, 200) });
        return false;
      }
    },

    async mintToken(projectKey, name, actor, kind = 'human') {
      const project = await this.getProject(projectKey);
      if (!['human', 'system'].includes(String(kind))) throw bad('kind', 'kind: human or system.');
      const { token, entry } = await store.tokens.mint({ project: project.key, name: text(name, 80, 'name'), createdBy: actor, kind: String(kind) });
      const { hash, ...rest } = entry;
      return { token, entry: rest };
    },

    /** Admin only: empties a project — every card, link and chronicle line. The project itself stays. */
    async wipeProject(projectKey) {
      const result = await store.projects.wipe(projectKey);
      live?.announce(projectKey, { verb: 'wipe', card: null, actor: 'admin' });
      return result;
    },

    async listTokens(projectKey) {
      const project = await this.getProject(projectKey);
      return store.tokens.list(project.key);
    },

    /**
     * A PERSON'S OWN KEY — minted at the board, not handed over.
     *
     * Felix's key was minted through the admin door and lay in a file on
     * David's disk for a day, waiting to be carried across. A key that has to
     * be carried is a key that is emailed. So: whoever can sign in can mint a
     * key for their own machine, see it, and revoke it — and the key IS that
     * person: owner and name are checked at the door, an actor header on such
     * a key is ignored. The admin door still exists for machines that belong
     * to nobody (a rule, a docs site).
     */
    async mintOwnKey(projectKey, name, human) {
      if (!human?.sub) throw new Refusal(403, 'humans-only', 'Only a signed-in person mints a key of their own.');
      const project = await this.getProject(projectKey);
      const { token, entry } = await store.tokens.mint({
        project: project.key, name: text(name, 80, 'name'), createdBy: human.name, kind: 'human', owner: String(human.sub), ownerName: String(human.name),
      });
      const { hash, ...rest } = entry;
      return { token, entry: rest };
    },

    async ownKeys(projectKey, human) {
      if (!human?.sub) throw new Refusal(403, 'humans-only', 'Only a signed-in person has keys of their own.');
      const project = await this.getProject(projectKey);
      return (await store.tokens.list(project.key)).filter((k) => k.owner === String(human.sub) && !k.revokedAt);
    },

    async revokeOwnKey(projectKey, id, human) {
      const mine = await this.ownKeys(projectKey, human);
      if (!mine.some((k) => k.id === String(id))) throw missing('There is no such key of yours.');
      await store.tokens.revoke(String(id));
      return { revoked: true };
    },

    /**
     * A MACHINE ASKS TO REGISTER — `gradula login`.
     *
     * The CLI knows its own hostname; it should not ask a human to type it,
     * and a human should not copy a key across. So the CLI opens a request,
     * the person approves it on the board (matching the short code the CLI
     * shows), and the CLI collects the key. The key is a person's own key,
     * with the machine as its name — the same key the board mints by hand,
     * only the machine named itself.
     */
    async openDevice(projectKey, machine) {
      const project = await this.getProject(projectKey);
      const clean = text(machine, 80, 'machine');
      const row = await store.devices.open({ project: project.key, machine: clean });
      return { id: row.id, code: row.code, project: project.key, machine: row.machine, expiresInMs: DEVICE_TTL };
    },

    /** The CLI, waiting: pending, approved (with both keys, once), denied or expired. */
    async pollDevice(id) {
      const row = await store.devices.get(id);
      if (!row) throw missing('There is no such request.');
      if (row.status !== 'approved') return { status: row.status };
      const claimed = await store.devices.claim(id);
      return { status: 'approved', token: claimed?.token ?? null, agentToken: claimed?.agentToken ?? null };
    },

    /** What the board shows a signed-in person: machines asking to join this project. */
    async pendingDevices(projectKey, human) {
      if (!human?.sub) throw new Refusal(403, 'humans-only', 'Only a signed-in person sees the machines asking to register.');
      const project = await this.getProject(projectKey);
      return store.devices.pending(project.key);
    },

    async approveDevice(projectKey, id, human) {
      if (!human?.sub) throw new Refusal(403, 'humans-only', 'Only a signed-in person approves a machine.');
      const project = await this.getProject(projectKey);
      const row = await store.devices.get(id);
      if (!row || row.project !== project.key) throw missing('There is no such request.');
      if (row.status !== 'pending') throw new Refusal(409, 'resolved', `That request is already ${row.status}.`);
      // TWO keys, one person. The first IS the approver, named after the
      // machine that asked; the second is for the AI sessions on that machine
      // (`GRADULA_AGENT_TOKEN`, src/hand.mjs), same owner, its own name — so the
      // chronicle can tell `david (Davids-MacBook-Pro)` from `david (Claude
      // Code · Davids-MacBook-Pro)`. It used to be minted by hand, which meant
      // a new developer's sessions had no key at all and came in as the person.
      const owner = { owner: String(human.sub), ownerName: String(human.name) };
      const { token } = await store.tokens.mint({ project: project.key, name: row.machine, createdBy: human.name, kind: 'human', ...owner });
      const { token: agentToken } = await store.tokens.mint({ project: project.key, name: agentKeyName(row.machine), createdBy: human.name, kind: AGENT_KEY_KIND, ...owner });
      await store.devices.resolve(id, { status: 'approved', token, agentToken, ...owner });
      return { approved: true, machine: row.machine, agent: agentKeyName(row.machine) };
    },

    async denyDevice(projectKey, id, human) {
      if (!human?.sub) throw new Refusal(403, 'humans-only', 'Only a signed-in person denies a machine.');
      const project = await this.getProject(projectKey);
      const row = await store.devices.get(id);
      if (!row || row.project !== project.key) throw missing('There is no such request.');
      if (row.status !== 'pending') return { denied: true };
      await store.devices.resolve(id, { status: 'denied' });
      return { denied: true };
    },

    async revokeToken(id) {
      const gone = await store.tokens.revoke(String(id));
      if (!gone) throw missing('There is no such key.');
      return { revokedAt: true };
    },
  };
}
