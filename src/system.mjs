/**
 * The system — one live picture, gathered here, served through one key.
 *
 * Four connections and the board each know a piece: Dokploy where the web
 * shell has arrived, EAS where the app has, GitHub what the pipeline did and
 * what was released, Sentry what broke, the chronicle who moved what. Until
 * now every piece had a door of its own, and whoever wanted the picture
 * asked five times and drew it by hand — the engine room did exactly that,
 * and it drew it wrong the day one door changed shape.
 *
 * So: ONE document, ONE shape, every field optional. A connection that is
 * not set up yields an empty list AND says so in `sources` — the page can
 * then say what it is not seeing instead of pretending an empty list is a
 * quiet system. That last line is the whole point: an empty list that means
 * "nothing happened" and an empty list that means "nobody asked" look the
 * same, and only one of them is good news.
 *
 * Gathered every 30 s at most, per project, however many viewers there are;
 * announced over the live line whenever it changed (see createSystemPoll).
 */

import * as dokploy from './dokploy.mjs';
import * as eas from './eas.mjs';
import * as github from './github.mjs';
import { fetchIssues, count24hOf, environmentsOf, lanesOf } from './sentry.mjs';
import { gatherDeployed, evidenceOf, unknownDeployed, DONE_WINDOW_MS } from './deployed.mjs';

/** How long a gathered picture is served as-is. */
export const FRESH_MS = 30_000;
/** The two lanes a picture has. The local machine is nobody's environment. */
export const ENVIRONMENTS = ['production', 'development'];

const line = (text) => String(text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120);
const errorOf = (reason) => `error: ${line(reason) || 'unknown'}`;
const labelsOf = (card) => [...new Set([...(card?.module ?? []), ...(card?.stack ?? [])])];

/**
 * The names Sentry knows a lane by. A connection may say so
 * (`lanes: { production: 'prod', development: ['dev', 'development'] }`);
 * without that, the lane's own name and its short form are asked for.
 */
export const SENTRY_ENVIRONMENTS = { production: ['production', 'prod'], development: ['development', 'dev'] };
export function sentryEnvironmentsOf(connection, environment) {
  const named = lanesOf(connection)[environment];
  const list = named === undefined || named === null ? SENTRY_ENVIRONMENTS[environment] ?? [environment] : [].concat(named);
  return list.map((name) => String(name).trim()).filter(Boolean);
}

/**
 * The environments the picture asks for BESIDE the lanes: every name the
 * connection watches for cards, plus `dev` and `local` — the ones the apps
 * tag — minus what a lane already asks under. A small fixed set, one call
 * each; the errors of these stand under their own name, so the inspector
 * can count a developer's own crashes without mistaking them for a lane's.
 */
export const SENTRY_EXTRA_ENVIRONMENTS = ['dev', 'local'];
export function sentryExtraEnvironmentsOf(connection) {
  const inLanes = new Set(ENVIRONMENTS.flatMap((lane) => sentryEnvironmentsOf(connection, lane)));
  const watched = environmentsOf(connection);
  const names = [...(watched === 'all' ? [] : watched), ...SENTRY_EXTRA_ENVIRONMENTS];
  return [...new Set(names.map((name) => String(name).trim()).filter(Boolean))].filter((name) => !inLanes.has(name) && !ENVIRONMENTS.includes(name));
}

/** The empty picture — what a project without a single connection gets. */
export function emptySystem(at = new Date().toISOString()) {
  return {
    at,
    environments: ENVIRONMENTS.map((id) => ({ id, deployments: [], standing: { standing: 'unknown', line: 'not watched' } })),
    // Per lane with a live head: { sha, at, cards } — see deployed.mjs.
    deployed: {},
    builds: [],
    updates: [],
    pipeline: [],
    releases: [],
    errors: [],
    people: [],
    cards: [],
    sources: { dokploy: 'not configured', eas: 'not configured', github: 'not configured', sentry: 'not configured', board: 'ok' },
  };
}

/**
 * The board's half: who moved what in the last day, and what is in hand —
 * plus what was done within the week, because THAT is what is on its way
 * to a lane right now, and the one question those cards still have is
 * where they have arrived (`deployed`, filled in by gatherSystem; unknown
 * here — this half asks nobody).
 * Pure — it takes the chronicle and the cards and asks nobody.
 */
export function boardPicture({ history = [], cards = [], now = Date.now(), hours = 24, doneWindowMs = DONE_WINDOW_MS } = {}) {
  const since = new Date(now - hours * 3_600_000).toISOString();
  const doneSince = now - doneWindowMs;
  const recentlyDone = (card) => card.state === 'done' && card.changed && new Date(card.changed).getTime() >= doneSince;
  const byKey = new Map(cards.map((card) => [card.key, card]));
  const people = history
    .filter((entry) => entry.at && entry.at >= since && entry.card)
    .map((entry) => ({
      actor: entry.actor ?? null,
      card: entry.card,
      verb: entry.verb,
      at: entry.at,
      labels: labelsOf(byKey.get(entry.card)),
    }));
  // Who touched a card last — the hand that is on it, as far as the
  // chronicle knows; a card nobody ever moved has none.
  const lastActor = new Map();
  for (const entry of history) {
    if (entry.card && !lastActor.has(entry.card) && entry.actor) lastActor.set(entry.card, entry.actor);
  }
  const inHand = cards
    .filter((card) => card.state === 'making' || card.state === 'review' || recentlyDone(card))
    .map((card) => ({
      key: card.key, title: card.title, state: card.state, labels: labelsOf(card), actor: lastActor.get(card.key) ?? null,
      deployed: unknownDeployed(),
      // Commits behind the card — counted by gatherSystem, which has the
      // complete chronicles; this half only has the last 500 entries.
      evidence: 0,
    }));
  return { people, cards: inHand };
}

/**
 * Gather the picture. Every fetcher is injected and every failure is an
 * answer: a connection that is down costs its own list and a line in
 * `sources`, never the document.
 */
export async function gatherSystem({
  connections = {},
  board = { history: [], cards: [] },
  fetchImpl = fetch,
  now = Date.now,
  deployedCache,
  budget,
} = {}) {
  const at = new Date(now()).toISOString();
  const out = emptySystem(at);
  const opts = { fetchImpl };

  const jobs = [];

  // Dokploy — one compose per lane.
  const dk = connections.dokploy;
  if (dk?.token && dk?.base) {
    const composes = dokploy.composesOf(dk);
    if (!Object.keys(composes).length) out.sources.dokploy = 'not configured';
    else {
      out.sources.dokploy = 'ok';
      for (const environment of out.environments) {
        const composeId = composes[environment.id];
        if (!composeId) continue;
        jobs.push(dokploy.fetchDeployments({ ...dk, composeId }, opts).then((fetched) => {
          if (!fetched.ok) { out.sources.dokploy = errorOf(fetched.reason); return; }
          environment.deployments = fetched.deployments.map((d) => ({
            status: d.standing, title: d.title, at: d.at,
            ...(d.finishedAt ? { finishedAt: d.finishedAt } : {}),
            ...(d.head ? { head: d.head } : {}),
            ...(d.commit ? { commit: d.commit } : {}),
            ...(d.sha ? { sha: d.sha } : {}),
            // The cards the built commit names — a deployment on its way
            // carries them too: that is "what is deploying right now".
            carries: d.carries ?? [],
          }));
          environment.standing = dokploy.standingOf(fetched.deployments);
        }));
      }
    }
  }

  // EAS — builds and updates.
  const ea = connections.eas;
  if (ea?.token && ea?.app) {
    out.sources.eas = 'ok';
    jobs.push(eas.fetchWork(ea, opts).then((fetched) => {
      if (!fetched.ok) { out.sources.eas = errorOf(fetched.reason); return; }
      out.builds = fetched.builds.map((b) => ({
        profile: b.profile, channel: b.channel, platform: b.platform, status: b.standing, at: b.at, url: b.url, version: b.version,
        ...(b.title ? { title: b.title } : {}), ...(b.commit ? { commit: b.commit } : {}),
      }));
    }));
    jobs.push(eas.fetchUpdates(ea, opts).then((fetched) => {
      if (!fetched.ok) { if (out.sources.eas === 'ok') out.sources.eas = errorOf(`updates — ${fetched.reason}`); return; }
      out.updates = fetched.updates.map((u) => ({
        channel: u.channel, at: u.at, message: u.message, runtime: u.runtime,
        ...(u.branch ? { branch: u.branch } : {}), ...(u.platforms?.length ? { platforms: u.platforms } : {}),
      }));
    }));
  }

  // GitHub — the pipeline and the releases.
  const gh = connections.github;
  if (gh?.repo) {
    out.sources.github = 'ok';
    jobs.push(github.fetchPipeline(gh, opts).then((fetched) => {
      if (!fetched.ok) { out.sources.github = errorOf(fetched.reason); return; }
      out.pipeline = fetched.runs.map((r) => ({
        name: r.name, branch: r.branch, status: r.status, at: r.at, url: r.url,
        ...(r.commit ? { commit: r.commit } : {}), ...(r.title ? { title: r.title } : {}),
      }));
    }));
    jobs.push(github.fetchReleases(gh, opts).then((fetched) => {
      if (!fetched.ok) { if (out.sources.github === 'ok') out.sources.github = errorOf(`releases — ${fetched.reason}`); return; }
      out.releases = fetched.releases.map((r) => ({ tag: r.tag, at: r.at, url: r.url, ...(r.name ? { name: r.name } : {}) }));
    }));
  }

  // Sentry — what is unresolved, with the last day's count, PER LANE.
  const se = connections.sentry;
  if (se?.token && se?.org && se?.project) {
    out.sources.sentry = 'ok';
    const errorOfIssue = (issue, environment) => ({
      environment,
      count24h: count24hOf(issue) ?? (Number(issue.count) || 0),
      lastAt: issue.lastSeen ?? null,
      title: String(issue.title ?? issue.culprit ?? 'Incident').slice(0, 200),
      url: issue.permalink ?? null,
      ...(issue.level ? { level: issue.level } : {}),
    });
    /*
     * The issue list does not say which environment an issue belongs to
     * unless it is ASKED per environment — so it is asked once per lane,
     * under the names Sentry knows the lane by (the connection may name
     * them; otherwise the lane's own name and its short form), and once per
     * environment beside the lanes (`dev`, `local`, whatever the connection
     * watches — sentryExtraEnvironmentsOf), under that environment's own
     * name. ALL environments stand in `errors`: the board decides what
     * becomes a card, the picture shows what is happening. An issue nobody
     * claims keeps `environment: null` rather than a guess; one that fires
     * in two places stands twice, each with the count of its place. One
     * call per lane, one per extra environment, one for the whole — held
     * with the rest of the picture for FRESH_MS.
     */
    const inLane = {};
    const everywhere = [];
    const places = [
      ...ENVIRONMENTS.map((environment) => ({ environment, names: sentryEnvironmentsOf(se, environment) })),
      ...sentryExtraEnvironmentsOf(se).map((name) => ({ environment: name, names: [name] })),
    ];
    const asks = places.map(({ environment, names }) => fetchIssues({ ...se, limit: 25, statsPeriod: '24h', environments: names }, fetchImpl)
      .then((issues) => { inLane[environment] = Array.isArray(issues) ? issues : []; }));
    asks.push(fetchIssues({ ...se, limit: 25, statsPeriod: '24h', environments: [] }, fetchImpl).then((issues) => { everywhere.push(...(Array.isArray(issues) ? issues : [])); }));
    jobs.push(Promise.all(asks).then(() => {
      const claimed = new Set();
      const errors = [];
      for (const { environment } of places) {
        for (const issue of inLane[environment] ?? []) { claimed.add(String(issue.id)); errors.push(errorOfIssue(issue, environment)); }
      }
      for (const issue of everywhere) if (!claimed.has(String(issue.id))) errors.push(errorOfIssue(issue, null));
      out.errors = errors;
    }, (error) => { out.sources.sentry = errorOf(error?.message); }));
  }

  await Promise.all(jobs);

  const picture = boardPicture({ history: board.history ?? [], cards: board.cards ?? [], now: now() });
  out.people = picture.people;
  out.cards = picture.cards;

  /*
   * Where each card has arrived — the join of Dokploy's head and GitHub's
   * ancestry (deployed.mjs). It runs after the lanes are known, costs at
   * most a budget of GitHub calls, and what it cannot say stays null with a
   * word in `sources.github`. The evidence comes with the board when the
   * caller has it complete (`board.evidence`); otherwise it is read out of
   * the chronicle at hand.
   */
  const evidence = board.evidence instanceof Map ? board.evidence : evidenceOf(board.history ?? []);
  // How many commits stand behind each card. The board shows where a card
  // has arrived only once there is something that could arrive: a card
  // without a commit is not "not deployed", it is not yet on its way.
  for (const card of out.cards) card.evidence = (evidence.get(card.key) ?? []).length;
  // Branch evidence is independent from deployments. A bounded listing can
  // confirm presence, but absence from the last 100 commits proves nothing.
  if (gh?.repo && gh.token && [...evidence.values()].some(refs => refs.length)) {
    const branches = await Promise.all(['dev', 'main'].map(async branch => ({branch, result: await github.fetchBranchCommits({...gh,branch}, opts)})));
    for (const card of out.cards) {
      const refs = [...new Set((evidence.get(card.key) ?? []).map(e => e.sha))];
      card.git = {repo: gh.repo, total: refs.length};
      for (const {branch,result} of branches) card.git[branch] = result.ok ? refs.filter(ref => /^[a-f0-9]{7,40}$/i.test(ref) && result.commits.some(c => c.sha.startsWith(ref))).length : null;
    }
  }
  const lanes = out.environments.filter((environment) => environment.deployments.length);
  if (lanes.length) {
    const joined = await gatherDeployed({
      github: gh?.repo ? gh : null,
      environments: lanes,
      cards: board.cards ?? [],
      evidence,
      fetchImpl,
      now: now(),
      ...(deployedCache ? { cache: deployedCache } : {}),
      ...(budget !== undefined ? { budget } : {}),
    });
    out.deployed = joined.deployed;
    for (const card of out.cards) card.deployed = joined.cards.get(card.key) ?? card.deployed;
    // "not configured" and "error: …" already say why nothing is known;
    // an "ok" that could not answer everything says what it could not.
    if (joined.line && out.sources.github === 'ok') out.sources.github = `ok (${joined.line})`;
  }
  return out;
}

/** What of a picture counts as "the same": everything but the clock. */
export const fingerprint = (doc) => JSON.stringify({ ...doc, at: undefined });

/**
 * Which parts differ between two pictures — the announcement names them,
 * so a page can repaint one panel instead of all.
 */
export function changedParts(before, after) {
  if (!before) return Object.keys(after).filter((k) => k !== 'at');
  return Object.keys(after).filter((k) => k !== 'at' && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/**
 * The poll behind the live line. It runs ONLY while somebody is listening:
 * `presence` is what the live channel calls on every join and leave, and
 * the first listener of a project starts the beat, the last one stops it.
 * Every beat asks `gradula.system` for a fresh picture and announces the
 * change — or nothing, when nothing changed.
 */
export function createSystemPoll({ gradula, live, everyMs = FRESH_MS, log = console } = {}) {
  const beats = new Map();
  const seen = new Map();

  const tick = async (projectKey) => {
    try {
      const doc = await gradula.system(projectKey, { fresh: true });
      const before = seen.get(projectKey);
      const now = fingerprint(doc);
      if (before?.print === now) return;
      const changed = changedParts(before?.doc ?? null, doc);
      seen.set(projectKey, { print: now, doc });
      if (before) live.announceSystem(projectKey, { at: doc.at, changed });
    } catch (error) {
      log.warn?.(`[gradula] system poll ${projectKey}: ${error.message}`);
    }
  };

  return {
    presence(projectKey, count) {
      if (count > 0 && !beats.has(projectKey)) {
        const clock = setInterval(() => tick(projectKey), everyMs);
        clock.unref?.();
        beats.set(projectKey, clock);
        // The first picture right away, so the first change is measured
        // against something rather than announced as "everything".
        tick(projectKey);
      } else if (count === 0 && beats.has(projectKey)) {
        clearInterval(beats.get(projectKey));
        beats.delete(projectKey);
      }
    },
    /** Once, now — a test's hand on the clock. */
    tick,
    polling: () => [...beats.keys()],
    stop() { for (const clock of beats.values()) clearInterval(clock); beats.clear(); },
  };
}
