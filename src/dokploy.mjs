/**
 * Dokploy — the connection the STANDING comes from.
 *
 * The third room stood as a word on a door from the first day: a card says
 * what to do and proves with its gate that it is done — but not WHERE it has
 * arrived. That is exactly what Dokploy knows, and we had never asked it.
 *
 * It is a connection under the contract in docs/connections.md, so:
 *
 *   verify()    credentials? Reads, changes nothing.
 *   fetch()     collect deployments. What becomes of them is Gradula's call.
 *   mayWrite    — EMPTY. Dokploy triggers nothing from here.
 *
 * The last line is the most important and already stands in the manifest: no
 * deploy button. Watching yes, triggering later and then with a confirmation.
 * A planning board that pushes to production in passing is an accident with
 * an announcement.
 */

import { carriesOf } from './deployed.mjs';

/** What is left of a deployment when you keep only the one line. */
const STANDING = {
  done: 'live',
  running: 'deploying',
  queued: 'deploying',
  error: 'failed',
  idle: 'idle',
};

/**
 * One line means the FIRST line. Dokploy's `title` carries the whole commit
 * message; whoever passes it through gets a paragraph where a line belongs —
 * and then the standing is unreadable although it is correct.
 */
const line = (text) => String(text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120);

/** The hash in a deployment's description — Dokploy writes `Hash: abc…` for a webhook. */
const commitOf = (text) => {
  const m = String(text ?? '').match(/\b([0-9a-f]{7,40})\b/i);
  return m ? m[1].slice(0, 12) : null;
};
/** The whole sha, when the description carries one (a webhook deployment: `Commit: <sha>` or `Hash: <sha>`). */
const shaOf = (text) => {
  const m = String(text ?? '').match(/\b([0-9a-f]{40})\b/i);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Which compose stands for which environment. `composeId` alone is the
 * old shape and means production; `composes` names both lanes. A lane
 * without a compose is not watched — and says so, instead of borrowing
 * the other lane's deployments.
 */
export function composesOf(connection = {}) {
  const named = connection.composes && typeof connection.composes === 'object' ? connection.composes : {};
  const out = {};
  for (const [environment, id] of Object.entries(named)) if (id) out[environment] = String(id);
  if (!out.production && connection.composeId) out.production = String(connection.composeId);
  return out;
}

async function ask(base, path, token, fetchImpl) {
  const response = await fetchImpl(`${base.replace(/\/+$/, '')}/${path}`, {
    headers: { 'x-api-key': token, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Do the credentials hold? Reads exactly one list and changes nothing. */
export async function verify({ base, token }, { fetchImpl = fetch } = {}) {
  if (!base || !token) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(base, 'project.all', token, fetchImpl);
    if (status === 401 || status === 403) return { ok: false, reason: 'the key is not valid' };
    if (!Array.isArray(body)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return { ok: true, projects: body.length };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The last deployments of a service, cut down to the essentials.
 *
 * Gradula stores NOTHING of them except the standing: whoever rebuilds
 * Dokploy's log maintains a worse copy of it forever (manifest, "no second
 * CI"). The link points at the real one.
 */
export async function fetchDeployments({ base, token, composeId }, { fetchImpl = fetch, limit = 5 } = {}) {
  if (!base || !token || !composeId) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(base, `deployment.allByCompose?composeId=${encodeURIComponent(composeId)}`, token, fetchImpl);
    if (!Array.isArray(body)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return {
      ok: true,
      deployments: body.slice(0, limit).map((d) => ({
        status: String(d.status ?? 'idle'),
        standing: STANDING[String(d.status ?? 'idle')] ?? 'idle',
        title: line(d.title),
        at: d.createdAt ?? null,
        ...(d.finishedAt ? { finishedAt: d.finishedAt } : {}),
        // The description is the FULL message of the commit that was built:
        // its first line is the commit's title (how deployed.mjs finds the
        // sha again), and its `Plan: KEY` lines are the cards it carries.
        ...(line(d.description) ? { head: line(d.description) } : {}),
        carries: carriesOf(d.description),
        // A webhook deployment carries the hash in its description; a manual
        // one carries none. Only what is there — never an invented one.
        ...(commitOf(d.description) ? { commit: commitOf(d.description) } : {}),
        ...(shaOf(d.description) ? { sha: shaOf(d.description) } : {}),
      })),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The standing of a service in ONE line — that is all the board should show
 * of it. If something is running right now, that wins: "on its way" is the
 * message, not "last one succeeded".
 */
export function standingOf(deployments = []) {
  if (!deployments.length) return { standing: 'unknown', line: 'no deployment seen yet' };
  const running = deployments.find((d) => d.standing === 'deploying');
  if (running) return { standing: 'deploying', line: running.title || 'deploying now', at: running.at };
  const newest = deployments[0];
  return {
    standing: newest.standing,
    line: newest.title || newest.status,
    at: newest.at,
  };
}

/** A connection never shows its key outward. */
export const publicConnection = (connection) => (connection
  ? { base: connection.base, composeId: connection.composeId, composes: composesOf(connection), token: connection.token ? 'set' : null, setAt: connection.setAt ?? null }
  : null);
