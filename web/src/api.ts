/**
 * The one place where the board speaks to the service.
 *
 * `credentials: 'include'` everywhere: the identity is the session cookie, and
 * a bundle in the browser must never carry a project key — that belongs to
 * machines, and a key in the bundle would be a key for every reader.
 *
 * People have to say which project they mean; a board for several has no
 * default that is right for all. So `project` hangs on every request except
 * the two that do not need it.
 */

export type State = 'ideas' | 'ready' | 'making' | 'review' | 'done' | 'ice';

export type Card = {
  key: string;
  title: string;
  text: string;
  kind: string;
  state: State;
  module: string[];
  stack: string[];
  suggestions?: { module: string[]; stack: string[] };
  person: string | null;
  gate: { kind: string; call: string; expect: string | null } | null;
  source: string;
  files: string[];
  visibility: 'internal' | 'public';
  /** Computed, never stored: a runner's lease is fresh. */
  running: boolean;
  heartbeat: string | null;
  due: string | null;
  created?: string;
  /** When the chronicle last said anything about this card. */
  touched?: string | null;
  count: number | null;
  permalink: string | null;
  /** How bad an incident is, in Sentry's own words. Not a state. */
  level: string | null;
  blockedBy: string[];
  /**
   * Where the card has been seen, from the chronicle's `deployed` notes —
   * memory, no network: true once a picture saw the card in that lane, and
   * the time of the head that carried it. See deployed.ts for the chips.
   */
  deployed?: { development: boolean; production: boolean; at: { development: string | null; production: string | null } };
  links?: { id: string; kind: string; from: string | null; to: string | null }[];
  history?: { at: string; verb: string; actor: string; data?: Record<string, unknown> | null }[];
};

/**
 * A card as the system picture carries it: what is in hand and what was done
 * this week, with where it has arrived MEASURED against what each lane runs
 * (null when nobody could tell) and how many commits stand behind it.
 */
export type SystemCard = {
  key: string; title: string; state: State; labels: string[]; actor: string | null;
  deployed: { development: boolean | null; production: boolean | null };
  evidence?: number;
};
/** The picture — only the parts the board reads; the engine room reads the rest. */
export type System = {
  at: string;
  cards: SystemCard[];
  deployed: Record<string, { sha: string | null; at: string | null; cards: string[] }>;
  sources: Record<string, string>;
};

export type Project = { key: string; name: string; repo: string | null };
export type Me =
  | { kind: 'human'; name: string; sub: string; roles: string[] }
  | { kind: 'machine'; key: string | null; project: string | null };

export type Herald = {
  id: string;
  kind: string;
  name: string;
  chat: string | null;
  token: string | null;
  /** speaks with the house key (the server's) — the key itself is never here */
  house?: boolean;
  active: boolean;
  filter: {
    verbs?: string[]; kinds?: string[]; states?: string[]; targets?: string[];
    sources?: string[]; labels?: string[]; voice?: 'plain' | 'human'; visibility?: 'internal' | 'public';
  };
  schedule?: { cadence?: 'daily' | 'weekly' | 'off'; hour?: number; weekday?: number } | null;
};

export type Template = { name: string; line: string; filter: Herald['filter'] };
export type Report = {
  project: string;
  counts: { done: number; decided: number; incidents: number; touched: number };
  plain: string;
  human: string;
  html: string;
};

/** The service address — under /dev/plan it sits one level up. */
const root = (() => {
  const path = window.location.pathname;
  const i = path.indexOf('/dev/plan');
  return i >= 0 ? path.slice(0, i + '/dev/plan'.length) : '';
})();

export class NotSignedIn extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (response.status === 401 || response.status === 403) throw new NotSignedIn();
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { line?: string })?.line ?? `Error ${response.status}`);
  return body as T;
}

export const signInPath = () =>
  `${root}/auth/start?target=${encodeURIComponent(window.location.pathname + window.location.search)}`;

export const me = () => call<Me>('/api/v1/me');
export const projects = () => call<Project[]>('/api/v1/projects');

export const cards = (project: string, filter: { q?: string; module?: string; stack?: string; area?: string } = {}) => {
  const query = new URLSearchParams({ project, limit: '500' });
  if (filter.q) query.set('q', filter.q);
  if (filter.module) query.set('module', filter.module);
  if (filter.stack) query.set('stack', filter.stack);
  if (filter.area) query.set('area', filter.area);
  return call<Card[]>(`/api/v1/cards?${query}`);
};
export const card = (project: string, key: string) => call<Card>(`/api/v1/cards/${key}?project=${project}`);
export const system = (project: string) => call<System>(`/api/v1/system?project=${project}`);
export type Link = { id: string; kind: string; source: string; reason: string | null; from: string | null; to: string | null };
export const links = (project: string) => call<Link[]>(`/api/v1/links?project=${project}`);
export const vocabulary = (project: string) => call<{ id: string; area?: string }[]>(`/api/v1/vocabulary?project=${project}`);

export const create = (project: string, fields: { title: string; kind: string; text?: string; person?: string }) =>
  call<Card>(`/api/v1/cards?project=${project}`, { method: 'POST', body: JSON.stringify(fields) });

export type Change = {
  title?: string; text?: string; kind?: string; person?: string | null;
  visibility?: 'internal' | 'public';
  gate?: { kind: string; call: string; expect?: string | null } | null;
};

export const change = (project: string, key: string, fields: Change) =>
  call<Card>(`/api/v1/cards/${key}?project=${project}`, { method: 'PATCH', body: JSON.stringify(fields) });

export const confirm = (project: string, key: string) =>
  call<Card>(`/api/v1/cards/${key}/confirm?project=${project}`, { method: 'POST' });

export const say = (project: string, key: string, text: string) =>
  call<Card>(`/api/v1/cards/${key}/say?project=${project}`, { method: 'POST', body: JSON.stringify({ text }) });

export const decide = (project: string, key: string, outcome: string, reason: string) =>
  call<Card>(`/api/v1/cards/${key}/decide?project=${project}`, { method: 'POST', body: JSON.stringify({ outcome, reason }) });

export const move = (project: string, key: string, state: State, reason?: string) =>
  call<Card>(`/api/v1/cards/${key}/move?project=${project}`, { method: 'POST', body: JSON.stringify({ state, reason: reason ?? null }) });

export const start = (project: string, key: string, anyway?: string) =>
  call<Card & { warnings: { card: string; files: string[] }[] }>(`/api/v1/cards/${key}/start?project=${project}`, {
    method: 'POST', ...(anyway ? { body: JSON.stringify({ anyway }) } : {}),
  });

// --- Settings: heralds and reports ----------------------------------------

export const heralds = (project: string) => call<Herald[]>(`/api/v1/heralds?project=${project}`);

// --- A person's own keys: minted here, shown once, revoked here ------------
// `kind` says which hand: `human` is the person's own, `agent` the one their
// AI sessions take (both minted by `gradula login`, src/spec.mjs KEY_KINDS).
export type OwnKey = { id: string; name: string; kind: 'human' | 'agent' | 'system'; created: string; usedAt: string | null };
export const myKeys = (project: string) => call<OwnKey[]>(`/api/v1/keys?project=${project}`);
export const mintKey = (project: string, name: string) =>
  call<{ token: string; entry: OwnKey }>(`/api/v1/keys?project=${project}`, { method: 'POST', body: JSON.stringify({ name }) });
export const revokeKey = (project: string, id: string) =>
  call<{ revoked: boolean }>(`/api/v1/keys/${id}?project=${project}`, { method: 'DELETE' });

// A machine asking to register (`gradula login`) — the person approves the code.
export type Device = { id: string; machine: string; code: string; created: string };
export const pendingDevices = (project: string) => call<Device[]>(`/api/v1/devices?project=${project}`);
export const approveDevice = (project: string, id: string) =>
  call<{ approved: boolean; machine: string; agent: string }>(`/api/v1/device/${id}/approve?project=${project}`, { method: 'POST' });
export const denyDevice = (project: string, id: string) =>
  call<{ denied: boolean }>(`/api/v1/device/${id}/deny?project=${project}`, { method: 'POST' });
export const templates = (project: string) => call<Record<string, Template>>(`/api/v1/heralds/templates?project=${project}`);
/** Whether the house has a bot key of its own (the server's TELEGRAM_BOT_TOKEN) — then a herald may say "the house key" instead of carrying one. */
export const houseKey = (project: string) => call<{ available: boolean }>(`/api/v1/heralds/house?project=${project}`);
export const HOUSE_KEY = 'house';
export const saveHerald = (project: string, herald: Partial<Herald> & { template?: string }) =>
  call<Herald>(`/api/v1/heralds?project=${project}`, { method: 'PUT', body: JSON.stringify(herald) });
export const dropHerald = (project: string, id: string) =>
  call<{ removed: boolean }>(`/api/v1/heralds/${id}?project=${project}`, { method: 'DELETE' });
export const probeHerald = (project: string, id: string) =>
  call<{ ok?: boolean; sent?: boolean; bot?: string; reason?: string }>(`/api/v1/heralds/${id}/probe?project=${project}`, { method: 'POST' });
/**
 * The channels a KEY can see, before the herald exists. The chicken and the
 * egg: the list needs the bot's key, and the key lives on a herald nobody has
 * saved yet — so the key that is already in the form asks directly. It is used
 * once and not stored.
 */
export const chatsForKey = (project: string, token: string, kind = 'telegram') =>
  call<{ ok: boolean; chats?: { id: string; kind: string; name: string }[]; reason?: string }>(
    `/api/v1/heralds/chats?project=${project}`,
    { method: 'POST', body: JSON.stringify({ kind, token }) },
  );

export const heraldChats = (project: string, id: string) =>
  call<{ ok: boolean; chats?: { id: string; kind: string; name: string }[]; reason?: string }>(`/api/v1/heralds/${id}/chats?project=${project}`);
export const report = (project: string, options: { period?: string; voice?: 'plain' | 'human'; since?: string } = {}) => {
  const query = new URLSearchParams({ project });
  if (options.period) query.set('period', options.period);
  if (options.voice) query.set('voice', options.voice);
  if (options.since) query.set('since', options.since);
  return call<Report>(`/api/v1/report?${query}`);
};
export const sendReport = (project: string, id: string, html: string) =>
  call<{ sent: boolean; reason?: string }>(`/api/v1/heralds/${id}/say?project=${project}`, { method: 'POST', body: JSON.stringify({ html }) });

/**
 * The live line. It carries only "something moved in this project" — the board
 * then asks through the door that knows its rights. That costs one request and
 * saves having card titles sitting in an open stream whose permissions may
 * have changed since it was opened.
 *
 * `EventSource` reconnects on its own, which is the whole reason it is not a
 * WebSocket: a socket that falls through a proxy at three in the morning stays
 * fallen until someone reloads, and a board that goes quietly stale is worse
 * than one that is empty.
 */
export function live(
  project: string,
  moved: (event: { verb: string; card: string; actor: string }) => void,
  // The picture changed — a deployment landed, a card was seen in a lane. As
  // with a move, only THAT it changed travels; the board asks /api/v1/system.
  pictured?: (event: { at: string; changed: string[] }) => void,
) {
  const source = new EventSource(`${root}/api/v1/live?project=${project}`, { withCredentials: true });
  const onMoved = (e: MessageEvent) => {
    try { moved(JSON.parse(e.data)); } catch { /* a broken frame is not a reason to stop listening */ }
  };
  const onSystem = (e: MessageEvent) => {
    try { pictured?.(JSON.parse(e.data)); } catch { /* same */ }
  };
  source.addEventListener('moved', onMoved as EventListener);
  source.addEventListener('system', onSystem as EventListener);
  return () => {
    source.removeEventListener('moved', onMoved as EventListener);
    source.removeEventListener('system', onSystem as EventListener);
    source.close();
  };
}

export type Standing = {
  standing: 'live' | 'deploying' | 'failed' | 'idle' | 'unknown';
  line: string;
  at?: string | null;
  deployments: { status: string; standing: string; title: string; at: string | null }[];
};
export const standing = (project: string) => call<Standing>(`/api/v1/standing?project=${project}`);

/**
 * The pulse — five questions in one answer.
 *
 * ONE request, deliberately. Five would let the surface show four fresh
 * panels and one from a minute ago, and the reader could not tell which.
 */
export type Outlook = {
  verdict: 'ahead' | 'tight' | 'behind' | 'no date' | 'no pace' | 'no parts' | 'settled';
  open: number;
  daysNeeded?: number;
  daysLeft?: number;
};
export type Flow = { id: string; moves: number; cards: string[] };
export type Pulse = {
  since: string;
  until: string;
  happened: {
    done: { card: string; title: string }[];
    released: { card: string; title: string }[];
    decided: { card: string; title: string }[];
    incidents: { card: string; title: string }[];
    started: { card: string; title: string }[];
    actors: string[];
    touched: number;
  };
  goals: {
    key: string; title: string; kind: string; state: State;
    due: string | null; total: number; done: number; dropped: number;
    share: number | null; open: string[]; outlook: Outlook;
  }[];
  pace: { settled: number; days: number; perDay: number; sample: number };
  energy: {
    moves: number;
    module: Flow[];
    stack: Flow[];
    people: { person: string; moves: number; cards: string[] }[];
    nowhere: { module: { moves: number; cards: string[] }; stack: { moves: number; cards: string[] } };
  };
  hangs: { card: string; title: string; state: State; waiting: string[] }[];
  findings: { id: string; line: string; cards: string[]; count: number; why: string }[];
};
export const pulse = (project: string, since?: string) => call<Pulse>(
  `/api/v1/pulse?project=${project}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
);
