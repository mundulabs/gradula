/**
 * Every word Gradula knows — in ONE place, because a second list of the same
 * words always drifts eventually. Server, CLI, MCP and the board all read here.
 *
 * Two rules sit behind the choice of words (docs/brand.md):
 *
 * ONE: no house word on the surface. "Board" and "slip" explain well in a paper
 * and say nothing to a stranger's project. That is why the targets are called
 * `note`, `document`, `preview`, `branch`, `release`.
 *
 * TWO: a word that already means something in Mundula is not given a second
 * meaning here. A "work" is a document in the library over there — which is why
 * the tallest kind of card is a `milestone`.
 */

/**
 * How tall a card is. Same table, same sheet, different height.
 *
 * `decision` is the fifth and the most important one for a team: a question
 * answered once and not renegotiated afterwards. Without it, decisions live in
 * conversations and commit messages — and get discussed again three weeks later
 * because nobody remembers the reason.
 */
export const KINDS = ['idea', 'task', 'venture', 'milestone', 'decision'];

/**
 * The columns. `ice` is deliberately one of them and not a flag: what is on ice
 * should disappear from the board, not clog it.
 *
 * `blocked` is missing here on purpose — it is computed (src/links.mjs), not a
 * state. Otherwise someone has to remember to take it off again.
 */
export const STATES = ['ideas', 'ready', 'making', 'review', 'done', 'ice'];

/** How far a wish may travel. The order IS the ladder. */
export const TARGETS = ['note', 'document', 'preview', 'branch', 'release'];

/** This far without asking: what comes into being here can knock nothing over. */
export const TARGETS_FREE = ['note', 'document', 'preview'];

/**
 * The kinds of link. Plain ASCII: these values live in URLs and in SQL.
 *
 * FIVE OF THEM SAY DIFFERENT THINGS, AND `touches` ONLY MEANS ONE:
 *
 *   needs / blocks  an ORDER. The same edge from two sides, and the only kind
 *                   that can form a cycle — a cycle is refused when it is laid.
 *   part-of         MEMBERSHIP in a bundle. Not an order: a milestone's parts
 *                   may all run at once.
 *   touches         THE SAME FILE. A fact, not a resemblance, and the reason
 *                   for the warning at `start`.
 *   resembles       may be a DUPLICATE. A guess, with the number it means it by.
 *   mentions        this card's text NAMES that one. Neither an order nor a
 *                   collision — and it used to be laid as `touches`, which
 *                   meant sixteen links on the live board claimed a file
 *                   collision where somebody had merely written "MDLA-14" in a
 *                   sentence. A warning that is usually wrong is a warning
 *                   nobody reads.
 */
export const LINK_KINDS = ['needs', 'blocks', 'part-of', 'resembles', 'touches', 'mentions'];

/** Where a link comes from — a machine's suggestion is not a resolution. */
export const LINK_SOURCES = ['human', 'rule', 'model'];

/** What a gate can check. Without one, a card never travels on its own. */
export const GATE_KINDS = ['test', 'command', 'file', 'url'];

/** Where a card comes from. `sentry` is why it carries a fingerprint. */
export const SOURCES = ['human', 'sentry', 'model'];

/**
 * Who may see a card once it leaves the house.
 *
 * `internal` is the default and stays it. A card does not become public by
 * slipping through a filter — it becomes public because a person said so. That
 * is the difference between a tool you trust with a channel and one you trust
 * with a channel once.
 */
export const VISIBILITIES = ['internal', 'public'];

/** Where a run happens. Per card, not forever. */
export const RUNNERS = ['here', 'server'];

/** The "which craft" axis. The other axis (module) comes from the project. */
export const STACKS = [
  'backend', 'frontend', 'ios', 'android', 'web', 'native', 'engine', 'infra', 'design', 'docs', 'gpu',
  // Measured on this board, not invented: 56 mentions of speech and voice, 33
  // of models and embeddings. `desktop` and `midi` are NOT here — zero
  // mentions, and a craft nobody writes about labels nothing.
  'speech', 'model',
];

/**
 * The roles. They stand here as words; who REALLY holds one is said by the
 * identity provider — a role that lives only in this database is a claim about
 * someone else's instance.
 */
export const ROLES = ['admin', 'dev', 'watch'];

/**
 * What a key is. `human` acts on behalf of a person; `system` is a rule with
 * nobody behind it and may not decide; `agent` is a person's SECOND hand —
 * the AI sessions on their machine (`GRADULA_AGENT_TOKEN`, src/hand.mjs).
 * An agent key has the same owner and the same rights as the person's own,
 * and differs in one thing only: its name in the chronicle. That is why it
 * is a kind and not a flag — the board marks it, and `gradula login` mints
 * it beside the person's key, named after the program and the machine.
 */
export const KEY_KINDS = ['human', 'agent', 'system'];
export const AGENT_KEY_KIND = 'agent';
/** The hand as the chronicle names it: `Claude Code · Davids-MacBook-Pro`. */
export const agentKeyName = (machine) => `Claude Code · ${machine}`;

export const MAY = {
  admin: ['see', 'write', 'start', 'manage'],
  dev: ['see', 'write', 'start'],
  watch: ['see'],
};

const has = (list) => (value) => list.includes(value);
export const isKind = has(KINDS);
export const isState = has(STATES);
export const isTarget = has(TARGETS);
export const isLinkKind = has(LINK_KINDS);
export const isLinkSource = has(LINK_SOURCES);
export const isGateKind = has(GATE_KINDS);
export const isRunner = has(RUNNERS);
export const isStack = has(STACKS);
export const isRole = has(ROLES);
export const isSource = has(SOURCES);
export const isVisibility = has(VISIBILITIES);

/**
 * How long a runner's heartbeat counts as fresh.
 *
 * A runner does not say "I stopped" — it stops saying anything. That is the
 * whole design: staleness IS the stop signal, so nothing has to remember to
 * clear a flag. Same reason `blocked` is computed and not a state: a stored
 * "is running" is wrong the first time a laptop closes mid-run, and then
 * nobody knows which one.
 *
 * Ninety seconds: long enough that a slow test suite between beats does not
 * flicker, short enough that a dead runner is gone before anyone asks.
 */
export const RUNNING_MS = 90_000;
export const isRunning = (heartbeat, now = Date.now()) =>
  Boolean(heartbeat) && now - new Date(heartbeat).getTime() < RUNNING_MS;

/** The state a new card starts in, according to its kind. */
export const bornIn = (kind) => (kind === 'idea' ? 'ideas' : 'ready');

/**
 * THE LADDER, AS FIVE MARKS. Where a card stands, readable in a sentence:
 * `■▩□□□` — the rungs behind it filled, the one it is on hatched, the rest
 * empty. Ice is not a rung, so it draws none. The CLI prints it and the MCP
 * server sends it along, so that a session writing "built (MDLA-71)" can put
 * the standing beside the link without asking a second time.
 */
export const LADDER = { ideas: '▩□□□□', ready: '■▩□□□', making: '■■▩□□', review: '■■■▩□', done: '■■■■■', ice: '·····' };
export const ladderOf = (state) => LADDER[state] ?? '□□□□□';

/**
 * What can stand in the history. `said` is a word, `decided` is a resolution —
 * and that is not a formality: throw both into the same thread and you get
 * forty comments from which nobody can read what holds.
 */
/**
 * How bad an incident is, in Sentry's own words. It is NOT a state: a card is
 * `ready` or `done` whatever the crash weighed, and the weight does not change
 * when somebody moves the card. It is what the foreign system said, kept as it
 * said it.
 *
 * Only `fatal` and `error` ask for a hand. That is why the board can show them
 * without a new colour: "you are needed" is a signal it already has.
 */
export const LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'];
export const isLevel = (value) => LEVELS.includes(value);
/** Does this level ask for a hand? */
export const isLoud = (value) => value === 'fatal' || value === 'error';

/**
 * Everything that can stand in the chronicle. A CLOSED list, because a herald
 * filters on it and the board reads it — a verb nobody knows is a line nobody
 * can filter and nobody can translate. The Sentry branch wrote `again
 * aufgetaucht` and `again seen` as free strings for a week, and both were
 * invisible to every filter in the house.
 */
export const VERBS = ['created', 'changed', 'moved', 'linked', 'started', 'evidenced',
  'suggested', 'confirmed', 'said', 'decided', 'ingested', 'resurfaced', 'deployed',
  // The incident happened again in an environment the board does not watch
  // (`{ environment, count }`) — the chronicle shows it, the card does not move.
  'seen'];

/**
 * What the live line may announce (src/live.mjs): every chronicle verb, and
 * ONE that never stands in a chronicle because it deletes it — `wipe`, from
 * the admin door that empties a project. The board hears it and empties its
 * columns at once; a chronicle verb only makes it read again.
 */
export const LIVE_VERBS = [...VERBS, 'wipe'];

/**
 * A gate as it is stored. `call` is what gets called (a test name, a command, a
 * path, a URL); `expect` is optional and says what has to come out of it — for
 * `url`, `200` for instance.
 */
export function normalizeGate(gate) {
  if (gate === null || gate === undefined) return null;
  if (typeof gate !== 'object') throw new TypeError('gate: an object or null');
  const kind = String(gate.kind ?? '');
  if (!isGateKind(kind)) throw new TypeError(`gate.kind: one of ${GATE_KINDS.join(', ')}`);
  const call = String(gate.call ?? '').trim();
  if (!call) throw new TypeError('gate.call: must not be empty');
  if (call.length > 500) throw new TypeError('gate.call: at most 500 characters');
  const expect = gate.expect === undefined || gate.expect === null
    ? null
    : String(gate.expect).slice(0, 200);
  return { kind, call, expect };
}

// --- Two languages on the surface, ONE in the data -------------------------
//
// The identifiers, the values and the reasoning are English, because this
// repository is meant to be read by strangers. What a person READS on the board
// can be German — but only that.
//
// The line is drawn in exactly one place:
//
//   THE DATA SPEAK ENGLISH, FOREVER. `state: 'making'` stands in the database,
//   in the URL, in SQL and in the contract of every connection. A value that
//   changes with a language setting breaks every integration anyone ever built
//   — and it breaks them silently.
//
//   THE DISPLAY SPEAKS BOTH. Only what a person reads is translated.
//
// Hence a table below and not a second word list: `WORDS.de` has a twin for
// every key in `WORDS.en`, and a test counts them. Add a word and forget the
// twin and you find out immediately.

export const LANGUAGES = ['en', 'de'];

export const WORDS = {
  en: {
    // kinds
    idea: 'Idea', task: 'Task', venture: 'Venture',
    milestone: 'Milestone', decision: 'Decision',
    // columns
    ideas: 'Ideas', ready: 'Ready', making: 'Making',
    review: 'Review', done: 'Done', ice: 'Ice',
    // targets
    note: 'Note', document: 'Document', preview: 'Preview',
    branch: 'Branch', release: 'Release',
    // links
    needs: 'needs', blocks: 'blocks', 'part-of': 'part of',
    resembles: 'resembles', touches: 'touches', mentions: 'mentions',
    // gates
    test: 'Test', command: 'Command', file: 'File', url: 'URL',
    // runners
    here: 'here', server: 'Server',
    // the things
    board: 'Board', card: 'Card', link: 'Link', history: 'History',
    gate: 'Gate', runner: 'Runner', connection: 'Connection', sources: 'Sources',
    cartographer: 'Cartographer', sheet: 'Sheet', wave: 'Wave',
    suggestion: 'Suggestion', evidence: 'Evidence', vocabulary: 'Vocabulary',
    key: 'Key', craft: 'Craft', right: 'Right', brief: 'Brief', herald: 'Herald',
  },
  de: {
    idea: 'Idee', task: 'Aufgabe', venture: 'Vorhaben',
    milestone: 'Meilenstein', decision: 'Entscheidung',
    ideas: 'Ideen', ready: 'Bereit', making: 'Arbeit',
    review: 'Prüfung', done: 'Fertig', ice: 'Eis',
    note: 'Notiz', document: 'Dokument', preview: 'Vorschau',
    branch: 'Zweig', release: 'Auslieferung',
    needs: 'braucht', blocks: 'blockiert', 'part-of': 'Teil von',
    resembles: 'gleicht', touches: 'berührt', mentions: 'nennt',
    test: 'Test', command: 'Befehl', file: 'Datei', url: 'Adresse',
    here: 'hier', server: 'Server',
    board: 'Brett', card: 'Karte', link: 'Faden', history: 'Chronik',
    gate: 'Tor', runner: 'Läufer', connection: 'Anschluss', sources: 'Quellen',
    cartographer: 'Kartograf', sheet: 'Blatt', wave: 'Welle',
    suggestion: 'Vorschlag', evidence: 'Beleg', vocabulary: 'Vokabular',
    key: 'Schlüssel', craft: 'Gewerk', right: 'Recht', brief: 'Auftrag', herald: 'Bote',
  },
};

/**
 * A word for people. If the twin is missing, the key comes back — a surface
 * with a visible identifier is ugly, one without text is broken.
 */
export const word = (key, language = 'en') =>
  WORDS[language]?.[key] ?? WORDS.en[key] ?? String(key);
