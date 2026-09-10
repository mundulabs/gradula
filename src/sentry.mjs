/**
 * Sentry — the incidents.
 *
 * THE MOST IMPORTANT DECISION FIRST: the fingerprint comes from Sentry, not
 * from us. Sentry already groups crashes — same cause, same issue id. A
 * second grouping beside it would be a second truth, and the first week with
 * two hundred notes would also be the last in which anybody looked. So: ONE
 * card per Sentry issue, recognised by `sentry:<id>`,
 * with the counter and the last sighting from Sentry itself.
 *
 * TWO WAYS IN, both on purpose:
 *   – the HOOK (webhook): Sentry calls as soon as something happens. No
 *     polling, no delay. It is checked by its signature, not by a key in the
 *     URL — a URL lands in logs, a signature does not.
 *   – the PULL: once a day or on demand, so that what happened while the hook
 *     was down arrives too.
 *
 * TOKEN OR OAUTH? For a Sentry that belongs to you, the token of an internal
 * integration is right: it hangs on the organization, not on a person,
 * survives every holiday and can be revoked on its own. OAuth buys exactly
 * one thing — the choice of organization and project by somebody whose Sentry
 * you do NOT own. That is the day Gradula carries a foreign project; until
 * then it would be a sign-in path with no use.
 * So: one token per Gradula project, one Sentry project per Gradula project.
 *
 * REGION: `mundulabs` lies in the EU (`ingest.de.sentry.io`). The API of an
 * EU organization answers under `https://de.sentry.io/api/0` — which is why
 * the base is a field and not a constant. Set it wrongly and you get a 404 on
 * an organization that very much exists.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { labelsFor } from './labels.mjs';
import { isLevel } from './spec.mjs';

export const BASE_EU = 'https://de.sentry.io/api/0';
export const BASE_US = 'https://sentry.io/api/0';

/**
 * The hook is genuine when its signature matches the body. Sentry signs with
 * the integration's client secret (HMAC-SHA256 over the RAW body) — so the
 * raw body has to arrive here, not JSON reassembled from it: one shifted
 * space and no signature matches any more.
 */
export function signatureOk(rawBody, secret, given) {
  if (!secret || !given) return false;
  const mine = createHmac('sha256', String(secret)).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(mine, 'utf8');
  const b = Buffer.from(String(given), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Reduce a hook's payload to ONE issue. Depending on the kind of integration
 * Sentry sends two shapes — the new one (`{ action, data: { issue } }`) and
 * the old warning of an alert (the issue itself, flat). Whoever knows only
 * one loses the other silently.
 */
/**
 * Which Sentry PROJECT an issue belongs to.
 *
 * An internal integration is set up per ORGANISATION and has exactly one
 * webhook URL — so every project in the organisation posts to the same door.
 * The door names a board project in its path (`/hook/MDLA`), and without this
 * check a crash in `gradula` becomes a card on the Mundula board. Measured:
 * MDLA-48 was GRADULA-3.
 */
export function projectOf(payload) {
  const issue = issueOf(payload);
  const slug = issue?.project?.slug ?? payload?.data?.issue?.project?.slug ?? null;
  return slug ? String(slug) : null;
}

export function issueOf(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const issue = payload.data?.issue ?? payload.data?.event ?? (payload.id ? payload : null);
  if (!issue?.id) return null;
  return issue;
}

/**
 * What Sentry DID with the issue. Without this field every hook would be
 * "here is an incident" — including the one saying "this incident is
 * settled", and the card would surface again although the opposite happened.
 *
 * `ignored` is Sentry's older name for `archived`; both mean the same.
 */
export function actionOf(payload) {
  const raw = String(payload?.action ?? '').toLowerCase();
  if (raw === 'ignored') return 'archived';
  return ['created', 'resolved', 'unresolved', 'assigned', 'archived'].includes(raw) ? raw : null;
}

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * A Sentry issue as a card. Pure, so a test can pin down every line — and
 * because one line here is worth more than the rest: the MODULE comes from
 * the same vocabulary as everywhere else. The path in the stack trace
 * (`packages/panels/src/StageView.tsx`) says where the incident belongs
 * without a person filing it.
 */
export function issueToCard(issue, { vocabulary = [] } = {}) {
  const title = String(issue.title ?? issue.metadata?.type ?? issue.culprit ?? 'Incident').slice(0, 200);
  const file = issue.metadata?.filename ?? null;
  const trace = [issue.culprit, file, issue.metadata?.function].filter(Boolean).join('\n');
  // The level is a FIELD, not a line of text. It used to stand only in the
  // body, so a card carrying a fatal crash looked like any other card.
  const level = isLevel(issue.level) ? issue.level : null;
  const value = issue.metadata?.value ?? null;

  const text = [
    value,
    trace,
    level ? `level: ${level}` : null,
    issue.shortId ? `Sentry: ${issue.shortId}` : null,
    issue.permalink,
  ].filter(Boolean).join('\n');

  const { module, stack } = labelsFor({ title, text, vocabulary });

  return {
    kind: 'task',
    state: 'ready',
    source: 'sentry',
    title,
    text,
    module,
    stack,
    files: file ? [file] : [],
    foreignId: `sentry:${issue.id}`,
    count: num(issue.count),
    lastSeen: issue.lastSeen ?? null,
    permalink: issue.permalink ?? null,
    level,
  };
}

const url = (base, path) => `${String(base).replace(/\/+$/, '')}${path}`;

async function call(base, path, token, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url(base, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const line = await res.text().catch(() => '');
    const error = new Error(`Sentry answers ${res.status}${line ? `: ${line.slice(0, 200)}` : ''}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/** A project's unresolved issues — what the board is meant to carry. */
export function fetchIssues({ base, org, project, token, query = 'is:unresolved', limit = 25 }, fetchImpl = fetch) {
  const suche = new URLSearchParams({ query, limit: String(Math.min(limit, 100)) });
  return call(base, `/projects/${org}/${project}/issues/?${suche}`, token, {}, fetchImpl);
}

/**
 * Mark an issue in Sentry as resolved. Runs ONLY when the connection carries
 * `writeBack`: a tool that writes into somebody else's system unasked is
 * surprising once and switched off afterwards.
 */
export function resolveIssue({ base, token, id }, fetchImpl = fetch) {
  return call(base, `/issues/${id}/`, token, { method: 'PUT', body: JSON.stringify({ status: 'resolved' }) }, fetchImpl);
}

/** `sentry:12345` → `12345`. */
export const issueIdOf = (foreignId) => (String(foreignId ?? '').startsWith('sentry:') ? String(foreignId).slice(7) : null);

/** What may go outward: the connection without its secrets. */
export function publicConnection(connection) {
  if (!connection) return null;
  const { token, hookSecret, ...rest } = connection;
  return { ...rest, token: token ? 'set' : null, hookSecret: hookSecret ? 'set' : null };
}
