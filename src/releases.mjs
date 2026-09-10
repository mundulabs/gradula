/**
 * A release is a moment of its own.
 *
 * Cards move one by one, and the channels used to hear them one by one — four
 * cards landing on production were four messages, and a TestFlight build was
 * nothing at all. What people outside the house want is the industry's sentence:
 * "Web c709023 shipped, here is what is in it", "iOS 0.0.1 (build 3) is on
 * TestFlight, since build 2: …". So a release is found in the system picture,
 * remembered once, and spoken once — per lane:
 *
 *   web       the production lane's head changed (Dokploy, deployed.mjs)
 *   ios       a production/beta build finished (EAS)
 *   android   the same, for Android
 *   ota       an update went out on the production channel (EAS Update)
 *
 * The cards a release carries: for the web, what the head names or contains
 * (deployed.mjs already knows); for an app build, every `Plan:` line in the
 * commits between the previous build of that lane and this one (one GitHub
 * compare); for an OTA update the same by the update's commit, or, without a
 * commit, what reached production since the previous update. The first
 * release on a lane has no "previous": it carries what stands on production.
 *
 * Nothing here talks to the network or the store: the picture comes in, the
 * releases come out, and gradula.mjs remembers and speaks.
 */

import { LADDER } from './spec.mjs';

/** The lanes an app release may take — a build's platform, or the update channel. */
export const LANES = ['web', 'ios', 'android', 'ota'];

/** A build that counts as a release: finished, for the people (not a dev client). */
const isReleaseBuild = (b) => b?.status === 'built' && ['production', 'beta'].includes(String(b.profile ?? '').toLowerCase());
const isReleaseUpdate = (u) => ['production', 'prod', 'beta'].includes(String(u?.channel ?? '').toLowerCase());

/**
 * The releases a picture shows, newest last — every one with an id that is
 * the same the next time the picture is read, so memory can say "seen".
 */
export function releasesIn(doc = {}) {
  const out = [];
  const web = doc.deployed?.production;
  if (web?.sha) {
    const live = (doc.environments ?? []).find((e) => e.id === 'production')?.deployments?.find((d) => d.status === 'live' || d.status === 'done');
    out.push({ id: `web:${web.sha}`, lane: 'web', at: web.at ?? null, commit: web.sha, version: null, title: live?.title ?? null, url: null, cards: [...(web.cards ?? [])] });
  }
  for (const b of doc.builds ?? []) {
    if (!isReleaseBuild(b)) continue;
    const lane = String(b.platform ?? '').toLowerCase();
    if (!['ios', 'android'].includes(lane)) continue;
    out.push({ id: `build:${b.url ?? `${lane}:${b.at}`}`, lane, at: b.at ?? null, commit: b.commit ?? null, version: b.version ?? null, title: b.title ?? null, url: b.url ?? null, profile: b.profile ?? null, cards: null });
  }
  for (const u of doc.updates ?? []) {
    if (!isReleaseUpdate(u)) continue;
    out.push({ id: `update:${u.channel}:${u.at}`, lane: 'ota', at: u.at ?? null, commit: u.commit ?? null, version: u.runtime ?? null, title: u.message ?? null, url: null, platforms: u.platforms ?? [], cards: null });
  }
  return out.filter((r) => r.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The previous release on the same lane, from memory — the one this release is "since". */
export function previousOf(release, known = []) {
  return known.filter((k) => k.lane === release.lane && String(k.at) < String(release.at)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null;
}

/**
 * The cards a release carries when no compare is possible: what reached
 * production between the previous release on the lane and this one — read
 * from the cards' own `deployed.at.production`.
 */
export function cardsBetween(cards = [], since = null, until = null) {
  return cards
    .filter((c) => c.deployed?.at?.production && (!since || String(c.deployed.at.production) > String(since)) && (!until || String(c.deployed.at.production) <= String(until)))
    .map((c) => c.key);
}

const LANE_NAMES = {
  en: { web: 'Web', ios: 'iOS', android: 'Android', ota: 'Update' },
  de: { web: 'Web', ios: 'iOS', android: 'Android', ota: 'Update' },
};
const WORDS = {
  en: { released: 'released', on: 'on', testflight: 'TestFlight', cards: (n) => `${n} ${n === 1 ? 'card' : 'cards'}`, since: 'since', nothing: 'no card named — a release of the plumbing', ota: 'over the air' },
  de: { released: 'ausgeliefert', on: 'auf', testflight: 'TestFlight', cards: (n) => `${n} ${n === 1 ? 'Karte' : 'Karten'}`, since: 'seit', nothing: 'keine Karte genannt — eine Auslieferung der Leitungen', ota: 'über die Luft' },
};

const shortSha = (sha) => (sha ? String(sha).slice(0, 7) : null);

/**
 * The note that goes out — one message per release. A public channel gets
 * the public cards' titles and nothing else; an internal one gets every card
 * with its key. Returns null when a public channel would have nothing to say.
 */
export function releaseNote(release, cards = [], { visibility = 'internal', language = 'en', origin = null } = {}) {
  const isPublic = visibility === 'public';
  const w = WORDS[language] ?? WORDS.en;
  const lane = (LANE_NAMES[language] ?? LANE_NAMES.en)[release.lane] ?? release.lane;
  const shown = cards.filter((c) => !isPublic || c.visibility === 'public');
  if (isPublic && !shown.length) return null;
  const where = release.lane === 'ios' && release.profile === 'beta' ? ` · ${w.testflight}` : release.lane === 'ota' ? ` · ${w.ota}` : '';
  const version = release.version ? ` ${release.version}` : release.commit ? ` ${shortSha(release.commit)}` : '';
  const title = release.title ? (String(release.title).length > 120 ? `${String(release.title).slice(0, 119)}…` : String(release.title)) : null;
  // the head is one line; the deployment's own title, when shown, stands beneath it — the head must read at a glance
  const head = `${lane}${version}${where} — ${w.released}${!isPublic && title ? `\n${title}` : ''}`;
  // inside the house every card line has the same head as everywhere else: key, ladder, state — then the title
  const lines = shown.map((c) => (isPublic ? `• ${c.title}` : `• ${c.key} ${LADDER[c.state] ?? ''} ${c.state ?? ''}`.replace(/\s+/g, ' ').trim() + `\n  ${c.title}`));
  const body = lines.length ? lines.join('\n') : w.nothing;
  return `${head}\n${body}${release.url && !isPublic ? `\n${release.url}` : ''}`;
}
