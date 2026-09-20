/**
 * Labels nobody maintains.
 *
 * Two axes: WHERE in the build (module) and WHICH KIND of craft (stack). Both
 * are given without anyone touching a dropdown — and by rules first, because
 * a rule can be justified, repeated and costs nothing. What the rule does not
 * catch a model may propose later; its labels arrive as `proposal: true` and
 * become true only once somebody touches them.
 *
 * IMPORTANT: Gradula reads no foreign repository. The module vocabulary
 * belongs to the project and is SENT from there (`gradula vocabulary push`). A
 * service that "just has a quick look in the repo" would be worthless for the second project.
 */

import { STACKS } from './spec.mjs';

/**
 * The words a stack is recognised by. Deliberately kept small: every word
 * here is a claim about somebody else's choice of words, and an over-eager
 * dictionary labels everything with everything.
 */
// The German words below are DATA, not prose: a card may be written in either
// language, and "Oberfläche" must find the same stack as "UI".
/**
 * Where a craft lives in a tree. Read against a card's files — the paths the
 * commits touched — so a card born from a commit carries its craft without a
 * word of prose. The rules are the house's shape (apps/, packages/, infra/);
 * a project with another shape says its own in the vocabulary one day.
 */
export const STACK_PATHS = {
  backend: [/^apps\/[^/]+\/server\//, /^packages\/hub\//, /^packages\/cloud\//],
  frontend: [/^apps\/[^/]+\/(?!server\/).*\.tsx$/, /^packages\/(panels|ui|stage)\//, /\.css$/],
  web: [/^apps\/[^/]+\/(web|marketing)\//, /^apps\/[^/]+\/server\/(marketing|docs)/, /\.html$/],
  ios: [/(^|\/)ios\//, /\.swift$/, /(^|\/)fastlane\//, /(^|\/)eas\.json$/],
  android: [/(^|\/)android\//, /\.kt$/],
  native: [/^packages\/native\//],
  engine: [/^packages\/engine\//, /^packages\/core\/src\/audio\//, /\.(dsp|wasm)$/],
  gpu: [/^packages\/scene\/src\/gpu\//, /\.wgsl$/, /\.(glsl|metal)$/],
  infra: [/^infra\//, /(^|\/)Dockerfile$/, /\.compose\.yml$/, /(^|\/)docker-compose\.yml$/, /^\.github\//, /(^|\/)\.dockerignore$/],
  docs: [/^docs\//, /\.md$/],
  design: [/^packages\/brand\//, /(^|\/)brand\//, /\.(svg|afdesign|sketch|fig)$/],
  speech: [/^packages\/(word|lingo)\//, /^packages\/control\/src\/(speech|ear)/],
  model: [/^packages\/ai\//],
  tooling: [/^\.githooks\//, /^tools\//, /^tests\//, /^scripts\//, /(^|\/)package\.json$/, /(^|\/)package-lock\.json$/, /^\.(?:claude|codex|agents)\//, /^\.mcp\.json$/, /^GEMINI\.md$/, /^AGENTS\.md$/, /^CLAUDE\.md$/],
};

export const STACK_WORDS = {
  backend: ['server', 'api', 'endpunkt', 'endpoint', 'route', 'datenbank', 'database', 'postgres', 'sql', 'relay', 's3', 'minio', 'bucket'],
  frontend: ['ui', 'oberfläche', 'oberflaeche', 'panel', 'window', 'ansicht', 'view', 'button', 'knopf', 'layout', 'css', 'react'],
  ios: ['ios', 'iphone', 'ipad', 'testflight', 'swift', 'xcode', 'appstore', 'app store', 'simulator'],
  android: ['android', 'play store', 'playstore', 'apk', 'aab', 'kotlin', 'assetlinks'],
  web: ['browser', 'web', 'chrome', 'safari', 'firefox', 'wasm', 'webgl', 'webrtc'],
  native: ['nativ', 'native', 'expo module', 'objective-c', 'jni', 'metal', 'coreaudio'],
  engine: ['audio', 'klang', 'sound', 'dsp', 'faust', 'voice', 'voice', 'engine', 'motor', 'latenz', 'sample'],
  infra: ['dokploy', 'docker', 'compose', 'traefik', 'deploy', 'dns', 'cloudflare', 'zertifikat', 'tls', 'launchd', 'tunnel', 'zitadel', 'oidc', 'sentry', 'webhook', 'haken'],
  design: ['design', 'farbe', 'typografie', 'schrift', 'symbol', 'icon', 'mark', 'brand', 'abstand', 'gestalt'],
  docs: ['doku', 'dokumentation', 'readme', 'handbuch', 'werkbuch', 'guide', 'kapitel', 'manifest'],
  // The picture's own craft. It was missing, so a card about a shader got
  // `native` from the word `metal` or nothing at all — and the axis that is
  // supposed to say WHICH KIND of work said the wrong kind.
  // The voice, in and out. `ear` hears, `lingo` speaks, and a spoken word
  // that becomes a control is the thing this board talks about most.
  speech: ['sprache', 'speech', 'stimme', 'voice', 'gesprochen', 'locale', 'tts', 'asr', 'whisper', 'diktat', 'aussprache', 'silbe'],
  // What runs a model: on the device or behind the relay.
  model: ['modell', 'model', 'embedding', 'clip', 'tensor', 'neural', 'foundation', 'inferenz', 'inference', 'prompt', 'coreml'],
  // not `hook`: a webhook is infrastructure, and "the Sentry token and hook" must stay infra
  tooling: ['githook', 'git hook', 'pre-push', 'pre-commit', 'script', 'cli', 'werkzeug', 'tooling', 'generator', 'lint', 'test suite'],
  // `token` is NOT in that list. On this board a token is almost always an
  // access token — "store the Sentry token and hook" came back labelled
  // `model`, and a craft that is wrong is worse than a craft that is absent.
  // A pipeline may be CI, release or data processing; it is not GPU evidence.
  gpu: ['gpu', 'shader', 'wgsl', 'glsl', 'webgpu', 'vertex', 'fragment', 'raymarch', 'raymarcher', 'compute', 'textur', 'texture'],
};

const lower = (value) => String(value ?? '').toLowerCase();

/**
 * A word stands in the text — at a word boundary, not inside another one.
 *
 * The underscore counts as a WORD CHARACTER. Without it `AI_APP_TOKEN` found
 * the module `ai`, because there seemed to be a boundary between "ai" and
 * "app" (measured on 2026-09-09 against MDUS-6). An identifier is a word,
 * even when it carries underscores.
 */
function mentions(haystack, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, 'iu').test(haystack);
}

/**
 * The paths standing in the text — `packages/panels/src/x.ts` gives the
 * module away more precisely than any keyword. The last meaningful part
 * counts: `packages/native/hand` is `hand`, not `native`.
 */
export function pathsIn(text) {
  const out = new Set();
  for (const match of String(text ?? '').matchAll(/(?:^|[\s(`'"])((?:packages|apps|tools|infra|docs|tests)\/[\w./-]+)/g)) {
    out.add(match[1]);
  }
  return [...out];
}

/**
 * The PROSE — everything without paths, addresses and domains.
 *
 * The reason stands in a measured mistake: "~/sound-live.sh" gave an
 * infrastructure card the label `engine` (the word "sound"), and
 * "dev-api.mundula.app" gave it `backend` (the word "api"). A file name is a
 * hint about a MODULE, never about a kind of craft. So the two axes read
 * different texts: paths say WHERE it belongs; sentences say WHICH kind of
 * work it is.
 */
export function proseOf(text) {
  return String(text ?? '')
    .replace(/[a-z]+:\/\/\S+/gi, ' ')                    // whole addresses
    .replace(/~?[\w.-]*\/[\w./-]+/g, ' ')                 // anything with a slash in it
    .replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, ' ');          // domains and file names
}

/**
 * THE AREA: the coarse axis above the modules.
 *
 * Thirty-six modules on the live board (`scene`, `device`, `hand`, …) and a
 * person asking "show me the Studio". The module list answers the question
 * "where in the repository"; it does not answer "which of the four things
 * that live here". An app is its own area (`apps/mundula` → `mundula`),
 * everything else is the first segment of its path (`packages/core` →
 * `packages`). A project may say it differently — `gradula.areas` in its
 * package.json, sent along with the vocabulary — and what it says wins.
 * Derived, never typed on a card: a card's area is the area of its modules.
 */
export function areaOf(paths = []) {
  const first = String(paths[0] ?? '').replace(/^\/+/, '');
  if (!first) return null;
  const [head, second] = first.split('/');
  if (head.startsWith('.')) return head === '.github' ? 'infra' : 'tooling';
  if (head === 'apps' && second) return second.toLowerCase();
  return head.toLowerCase();
}

/**
 * A project's vocabulary: the modules as the project names them, each with
 * the paths they are recognised by, and the area they belong to.
 * `[{ id: 'panels', paths: ['packages/panels'], words: ['stage'], area: 'packages' }]`
 */
export function normalizeVocabulary(entries) {
  if (!Array.isArray(entries)) throw new TypeError('vocabulary: a list');
  const seen = new Set();
  return entries.map((raw) => {
    const id = String(raw?.id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new TypeError(`vocabulary: "${raw?.id}" is not a module id`);
    if (seen.has(id)) throw new TypeError(`vocabulary: ${id} stands there twice`);
    seen.add(id);
    const paths = (raw.paths ?? []).map((p) => (String(p) === '/' ? '/' : String(p).replace(/^\/+|\/+$/g, ''))).filter(Boolean).slice(0, 20);
    const said = raw.area === undefined || raw.area === null ? '' : String(raw.area).trim().toLowerCase();
    if (said && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(said)) throw new TypeError(`vocabulary: "${raw.area}" is not an area`);
    return {
      id,
      paths,
      words: (raw.words ?? []).map(lower).filter(Boolean).slice(0, 20),
      area: said || areaOf(paths) || id,
    };
  });
}

/**
 * The rule labels for a text. A pure function: the same input, the same
 * result, and a test can pin down every line of it.
 */
export function labelsFor({ title = '', text = '', files = [], vocabulary = [] } = {}) {
  const haystack = `${title}\n${text}`;
  const prosa = lower(proseOf(haystack));
  // A card's files are the CLEAREST hint about its module — they are paths
  // already and need not be guessed out of a sentence. (Measured against
  // MDUS-7: a card about `apps/mundula/sentry.ts` got no module, because the
  // path stood only in the `files` field, not in the text.)
  const paths = [...new Set([...pathsIn(haystack), ...files.map((d) => String(d).replace(/^\/+/, ''))])];

  const ausPfad = [];
  const ausWort = [];
  // The vocabulary comes from outside — from a repo, from a migration, from
  // an older version of this service. A list without one of the keys is a
  // module without hints; it is no reason to abort the creation of a card
  // with a stack trace. (On 2026-09-09 the migrated vocabulary still carried
  // `pfade`/`worte`, and EVERY new card failed.)
  for (const entry of vocabulary) {
    if (!entry?.id) continue;
    const entryPaths = Array.isArray(entry.paths) ? entry.paths : [];
    const entryWords = Array.isArray(entry.words) ? entry.words : [];
    // `/` is the root itself: the files that live beside package.json and belong to no folder
    const byPath = entryPaths.some((p) => paths.some((found) => (p === '/' ? !found.includes('/') : found === p || found.startsWith(`${p}/`))));
    if (byPath) { ausPfad.push(entry.id); continue; }
    if (mentions(prosa, entry.id) || entryWords.some((w) => mentions(prosa, w))) ausWort.push(entry.id);
  }

  // A path beats a word: whoever names `apps/mundula-web` does not also mean
  // the module `mundula` just because its name is inside it.
  const module = [...ausPfad, ...ausWort.filter((id) => !ausPfad.some((genauer) => genauer !== id && genauer.includes(id)))];

  const stack = [];
  for (const name of STACKS) {
    if ((STACK_WORDS[name] ?? []).some((word) => mentions(prosa, word))) stack.push(name);
  }
  // THE FILES SAY THE CRAFT TOO. A card born from a commit has no prose that
  // names a craft — but a commit in apps/*/server is backend work whatever the
  // subject says, and one in .githooks is tooling. Paths first, prose adds.
  for (const name of STACKS) {
    if (stack.includes(name)) continue;
    if ((STACK_PATHS[name] ?? []).some((rule) => paths.some((found) => rule.test(found)))) stack.push(name);
  }

  return { module, stack };
}

/**
 * Merge labels without overwriting the handwork. What a person set stays;
 * what a rule finds is added; a duplicate becomes one.
 */
export function mergeLabels(existing = [], found = []) {
  const out = [...existing];
  for (const label of found) if (!out.includes(label)) out.push(label);
  return out;
}
