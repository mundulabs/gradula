/**
 * EAS — the fourth connection, and the one that says what Dokploy cannot.
 *
 * Dokploy watches the web shell. It knows nothing about the app on a phone,
 * and so the board's word "live" was quietly a word about a third of the
 * product. A card labelled `ios` could be done, gated, evidenced and deployed
 * — and still be nowhere anybody could install it.
 *
 * A BUILD IS NOT A RELEASE, and this connection refuses to blur that. EAS has
 * two clocks: a BUILD becomes an artifact, a SUBMISSION carries it to
 * TestFlight or Play. A finished build with no submission behind it is
 * "built", not "live", and saying otherwise is the most expensive kind of
 * wrong: everybody stops looking.
 *
 * Under the same contract as the others (docs/connections.md):
 *
 *   verify()    credentials? Reads, changes nothing.
 *   fetch()     collect builds and submissions.
 *   mayWrite    — EMPTY. Nothing here starts a build and nothing submits.
 *
 * The last line matters more here than at Dokploy: a build costs money and a
 * submission is a thing you cannot take back out of a store.
 */

const API = 'https://api.expo.dev/graphql';

/** What is left of a build when you keep only the one word. */
const BUILD_STANDING = {
  NEW: 'building',
  IN_QUEUE: 'building',
  IN_PROGRESS: 'building',
  PENDING_CANCEL: 'building',
  FINISHED: 'built',
  ERRORED: 'failed',
  CANCELED: 'idle',
};

/** And of a submission — the half that decides whether anybody can install it. */
const SUBMIT_STANDING = {
  AWAITING_BUILD: 'sending',
  IN_QUEUE: 'sending',
  IN_PROGRESS: 'sending',
  FINISHED: 'live',
  ERRORED: 'failed',
  CANCELED: 'idle',
};

const line = (text) => String(text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120);

async function ask(query, variables, token, fetchImpl) {
  const response = await fetchImpl(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const APP = `
query($fullName: String!) {
  app { byFullName(fullName: $fullName) { id name fullName } }
}`;

/**
 * `submissions` demands a filter — `SubmissionFilter!`, non-null, with every
 * field inside it optional. An EMPTY object is therefore the way to say "all
 * of them", and leaving the argument off is a hard error that says nothing
 * about what it wants. Measured against the live API on 09.09.: the query
 * without it comes back `Field "submissions" argument "filter" ... is
 * required`, and the builds half never runs either.
 */
const WORK = `
query($fullName: String!, $limit: Int!) {
  app { byFullName(fullName: $fullName) {
    id
    builds(limit: $limit, offset: 0) {
      id status platform appVersion appBuildVersion createdAt completedAt
      gitCommitHash gitCommitMessage buildProfile channel
    }
    submissions(limit: $limit, offset: 0, filter: {}) {
      id status platform createdAt updatedAt
    }
  } }
}`;

/**
 * The updates — the third clock, and the one that ships without a store: an
 * EAS Update lands on a channel and every installed build on that channel
 * takes it at the next start. Read per channel, newest branch first.
 */
const UPDATES = `
query($fullName: String!, $limit: Int!) {
  app { byFullName(fullName: $fullName) {
    id
    updateChannels(limit: $limit, offset: 0) {
      name
      updateBranches(limit: 3, offset: 0) {
        name
        updates(limit: 3, offset: 0) { id group message runtimeVersion platform createdAt }
      }
    }
  } }
}`;

/** The address of a build on expo.dev — a string, not a request. */
export const buildUrl = (app, id) => {
  const m = String(app ?? '').match(/^@([\w.-]+)\/([\w.-]+)$/);
  return m && id ? `https://expo.dev/accounts/${m[1]}/projects/${m[2]}/builds/${id}` : null;
};

/** Do the credentials hold? Reads exactly one app and changes nothing. */
export async function verify({ token, app }, { fetchImpl = fetch } = {}) {
  if (!token || !app) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(APP, { fullName: app }, token, fetchImpl);
    if (status === 401 || status === 403) return { ok: false, reason: 'the token is not valid' };
    const found = body?.data?.app?.byFullName;
    if (!found) return { ok: false, reason: line(body?.errors?.[0]?.message) || `unexpected answer (HTTP ${status})` };
    return { ok: true, app: found.fullName, id: found.id };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The last builds and submissions, cut down to what a board may show.
 *
 * Gradula stores NOTHING of them (manifest, "no second CI"): whoever rebuilds
 * Expo's history keeps a worse copy of it from the second week. The link
 * points at the real one.
 */
export async function fetchWork({ token, app }, { fetchImpl = fetch, limit = 10 } = {}) {
  if (!token || !app) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(WORK, { fullName: app, limit }, token, fetchImpl);
    const found = body?.data?.app?.byFullName;
    if (!found) return { ok: false, reason: line(body?.errors?.[0]?.message) || `unexpected answer (HTTP ${status})` };
    // Newest first, said out loud. The API returns them in an order that is
    // usually newest-first and is nowhere promised to be — and every sentence
    // below reads `[0]` as "the newest".
    const newestFirst = (rows) => rows.sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));
    return {
      ok: true,
      builds: newestFirst((found.builds ?? []).map((b) => ({
        id: b.id,
        platform: String(b.platform ?? '').toLowerCase() || 'unknown',
        status: b.status,
        standing: BUILD_STANDING[b.status] ?? 'idle',
        version: [b.appVersion, b.appBuildVersion].filter(Boolean).join(' · ') || null,
        commit: b.gitCommitHash ? String(b.gitCommitHash).slice(0, 12) : null,
        title: line(b.gitCommitMessage),
        at: b.completedAt ?? b.createdAt ?? null,
        profile: b.buildProfile ?? null,
        channel: b.channel ?? null,
        url: buildUrl(app, b.id),
      }))),
      submissions: newestFirst((found.submissions ?? []).map((s) => ({
        id: s.id,
        platform: String(s.platform ?? '').toLowerCase() || 'unknown',
        status: s.status,
        standing: SUBMIT_STANDING[s.status] ?? 'idle',
        at: s.updatedAt ?? s.createdAt ?? null,
      }))),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The last updates per channel, flattened and newest first. One entry per
 * update GROUP would be the honest unit (one publish = one group, one row
 * per platform in it); the rows are folded by group so that an iOS and an
 * Android row of the same publish read as one line with two platforms.
 */
export async function fetchUpdates({ token, app }, { fetchImpl = fetch, limit = 5 } = {}) {
  if (!token || !app) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(UPDATES, { fullName: app, limit }, token, fetchImpl);
    const found = body?.data?.app?.byFullName;
    if (!found) return { ok: false, reason: line(body?.errors?.[0]?.message) || `unexpected answer (HTTP ${status})` };
    const byGroup = new Map();
    for (const channel of found.updateChannels ?? []) {
      for (const branch of channel.updateBranches ?? []) {
        for (const u of branch.updates ?? []) {
          const key = u.group ?? u.id;
          const row = byGroup.get(key) ?? {
            id: key, channel: channel.name ?? null, branch: branch.name ?? null,
            message: line(u.message), runtime: u.runtimeVersion ?? null, at: u.createdAt ?? null, platforms: [],
          };
          const platform = String(u.platform ?? '').toLowerCase();
          if (platform && !row.platforms.includes(platform)) row.platforms.push(platform);
          if (u.createdAt && (!row.at || u.createdAt > row.at)) row.at = u.createdAt;
          byGroup.set(key, row);
        }
      }
    }
    return {
      ok: true,
      updates: [...byGroup.values()].sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0)).slice(0, limit * 2),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * One line per platform — that is all the board should show of it.
 *
 * Something happening NOW wins over something that succeeded: "on its way" is
 * the message, not "the last one worked". And a build that finished with no
 * submission behind it says `built`, never `live`: the artifact exists, and
 * nobody outside this room can install it.
 */
export function standingOf({ builds = [], submissions = [] } = {}) {
  const platforms = [...new Set([...builds, ...submissions].map((row) => row.platform))].sort();
  const out = {};
  for (const platform of platforms) {
    const mine = builds.filter((b) => b.platform === platform);
    const sent = submissions.filter((s) => s.platform === platform);
    const running = mine.find((b) => b.standing === 'building') ?? sent.find((s) => s.standing === 'sending');
    if (running) {
      out[platform] = { standing: running.standing, line: running.title || running.status, at: running.at };
      continue;
    }
    // THE NEWEST OF EACH, never the nicest. Preferring the newest SUCCESSFUL
    // submission looks kind and lies: measured on the real board, Android's
    // last submission failed on the 7th and a successful one from the 6th
    // stood in front of it — the board said `live` about a store upload that
    // had not happened. The newest submission is the fact; that it failed is
    // the whole message.
    const build = mine[0] ?? null;
    const submitted = sent[0] ?? null;
    if (!build && !submitted) { out[platform] = { standing: 'unknown', line: 'nothing seen yet' }; continue; }
    // A submission counts only when it is not older than the newest build, or
    // a fresh build would read as live because an old one once reached the
    // store.
    const fresher = submitted && (!build || new Date(submitted.at ?? 0) >= new Date(build.at ?? 0));
    out[platform] = fresher
      ? { standing: submitted.standing, line: build?.title || submitted.status, at: submitted.at, version: build?.version ?? null }
      : { standing: build.standing, line: build.title || build.status, at: build.at, version: build.version };
  }
  return out;
}

/** A connection never shows its key outward. */
export const publicConnection = (connection) => (connection
  ? { app: connection.app, token: connection.token ? 'set' : null, setAt: connection.setAt ?? null }
  : null);
