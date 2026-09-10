/**
 * Deployed — a card knows where it is, a deployment knows what it carries.
 *
 * Two facts nobody had joined: Dokploy keeps the FULL commit message of the
 * head it built (with every `Plan: MDLA-3` line in it), and GitHub knows
 * whether one commit sits inside another. Put together they answer, without
 * anybody typing a word, the question a card could never answer about
 * itself: "is this on dev yet — is it on production?"
 *
 * Two roads to the same fact, and both are taken:
 *
 *   carries    the head commit NAMES the card (`Plan: KEY`). That is read
 *              straight out of the description, costs nothing, and holds
 *              for a deployment still on its way — "which tickets are
 *              deploying right now" is exactly this list.
 *   contained  the card's evidence (a sha per commit, from the push hook)
 *              is an ancestor of the deployed head. That needs GitHub:
 *              first the head's sha, found by its title on the lane's
 *              branch, then one compare per (head, evidence).
 *
 * A compare between two fixed commits is an immutable fact and is kept
 * forever; a branch listing is kept a minute. And there is a BUDGET — a
 * picture may cost about forty GitHub calls, never more: what does not fit
 * stays `null` (unknown) and `sources` says so. Unknown is an answer; a
 * guess is not.
 *
 * No state changes here: this measures. The board moves the card when it
 * writes the note (gradula.mjs, noteDeployed → arrived): seen on development
 * → review, seen on production → done, a gate still deciding the last step.
 */

import * as github from './github.mjs';

/** Which branch a lane deploys. A connection may say otherwise (`branches`). */
export const BRANCHES = { production: 'main', development: 'dev' };
export const branchOf = (connection, environment) => String(connection?.branches?.[environment] ?? BRANCHES[environment] ?? environment);

/** How long a branch listing is served as-is. */
export const BRANCH_FRESH_MS = 60_000;
/** How many GitHub calls one gathering may spend. */
export const BUDGET = 40;
/** A card done longer ago than this is out of the picture. */
export const DONE_WINDOW_MS = 7 * 24 * 3_600_000;

const firstLine = (text) => String(text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim();
const short = (reason) => String(reason ?? '').split('\n')[0].trim().slice(0, 120);

/**
 * The cards a commit message names — one `Plan: KEY` per line, the same
 * bracket `gradula sync` reads. Unique, in order of appearance.
 */
export function carriesOf(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/^\s*Plan:\s*([A-Z]{2,8}-[0-9]{1,7})\s*$/gm)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The foreign id of one observation — the seam that keeps the note single. */
export const foreignIdOf = (environment, cardKey, sha) => `dokploy:${environment}:${cardKey}:${sha}`;

/** What a card says about itself when nobody has looked. */
export const unknownDeployed = () => ({ development: null, production: null });

/**
 * The cache: branch listings for a minute, compares forever. One per
 * process is enough — the facts do not belong to a project, they belong to
 * a repository — but a test wants one of its own.
 */
export function createDeployedCache({ branchFreshMs = BRANCH_FRESH_MS, compareLimit = 5000 } = {}) {
  const branches = new Map();
  const compares = new Map();
  return {
    branchFreshMs,
    branches,
    compares,
    rememberCompare(key, status) {
      if (compares.size >= compareLimit) compares.delete(compares.keys().next().value);
      compares.set(key, status);
    },
  };
}
const SHARED = createDeployedCache();

/**
 * The cards whose deployment is a question worth a call: in making, in
 * review, or done within the window — newest change first, so that when
 * the budget runs out it runs out on the oldest.
 */
export function candidatesOf(cards = [], { now = Date.now(), windowMs = DONE_WINDOW_MS } = {}) {
  const since = now - windowMs;
  const when = (card) => (card.changed ? new Date(card.changed).getTime() : 0);
  return cards
    .filter((card) => card.state === 'making' || card.state === 'review' || (card.state === 'done' && when(card) >= since))
    .sort((a, b) => when(b) - when(a));
}

/**
 * The evidence per card key out of a chronicle: `evidenced` entries of kind
 * `commit`, newest first. A history from `gradula.history` carries `card`;
 * one from `store.events.of` carries `item` — a lookup maps the second.
 */
export function evidenceOf(history = [], keyOf = (entry) => entry.card) {
  const out = new Map();
  for (const entry of history) {
    if (entry.verb !== 'evidenced' || entry.data?.kind !== 'commit' || !entry.data?.ref) continue;
    const key = keyOf(entry);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ sha: String(entry.data.ref), at: entry.at ?? null });
  }
  for (const list of out.values()) list.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return out;
}

/**
 * What a card's chronicle says about where it has been seen: per lane, the
 * time of the last `deployed` note. NO network — the notes are the memory.
 */
export function deployedOf(history = []) {
  const at = { development: null, production: null };
  for (const entry of history) {
    if (entry.verb !== 'deployed') continue;
    const environment = entry.data?.environment;
    if (!(environment in at)) continue;
    const when = entry.data?.at ?? entry.at ?? null;
    if (!at[environment] || String(when) > String(at[environment])) at[environment] = when;
  }
  return { development: Boolean(at.development), production: Boolean(at.production), at };
}

/**
 * The sha of what a lane runs: the newest finished deployment's title,
 * matched against the branch, newest commit first. The listing is asked
 * once a minute at most; a miss is a miss, never a guess.
 */
export async function resolveDeployedSha({ repo, token, branch, title }, { fetchImpl = fetch, cache = SHARED, now = Date.now(), spend = () => true } = {}) {
  const wanted = firstLine(title);
  if (!wanted) return { sha: null, reason: 'the deployment names no commit' };
  const key = `${repo}#${branch}`;
  let held = cache.branches.get(key);
  if (!held || now - held.at >= cache.branchFreshMs) {
    if (!spend()) return { sha: null, reason: 'budget' };
    const fetched = await github.fetchBranchCommits({ repo, token, branch }, { fetchImpl });
    if (!fetched.ok) return { sha: null, reason: fetched.reason };
    held = { at: now, commits: fetched.commits };
    cache.branches.set(key, held);
  }
  const hit = held.commits.find((c) => c.title === wanted);
  return hit ? { sha: hit.sha, at: hit.at } : { sha: null, reason: `no commit on ${branch} is titled "${wanted.slice(0, 60)}"` };
}

/**
 * Is `evidence` inside `deployed`? `identical` or `behind` (the evidence is
 * an ancestor of the head) means yes; `ahead` and `diverged` mean no; an
 * unanswered compare means nobody knows. Answers are kept forever.
 */
export async function contained({ repo, token, deployedSha, evidenceSha }, { fetchImpl = fetch, cache = SHARED, spend = () => true } = {}) {
  const key = `${repo}:${deployedSha}...${evidenceSha}`;
  if (cache.compares.has(key)) return cache.compares.get(key);
  if (!spend()) return null;
  const answer = await github.compareCommits({ repo, token, base: deployedSha, head: evidenceSha }, { fetchImpl });
  if (!answer.ok) return null;
  const yes = answer.status === 'identical' || answer.status === 'behind';
  cache.rememberCompare(key, yes);
  return yes;
}

/**
 * The whole join, for one picture.
 *
 *   environments  [{ id, deployments: [{ status, title, head?, carries, at, finishedAt? }] }]
 *   cards         the board's cards (state, changed) — the candidates are picked here
 *   evidence      Map key → [{ sha, at }] (see evidenceOf)
 *
 * Answers
 *
 *   deployed      { <environment>: { sha, at, cards: [keys] } }   per lane with a live head
 *   cards         Map key → { development: bool|null, production: bool|null }
 *   line          what to append to sources.github, or null when all was seen
 *   calls         how many GitHub calls it cost
 */
export async function gatherDeployed({
  github: connection = null,
  environments = [],
  cards = [],
  evidence = new Map(),
  fetchImpl = fetch,
  cache = SHARED,
  budget = BUDGET,
  now = Date.now(),
} = {}) {
  const known = new Set(cards.map((card) => card.key));
  const candidates = candidatesOf(cards, { now });
  const perCard = new Map(candidates.map((card) => [card.key, unknownDeployed()]));
  const deployed = {};
  const notes = [];
  let calls = 0;
  const spend = () => (calls < budget ? (calls += 1, true) : false);
  let pending = 0;

  const repo = connection?.repo ?? null;
  const token = connection?.token ?? null;
  const lanes = environments
    .map((environment) => ({ environment, live: (environment.deployments ?? []).find((d) => d.status === 'live' || d.status === 'done') ?? null }))
    .filter(({ live }) => live);

  for (const { environment, live } of lanes) {
    const lane = environment.id;
    const named = (live.carries ?? []).filter((key) => known.has(key));
    const entry = { sha: null, at: live.finishedAt ?? live.at ?? null, cards: [...named] };
    deployed[lane] = entry;
    for (const key of named) if (perCard.has(key)) perCard.get(key)[lane] = true;
    if (!repo || !token) continue;

    const found = await resolveDeployedSha(
      { repo, token, branch: branchOf(connection, lane), title: live.head || live.title },
      { fetchImpl, cache, now, spend },
    );
    if (!found.sha) { notes.push(`${lane}: ${found.reason}`); continue; }
    entry.sha = found.sha;

    // Contained? Newest cards first; the budget runs out on the oldest.
    for (const card of candidates) {
      if (perCard.get(card.key)[lane] === true) continue;
      const shas = evidence.get(card.key) ?? [];
      if (!shas.length) { perCard.get(card.key)[lane] = false; continue; }
      let verdict = true;
      for (const { sha } of shas) {
        const yes = await contained({ repo, token, deployedSha: found.sha, evidenceSha: sha }, { fetchImpl, cache, spend });
        if (yes === null) { verdict = null; break; }
        if (!yes) { verdict = false; break; }
      }
      if (verdict === null) pending += 1;
      perCard.get(card.key)[lane] = verdict;
      if (verdict) entry.cards.push(card.key);
    }
  }

  let line = null;
  if (lanes.length && (!repo || !token)) line = !repo ? 'deployed unknown: no repository' : 'deployed unknown: no token';
  else if (pending && calls >= budget) line = `deployed: ${pending} ${pending === 1 ? 'card' : 'cards'} past the budget of ${budget} calls`;
  else if (pending) line = `deployed: ${pending} ${pending === 1 ? 'card' : 'cards'} GitHub did not answer for`;
  else if (notes.length) line = `deployed: ${notes.join('; ')}`;

  return { deployed, cards: perCard, line: line ? short(line) : null, calls };
}
