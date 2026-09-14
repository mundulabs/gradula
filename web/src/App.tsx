import CodeContext from './CodeContext';
import { acceptancePolicy, saveAcceptancePolicy } from './api';
/**
 * The board — what is to be done.
 *
 * Deliberately little: six columns, cards, a sheet beside them. No dragging
 * with the mouse in this round, but buttons that say where a card goes. A drag
 * that does not work on a phone and is imprecise on a desktop would be the
 * wrong first gesture; the right one comes when somebody misses it.
 *
 * Settings hold keys, heralds and reports. Progress shapes have fixed meanings.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb } from 'thinking-orbs';
import { signalOf, beamFor, changedBetween, isRunning, IMPULSE_MS, BEAM_STATIC, LEVEL_CLASS, type Signal } from './motion';
import { Liquid } from 'liquid-gooey';
import { group, parentsFrom, type Group } from './bonds';
import { chosenLanguage, keepLanguage, words, LANGUAGES, type Language } from './words';
import { KINDS, GATE_KINDS, AGENT_KEY_KIND, templateOf } from './vocabulary';
import AreaMap from './Map';
import PulseView from './Pulse';
import Legend from './Legend';
import { ageOf, shortAge } from './age';
import Prose from './Prose';
import Dialog from './Dialog';
import Icon from './Icon';
import ConfirmAction from './ConfirmAction';
import {
  signInPath, me as readMe, projects as readProjects, cards as readCards,
  card as readCard, system as readSystem, move, start, beatWork, releaseWork, workSession, create, change, confirm, say, decide,
  vocabulary as readVocabulary, links as readLinks, live as liveLine,
  standing as readStanding, NotSignedIn,
  heralds as heraldsRead, myKeys, mintKey, revokeKey, type OwnKey, pendingDevices, approveDevice, denyDevice, type Device, templates as templatesRead, houseKey as houseKeyRead, HOUSE_KEY, saveHerald, dropHerald,
  probeHerald, heraldChats, chatsForKey, report as reportRead, sendReport,
  type Me, type Card, type Project, type State, type Herald, type Template, type Report, type Link,
  type Standing, type SystemCard,
} from './api';
import { laneChips, commitHref, fileHref, LANES, type Lane, type Chip } from './deployed';

/** Written out, one by one — see the note where it is used. */
const STAND_CLASS: Record<string, string> = {
  live: 'standing stand-live',
  deploying: 'standing stand-deploying',
  failed: 'standing stand-failed',
  idle: 'standing',
};

/*
 * A CARD HAS AN ADDRESS, EVEN INSIDE THE APP.
 *
 * The board is served under two mounts (grad.mundula.app and
 * mundula.app/dev/plan), so "where a card lives" is whatever the path was
 * BEFORE the card — never a hard-coded slash. Both `open()` and every card's
 * own `href` read it the same way, so a right-click "open in new tab" or
 * "copy link" on a card lands exactly where clicking it would take you —
 * before, a card was a `<button>` with nothing under the pointer to copy.
 */
function mountPath(): string {
  return window.location.pathname.replace(/\/[A-Z]{2,8}-\d{1,7}$/, '').replace(/\/$/, '');
}
function cardHref(key: string): string {
  return `${mountPath()}/${key}`;
}

/**
 * The language of the surface, decided once per load. A switch writes it and
 * reloads: everything on this page is a word, and half a page in two languages
 * is worse than either.
 */
const language: Language = chosenLanguage();
const t = words(language);

// The column NAMES come from the service's vocabulary (src/spec.mjs) — the
// states themselves are identifiers and never translated.
const COLUMNS: State[] = [
  'ideas', 'ready', 'making', 'review', 'done',
  // Ice is a column, not a rung: what lies on ice is not on its way up. That
  // is exactly why it is a column and not a flag — see src/spec.mjs.
  'ice',
];
const COLUMN_NAMES: { state: State; name: string }[] = COLUMNS.map((state) => ({ state, name: t(state) }));


function Labels({ card }: { card: Card }) {
  const guessed = new Set([...(card.suggestions?.module ?? []), ...(card.suggestions?.stack ?? [])]);
  const all = [...new Set([...card.module, ...card.stack, ...guessed])];
  if (!all.length) return null;
  return (
    <div className="labels">
      {all.map((e) => (
        <span key={e} className={`label${card.module.includes(e) ? ' module' : ''}${guessed.has(e) ? ' guessed' : ''}`}>{e}</span>
      ))}
    </div>
  );
}

function FileRefs({ files, repo }: { files: string[]; repo: string | null }) {
  if (!files.length) return null;
  return (
    <section className="file-refs" aria-label={t('card.files')}>
      <h3>{t('card.files')}</h3>
      <div>
        {files.map((file) => {
          const href = fileHref(repo, file);
          return href
            ? <a key={file} href={href} target="_blank" rel="noreferrer">{file}</a>
            : <span key={file}>{file}</span>;
        })}
      </div>
    </section>
  );
}

/**
 * WHERE THE CARD HAS ARRIVED. Two small chips, dev and prod: filled when the
 * lane runs the card's commits, outlined when it was measured and does not
 * yet, absent when nobody could tell — and absent altogether while no commit
 * stands behind the card (deployed.ts has the law). The card's own notes and
 * the live picture are read together; the `system` event on the live line
 * is what makes a chip fill the minute a deployment lands.
 */
const LANE_WORD: Record<Lane, string> = { development: t('lane.dev'), production: t('lane.prod') };
const LANE_ON: Record<Lane, string> = { development: t('card.onDev'), production: t('card.onProd') };
const LANE_OFF: Record<Lane, string> = { development: t('card.notOnDev'), production: t('card.notOnProd') };
// Written out, not composed — the surface test reads `_CLASS` lookups.
const LANE_CLASS: Record<Chip, string> = { filled: 'lane lane-on', outlined: 'lane' };
function LaneChips({ card, picture }: { card: Card; picture?: SystemCard | null }) {
  const chips = laneChips(card, picture);
  const shown = LANES.flatMap((lane) => { const chip = chips[lane]; return chip ? [{ lane, chip }] : []; });
  const git = picture?.git;
  const branches = (['dev','main'] as const).filter(branch => (git?.[branch] ?? 0) > 0);
  if (!shown.length && !branches.length) return null;
  return (
    <span className="lanes">
      {branches.map(branch => <span key={branch} className="lane" title={t('card.gitProof')}>Git {branch} · {git![branch]}/{git!.total}</span>)}
      {shown.map(({ lane, chip }) => (
        <span key={lane} className={LANE_CLASS[chip]} title={chip === 'filled' ? LANE_ON[lane] : LANE_OFF[lane]}>
          {LANE_WORD[lane]}
        </span>
      ))}
    </span>
  );
}

function CardButton({ card, open, signal, picture }: { card: Card; open: () => void; signal: Signal | null; picture?: SystemCard | null }) {
  const beam = beamFor(signal);
  const age = ageOf(card);
  /*
   * A LEFT CLICK STAYS INSIDE THE APP; EVERY OTHER CLICK IS THE BROWSER'S.
   * That distinction is the whole reason this is an <a> and not a <button>:
   * cmd/ctrl/middle-click, and "open in new tab" from the context menu, only
   * exist for an element with a real href — a button has nothing to open.
   */
  const click = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open();
  };
  const buttonNode = (
    <a className="card" href={cardHref(card.key)} onClick={click}
      aria-describedby={signal ? `sig-${card.key}` : undefined}>
      {signal ? (
        // The motion is the message for the eye. This is the same message for a
        // screen reader, which sees no beam at all.
        <span id={`sig-${card.key}`} className="readerOnly">
          {signal === 'working' ? 'being worked on' : signal === 'attention' ? 'needs a hand' : 'just changed'}
        </span>
      ) : null}
      {card.reservation ? <span className="work-owner">{card.reservation.actor} · {t(Date.parse(card.reservation.until) > Date.now() ? 'work.active' : 'work.unknown')}</span> : null}
      <span className="key">
        {card.key}{card.source === 'sentry' ? ' · incident' : ''}
        {/*
          WHAT KIND OF THING THIS IS, when it is not the usual one.
          A milestone held eighteen cards and looked exactly like the tasks it
          held. The kind is not a state, so it gets no colour — it gets a word,
          and only where the word says something: `task` on twenty-nine of
          thirty-five cards would be noise, not information.
        */}
        {card.kind !== 'task' ? <span className="kind">{t(card.kind)}</span> : null}
        {/*
          HOW BAD SENTRY THOUGHT IT WAS. Not a state and not the beam: the
          beam says "you are needed", and this says how loud the thing was
          when it happened. Its own small scale, and only on cards that
          carry one — which is only incidents.
        */}
        {card.level ? <span className={LEVEL_CLASS[card.level] ?? 'level'}>{t(`level.${card.level}`, card.level)}</span> : null}
        {isRunning(card) ? (
          // A machine is at work on this card AT THIS MOMENT — not a state
          // somebody left it in, a lease that is being renewed right now.
          <span className="orb" title="a runner is working on this right now">
            <ThinkingOrb state="working" size={20} />
            <span className="readerOnly">{t('card.running')}</span>
          </span>
        ) : null}
      </span>
      <span className="title">{card.title}</span>
      <Labels card={card} />
      <span className="foot">
        {card.person ? <span>{card.person}</span> : null}
        {card.count ? <span>{card.count}×</span> : null}
        {card.gate ? <span>{t('card.gate')}</span> : null}
        <LaneChips card={card} picture={picture} />
        {card.blockedBy.length ? <span className="waiting">{t('card.waits')} {card.blockedBy.join(' ')}</span> : null}
        {/*
          HOW LONG THIS HAS BEEN LYING HERE — and only past the threshold. A
          number on every card is a number nobody reads; a number on three of
          forty is the three you were looking for. A date that has passed
          outranks it: overdue is a fact about a promise, idle only about
          attention.
        */}
        {age.overdue ? <span className="overdue" title={t('card.overdueWhy')}>{t('card.overdue')}</span>
          : age.idle ? <span className="idle" title={t('card.idleWhy')}>{shortAge(age.days)}</span> : null}
      </span>
    </a>
  );
  return beam
    ? <BorderBeam size={beam.size} duration={beam.duration} colorVariant={beam.color} staticColors={BEAM_STATIC} theme="dark">{buttonNode}</BorderBeam>
    : buttonNode;
}

/**
 * The gate as a form. Two fields are enough: WHAT is called and WHAT must
 * come out of it. Whoever asks for more gets one less often — and a card
 * without a gate is one somebody maintains by hand forever.
 */
/**
 * The gate as a form. Two fields are enough: WHAT is called and WHAT must come
 * out of it.
 *
 * The call field offers what the board ALREADY KNOWS — every path a card has
 * named, every path in the module vocabulary. Not a file browser: this runs in
 * a browser and has no repository. But a list of the paths this project
 * actually works in beats an empty box that wants `packages/…/x.ts` typed
 * without a typo, and since `gradula sync` records the files of every commit,
 * the list fills itself.
 */
const NEW_PERSON = '__new__';
function PersonField({ value, people, onChange }: { value: string; people: string[]; onChange: (who: string) => void }) {
  const known = people.includes(value);
  const [typing, setTyping] = useState(!known && Boolean(value));
  return (
    <div className="person-field">
      <select aria-label={t('card.person')} value={typing ? NEW_PERSON : (known ? value : '')} onChange={(e) => {
        if (e.target.value === NEW_PERSON) { setTyping(true); onChange(''); return; }
        setTyping(false); onChange(e.target.value);
      }}>
        <option value="">{t('card.nobody')}</option>
        {people.map((who) => <option key={who} value={who}>{who}</option>)}
        <option value={NEW_PERSON}>{t('card.newPerson')}</option>
      </select>
      {typing ? <input autoFocus placeholder={t('card.personName')} value={value} onChange={(e) => onChange(e.target.value)} /> : null}
    </div>
  );
}

/*
 * A source path is one that lives in this repository. The list the board
 * gathers is wider than that: a Sentry trace names /app/src/api.mjs (the
 * container's path), a card mentions .gitignore, the vocabulary lists bare
 * module names — none of them is a file one can put a gate on.
 */
const SOURCE_PATH = /^(packages|apps|tools|tests|src|web|bin)\/[^\s]+\.(ts|tsx|mjs|cjs|js|json|md)$/;
const OTHER_PATH = '__other__';

function GateField({ gate, setGate, known = [] }: { gate: Card['gate']; setGate: (t: Card['gate']) => void; known?: string[] }) {
  const kind = gate?.kind ?? 'test';
  const sources = known.filter((path) => SOURCE_PATH.test(path));
  return (
    <div className="gate-field">
      <select aria-label={t('card.gate')} value={gate ? kind : ''} onChange={(e) => setGate(e.target.value ? { kind: e.target.value, call: gate?.call ?? '', expect: gate?.expect ?? null } : null)}>
        {/* The kinds come from the service (GATE_KINDS). They stood here as a
            second list, and after the move to English it still offered
            `befehl`, `datei` and `adresse` — three of four choices the service
            refuses with a 400. Nothing was red; the board simply could not set
            a gate. */}
        <option value="">{t('card.gateNone')}</option>
        {GATE_KINDS.map((one) => <option key={one} value={one}>{t(one)}</option>)}
      </select>
      {gate ? (
        <>
          {/* These compared against `adresse` and `datei` long after the
              gate kinds had moved to English — so every gate but `test` got
              the wrong example, and nothing was red about it. */}
          {kind === 'file' && sources.length ? (
            <>
              <select value={sources.includes(gate.call) ? gate.call : (gate.call ? OTHER_PATH : '')}
                      onChange={(e) => setGate({ ...gate, call: e.target.value === OTHER_PATH ? ' ' : e.target.value })}>
                <option value="">{t('card.pickFile')}</option>
                {sources.map((path) => <option key={path} value={path}>{path}</option>)}
                <option value={OTHER_PATH}>{t('card.otherFile')}</option>
              </select>
              {gate.call && !sources.includes(gate.call) ? (
                <input autoFocus placeholder={t('card.pathExample')} value={gate.call.trim()} onChange={(e) => setGate({ ...gate, call: e.target.value })} />
              ) : null}
            </>
          ) : (
            <input placeholder={kind === 'url' ? 'https://…/api/health' : kind === 'file' ? 'packages/…/x.ts' : 'npm test -- x'}
                   value={gate.call} onChange={(e) => setGate({ ...gate, call: e.target.value })} />
          )}
          <input aria-label={t('card.gateExpect')} placeholder={t('card.gateExpect')}
                 value={gate.expect ?? ''} onChange={(e) => setGate({ ...gate, expect: e.target.value || null })} />
        </>
      ) : null}
    </div>
  );
}

function Sheet({ project, cardKey, close, changed, people = [], knownPaths = [], repo = null, picture = null }: {
  project: string; cardKey: string; close: () => void; changed: () => void;
  people?: string[]; knownPaths?: string[]; repo?: string | null; picture?: SystemCard | null;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [editing, setEditing] = useState(false);
  const [byHand, setByHand] = useState(false);
  const [planned, setPlanned] = useState<string | null>(null);
  const [workReason, setWorkReason] = useState('');
  useEffect(() => { setPlanned(null); setWorkReason(''); }, [cardKey]);
  const [draft, setDraft] = useState<{ title: string; text: string; person: string; gate: Card['gate'] } | null>(null);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const baseline = useRef<typeof draft>(null);
  const lock = useRef(false);

  // Read again when the picture changed: the deployed line is written into
  // the chronicle while the picture is gathered, and the sheet should show it
  // the minute the chip fills.
  useEffect(() => {
    let active = true;
    readCard(project, cardKey).then((value) => { if (active) setCard(value); }).catch((e) => { if (active) setError(String(e.message ?? e)); });
    return () => { active = false; };
  }, [project, cardKey, picture]);

  const run = async (fn: () => Promise<Card>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(null);
    try { setCard(await fn()); changed(); return true; }
    catch (e) { setError(String((e as Error).message ?? e)); return false; }
    finally { lock.current = false; setBusy(false); }
  };

  const beginWork = () => {
    if (!card) return;
    const other = card.reservation && card.reservation.session !== workSession && Date.parse(card.reservation.until) > Date.now();
    if ((other || card.blockedBy.length) && !workReason.trim()) { setError(t('work.reasonRequired')); return; }
    run(() => start(project, card.key, card.blockedBy.length ? workReason.trim() : undefined, other ? workReason.trim() : undefined, planned === null ? undefined : planned.split('\n').map(p => p.trim()).filter(Boolean)));

  };

  const openToChange = () => {
    if (!card) return;
    setDraft({ title: card.title, text: card.text, person: card.person ?? '', gate: card.gate });
    baseline.current = { title: card.title, text: card.text, person: card.person ?? '', gate: card.gate };
    setEditing(true);
  };

  const keep = async () => {
    if (!draft || !card) return;
    // Send only what really changed: a PATCH that sends everything writes
    // back what somebody else has changed in the meantime, too.
    //
    const original = baseline.current;
    if (!original) return;
    const fields: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const fresh = await readCard(project, cardKey).catch(() => null);
    if (!fresh) { setError(t('ui.retrySave')); return; }
    for (const field of ['title', 'text', 'person', 'gate'] as const) {
      if (JSON.stringify(draft[field]) === JSON.stringify(original[field])) continue;
      const current = field === 'person' ? fresh.person ?? '' : fresh[field];
      if (JSON.stringify(current) !== JSON.stringify(original[field])) { setError(t('ui.editConflict')); return; }
      fields[field] = field === 'person' ? draft.person || null : draft[field];
      expected[field] = field === 'person' ? original.person || null : original[field];
    }
    if (!Object.keys(fields).length) { setEditing(false); return; }
    if (await run(() => change(project, card.key, { ...fields, expected }))) setEditing(false);
  };

  return (
    <Dialog title={cardKey} close={close} busy={busy} dirty={!!word.trim() || (editing && JSON.stringify(draft) !== JSON.stringify(baseline.current))}>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!card ? <p className="empty">{t('ui.loading')}</p> : (
          <>
            <h2>{card.title}</h2>
            <section className="work-reservation">
              <strong>{t('work.title')}</strong>
              <p>{card.reservation ? `${card.reservation.actor} · ${t(Date.parse(card.reservation.until) > Date.now() ? 'work.active' : 'work.unknown')} · ${t('work.session')} ${card.reservation.session.slice(0, 8)}` : t('work.free')}</p>
              {['ready','making'].includes(card.state) ? <label>{t('work.files')}<textarea value={planned ?? (card.reservation?.files ?? card.files).join('\n')} onChange={e => setPlanned(e.target.value)} placeholder={t('work.pathExample')} /></label> : null}
              {(card.blockedBy.length > 0 || (card.reservation && card.reservation.session !== workSession && Date.parse(card.reservation.until) > Date.now())) ? <label>{t('work.takeoverWhy')}<input value={workReason} onChange={e => setWorkReason(e.target.value)} /></label> : null}
              {(card.warnings ?? []).map(w => <p key={w.card}><a href={`/${w.card}`}>{w.card}</a> · {w.actor ?? t('work.unknown')} · {t(w.level === 'files' ? 'work.fileOverlap' : 'work.moduleOverlap')}: {(w.files.length ? w.files : w.modules).join(', ')} · {t(w.activity === 'active' ? 'work.active' : 'work.unknown')}</p>)}
            </section>
            <div className="line">
              <span>{t(card.kind)}</span><span>·</span><span>{t(card.state)}</span>
              {card.person ? <><span>·</span><span>{card.person}</span></> : null}
              {card.source !== 'human' ? <><span>·</span><span>{card.source}</span></> : null}
              {card.level ? <><span>·</span><span className={LEVEL_CLASS[card.level] ?? 'level'}>{t(`level.${card.level}`, card.level)}</span></> : null}
              {card.count && card.count > 1 ? <><span>·</span><span>{card.count}×</span></> : null}
              <LaneChips card={card} picture={picture} />
            </div>
            {/*
              WHERE IT HAS ARRIVED, WITH WHEN AND WHAT. Per lane the time the
              picture first saw the card there and the head that carried it —
              the sha as a link into the repository, the same address the
              card's GitHub door gives its evidence. Only lanes that hold the
              card: "not yet" is already said by the chip above.
            */}
            {LANES.some((lane) => card.deployed?.[lane]) ? (
              <div className="line">
                <span className="done">{t('card.deployed')}</span>
                {LANES.filter((lane) => card.deployed?.[lane]).map((lane) => {
                  const note = [...(card.history ?? [])].reverse().find((e) => e.verb === 'deployed' && e.data?.environment === lane);
                  const sha = note?.data?.sha ? String(note.data.sha) : null;
                  const href = commitHref(repo, sha);
                  const when = card.deployed?.at[lane];
                  return (
                    <span key={lane}>
                      {LANE_WORD[lane]}{when ? ` ${when.slice(0, 16).replace('T', ' ')}` : ''}
                      {sha ? <> · {href ? <a className="sha" href={href} target="_blank" rel="noreferrer">{sha.slice(0, 12)}</a> : <span className="sha">{sha.slice(0, 12)}</span>}</> : null}
                    </span>
                  );
                })}
              </div>
            ) : null}
            <Labels card={card} />
            {(card.suggestions?.module?.length || card.suggestions?.stack?.length) ? (
              <div className="line">
                <span>{t('card.suggested')}</span>
                <button onClick={() => run(() => confirm(project, card.key))}>{t('card.confirm')}</button>
              </div>
            ) : null}
            {card.gate ? <div className="line"><span>{t('card.gate')}</span><span>{card.gate.kind}</span><span>{card.gate.call}</span></div>
              : ['making', 'review'].includes(card.state)
                ? <div className="line waiting">{t('card.gateMissing')}</div>
                : null}
            <FileRefs files={card.files ?? []} repo={repo} />
            <CodeContext key={card.key} project={project} files={card.files ?? []} />
            {card.blockedBy.length ? <div className="line waiting">{t('card.waits')} {card.blockedBy.join(', ')}</div> : null}
            {card.permalink ? <a href={card.permalink} target="_blank" rel="noreferrer">{t('card.sentry')}</a> : null}
            {card.text ? <Prose text={card.text} open={open} /> : null}

            {editing && draft ? (
              <div className="change">
                <input aria-label={t('card.title')} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                <textarea aria-label={t('card.text')} rows={7} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
                {/*
                  The people this board already knows, by the name the chronicle
                  uses. A free field is right — somebody who has not touched a
                  card yet has to be typeable — but typing a name that already
                  exists, differently, is how one person becomes two.
                */}
                {/*
                  A real choice, not a free field wearing a hint. The names the
                  board knows are the options; "somebody new" is a deliberate
                  choice that opens a field — so a person who exists already is
                  never typed a second time, differently.
                */}
                <PersonField value={draft.person} people={people} onChange={(person) => setDraft({ ...draft, person })} />
                <GateField gate={draft.gate} setGate={(gate) => setDraft({ ...draft, gate })} known={knownPaths} />
                <div className="move">
                  <button className="primary" disabled={busy || !draft.title.trim()} onClick={keep}>{t('card.save')}</button>
                  <button onClick={() => setEditing(false)}>{t('card.discard')}</button>
                </div>
              </div>
            ) : null}

            {/*
              REVIEW HAS TWO ANSWERS, AND THEY ARE NOT COLUMNS.
              "What am I supposed to do here" was a fair question: the sheet
              offered five equal arrows, and the two that mean something —
              yes and not yet — were hidden among them. They are the same two
              moves underneath; a column list is a filing cabinet, and this is
              a decision.
            */}
            {card.state === 'review' ? (
              <div className="verdict-row">
                <button className="approve" disabled={busy || !!card.gate && card.gateStanding !== 'green'} onClick={() => run(() => move(project, card.key, 'done', t('card.approvedReason')))}>
                  {t('card.approve')}
                </button>
                <button className="reject" onClick={() => {
                  const why = window.prompt(t('card.sendBackWhy'));
                  if (why === null) return;
                  run(() => move(project, card.key, 'making', why || t('card.sendBackReason')));
                }}>
                  {t('card.sendBack')}
                </button>
                <span className="quiet">{t(card.gate && card.gateStanding !== 'green' ? (card.gateStanding === 'red' ? 'card.gateFailed' : 'card.gatePending') : 'card.acceptMeaning')}</span>
              </div>
            ) : null}

            {/*
              SIX ARROWS ARE NOT SIX DECISIONS.
              A card climbs by itself: a gate turns green and it is done, a
              runner's lease puts it in making and takes it back out, a day
              without a sign puts it back on ready. The arrows are the hand
              for when that fails — an escape hatch, not the main road, and
              standing open they made the board look like a filing cabinet
              you have to operate.
            */}
            <div className="move">
              {!editing ? <button onClick={openToChange}>{t('card.edit')}</button> : null}
              {/*
                THE DOOR SAYS THE SAME THING THE BUTTON SAYS.
                Start refuses an idea, a card on ice and a card that waits —
                so the button does not offer what the door will refuse. An
                idea gets the one move that means yes; a waiting card asks
                for the reason the door will want, and the reason lands in
                the chronicle beside the start.
              */}
              {card.state === 'ideas' || card.state === 'ice' ? (
                <button onClick={() => run(() => move(project, card.key, 'ready'))}>{t('card.toReady')}</button>
              ) : ['ready', 'making'].includes(card.state) ? (
                <button onClick={beginWork}>{t(card.reservation && card.reservation.session !== workSession && Date.parse(card.reservation.until) > Date.now() ? 'work.takeover' : 'card.start')}</button>
              ) : null}
              {card.reservation?.session === workSession ? <button onClick={() => run(() => releaseWork(project, card.key))}>{t('work.release')}</button> : null}
              <button className="by-hand" aria-expanded={byHand} onClick={() => setByHand(!byHand)}>
                {t('card.byHand')} {byHand ? '▾' : '▸'}
              </button>
            </div>
            {byHand ? (
              <div className="move">
                {COLUMN_NAMES.filter((s) => s.state !== card.state).map((s) => (
                  <button key={s.state} onClick={() => run(() => move(project, card.key, s.state))}>→ {s.name}</button>
                ))}
              </div>
            ) : null}

            {card.history?.length ? (
              <div className="history">
                {card.history.map((e, i) => {
                  const d = (e.data ?? {}) as Record<string, string>;
                  // What was said and what was decided belong IN the timeline —
                  // otherwise it reads "said" and nobody knows what.
                  //
                  // Every verb and every field here is the API's own name. They
                  // were German once, and after the move this whole block matched
                  // nothing: the chronicle showed a verb and an actor and never
                  // once what had actually been said. Nothing was red, because a
                  // comparison that finds nothing is a comparison that works.
                  //
                  // A commit — evidence, or the head that carried the card to a
                  // lane — is a link into the repository where there is one.
                  const commit = (sha: string, short = false) => {
                    const href = commitHref(repo, sha);
                    const text = short ? sha.slice(0, 12) : sha;
                    return href ? <a className="sha" href={href} target="_blank" rel="noreferrer">{text}</a> : text;
                  };
                  const inside: React.ReactNode = e.verb === 'said' ? d.line
                    : e.verb === 'decided' ? `${d.result} — ${d.reason}`
                    : e.verb === 'evidenced' ? <>{d.kind === 'commit' && d.ref ? commit(d.ref) : d.ref}{d.comment ? ` · ${d.comment}` : ''}</>
                    : e.verb === 'deployed' ? <>{d.environment}{d.sha ? <> · {commit(String(d.sha), true)}</> : null}</>
                    : e.verb === 'seen' ? <>{d.environment}{d.count != null ? ` · ${d.count}` : ''}</>
                    : '';
                  return (
                    <span key={i} className={e.verb === 'decided' ? 'decision' : undefined}>
                      {e.at.slice(0, 16).replace('T', ' ')}  <b>{e.verb}</b>  {e.actor}
                      {inside ? <><br /><span className="inside">{inside}</span></> : null}
                    </span>
                  );
                })}
              </div>
            ) : null}

            <div className="talk">
              <textarea aria-label={t('card.say')} rows={2} placeholder={t('card.say')} value={word} onChange={(e) => setWord(e.target.value)} />
              <div className="move">
                <button disabled={busy || !word.trim()} onClick={async () => { const text = word.trim(); if (await run(() => say(project, card.key, text))) setWord(''); }}>{t('card.say2')}</button>
                {card.kind === 'decision' ? (
                  <button disabled={busy || !word.trim()} onClick={async () => {
                    const reason = word.trim();
                    const outcome = window.prompt(t('card.decided'));
                    if (!outcome) return;
                    if (await run(() => decide(project, card.key, outcome, reason))) setWord('');
                  }}>{t('card.decide')}</button>
                ) : null}
              </div>
            </div>

          </>
        )}
    </Dialog>
  );
}

/**
 * Create a card. Deliberately three fields — title, kind, text. Everything
 * else (labels, links) Gradula sets itself; a form that asks for everything
 * is a form nobody fills in.
 */
function NewCard({ project, done, cancel }: { project: string; done: () => void; cancel: () => void }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('idea');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await create(project, { title: title.trim(), kind, text: text.trim() }); done(); }
    catch (err) { setError(String((err as Error).message ?? err)); setBusy(false); }
  };

  return (
    <Dialog title={t('card.new')} close={cancel} dirty={!!title.trim() || !!text.trim()} busy={busy}>
      <form className="new-card-form" onSubmit={submit}>
        {error ? <p className="error">{error}</p> : null}
        <label>{t('card.title')}<input required maxLength={200} autoFocus placeholder={t('card.title')} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {/* The kinds come from the service's vocabulary — a second list here
            would be a second truth, and one of them would be in one language. */}
        <label>{t('ui.kind')}<select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((one) => <option key={one} value={one}>{t(one)}</option>)}
        </select></label>
        <p className="hint">{t('ui.newCardHint')}</p>
        <label>{t('card.text')}<textarea rows={6} placeholder={t('card.text')} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="move">
          <button className="primary" type="submit" disabled={!title.trim() || busy}>{t('card.create')}</button>
          <button type="button" disabled={busy} onClick={(e) => e.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>{t('card.cancel')}</button>
        </div>
      </form>
    </Dialog>
  );
}


/**
 * Settings — keys, heralds and reports.
 */
/**
 * A PERSON'S OWN KEYS. Minted here, shown ONCE, revoked here — never handed
 * over. Felix's key lay in a file on David's disk for a day, waiting to be
 * carried across; a key that has to be carried is a key that gets emailed.
 * The lines below the token are the whole set-up: the key speaks as the
 * person who minted it, so no actor line is needed.
 */
function KeySection({ project }: { project: string }) {
  const [keys, setKeys] = useState<OwnKey[]>([]);
  const [pending, setPending] = useState<Device[]>([]);
  const [machine, setMachine] = useState('');
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    myKeys(project).then(setKeys).catch((e) => setError(String(e.message ?? e)));
    pendingDevices(project).then(setPending).catch(() => setPending([]));
  }, [project]);
  useEffect(() => { reload(); }, [reload]);
  // A machine running `gradula login` is waiting: poll while the panel is open.
  useEffect(() => {
    const clock = setInterval(() => { pendingDevices(project).then(setPending).catch(() => {}); }, 3000);
    return () => clearInterval(clock);
  }, [project]);

  const approve = async (id: string) => { setError(null); try { await approveDevice(project, id); reload(); } catch (e) { setError(String((e as Error).message ?? e)); } };
  const deny = async (id: string) => { setError(null); try { await denyDevice(project, id); reload(); } catch (e) { setError(String((e as Error).message ?? e)); } };

  const mint = async () => {
    const name = machine.trim();
    if (!name) return;
    setError(null);
    try {
      const out = await mintKey(project, name);
      setFresh({ token: out.token, name });
      setMachine('');
      reload();
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };
  const revoke = async (id: string) => {
    setError(null);
    try { await revokeKey(project, id); if (fresh && keys.find((k) => k.id === id)?.name === fresh.name) setFresh(null); reload(); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };
  const lines = fresh ? `GRADULA_URL=${window.location.origin}\nGRADULA_TOKEN=${fresh.token}` : '';
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(lines).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <section>
      <h3>{t('keys.head')}</h3>
      {error ? <p className="error">{error}</p> : null}
      {pending.map((d) => (
        <div className="row pending" key={d.id}>
          <b>{d.machine}</b>
          <span className="small">{t('keys.pending')} · {t('keys.code')} {d.code}</span>
          <button onClick={() => approve(d.id)}>{t('keys.approve')}</button>
          <button className="ghost" onClick={() => deny(d.id)}>{t('keys.deny')}</button>
        </div>
      ))}
      <p className="hint">{t('keys.login')}</p>
      {!keys.length && !pending.length ? <p className="small">{t('keys.none')}</p> : null}
      {keys.map((k) => (
        <div className="row" key={k.id}>
          <b>{k.name}</b>
          {/* The sessions' key: `gradula login` mints it beside yours; revoking one leaves the other. */}
          {k.kind === AGENT_KEY_KIND ? <span className="small">{t('keys.agent')}</span> : null}
          <span className="small">{t('keys.used')} {k.usedAt ? k.usedAt.slice(0, 16).replace('T', ' ') : t('keys.never')}</span>
          <ConfirmAction label={t('keys.revoke')} action={() => revoke(k.id)} />
        </div>
      ))}
      <div className="row">
        <input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder={t('keys.machine')} onKeyDown={(e) => { if (e.key === 'Enter') mint(); }} />
        <button onClick={mint} disabled={!machine.trim()}>{t('keys.mint')}</button>
      </div>
      {fresh ? (
        <>
          <p className="small">{t('keys.once')}</p>
          <pre className="report">{lines}</pre>
          <div className="row"><button onClick={copy}>{copied ? t('keys.copied') : t('keys.copy')}</button></div>
        </>
      ) : null}
    </section>
  );
}

function Settings({ project, close }: { project: string; close: () => void }) {
  const [manualAcceptance, setManualAcceptance] = useState<boolean | null>(null);
  useEffect(() => { acceptancePolicy(project).then(p => setManualAcceptance(p.manualAcceptance)).catch(e => setError(e.message)); }, [project]);
  const [tab, setTab] = useState<'channels' | 'reports' | 'access'>('channels');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const draftBase = useRef('');
  const beginDraft = (value: Partial<Herald> & { template?: string; token?: string }) => { draftBase.current = JSON.stringify(value); setError(null); setNote(null); setDraft(value); };
  const perform = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const [heralds, setHeralds] = useState<Herald[]>([]);
  const [templates, setTemplates] = useState<Record<string, Template>>({});
  const [draft, setDraft] = useState<(Partial<Herald> & { template?: string; token?: string }) | null>(null);
  const [chats, setChats] = useState<Record<string, { id: string; kind: string; name: string }[]>>({});
  const [draftChats, setDraftChats] = useState<{ id: string; kind: string; name: string }[]>([]);
  const [house, setHouse] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [period, setPeriod] = useState('this week');
  const [voice, setVoice] = useState<'plain' | 'human'>('human');
  useEffect(() => { setPreview(null); }, [period, voice, project]);

  const reload = useCallback(() => {
    heraldsRead(project).then(setHeralds).catch((e) => setError(String(e.message ?? e)));
  }, [project]);

  useEffect(() => { reload(); templatesRead(project).then(setTemplates).catch((e) => setError(e.message)); houseKeyRead(project).then((h) => setHouse(!!h.available)).catch(() => setHouse(false)); }, [project, reload]);
  /*
   * THE CHANNEL IS A LIST. With the house key the list needs no button: as
   * soon as the draft says "the house key", Telegram is asked which channels
   * the house bot can see, and the field is a choice, not a number.
   */
  const usingHouse = draft?.token === HOUSE_KEY;
  const publicDraft = (draft?.template ? templates[draft.template]?.filter.visibility : draft?.filter?.visibility) === 'public';
  useEffect(() => {
    if (!usingHouse) return;
    chatsForKey(project, HOUSE_KEY).then((out) => setDraftChats(out.ok ? out.chats ?? [] : [])).catch(() => setDraftChats([]));
  }, [project, usingHouse]);

  const save = async () => {
    if (!draft) return;
    try {
      await saveHerald(project, draft);
      setDraft(null); setNote(t('report.saved')); reload();
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const probe = async (id: string) => {
    setNote(null); setError(null);
    const out = await probeHerald(project, id)
      .catch((e) => ({ sent: false, bot: undefined, reason: String(e.message ?? e) }) as Awaited<ReturnType<typeof probeHerald>>);
    if (out.sent) setNote(`Delivered${out.bot ? ` as @${out.bot}` : ''}.`);
    else setError(`Not delivered — ${out.reason ?? 'unknown'}`);
  };

  const findChats = async (id: string) => {
    const out = await heraldChats(project, id)
      .catch((e) => ({ ok: false, chats: [], reason: String(e.message ?? e) }) as Awaited<ReturnType<typeof heraldChats>>);
    if (out.ok) setChats((c) => ({ ...c, [id]: out.chats ?? [] }));
    else setError(out.reason ?? 'no answer');
  };

  const build = async () => {
    setError(null);
    try { setPreview(await reportRead(project, { period, voice })); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const deliver = async (id: string) => {
    if (!preview) return;
    const out = await sendReport(project, id, preview.html)
      .catch((e) => ({ sent: false, reason: String(e.message ?? e) }));
    setNote(out.sent ? t('report.sent') : null);
    if (!out.sent) setError(out.reason ?? 'not delivered');
  };

  return (
    <Dialog title={t('nav.settings')} close={close} wide busy={busy} dirty={!!draft && JSON.stringify(draft) !== draftBase.current}>
      <section className="work-reservation">
        <label className="acceptance-toggle"><input type="checkbox" checked={manualAcceptance === true} disabled={busy || manualAcceptance === null} onChange={e => { const value = e.target.checked; perform(async () => { const saved = await saveAcceptancePolicy(project, value); setManualAcceptance(saved.manualAcceptance); }); }} /> {t('settings.manualAcceptance')}</label>
        <p className="hint">{t('settings.manualAcceptanceWhy')}</p>
      </section>
      <nav className="settings-tabs" aria-label={t('nav.settings')}>
        {(['channels', 'reports', 'access'] as const).map((one) => <button type="button" key={one} aria-pressed={tab === one} onClick={() => setTab(one)}>{t(`settings.${one}`)}</button>)}
      </nav>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {note ? <p className="notice" role="status">{note}</p> : null}

      <fieldset className="settings-body" disabled={busy}>
      <div hidden={tab !== 'access'}><KeySection project={project} /></div>

      <section hidden={tab !== 'channels' || !!draft}>
        <h3>{t('herald.head')}</h3>
        {!heralds.length ? <p className="small">{t('herald.none')}</p> : null}
        {heralds.map((h) => (
          <article className="herald" key={h.id}>
            <header>
              <b>{h.name}</b><span className="audience">{t(h.filter.visibility === 'public' ? 'settings.public' : 'settings.internal')}</span>
              <span className="small">{h.active === false ? t('settings.paused') : t('settings.active')}</span>
              {h.token ? null : <span className="error"> no key</span>}
            </header>
            <p className="small">
              {templates[templateOf(h.filter, templates) ?? '']?.line ?? t('settings.custom')}
              {h.filter.pipeline ? ` · ${t('herald.pipeline')}` : ''}
            </p>
            <div className="row">
              <button onClick={() => beginDraft({ ...h, token: h.house ? HOUSE_KEY : '', template: templateOf(h.filter, templates) })}>{t('card.edit')}</button>
              <button onClick={() => perform(() => probe(h.id))}>{t('herald.probe')}</button>
              <button onClick={() => perform(() => findChats(h.id))}>{t('herald.chats')}</button>
              <button onClick={() => perform(() => saveHerald(project, { id: h.id, active: h.active === false }).then(reload))}>{t(h.active === false ? 'settings.resume' : 'settings.pause')}</button>
              <ConfirmAction label={t('herald.remove')} action={() => dropHerald(project, h.id).then(reload)} />
            </div>
            {chats[h.id] ? (
              <ul className="small">
                {chats[h.id].length
                  ? chats[h.id].map((c) => (
                      <li key={c.id}>
                        <code>{c.id}</code> {c.kind} {c.name}
                        <button onClick={() => perform(() => saveHerald(project, { id: h.id, chat: c.id }).then(reload))}>{t('card.use')}</button>
                      </li>
                    ))
                  : <li>{t('herald.noChats')}</li>}
              </ul>
            ) : null}
          </article>
        ))}
        {/* a new herald takes the house key when the house has one — the channels then list themselves */}
        <button className="primary" onClick={() => beginDraft({ kind: 'telegram', template: 'workshop', ...(house ? { token: HOUSE_KEY } : {}) })}><Icon name="plus" />{t('herald.new')}</button>
      </section>

      {draft ? (
        <section className="draft" hidden={tab !== 'channels'}>
          <h3>{t(draft.id ? 'herald.edit' : 'herald.new')}</h3>
          {/*
            EVERY FIELD SAYS WHAT IT IS AND WHERE ITS VALUE COMES FROM.
            Three boxes called Name, Chat and Key are three questions nobody
            outside this room can answer — the second one wanted a number from
            a place the board never mentioned.
          */}
          <label>{t('herald.name')}
            <input autoFocus maxLength={80} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('herald.namePlaceholder')} />
          </label>
          <p className="hint">{t('herald.nameWhy')}</p>

          {/*
            THE KEY: THE HOUSE'S, OR ONE TYPED IN. The house bot's key lives in
            the server's environment; a herald that uses it carries only the
            word "house". Typing a key stays possible for a bot of one's own.
          */}
          {house ? (
            <label className="check">
              <input type="checkbox" checked={usingHouse}
                onChange={(e) => { setDraftChats([]); setDraft({ ...draft, token: e.target.checked ? HOUSE_KEY : '' }); }} />
              {' '}{t('herald.houseKey')}
            </label>
          ) : null}
          {!usingHouse ? (
            <>
              <label>
                {t('herald.key')}
                <input type="password" value={draft.token ?? ''}
                  placeholder={draft.id ? t('herald.keyKept') : t('herald.keyPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, token: e.target.value })} />
              </label>
              <p className="hint">{t('herald.keyWhy')}</p>
            </>
          ) : <p className="hint">{t('herald.houseKeyWhy')}</p>}

          {/*
            The channel is a LIST, not a number to look up. The key that is
            already in the field asks Telegram which channels the bot can see —
            being invited into the group is enough, and nobody copies a
            `-100…` out of anywhere.
          */}
          <label>{t('chat.head')}
            {draftChats.length ? (
              <select value={draft.chat ?? ''} onChange={(e) => setDraft({ ...draft, chat: e.target.value })}>
                <option value="">— {t('herald.pickChat')} —</option>
                {draftChats.map((c) => <option key={c.id} value={c.id}>{c.name || c.id} · {c.kind}</option>)}
              </select>
            ) : (
              <input value={draft.chat ?? ''} onChange={(e) => setDraft({ ...draft, chat: e.target.value })} placeholder={t('herald.chatId')} />
            )}
          </label>
          <div className="row">
            <button disabled={!draft.token} onClick={() => {
              chatsForKey(project, String(draft.token))
                .then((out) => setDraftChats(out.ok ? out.chats ?? [] : []))
                .catch(() => setDraftChats([]));
            }}>{t('herald.chats')}</button>
            <span className="hint">{t('herald.chatWhy')}</span>
          </div>

          <label>
            {t('herald.template')}
            <select value={draft.template ?? templateOf(draft.filter, templates) ?? ''} onChange={(e) => { const template = e.target.value || undefined; setDraft({ ...draft, template, ...(template && templates[template]?.filter.visibility === 'public' ? { schedule: { ...draft.schedule, cadence: 'off' } } : {}) }); }}>
              <option value="">— {t('herald.keepFilter')} —</option>
              {Object.entries(templates).map(([id, t2]) => <option key={id} value={id}>{t2.name} — {t2.line}</option>)}
            </select>
          </label>
          <p className="hint">{t('herald.templateWhy')}</p>
          <label className="check">
            <input type="checkbox"
              checked={!!(draft.template ? templates[draft.template]?.filter.pipeline : draft.filter?.pipeline)}
              disabled={(draft.template ? templates[draft.template]?.filter.visibility : draft.filter?.visibility) === 'public'}
              onChange={(e) => setDraft({ ...draft, template: undefined, filter: { ...(draft.template ? templates[draft.template]?.filter : draft.filter), pipeline: e.target.checked } })} />
            {' '}{t('herald.pipeline')}
          </label>
          <p className="hint">{t('herald.pipelineWhy')}</p>
          {/*
            WHEN IT SPEAKS BY ITSELF. A report you have to trigger is, after two
            weeks, one nobody triggers — so a herald can carry its own cadence:
            a workshop channel daily, a client channel weekly, both on the same
            board. `off` means it only ever speaks when a hand presses send.
          */}
          <label hidden={publicDraft}>{t('herald.cadence')}
            <div className="row">
              <select disabled={publicDraft}
                value={draft.schedule?.cadence ?? 'off'}
                onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, cadence: e.target.value as 'daily' | 'weekly' | 'off' } })}
              >
                <option value="off">{t('herald.cadenceOff')}</option>
                <option value="daily">{t('herald.daily')}</option>
                <option value="weekly">{t('herald.weekly')}</option>
              </select>
              {draft.schedule?.cadence && draft.schedule.cadence !== 'off' ? (
                <span className="small">{t('herald.atHour')}
                  <input
                    type="number" min={0} max={23} style={{ width: '3.5rem', marginLeft: '.4rem' }}
                    value={draft.schedule?.hour ?? 8}
                    onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) } })}
                  /> UTC
                </span>
              ) : null}
            </div>
          </label>
          <div className="row">
            <button className="primary" disabled={!draft.chat?.trim()} onClick={() => perform(save)}>{t('card.save')}</button>
            <button onClick={() => setDraft(null)}>{t('card.cancel')}</button>
          </div>
        </section>
      ) : null}

      <section hidden={tab !== 'reports'}>
        <h3>{t('report.head')}</h3>
        <p className="hint">{t('settings.reportAudience')}</p>
        <div className="row">
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={t('report.period')} />
          <select value={voice} onChange={(e) => setVoice(e.target.value as 'plain' | 'human')}>
            <option value="human">{t('herald.voiceHuman')}</option>
            <option value="plain">{t('herald.voicePlain')}</option>
          </select>
          <button className="primary" onClick={() => perform(build)}>{t('build.head')}</button>
        </div>
        {preview ? (
          <>
            <p className="small">
              {preview.counts.done} done · {preview.counts.decided} decided · {preview.counts.incidents} incidents
            </p>
            <pre className="report">{voice === 'plain' ? preview.plain : preview.human}</pre>
            <div className="row">
              {heralds.filter((h) => h.chat && h.active !== false && h.filter.visibility !== 'public').map((h) => (
                <button key={h.id} onClick={() => perform(() => deliver(h.id))}>Send to {h.name}</button>
              ))}
            </div>
          </>
        ) : <p className="small">{t('herald.quiet')}</p>}
      </section>
      </fieldset>
    </Dialog>
  );
}


/**
 * The door.
 *
 * The mark shows what the product is instead of claiming it: the six columns
 * ARE the rungs, and `gradus` is the rung. A tagline can be argued with; a
 * ladder cannot.
 *
 * No motion on the mark — by our own law, motion means state, and a door has
 * none. But pressing the button IS a state: the browser is walking to the
 * identity provider, which takes a moment on a cold connection. That is when
 * something may move, and only then.
 */
/**
 * The language switch. It reloads, and that is the honest thing: the language
 * is read once at the top of the module, and half a page in two languages is
 * worse than either.
 *
 * It stands on the DOOR as well as in the head. Whoever is not signed in sees
 * only the door, and a switch you reach after signing in is one that arrives
 * too late for the person who needed it.
 *
 * Two letters, not a globe: the choice is between exactly these two, and the
 * chosen one is a weight — colour means state in this house.
 */
function LanguageSwitch() {
  return (
    <span className="languages" role="group" aria-label="Sprache · language">
      {LANGUAGES.map((one) => (
        <button
          key={one}
          className={one === language ? 'language on' : 'language'}
          aria-pressed={one === language}
          onClick={() => { if (one !== language) { keepLanguage(one); location.reload(); } }}
        >{one.toUpperCase()}</button>
      ))}
    </span>
  );
}

function Door() {
  const [walking, setWalking] = useState(false);
  const rungs = COLUMN_NAMES.filter((c) => c.state !== 'ice').map((c) => c.name);
  return (
    <main className="door">
      <div className="card-door">
        <span className="mark">Gradula</span>
        <ol className="ladder" aria-label={t('door.ladder')}>
          {rungs.map((name) => <li key={name}>{name}</li>)}
        </ol>
        <p className="claim">{t('sign.claim')}</p>
        <a
          className={`button${walking ? ' walking' : ''}`}
          href={signInPath()}
          onClick={() => setWalking(true)}
          aria-busy={walking}
        >
          {t(walking ? 'sign.walking' : 'sign.in')}
        </a>
        <p className="small">{t('sign.note')}</p>
        <LanguageSwitch />
      </div>
    </main>
  );
}

/**
 * A bond. Cards that belong together flow into one silhouette — the melt IS
 * the information: cards explicitly assigned to one venture share a purpose.
 *
 * A group of one gets no liquid at all. Drawing a bond around a single card
 * would say something untrue, and it would cost a filter for nothing.
 */
/** How many cards a melt can hold before it is a wall rather than a bond. */
const MELT_AT_MOST = 4;

function Bond({ group, open, justChanged, picture }: {
  group: Group;
  open: (key: string) => void;
  justChanged: Set<string>;
  picture: Map<string, SystemCard>;
}) {
  const [folded, setFolded] = useState(false);
  const cards = group.cards.map((k) => (
    <CardButton key={k.key} card={k} open={() => open(k.key)}
      signal={signalOf(k, justChanged.has(k.key))} picture={picture.get(k.key) ?? null} />
  ));
  if (!group.bond) return <>{cards}</>;
  const why = `${t(group.bond.reason === 'module' ? 'bond.module' : 'bond.venture')} ${group.bond.detail}`;
  /*
   * A GROUP OF EIGHTEEN IS NOT A GROUP.
   *
   * The melt says "one piece of work in two hands" — it reads at two or three
   * cards and stops meaning anything at four or five. On the live board one
   * venture held eighteen of a column's twenty-six, and the melt drew a wall.
   * A shape that covers most of what you can see says nothing about it.
   *
   * Above the cap the bond keeps its SENTENCE and loses its shape: the cards
   * stay cards, and the line above them still says what they are part of.
   */
  /*
   * AND A GROUP OF EIGHTEEN CAN BE FOLDED AWAY.
   *
   * Above the cap the line is the only thing that still reads, so it becomes
   * the handle: press it and the parts go, press it again and they come back.
   * Deliberately NOT remembered across a reload — a board that opens with
   * three columns silently folded is a board that lies about what is on it.
   */
  if (group.bond.reason === 'module' || group.cards.length > MELT_AT_MOST) return (
    <div className={'group wide group-venture'}>
      <button className="bond fold" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
        <span className="chevron" aria-hidden="true">{folded ? '▸' : '▾'}</span>
        {why} · {group.cards.length}
      </button>
      {folded ? null : cards}
    </div>
  );
  return (
    // Written out, not composed: a class name you cannot grep is one no test
    // finds either — and that is exactly how rules are orphaned. That was the
    // cause three times last night.
    <div className={'group group-venture'}>
      {/*
        THE BOND SAYS WHY, ON THE BOARD.
        It stood in a `title` — a tooltip nobody hovers. What one saw was a
        darker block of cards packed together, and the only honest reading of
        that is "something is wrong with these". David asked what it meant,
        which is the answer: a shape alone does not say a reason.
      */}
      <span className="bond">{why}</span>
      <Liquid blur={7} contrast={20} fill="var(--surface)" waviness={0}>
        {cards.map((card, i) => <Liquid.Item key={group.cards[i].key} effect="melt">{card}</Liquid.Item>)}
      </Liquid>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string>(() => localStorage.getItem('gradula.project') ?? '');
  const [cards, setCards] = useState<Card[]>([]);
  const working = useRef(new Map<string, Card>());
  const [, refreshActivity] = useState(0);
  useEffect(() => { const timer = setInterval(() => refreshActivity(n => n + 1), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    for (const card of cards) {
      if (card.reservation?.session === workSession && card.state === 'making') working.current.set(card.key, card);
      else working.current.delete(card.key);
    }
  }, [cards]);
  useEffect(() => {
    const clock = setInterval(() => {
      for (const [key] of working.current) {
        beatWork(key.split('-')[0], key).then(result => {
          setCards(before => before.map(card => card.key === key && card.reservation?.session === workSession ? { ...card, heartbeat: new Date().toISOString(), reservation: { ...card.reservation, until: result.until }, warnings: result.warnings } : card));
        }).catch(error => { working.current.delete(key); setError(`${key}: ${error.message}`); });
      }
    }, 25000);
    return () => clearInterval(clock);
  }, []);

  // What has moved since I last looked. The short impulse ends by itself —
  // it is a message, not a state.
  const [justChanged, setJustChanged] = useState<Set<string>>(new Set());
  const previous = useRef<Card[]>([]);
  const [bonds, setBonds] = useState<Link[]>([]);
  const [standing, setStanding] = useState<Standing | null>(null);
  /*
   * THE PICTURE, by card key: where each card in hand has arrived, measured
   * against what the lanes run (deployed.ts). Read once per project and
   * again whenever the live line says the picture changed — a board that
   * asked /api/v1/system on every move would gather for nothing.
   */
  const [picture, setPicture] = useState<Map<string, SystemCard>>(new Map());
  // Three views of the same facts: the board answers "what is to be done",
  // the map "where has the work gone", the pulse "how are we doing". Same
  // cards, three questions — which is why it is a switch and not three tools.
  const [view, setView] = useState<'board' | 'map' | 'pulse'>('board');
  /*
   * THE ADDRESS IS THE STATE, and the address of a card is `/MDLA-2`.
   *
   * It was `/?card=MDLA-2`, which is a state smuggled into a query string:
   * every link that left the house pointed at a bounce, and the crawler had
   * a second address of its own. One segment, no query, and the same link for
   * a person and for a preview.
   *
   * `?card=` is still read once — links written under the old address are in
   * chats that nobody can edit — and then quietly replaced.
   */
  const [openKey, setOpenKey] = useState<string | null>(() => {
    const path = window.location.pathname.match(/\/([A-Z]{2,8}-\d{1,7})$/);
    if (path) return path[1];
    return new URLSearchParams(window.location.search).get('card');
  });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  /*
   * The coarse axis above the modules. Thirty-six modules answer "where in
   * the repository"; "show me the Studio" is a question about one of the four
   * things that live there. The area of a module comes with the vocabulary —
   * derived from paths, or declared by the project — and a card's area is
   * the area of its modules. Nothing is typed.
   */
  const [areaFilter, setAreaFilter] = useState('');
  const [areaOfModule, setAreaOfModule] = useState<Record<string, string>>({});
  // The second axis. The module says WHERE in the repository, the craft says
  // WHICH TRADE — and "show me everything about the GPU" is a question the
  // board could not answer, although every card carried the answer.
  const [craftFilter, setCraftFilter] = useState('');
  const [crafts, setCrafts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [legend, setLegend] = useState(false);
  // The header does not fit a phone screen: project, search, three filters,
  // three views, five more buttons. Board/Map/Pulse and "+ Card" are how you
  // GET somewhere and stay reachable always; the rest (filters, legend,
  // settings, language, standing) folds behind one button on a narrow screen.
  const [menuOpen, setMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileColumn, setMobileColumn] = useState<State>('ready');
  const [loading, setLoading] = useState(true);
  const cardRequest = useRef(0);
  const scope = useRef('');
  const currentScope = JSON.stringify([project, search, moduleFilter, craftFilter, areaFilter]);
  scope.current = currentScope;
  const activeProject = useRef(project);
  activeProject.current = project;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const resetFilters = () => { setSearch(''); setAreaFilter(''); setModuleFilter(''); setCraftFilter(''); };
  const filterCount = [search, areaFilter, moduleFilter, craftFilter].filter(Boolean).length;

  // Opening and closing writes the address along, without reloading the page
  // — and the browser's back button closes the sheet, as it should.
  const open = useCallback((key: string | null) => {
    setOpenKey(key);
    if (key) setProject(key.split('-')[0]);
    const url = new URL(window.location.href);
    url.searchParams.delete('card');
    url.pathname = key ? cardHref(key) : `${mountPath()}/`;
    window.history.pushState({ card: key }, '', url);
  }, []);

  useEffect(() => {
    const back = () => {
      const path = window.location.pathname.match(/\/([A-Z]{2,8}-\d{1,7})$/);
      setOpenKey(path ? path[1] : new URLSearchParams(window.location.search).get('card'));
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  useEffect(() => {
    readMe()
      .then((who) => { setMe(who); setSignedIn(true); return readProjects(); })
      .then((list) => {
        setProjects(list);
        setProject((now) => { const wanted = openKey?.split('-')[0] ?? now; return list.some((p) => p.key === wanted) ? wanted : list[0]?.key ?? ''; });
      })
      .catch((e) => (e instanceof NotSignedIn ? setSignedIn(false) : setError(String(e.message ?? e))));
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    localStorage.setItem('gradula.project', project);
    const request = ++cardRequest.current;
    setLoading(true); setError(null);
    readCards(project, { q: search || undefined, module: moduleFilter || undefined, stack: craftFilter || undefined, area: areaFilter || undefined })
      .then((fresh) => {
        if (scope.current !== currentScope || request !== cardRequest.current) return;
        const moved = changedBetween(previous.current, fresh);
        previous.current = fresh;
        setCards(fresh);
        if (moved.size) {
          setJustChanged(moved);
          setTimeout(() => setJustChanged(new Set()), IMPULSE_MS);
        }
      })
      .catch((e) => { if (scope.current === currentScope && request === cardRequest.current) setError(String(e.message ?? e)); })
      .finally(() => { if (scope.current === currentScope && request === cardRequest.current) setLoading(false); });
  }, [project, search, moduleFilter, craftFilter, areaFilter, currentScope]);

  // While typing, do not ask on every character: a search that starts thirty
  // times in a row is slower than one that waits once.
  useEffect(() => {
    const clock = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(clock);
  }, [load, search]);

  const loadPicture = useCallback(() => {
    if (!project) return;
    readSystem(project)
      .then((doc) => { if (activeProject.current === project) setPicture(new Map((doc.cards ?? []).map((card) => [card.key, card]))); })
      .catch(() => { if (activeProject.current === project) setPicture(new Map()); });
  }, [project]);

  // The long line. It says only THAT something moved; the reading happens
  // through the door that knows the rights. Bundled, so that ten moves in one
  // second do not become ten queries. A changed picture reloads the cards
  // too: the notes that fill a chip are written while it is gathered.
  //
  // A WIPE is the one move that is not a move (src/live.mjs, from
  // wipeProject): every card, link and chronicle line of the project is gone.
  // The columns empty at once and everything the board holds beside the
  // cards — bonds, the picture, the memory of what changed — goes with them;
  // a tab that kept showing wiped cards until somebody pressed reload was
  // showing a board that no longer existed.
  useEffect(() => {
    if (!project) return;
    let clock: ReturnType<typeof setTimeout> | null = null;
    const stop = liveLine(project, (event) => {
      if (event.verb === 'wipe') {
        if (clock) { clearTimeout(clock); clock = null; }
        previous.current = [];
        setCards([]);
        setJustChanged(new Set());
        setBonds([]);
        setPicture(new Map());
        load();
        return;
      }
      if (clock) return;
      clock = setTimeout(() => { clock = null; load(); }, 400);
    }, () => {
      loadPicture();
      if (clock) return;
      clock = setTimeout(() => { clock = null; load(); }, 400);
    });
    return () => { if (clock) clearTimeout(clock); stop(); };
  }, [project, load, loadPicture]);

  useEffect(() => {
    if (!project) return;
    readVocabulary(project)
      .then((v) => {
        if (activeProject.current !== project) return;
        setModules(v.map((m) => m.id));
        setAreaOfModule(Object.fromEntries(v.map((m) => [m.id, m.area ?? m.id])));
      })
      .catch(() => { if (activeProject.current === project) { setModules([]); setAreaOfModule({}); } });
    setCards([]); previous.current = []; setBonds([]); setPicture(new Map()); setStanding(null);
    setAreaFilter('');
    readLinks(project).then((value) => { if (activeProject.current === project) setBonds(value); }).catch(() => {});
    readStanding(project).then((value) => { if (activeProject.current === project) setStanding(value); }).catch(() => {});
    setModuleFilter('');
    setCraftFilter('');
    loadPicture();
  }, [project, loadPicture]);

  /*
   * The crafts on offer are the crafts in use — the spec knows fifteen and
   * this board uses six, and a menu of nine empty answers is a menu nobody
   * opens twice.
   *
   * Not while a craft is chosen: the list would shrink to the one thing
   * already chosen, and then there would be no way back to the others.
   */
  useEffect(() => {
    if (filterCount) return;
    setCrafts([...new Set(cards.flatMap((c) => c.stack))].sort());
  }, [cards, filterCount]);

  /*
   * What this board already knows about itself — no extra request, and both
   * lists grow on their own: every commit `gradula sync` reads adds the files
   * it touched, and every card somebody is given adds a name.
   */
  const people = useMemo(
    () => [...new Set(cards.map((c) => c.person).filter((n): n is string => Boolean(n)))].sort(),
    [cards],
  );
  const knownPaths = useMemo(
    () => [...new Set([...cards.flatMap((c) => c.files ?? []), ...modules])].sort().slice(0, 300),
    [cards, modules],
  );
  // The areas on offer, busiest first; and inside a chosen area only its own
  // modules — a menu of thirty-six where four apply is a menu nobody reads.
  const areas = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of modules) { const a = areaOfModule[m] ?? m; count.set(a, (count.get(a) ?? 0) + 1); }
    return [...count.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([a]) => a);
  }, [modules, areaOfModule]);
  const shownModules = useMemo(
    () => (areaFilter ? modules.filter((m) => (areaOfModule[m] ?? m) === areaFilter) : modules),
    [modules, areaOfModule, areaFilter],
  );

  if (signedIn === false) return <Door />;

  if (signedIn === null) return <main className="door" aria-busy={!error}><div className="card-door"><h1>{t('ui.app')}</h1><p role={error ? 'alert' : 'status'}>{error ?? t('ui.loading')}</p>{error ? <button onClick={() => window.location.reload()}>{t('ui.retry')}</button> : null}</div></main>;

  return (
    <>
      <header className="head">
        {projects.length > 1 ? <select className="project-switch" aria-label={t('ui.project')} value={project} onChange={(e) => { open(null); setProject(e.target.value); resetFilters(); }}>
          {projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select> : <strong className="project-name">{projects[0]?.name ?? t('ui.app')}</strong>}
        <input className="search" type="search" aria-label={t('nav.search')} placeholder={t('nav.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <nav className="views" aria-label={t('ui.views')}>
          {(['board', 'map', 'pulse'] as const).map((one) => <button key={one} aria-pressed={view === one} className={view === one ? 'view here' : 'view'} onClick={() => setView(one)}>{t(`nav.${one}`)}</button>)}
        </nav>
        <button className="primary new-action" disabled={!project} onClick={() => setCreating(true)}><Icon name="plus" />{t('ui.newCard')}</button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="head-toggle icon-button" aria-label={t('nav.menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="more" /></button>
          {menuOpen ? <div className="head-extra open">
            <button onClick={() => { setSettings(true); setMenuOpen(false); }} disabled={!project}>{t('nav.settings')}</button>
            <button onClick={() => { setLegend(true); setMenuOpen(false); }}>{t('nav.legend')}</button>
            <LanguageSwitch />
            <span className="who">{me?.kind === 'human' ? me.name : ''}</span>
          </div> : null}
        </div>
      </header>
      <div className="workspace-toolbar">
        <div className="workspace-context"><span>{t(`nav.${view}`)}</span><span className="small" role="status">{loading ? t('ui.loading') : `${cards.length} ${t('map.cards')}`}</span></div>
        {standing && standing.standing !== 'unknown' ? <span className={STAND_CLASS[standing.standing] ?? 'standing'} title={standing.line}>{standing.standing}</span> : null}
        {view !== 'pulse' ? <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filter" />{t('ui.filters')}{filterCount ? ` · ${filterCount}` : ''}</button> : null}
        {filterCount && view !== 'pulse' ? <button className="ghost" onClick={resetFilters}>{t('ui.clearFilters')}</button> : null}
      </div>
      {filtersOpen && view !== 'pulse' ? <div className="filter-bar">
        <label>{t('ui.area')}<select value={areaFilter} onChange={(e) => { setAreaFilter(e.target.value); setModuleFilter(''); }}><option value="">{t('nav.allAreas')}</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
        <label>{t('ui.module')}<select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}><option value="">{t('nav.allModules')}</option>{shownModules.map((module) => <option key={module} value={module}>{module}</option>)}</select></label>
        <label>{t('ui.craft')}<select value={craftFilter} onChange={(e) => setCraftFilter(e.target.value)}><option value="">{t('nav.allCrafts')}</option>{crafts.map((craft) => <option key={craft} value={craft}>{craft}</option>)}</select></label>
      </div> : null}
      {error ? <div className="error" role="alert">{error}<button onClick={load}>{t('ui.retry')}</button></div> : null}
      {!project ? <div className="empty-state"><h2>{t('ui.noProjects')}</h2><p>{t('ui.noProjectsWhy')}</p></div> : null}
      {!loading && !cards.length && project && view !== 'pulse' ? <div className="board-notice"><strong>{t(filterCount ? 'ui.noResults' : 'ui.emptyBoard')}</strong><span>{t(filterCount ? 'ui.noResultsWhy' : 'ui.emptyBoardWhy')}</span>{filterCount ? <button onClick={resetFilters}>{t('ui.clearFilters')}</button> : <button onClick={() => setCreating(true)}>{t('ui.newCard')}</button>}</div> : null}
      {view === 'board' ? <nav className="column-tabs" aria-label={t('ui.stages')}>
        {COLUMN_NAMES.map((column) => <button key={column.state} aria-pressed={mobileColumn === column.state} onClick={() => setMobileColumn(column.state)}>{column.name}<span>{cards.filter((card) => card.state === column.state).length}</span></button>)}
      </nav> : null}

      {view === 'pulse' ? <PulseView key={`pulse:${project}`} project={project} open={open} /> : view === 'map' ? <AreaMap key={`map:${project}`} cards={cards} open={open} areaOfModule={areaOfModule} /> : (
      <div className="board" aria-busy={loading}>
        {COLUMN_NAMES.map((column) => {
          const inside = cards.filter((k) => k.state === column.state);
          const groups = group(inside, parentsFrom(bonds), new Map(cards.map((card) => [card.key, card.title])));
          return (
            <section className="column" key={column.state} data-selected={mobileColumn === column.state}>
              <header><h2>{column.name}</h2><span className="number">{inside.length}</span></header>
              <div className="column-inside">
                {!inside.length ? <p className="column-empty">{t(`empty.${column.state}`)}</p> : null}
                {groups.map((g) => (
                  <Bond key={g.cards[0].key} group={g} open={open} justChanged={justChanged} picture={picture} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      )}

      {openKey ? (
        <Sheet key={`${project}:${openKey}`} project={project} cardKey={openKey} close={() => open(null)} changed={load} people={people} knownPaths={knownPaths}
          repo={projects.find((p) => p.key === project)?.repo ?? null} picture={picture.get(openKey) ?? null} />
      ) : null}
      {legend ? <Legend close={() => setLegend(false)} /> : null}
      {settings ? <Settings key={`settings:${project}`} project={project} close={() => setSettings(false)} /> : null}
      {creating ? <NewCard key={`new:${project}`} project={project} done={() => { setCreating(false); load(); }} cancel={() => setCreating(false)} /> : null}
    </>
  );
}
