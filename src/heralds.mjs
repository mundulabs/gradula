/**
 * The herald — the third sort of foreign thing, and the only one that speaks OUT.
 *
 * | | Connection | Runner | HERALD |
 * |---|---|---|---|
 * | Direction | inward | out and back | **outward** |
 * | Brings | facts | work | **a message** |
 * | Worst case | wrong cards | foreign code | **something internal in the wrong channel** |
 *
 * The last row is the reason so much caution stands here. A connection that
 * delivers nonsense makes the board wrong; a herald that says too much makes
 * it public. That cannot be taken back.
 *
 * DREI GESETZE:
 *
 * ONE: THE HERALD INVENTS NO PUBLICITY. A channel is `internal` or `public`.
 * A public one gets ONLY what a person released on the card — never something
 * that merely slipped through a filter.
 *
 * TWO: IT NEVER CARRIES A KEY OUTWARD. What it sends is title, state, label,
 * reason — never the text of a card when the channel is public, and never
 * anything out of a connection's credentials.
 *
 * THREE: A MUTE HERALD HOLDS NOTHING UP. Telegram is down, the move goes
 * through anyway. A planning board that stops because a chat does not answer
 * is switched off the second time it happens.
 *
 * Everything here is pure: event in, decision and sentence out. No network,
 * no time — the sending stands in `src/telegram.mjs`.
 */

import { word, ladderOf } from './spec.mjs';

/**
 * THE OUTWARD LANGUAGE IS NOT THE DEVELOPER'S.
 *
 * A person reads the board in the language they chose; a channel is read by
 * whoever is in it. A workshop channel in German and a client channel in
 * English is one board and two audiences, and neither should have to take the
 * other's language. So the language belongs to the HERALD, beside its voice.
 *
 * Only the human voice translates. The plain voice is keys, verbs and labels —
 * identifiers, and an identifier that changes with a setting is the thing this
 * whole board is built not to do.
 */
const HEADS = {
  en: { created: 'New', moved: { done: 'Done', now: 'Now' }, started: 'In progress', decided: 'Decided', ingested: 'Crash', resurfaced: 'Back again', evidenced: 'Evidenced', deployed: 'Deployed', seen: 'Seen elsewhere' },
  de: { created: 'Neu', moved: { done: 'Fertig', now: 'Jetzt' }, started: 'In Arbeit', decided: 'Entschieden', ingested: 'Absturz', resurfaced: 'Wieder da', evidenced: 'Belegt', deployed: 'Ausgerollt', seen: 'Anderswo gesehen' },
};

/** How a message sounds. Two voices, because two sorts of people listen. */
export const VOICES = ['plain', 'human'];

// The visibilities stand in the vocabulary (src/spec.mjs) — a second list of
// the same words drifts eventually, and then the herald filters on something
// a card cannot be at all.
export { VISIBILITIES } from './spec.mjs';


/**
 * Templates are NOT a second kind — they are filled-in filters. That is why
 * "template or hand-built" does not exist: whoever takes a template and
 * changes a line has their own filter, and nothing about it is special.
 */
export const TEMPLATES = {
  workshop: {
    name: 'Workshop',
    line: 'Everything that moves — for the team channel.',
    filter: { verbs: ['created', 'moved', 'started', 'evidenced', 'decided', 'ingested', 'resurfaced', 'released', 'notes'], voice: 'plain', pipeline: true },
  },
  /*
   * Release meant "target: release" — the ladder of how far a wish may travel,
   * which nobody sets since the board moves by itself. Since 2026-09-10 done
   * IS production: a card goes to done when its commits are seen on main
   * (deployed.mjs, arrived) or when a hand approves it. So "what left the
   * house" is exactly: moved to done.
   */
  release: {
    name: 'Release',
    line: 'One note per release — web, iOS, Android, update — with the cards it carries.',
    filter: { verbs: ['released', 'notes'], voice: 'human' },
  },
  fire: {
    name: 'Fire',
    line: 'Crashes as they come in — and when they come back.',
    filter: { verbs: ['ingested'], sources: ['sentry'], voice: 'plain' },
  },
  decisions: {
    name: 'Decisions',
    line: 'Every decision with its reason. The most underrated channel.',
    filter: { verbs: ['decided'], voice: 'human' },
  },
  /*
   * Two releases, by audience. `release` is the machine's sentence, for the
   * house; `public-release` is a person's sentence — the reviewed notes the
   * store shows — for everyone else. Named by who they are for, because the
   * one mistake that keeps happening is a public channel on the team's
   * template.
   */
  'public-release': {
    name: 'Release · public',
    line: 'The reviewed release notes of what reached the store — for the people outside.',
    filter: { verbs: ['notes'], stages: ['production'], visibility: 'public', voice: 'human' },
  },
  /*
   * Testers get every beta: the TestFlight build with its What to Test, as
   * it goes out — and nothing about production, which they will hear of
   * with everyone else.
   */
  beta: {
    name: 'Beta · testers',
    line: 'Every TestFlight and beta build with its notes — for the testers.',
    filter: { verbs: ['released', 'notes'], stages: ['beta'], visibility: 'public', voice: 'human' },
  },
  /*
   * Outside is the community's window beyond releases: the milestones
   * reached and the decisions taken that a person published. Not cards,
   * not commits — the shape of where the thing is going.
   */
  outside: {
    name: 'Outside',
    line: 'Milestones reached and decisions published — the road, for the community.',
    filter: { verbs: ['moved', 'decided'], kinds: ['milestone', 'decision'], states: ['done'], visibility: 'public', voice: 'human' },
  },
};

/** JSONB reorders object keys. Filter lists are sets, so their order cannot
 * decide whether the saved herald still uses its template. */
export function templateOf(filter, templates = TEMPLATES) {
  const canonical = (value) => {
    if (Array.isArray(value)) return [...new Set(value)].sort();
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]));
    return value;
  };
  const signature = (value) => JSON.stringify(canonical(value ?? {}));
  return Object.entries(templates).find(([, template]) => signature(template.filter) === signature(filter))?.[0];
}

const EMPTY = (list) => !Array.isArray(list) || list.length === 0;

/** A card's labels across both axes — module AND stack. */
export const labelsOf = (card) => [...new Set([...(card?.module ?? []), ...(card?.stack ?? [])])];

/**
 * May this event go into this channel?
 *
 * Every empty list means "everything" — a filter you do not fill in should
 * not fall silent but let things through. Only the VISIBILITY works the other
 * way round: it is a permission, not a restriction.
 */
export function matches(filter = {}, moment = {}) {
  const { card = {}, verb } = moment;

  // Visibility first — it is the one law that must never go soft out of
  // convenience: a public channel gets only what was released.
  if (filter.visibility === 'public' && card.visibility !== 'public') return false;

  if (!EMPTY(filter.verbs) && !filter.verbs.includes(verb)) return false;
  if (!EMPTY(filter.kinds) && !filter.kinds.includes(card.kind)) return false;
  if (!EMPTY(filter.states) && !filter.states.includes(card.state)) return false;
  if (!EMPTY(filter.targets) && !filter.targets.includes(card.target)) return false;
  if (!EMPTY(filter.sources) && !filter.sources.includes(card.source)) return false;

  // Labels: ONE hit is enough. "ios and backend" would be an AND question,
  // and nobody wants to ask that here — you subscribe to topics, not to
  if (!EMPTY(filter.labels)) {
    const da = labelsOf(card);
    if (!filter.labels.some((e) => da.includes(e))) return false;
  }

  return true;
}

const short = (text, n) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

/**
 * The sentence that goes out.
 *
 * A public channel NEVER gets the text of a card, nor the reason — only the
 * title. The text is where somebody has written an address, a customer's
 * name or half a key.
 */
/** Keep the detailed actor untouched in history; notifications name the person and coder. */
export function notificationActor(actor, language = 'en') {
  const text = String(actor ?? '');
  const match = /^(.*) \((Codex|Claude Code|Gemini CLI|Cursor|Antigravity|Copilot|AI sessions) · [^()]+\)$/.exec(text);
  return match ? `${match[1]} ${language === 'de' ? 'mit' : 'via'} ${match[2]}` : text;
}

export function lineFor(moment, { voice = 'plain', visibility = 'internal', project = null, language = 'en', style = 'squares' } = {}) {
  const { card = {}, verb, actor, data = {} } = moment;
  const isPublic = visibility === 'public';
  const title = short(card.title, 140);   /* a card's own cap — a title is never cut here */
  const mark = project ? `${card.key ?? project}` : card.key ?? '';
  const ladder = card.state ? ladderOf(card.state, style) : '';

  // Stable reading order: status and title, explanation, topics, author.
  // Commit evidence uses its own subject. Public messages omit internal details.
  const commit = verb === 'evidenced' && data.kind === 'commit' && data.ref ? String(data.ref).slice(0, 7) : null;   /* seven: git's own abbreviation */
  // the ladder is a picture, the state is the word — both, so neither the eye nor the reader has to decode; then what happened
  // an incident carries how loud it was (Sentry's own word: fatal, error, warning, info) — beside what happened, every time it is named
  const loud = card.level && card.source === 'sentry' ? ` · ${card.level}` : '';
  const what = `${card.state ?? 'moving'} · ${commit ? `commit ${commit}` : verb}${loud}`;
  const labels = labelsOf(card);
  const second = commit ? short(data.comment ?? '', 140) || title : title;
  const author = !isPublic && actor ? notificationActor(actor, language) : '';
  const explanation = !isPublic && data.reason ? short(data.reason, 1200) : '';

  if (voice === 'human') {
    const head = HEADS[language]?.[verb] ?? HEADS.en[verb] ?? verb;
    const kopf = verb === 'moved'
      ? (card.state === 'done' ? head.done : `${head.now} ${word(card.state ?? 'moving', language)}`)
      : head;
    const first = [mark, ladder, kopf + (card.level && card.source === 'sentry' ? ` · ${card.level}` : '')].filter(Boolean).join(' ');
    const reason = !isPublic && data.reason ? ` — ${short(data.reason, 160)}` : '';
    return `${first}\n${second}${reason}`;
  }

  const first = [mark, ladder, what].filter(Boolean).join(' ');
  const topics = labels.length && !isPublic ? `[${labels.join(' ')}]` : '';
  return [`${first}\n${second}`, explanation, topics, author].filter(Boolean).join('\n\n');
}

/**
 * For one move: which channels get it, and with which sentence?
 * A disabled herald gets nothing — not even "just as a test".
 */
export function messages(heralds, moment, { language = 'en', style = 'squares' } = {}) {
  const out = [];
  for (const herald of heralds ?? []) {
    if (herald.active === false) continue;
    const filter = { ...(herald.filter ?? {}) };
    if (!matches(filter, moment)) continue;
    out.push({
      herald,
      text: lineFor(moment, {
        voice: filter.voice ?? 'plain',
        visibility: filter.visibility ?? 'internal',
        project: herald.project,
        // The channel's own language first, then the board's, then English:
        // a herald set up for clients keeps its choice, and one that was never
        // asked speaks the language the cards are written in.
        language: filter.language ?? language,
        style,
      }),
    });
  }
  return out;
}

/**
 * EVERYTHING WITH AN ADDRESS IS A LINK. A card key anywhere in a sentence —
 * at the head, in a reason, in a release note — leads to the card; a commit
 * hash anywhere leads to the commit. Applied to the ESCAPED text, once, at
 * the end: no line has to know where it will be linked. Without an origin
 * no card links; without a repository no commit links — never a guess.
 */
export function linkify(escaped, { origin = null, repo = null } = {}) {
  // Protect explicit URLs and file references before linking keys/hashes.
  // A prose path is not proof that a file has been pushed to GitHub. Code
  // entities also stop Telegram treating an .md filename as a domain.
  const protectedText = [];
  let out = String(escaped ?? '').replace(
    /https?:\/\/[^\s<>]+|(?<![\w@])(?:[~.]?\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:md|mdx|json|ya?ml|toml|[cm]?[jt]sx?|rs|py|sh|txt|csv|png|jpe?g|svg|wasm)(?::\d+(?::\d+)?)?(?![\w/-]|\.[\w])/gi,
    (value) => {
      const index = protectedText.push(/^https?:\/\//i.test(value) ? value : `<code>${value}</code>`) - 1;
      return `\u0000${index}\u0000`;
    },
  );
  if (origin) out = out.replace(/\b([A-Z]{2,8}-[0-9]{1,7})\b/g, (key) => `<a href="${origin.replace(/\/+$/, '')}/${key}">${key}</a>`);
  // a hash: 7–40 hex characters standing alone — not inside a word, not part of a key, not a number like 2026
  if (repo) out = out.replace(/(^|[^A-Za-z0-9/"#-])([0-9a-f]{7,40})(?![A-Za-z0-9-])/g, (m, before, sha) => (/[a-f]/.test(sha) ? `${before}<a href="https://github.com/${repo}/commit/${sha}">${sha}</a>` : m));
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => protectedText[Number(index)]);
}
