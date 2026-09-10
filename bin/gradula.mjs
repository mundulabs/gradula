#!/usr/bin/env node
/**
 * The hand: the same doors as the board, only from the keyboard.
 *
 * It holds NO truth of its own. Everything goes through the API, so that
 * there is no way to write past the rules — a CLI that wrote into a database
 * itself would be the second place where things are decided.
 *
 * A project brings three lines (`.gradula.env` in the repo, or the environment):
 *   GRADULA_URL=https://gradula.mundula.app
 *   GRADULA_TOKEN=grad_pat_…          the person's key — `gradula login` writes it
 *   GRADULA_AGENT_TOKEN=grad_pat_…    the key AI sessions take — written beside it
 *
 * Both keys ARE the person who approved the machine; only the hand in the
 * chronicle differs: `david (Davids-MacBook-Pro)` and `david (Claude Code ·
 * Davids-MacBook-Pro)`. An older `GRADULA_ACTOR` line is a claim, not a
 * credential — it stands in the chronicle as exactly that, and an owned key
 * ignores it.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { hostname } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { allGates, gateLine } from '../src/gates.mjs';
import { KINDS, ladderOf, agentKeyName } from '../src/spec.mjs';
import { config, handOf, mergeEnv } from '../src/hand.mjs';
import { cardOfBranch } from '../src/ids.mjs';

const HELP = `gradula — wish, board, standing

  gradula cards [--state ready] [--kind task] [--module panels] [--area studio] [--q word]
  gradula new [<kind>] "<title>" [--text "…"]   kinds: idea, task, venture, milestone, decision
                      [--gate test:tests/x.test.mjs] [--person david] [--file path]
  gradula show <CARD>
  gradula approve <CARD>           the review says yes — done, with a reason
  gradula reject <CARD> "what is missing" back to making, and the sentence is the reason
  gradula move <CARD> <ideas|ready|making|review|done|ice> [--reason "…"]
  gradula confirm <CARD>…          take over the labels a rule proposed (a hand's call)
  gradula start <CARD> [--tree]    --tree creates a branch and a worktree
                 [--anyway "why"]  start a card that waits on another — the sentence is the reason
  gradula link <CARD> <needs|blocks|part-of|resembles|touches> <CARD>
  gradula sync [--since <ref>]     send commits carrying "Plan: CARD" as evidence
  gradula gates [--commands]       run the gates; green moves the card to done
  gradula wave [<VENTURE>]         what can go side by side right now
  gradula heralds                  who speaks outward, and about what
  gradula herald --template <name> --chat <id> --token <t>
                 [--every daily|weekly --hour 7]   a report that comes by itself (UTC)
  gradula herald probe|drop <id>
  gradula publish|unpublish <CARD> what may leave the house
  gradula relabel                  run the label rules over old cards:
                                 an empty axis is filled, a touched one is asked
  gradula suggestions              what the cartographer sees (it changes nothing)
  gradula work <CARD> [-- <cmd>]   say you are working; the board shows it live
  gradula github [<CARD>]          what hangs on a card in GitHub; without a card: connect
                 --repo owner/name --token <read token>
  gradula health [--quiet 14]      what is wrong with the board itself — no score
  gradula goals                    milestones, their coverage, the nearest date first
  gradula pulse [--since ISO]      the five questions: what happened, where to,
                                 in time?, where the energy went, what it hangs on
  gradula due <CARD> <YYYY-MM-DD>  a date on a milestone or a venture ("none" clears)
  gradula standing                 where things have arrived (reads Dokploy)
  gradula app [--app @acc/slug --token <expo token>]
                                 where the APP has arrived (reads EAS)
  gradula dokploy --base <api> --token <key> --compose <id> [--compose-dev <id>]
  gradula sentry [--org <org> --project <slug>] [--base eu|us] [--token <t>]
                 [--hook-secret <s>] [--write-back [off]]
                 [--environments prod,dev|all|default]   which Sentry environments become cards
  gradula system                   ONE picture: deployments, builds, updates,
                                 pipeline, releases, errors, people — and what is not seen
  gradula history [--after N]      what happened while you were away
  gradula report [--plain] [--period "…"] [--milestone GRD-43] [--send]
  gradula chats                    which channels the heralds can see
  gradula vocabulary [push]        read this repo's modules (and send them)
  gradula hook [off]               evidence lands on every commit, by itself
  gradula login [--project MDLA]   register THIS machine — the board mints two keys (yours, and
                                 one for the AI sessions here), no copy-paste
  gradula project [--alias "david=David Bläsing"] [--language de|en]
                                 which names mean the same person ("none" clears)
                                 and which language the CARDS are written in

Environment: GRADULA_URL, GRADULA_TOKEN, GRADULA_ACTOR (or .gradula.env — gradula login writes it)
             GRADULA_AGENT_TOKEN  the key AI sessions take — same person, its own hand in the
                                  chronicle ("Claude Code · <machine>"); gradula login writes it too
             GRADULA_HAND=agent|person  say which hand this is, if the environment does not`;

const env = config();
const base = (env.GRADULA_URL ?? 'http://127.0.0.1:3200').replace(/\/+$/, '');
// Which hand: a person at the terminal, or a session that runs the CLI for
// one. Same actor, its own key — the chronicle says "via" which.
const hand = handOf(env);

async function call(path, { method = 'GET', body } = {}) {
  if (!hand.token) stop('No GRADULA_TOKEN — nothing happens here without a project key.');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${hand.token}`,
      ...(hand.actor ? { 'X-Gradula-Actor': hand.actor } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((cause) => stop(`${base} does not answer (${cause.message}).`));
  const payload = await res.json().catch(() => null);
  if (!res.ok) stop(`${payload?.error ?? res.status}: ${payload?.line ?? 'unknown'}`);
  return payload;
}

function stop(line) {
  console.error(line);
  process.exit(1);
}

/** `--name value` and `--name` as a switch; everything else is a word. */
function args(list) {
  const flags = {};
  const words = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item.startsWith('--')) {
      const name = item.slice(2);
      const next = list[i + 1];
      if (next && !next.startsWith('--')) { flags[name] = next; i += 1; } else flags[name] = true;
    } else words.push(item);
  }
  return { flags, words };
}

/**
 * A card key, as something a terminal can open.
 *
 * OSC 8 is the terminal's own hyperlink: iTerm2, WezTerm, Ghostty, VS Code and
 * modern GNOME Terminal make it clickable, and everything else prints the text
 * and ignores the escape — which is why the KEY stays the visible text and the
 * address is only underneath. Nothing is lost on a terminal that cannot.
 *
 * Only when this is a terminal: piped into a file or another program, the
 * escape would end up in the data.
 */
const link = (text, url) => (process.stdout.isTTY && url
  ? `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`
  : text);

/** Where a card lives for a person: the board, with the card open. */
const onBoard = (key) => `${base}/${key}`;

const dot = (item) => {
  // The ladder instead of one mark: five rungs say where a card stands, and
  // a session can copy them beside a link — "[MDLA-71](…) ■■▩□□".
  const mark = ladderOf(item.state);
  // Module and stack are TWO AXES and must not go into one bracket. Measured
  // on 09.09.: because both stood together I took `infra` for a module and
  // the cartographer for broken — it was right, the display lied. Modules in
  // brackets (where in the build), stacks bare beside them (which kind of work).
  const module = item.module.length ? `[${item.module.join(' ')}]` : '';
  const stack = item.stack.filter((x) => !item.module.includes(x)).join(' ');
  const labels = [module, stack].filter(Boolean).join(' ');
  const blockedBy = item.blockedBy?.length ? `  ⟂ ${item.blockedBy.join(' ')}` : '';
  // A small "prod" behind a card that production has been seen carrying —
  // from the chronicle's `deployed` notes, no network (deployed.mjs).
  const prod = item.deployed?.production ? '  prod' : '';
  return `${mark} ${link(item.key, onBoard(item.key)).padEnd(process.stdout.isTTY ? 10 + link('', onBoard(item.key)).length : 10)} ${item.title}${labels ? `  ${labels}` : ''}${prod}${blockedBy}`;
};

/**
 * "deployed: dev 10:41 · production —": the clock of the day when it is
 * today, the day before the clock when it is not, a dash when a lane has
 * never been seen carrying the card.
 */
const clockOf = (at, today = new Date()) => {
  if (!at) return '—';
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '—';
  const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const sameDay = when.toDateString() === today.toDateString();
  return sameDay ? hhmm : `${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${hhmm}`;
};
const deployedLine = (deployed) => `deployed: dev ${clockOf(deployed?.at?.development)} · production ${clockOf(deployed?.at?.production)}`;

/**
 * The vocabulary from THIS repo — Gradula never reads it itself. The
 * workspaces say which packages exist; the last part of their path is the
 * module id, because `packages/native/hand` is `hand` and not `native`.
 */
function vocabularyOf(root = process.cwd()) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) stop(`No package.json in ${root} — there is no vocabulary to read here.`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const globs = pkg.workspaces ?? [];
  const module = new Map();

  for (const glob of globs) {
    const parts = String(glob).split('/');
    const star = parts.indexOf('*');
    if (star === -1) { const id = basename(glob); module.set(id, { id, paths: [glob], words: [] }); continue; }
    const dir = join(root, ...parts.slice(0, star));
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const relative = [...parts.slice(0, star), entry.name].join('/');
      if (!existsSync(join(root, relative, 'package.json'))) continue;
      const id = entry.name.toLowerCase();
      const found = module.get(id) ?? { id, paths: [], words: [] };
      found.paths.push(relative);
      module.set(id, found);
    }
  }
  for (const extra of ['tools', 'infra', 'docs', 'tests']) {
    if (existsSync(join(root, extra))) module.set(extra, { id: extra, paths: [extra], words: [] });
  }
  /*
   * THE AREAS A PROJECT DECLARES. By default an app is its own area and
   * everything else is the first segment of its path — which calls the kit
   * "packages". A project that has a word for it says so in its package.json:
   *
   *   "gradula": { "areas": { "kit": ["packages", "tools", "tests"], "studio": ["apps/mundula"] } }
   *
   * Declared here and not on the board, because the paths are here; the
   * board only ever sees the result.
   */
  const declared = Object.entries(pkg.gradula?.areas ?? {});
  const areaFor = (paths) => {
    for (const [area, prefixes] of declared) {
      for (const prefix of [].concat(prefixes)) {
        const clean = String(prefix).replace(/^\/+|\/+$/g, '');
        if (paths.some((p) => p === clean || p.startsWith(clean + '/'))) return String(area).toLowerCase();
      }
    }
    return undefined;
  };
  return [...module.values()]
    .map((one) => { const area = areaFor(one.paths); return area ? { ...one, area } : one; })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const [command, ...rest] = process.argv.slice(2);
const { flags, words } = args(rest);

switch (command) {
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;

  case 'project': {
    // `--alias "david=David Bläsing"` — which names mean the same person.
    // Declared, never guessed: a board that folds similar spellings together
    // will one day put two people's work under one name, and nothing about it
    // looks wrong. `--alias none` clears the lot.
    if (typeof flags.language === 'string') {
      const after = await call('/api/v1/project', { method: 'PATCH', body: { language: flags.language === 'none' ? null : flags.language } });
      console.log(`Cards are written in: ${after.language ?? 'whatever the writer picks'}`);
      break;
    }
    const claimed = [flags.alias].flat().filter((x) => typeof x === 'string');
    if (claimed.length) {
      const people = {};
      if (claimed.length === 1 && claimed[0] === 'none') { /* cleared */ } else {
        for (const one of claimed) {
          const at = one.indexOf('=');
          if (at < 1) stop(`--alias needs the form "from=to" (got ${one}).`);
          people[one.slice(0, at).trim()] = one.slice(at + 1).trim();
        }
      }
      const after = await call('/api/v1/project', { method: 'PATCH', body: { people } });
      const rows = Object.entries(after.people ?? {});
      console.log(rows.length ? rows.map(([from, to]) => `  ${from} → ${to}`).join('\n') : 'No aliases.');
      break;
    }
    const project = await call('/api/v1/project');
    console.log(`${project.key} — ${project.name}${project.repo ? ` (${project.repo})` : ''}`);
    if (project.language) console.log(`Cards are written in: ${project.language}`);
    const rows = Object.entries(project.people ?? {});
    if (rows.length) {
      console.log('\nOne person, one name:');
      for (const [from, to] of rows) console.log(`  ${from} → ${to}`);
    }
    break;
  }

  case 'cards': {
    const query = new URLSearchParams();
    for (const name of ['state', 'kind', 'module', 'stack', 'area', 'person', 'q', 'limit']) {
      if (typeof flags[name] === 'string') query.set(name, flags[name]);
    }
    const cards = await call(`/api/v1/cards${query.size ? `?${query}` : ''}`);
    if (!cards.length) { console.log('Nothing here.'); break; }
    for (const card of cards) console.log(dot(card));
    break;
  }

  case 'new': {
    // `gradula new "Title"` and `gradula new task "Title"` are both allowed —
    // the second form types itself, and whoever did not know it would have
    // created the kind as the title. That is exactly what happened eight
    // times on 09.09.: the surplus word was swallowed silently and eight
    // cards were called "decision" and "task". A command that keeps quiet
    // about an argument is worse than one that stops.
    let [title, ...rest] = words;
    let kind = flags.kind;
    if (words.length > 1 && KINDS.includes(title)) { kind = kind ?? title; [title, ...rest] = rest; }
    if (!title) stop('gradula new "<title>"  ·  gradula new <kind> "<title>"');
    if (rest.length) {
      error(kind
        ? `Too many words: ${rest.map((w) => `"${w}"`).join(', ')}. The title belongs in ONE pair of quotes.`
        : `"${title}" is not a kind — there are ${KINDS.join(', ')}. You probably meant: gradula new <kind> "${rest.join(' ')}"`);
    }
    if (kind && !KINDS.includes(kind)) stop(`"${kind}" is not a kind. There are: ${KINDS.join(', ')}. You probably meant: gradula new <kind> "${rest.join(' ')}"`);
    const gate = typeof flags.gate === 'string'
      ? (() => { const i = flags.gate.indexOf(':'); return i < 0 ? stop('--gate kind:call, e.g. test:tests/x.test.mjs') : { kind: flags.gate.slice(0, i), call: flags.gate.slice(i + 1) }; })()
      : undefined;
    const card = await call('/api/v1/cards', {
      method: 'POST',
      body: {
        title,
        kind: kind ?? 'idea',
        text: flags.text ?? '',
        person: flags.person,
        gate,
        target: flags.target,
        runner: flags.runner,
        files: typeof flags.file === 'string' ? [flags.file] : undefined,
      },
    });
    console.log(`${card.key} created — ${[...new Set([...card.module, ...card.stack])].join(', ') || 'no label'}`);
    // A nudge, not a demand: a decision needs no gate, a venture has a better
    // one (its parts). A TASK without a gate never moves to done by itself —
    // and whoever only reads that at the start has already begun.
    if (card.kind === 'task' && !card.gate) {
      console.log('Without a gate this card never reaches done on its own.');
      console.log(`  gradula new … --gate test:tests/x.test.mjs   ·   or add it in the sheet`);
    }
    if (card.links?.length) console.log(`  touches: ${card.links.join(', ')}`);
    break;
  }

  case 'show': {
    const card = await call(`/api/v1/cards/${String(words[0] ?? '').toUpperCase()}`);
    console.log(`${link(card.key, onBoard(card.key))}  ${card.title}`);
    console.log(`  ${card.kind} · ${card.state}${card.person ? ` · ${card.person}` : ''} · runner: ${card.runner}`);
    if (card.module.length) console.log(`  Module: ${card.module.join(', ')}`);
    const onlyStack = card.stack.filter((x) => !card.module.includes(x));
    if (onlyStack.length) console.log(`  Craft: ${onlyStack.join(', ')}`);
    if (card.suggestions?.module?.length || card.suggestions?.stack?.length) {
      console.log(`  Suggestions: ${[...card.suggestions.module, ...card.suggestions.stack].join(', ')} (unconfirmed)`);
    }
    if (card.gate) console.log(`  Gate: ${card.gate.kind} ${card.gate.call}${card.gate.expect ? ` → ${card.gate.expect}` : ''}`);
    if (card.blockedBy.length) console.log(`  blockedBy from: ${card.blockedBy.join(', ')}`);
    console.log(`  ${deployedLine(card.deployed)}`);
    if (card.text) console.log(`\n${card.text}\n`);
    for (const entry of card.history) console.log(`  ${String(entry.at ?? '').slice(0, 16).replace('T', ' ')}  ${entry.verb}  ${entry.actor}`);
    /*
     * WHAT TO DO NEXT, AS SOMETHING YOU CAN PRESS OR PASTE.
     *
     * A terminal has no buttons, so the two answers a review has are printed
     * as the two commands that give them — and the key above opens the board
     * where a terminal can follow a link. Only where there IS a decision: a
     * card in `ready` gets no prompt, because pressing anything there is not
     * what the board is waiting for.
     */
    if (card.state === 'review') {
      console.log(`\n  gradula approve ${card.key}`);
      console.log(`  gradula reject ${card.key} "what is still missing"`);
    } else if (card.state === 'ready' && !card.blockedBy.length) {
      console.log(`\n  gradula start ${card.key} --tree`);
    } else if (card.state === 'ready') {
      console.log(`\n  gradula start ${card.key} --anyway "why, although it waits on ${card.blockedBy.join(', ')}"`);
    } else if (card.state === 'ideas') {
      console.log(`\n  gradula move ${card.key} ready     the yes — then start`);
    }
    console.log(`\n  ${link('open on the board', onBoard(card.key))}${process.stdout.isTTY ? '' : `: ${onBoard(card.key)}`}`);
    break;
  }

  /*
   * A proposal becomes a label. The board had this door ("take over") and the
   * keyboard did not — so six cards beamed "needs a hand" for a week, because
   * the hand that reads `gradula health` had nowhere to put it. Several keys
   * at once, because a hand that agrees with the rule agrees with it for the
   * whole list, not one card at a time.
   */
  case 'confirm': {
    const keys = words.map((w) => String(w).toUpperCase()).filter(Boolean);
    if (!keys.length) stop('gradula confirm <CARD> [<CARD>…]');
    for (const key of keys) {
      const card = await call(`/api/v1/cards/${key}/confirm`, { method: 'POST' });
      const labels = [card.module.length ? `[${card.module.join(' ')}]` : '', card.stack.filter((x) => !card.module.includes(x)).join(' ')].filter(Boolean).join('  ');
      console.log(`${card.key.padEnd(10)} ${labels || '(no label)'}`);
    }
    break;
  }

  case 'move': {
    const card = await call(`/api/v1/cards/${String(words[0] ?? '').toUpperCase()}/move`, {
      method: 'POST', body: { state: words[1], reason: flags.reason ?? null },
    });
    console.log(`${card.key} → ${card.state}`);
    break;
  }

  case 'start': {
    const key = String(words[0] ?? '').toUpperCase();
    // A blocked card opens only with a reason, and the reason is a sentence
    // — `--anyway` alone is a shrug, and the door refuses a shrug.
    const anyway = typeof flags.anyway === 'string' ? flags.anyway : null;
    const card = await call(`/api/v1/cards/${key}/start`, { method: 'POST', body: anyway ? { anyway } : {} });

    // The warnings first: whoever reads them under the brief has already begun.
    if (card.blockedBy.length) console.log(`CAREFUL: ${key} waits on ${card.blockedBy.join(', ')}`);
    // Which language this board writes its cards in. It stands HERE because
    // this is the last thing anybody reads before they write — a setting
    // nobody sees at the moment of writing is a setting nobody follows.
    const speaks = await call('/api/v1/project').then((p) => p.language).catch(() => null);
    if (speaks) console.log(`Write on this board in: ${speaks}`);
    for (const warning of card.warnings ?? []) {
      console.log(`CAREFUL: ${warning.card} is touching the same files right now — ${warning.files.join(', ')}`);
    }

    /**
     * A tree of its own per card. The pattern already stands next door
     * (.worktrees/… with a branch per venture): two moves in one tree see
     * each other's changes and report foreign test failures.
     */
    if (flags.tree) {
      const branch = `plan/${key}`;
      const place = join('.worktrees', 'plan', key);
      try {
        if (!existsSync(place)) {
          const zweige = execFileSync('git', ['branch', '--list', branch], { encoding: 'utf8' }).trim();
          execFileSync('git', zweige ? ['worktree', 'add', place, branch] : ['worktree', 'add', place, '-b', branch], { stdio: 'pipe' });
        }
        console.log(`Worktree: ${place} (Zweig ${branch})`);
      } catch (error) {
        console.error(`No worktree: ${String(error.stderr ?? error.message).trim().split('\n').pop()}`);
      }
    }

    console.log(`\n── Brief ${card.key} ──────────────────────────────`);
    console.log(card.title);
    if (card.text) console.log(`\n${card.text}`);
    const labels = [...new Set([...card.module, ...card.stack])];
    if (labels.length) console.log(`\nLabels: ${labels.join(', ')}`);
    if (card.files?.length) console.log(`Files: ${card.files.join(', ')}`);
    if (card.links?.length) console.log(`Links: ${card.links.map((f) => `${f.kind} ${f.to ?? f.from}`).join(', ')}`);
    console.log(card.gate
      ? `\nGate: ${card.gate.kind} ${card.gate.call}${card.gate.expect ? ` → ${card.gate.expect}` : ''}`
      : '\nGate: NONE. Without a gate this card never reaches done on its own — write one before you start.');
    console.log(`\nWhen it stands: commit with the line  Plan: ${card.key}`);
    console.log('────────────────────────────────────────────────────');
    break;
  }

  case 'link': {
    const [from, kind, to] = words;
    const link = await call('/api/v1/links', {
      method: 'POST',
      body: { from: String(from ?? '').toUpperCase(), to: String(to ?? '').toUpperCase(), kind },
    });
    console.log(`${link.from} ${link.kind} ${link.to}`);
    break;
  }

  /**
   * The way back: what stands in the history becomes evidence on the card.
   *
   * The bracket is the line `Plan: MDLA-142` in the commit message — it is
   * the only thing a commit can say about a card without somebody keeping a
   * second list. Gradula does not take the same evidence twice.
   */
  case 'sync': {
    const since = typeof flags.since === 'string' ? `${flags.since}..HEAD` : '-50';
    let history = '';
    try {
      // `--name-only` appends the touched paths after the body, and the
      // record separator keeps them attached to their commit. This is where
      // a card's `files` come from: nobody types them, and the commit knows.
      history = execFileSync('git', ['log', since, '--name-only', '--format=%x1e%H%x1f%s%x1f%an%x1f%ae%x1f%b%x1f'], { encoding: 'utf8' });
    } catch (cause) {
      stop(`No history to read: ${String(cause.stderr ?? cause.message).trim().split('\n').pop()}`);
    }

    // The branch already knows the card. `gradula start MDLA-3 --tree` creates
    // `plan/MDLA-3` — whoever works on it should not have to type the line as
    // well. Only this one form counts; guessing from arbitrary branch names is
    // the path on which evidence lands on the wrong card.
    let onBranch = null;
    try {
      onBranch = cardOfBranch(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim());
    } catch { /* no branch, no harm */ }

    const found = new Map();
    const add = (card, hash, title, author, email, files) => {
      if (!found.has(card)) found.set(card, []);
      found.get(card).push({ hash: hash.trim().slice(0, 12), title: (title ?? '').trim(), author, email, files });
    };
    for (const entry of history.split('\x1e')) {
      const [hash, title, author, email, body, paths] = entry.split('\x1f');
      // Everything after the last separator is `--name-only`: one path per
      // line, blank lines where a merge commit has none.
      const files = String(paths ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
      if (!hash?.trim()) continue;
      const named = [...`${title}\n${body ?? ''}`.matchAll(/^\s*Plan:\s*([A-Z]{2,8}-[0-9]{1,7})\s*$/gm)];
      if (named.length) for (const hit of named) add(hit[1].toUpperCase(), hash, title, author, email, files);
      else if (onBranch) add(onBranch, hash, title, author, email, files);
    }

    if (!found.size) {
      console.log('No commit names a card. The line reads:  Plan: MDLA-142');
      console.log('Or work on a branch that gradula start --tree created (plan/MDLA-142).');
      break;
    }
    if (onBranch) console.log(`On branch plan/${onBranch} — commits without a Plan line count for ${onBranch}.\n`);

    let fresh = 0;
    for (const [card, commits] of found) {
      for (const commit of commits) {
        const response = await call(`/api/v1/cards/${card}/evidence`, {
          method: 'POST',
          body: { kind: 'commit', ref: commit.hash, note: commit.title.slice(0, 200), author: commit.author, email: commit.email, files: commit.files },
        }).catch((e) => { console.error(`  ${card}: ${e.message ?? e}`); return null; });
        if (response?.fresh) {
          fresh += 1;
          const many = commit.files?.length ? `  (${commit.files.length} ${commit.files.length === 1 ? 'file' : 'files'})` : '';
          console.log(`${card} ← ${commit.hash}  ${commit.title.slice(0, 52)}${many}`);
        }
      }
    }
    // One is not several. A tool that says "1 new pieces of evidence" is
    // unfinished at exactly the place where you are meant to trust it.
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    console.log(`\n${count(fresh, 'new piece of evidence', 'new pieces of evidence')} on ${count(found.size, 'card', 'cards')}.`);

    // What has evidence but is not done is a QUESTION — not an action.
    const open = [];
    for (const card of found.keys()) {
      const read = await call(`/api/v1/cards/${card}`).catch(() => null);
      if (read && !['done', 'ice'].includes(read.state)) open.push(`${card} (${read.state}${read.gate ? ', gate: ' + read.gate.kind : ', no gate'})`);
    }
    if (open.length) {
      console.log(`\nEvidenced but not done — done?\n  ${open.join('\n  ')}`);
      console.log('\n  gradula move <CARD> review --reason "…"');
    }
    break;
  }

  /**
   * Run the gates. Green means done — that is not a guess but exactly what
   * the gate claimed. Red means "not yet", never "broken": the reason may be
   * a missing tool.
   */
  case 'gates': {
    const cards = await call('/api/v1/cards?limit=500');
    const withGate = cards.filter((k) => k.gate && !['done', 'ice'].includes(k.state));
    if (!withGate.length) { console.log('No open card has a gate. That is the actual news.'); break; }

    const results = await allGates(withGate, {
      root: process.cwd(),
      testCommand: env.GRADULA_TEST ?? 'npm test --',
      commandsAllowed: Boolean(flags.commands),
      report: (command) => console.log(`  $ ${command}`),
    });

    let green = 0; let red = 0; let skipped = 0;
    for (const { card, ran, green: ok, line, reason } of results) {
      if (!ran) { skipped += 1; console.log(`· ${card.key.padEnd(10)} ${reason}`); continue; }
      const mark = ok ? '✓' : '✗';
      console.log(`${mark} ${card.key.padEnd(10)} ${gateLine(card.gate)} — ${line}`);
      await call(`/api/v1/cards/${card.key}/evidence`, {
        method: 'POST',
        body: { kind: 'run', ref: `${new Date().toISOString().slice(0, 16)} ${card.gate.kind}`, note: `${ok ? 'green' : 'red'}: ${line}` },
      }).catch(() => null);
      if (ok) {
        green += 1;
        await call(`/api/v1/cards/${card.key}/move`, { method: 'POST', body: { state: 'done', reason: `gate green: ${line}` } });
        console.log(`  → done`);
      } else red += 1;
    }
    console.log(`\n${green} green · ${red} red · ${skipped} skipped`);
    if (skipped && !flags.commands) console.log('With --commands the gates that execute what the card says will run too.');
    break;
  }

  case 'relabel': {
    const found = await call('/api/v1/relabel', { method: 'POST' });
    if (!found.length) { console.log('Every open card already carries what the rules can find.'); break; }
    const shape = (l) => [l.module.length ? `[${l.module.join(' ')}]` : '', l.stack.join(' ')].filter(Boolean).join('  ');
    let filled = 0, asked = 0;
    for (const one of found) {
      const set = shape(one.set), ask = shape(one.asked);
      if (set) filled += 1;
      if (ask) asked += 1;
      console.log(`${one.card.padEnd(9)} ${set}${ask ? `  ?  ${ask}` : ''}`);
    }
    console.log(`\n${filled} cards had an empty axis and it was filled — nothing was overwritten.`);
    if (asked) console.log(`${asked} carry a label already; what the rules would add stands beside it until a hand takes it.`);
    break;
  }

  case 'suggestions': {
    const seen = await call('/api/v1/suggestions');
    if (!seen.length) { console.log('The cartographer sees nothing — that is good news.'); break; }
    for (const v of seen) {
      if (v.kind === 'bundle') console.log(`~ bundle   ${v.cards.join(' ')}  (${v.reason})`);
      else console.log(`${v.confidence === 'hard' ? '=' : '~'} ${v.kind.padEnd(8)} ${v.from} ↔ ${v.to}  (${v.reason})`);
    }
    console.log(`\n${seen.length} suggestions. Confirm with:  gradula link <A> <kind> <B>`);
    break;
  }

  /**
   * The wave. It changes nothing — it says what can go at the same time.
   * The GRAPH belongs here, the LOOP to the runner, and the gate is the seam:
   * a loop without a stopping condition from outside marks its own homework.
   */
  case 'pulse': {
    const since = flags.since ? `?since=${encodeURIComponent(String(flags.since))}` : '';
    const p = await call(`/api/v1/pulse${since}`);
    const day = (iso) => String(iso).slice(0, 10);
    console.log(`${day(p.since)} → ${day(p.until)}\n`);

    console.log(`What happened — ${p.happened.touched} cards touched by ${p.happened.actors.join(', ') || 'nobody'}`);
    for (const [name, list] of [['done', p.happened.done], ['decided', p.happened.decided], ['incidents', p.happened.incidents]]) {
      if (list.length) console.log(`  ${name}: ${list.map((r) => r.card).join(' ')}`);
    }

    console.log(`\nPace — ${p.pace.settled} settled in ${p.pace.days} days (${p.pace.perDay.toFixed(2)}/day, from ${p.pace.sample} moves)`);

    if (p.goals.length) {
      console.log('\nWhere we are going');
      for (const g of p.goals) {
        // `share` and `verdict` both go quiet when there are no parts. Saying
        // it twice reads like a stutter, so the share stands only when there
        // is one.
        const share = g.share === null ? '' : `${Math.round(g.share * 100)} %`;
        const when = g.due ? ` · ${g.due}` : '';
        const say = {
          ahead: 'in time', tight: 'tight', behind: 'behind', 'no date': 'no date',
          'no pace': 'no pace yet', 'no parts': 'no parts', settled: 'settled',
        }[g.outlook.verdict] ?? g.outlook.verdict;
        const numbers = g.outlook.daysNeeded !== undefined ? ` (${g.outlook.daysNeeded}d of work, ${g.outlook.daysLeft}d left)` : '';
        console.log(`  ${g.key.padEnd(10)} ${g.title}`);
        console.log(`  ${''.padEnd(10)} ${[share + when, say + numbers].filter((x) => x.trim()).join(' — ')}`);
      }
    }

    console.log('\nWhere the energy went');
    for (const [axis, list] of [['module', p.energy.module], ['craft', p.energy.stack]]) {
      const nowhere = p.energy.nowhere[axis === 'craft' ? 'stack' : 'module'];
      const line = list.slice(0, 6).map((e) => `${e.id} ${e.moves}`).join('  ') || 'nothing labelled';
      console.log(`  ${axis.padEnd(7)} ${line}${nowhere.moves ? `  ·  ${nowhere.moves} moves carry no ${axis}` : ''}`);
    }
    if (p.energy.people.length) console.log(`  people  ${p.energy.people.map((e) => `${e.person} ${e.moves}`).join('  ')}`);

    if (p.hangs.length) {
      console.log('\nWhat it hangs on');
      for (const h of p.hangs) console.log(`  ${h.card.padEnd(10)} ${h.title}  ← ${h.waiting.join(' ')}`);
    }

    const loud = p.findings.filter((f) => f.count);
    if (loud.length) {
      console.log('\nThe board itself');
      for (const f of loud) console.log(`  ${String(f.count).padStart(3)}  ${f.line}: ${f.cards.slice(0, 8).join(' ')}${f.cards.length > 8 ? ' …' : ''}`);
    }
    break;
  }

  /**
   * Where the APP has arrived — the half Dokploy cannot see. A finished build
   * is an artifact; only a submission puts it where somebody can install it,
   * and the two words stay apart here.
   */
  case 'app': {
    if (flags.app) {
      const set = await call('/api/v1/eas', { method: 'PUT', body: { app: String(flags.app), token: typeof flags.token === 'string' ? flags.token : undefined } });
      console.log(`EAS: ${set.app} (token ${set.token ?? 'missing'})`);
      break;
    }
    const standing = await call('/api/v1/app');
    const platforms = Object.entries(standing.platforms ?? {});
    if (!platforms.length) { console.log(standing.line ?? 'Nothing known.'); break; }
    console.log(`${standing.app}\n`);
    for (const [platform, where] of platforms) {
      console.log(`  ${platform.padEnd(9)} ${where.standing.padEnd(9)} ${where.version ? `${where.version}  ` : ''}${where.line}`);
    }
    const built = platforms.filter(([, w]) => w.standing === 'built');
    if (built.length) console.log(`\nBuilt, not submitted: ${built.map(([p]) => p).join(', ')} — an artifact nobody can install yet.`);
    break;
  }

  /**
   * The two answers a review has, from the side the work is on.
   *
   * They were only on the board, and that is the wrong place for half of them:
   * whoever just finished the work is in a terminal, not in a browser, and
   * `move CARD done` reads like filing, not like a decision. Same two moves
   * underneath — a word for what they mean is the whole difference.
   */
  case 'approve': {
    const key = String(words[0] ?? '').toUpperCase();
    if (!key) stop('gradula approve <CARD> [--reason "…"]');
    const card = await call(`/api/v1/cards/${key}/move`, {
      method: 'POST',
      body: { state: 'done', reason: typeof flags.reason === 'string' ? flags.reason : 'reviewed and approved' },
    });
    console.log(`${card.key} → ${card.state}`);
    if (card.alsoClosed?.length) console.log(`Closed with it: ${card.alsoClosed.join(' ')}`);
    break;
  }

  case 'reject': {
    const key = String(words[0] ?? '').toUpperCase();
    // A rejection without a reason is not a rejection, it is a card that moved
    // backwards for no reason anybody can read next week.
    const why = typeof flags.reason === 'string' ? flags.reason : words.slice(1).join(' ');
    if (!key || !why) stop('gradula reject <CARD> "what is still missing"');
    const card = await call(`/api/v1/cards/${key}/move`, { method: 'POST', body: { state: 'making', reason: why } });
    console.log(`${card.key} → ${card.state}  (${why})`);
    break;
  }

  case 'wave': {
    const root = words[0] ? `?root=${encodeURIComponent(String(words[0]).toUpperCase())}` : '';
    const { waves, waiting, withoutGate, root: wk } = await call(`/api/v1/wave${root}`);
    if (wk) console.log(`Venture ${wk}\n`);
    if (!waves.length) console.log('Nothing is ready.');
    waves.forEach((gruppe, i) => {
      console.log(`Wave ${i + 1}${i === 0 ? ' — can start now' : ' — only after that (the same files)'}:`);
      for (const card of gruppe) {
        const files = card.files?.length ? `  (${card.files.join(' ')})` : '';
        console.log(`  ${card.key.padEnd(10)} ${card.title}${files}`);
      }
    });
    if (waiting.length) {
      console.log('\nWaiting:');
      for (const w of waiting) console.log(`  ${w.card.key.padEnd(10)} ${w.card.title}  ⟂ ${w.waitsOn.join(' ')}`);
    }
    if (withoutGate.length) {
      console.log(`\nWithout a gate: ${withoutGate.join(' ')}`);
      console.log('These cards never reach done on their own — a loop without a gate grades its own homework.');
    }
    if (waves[0]?.length) console.log(`\nGo:  gradula start ${waves[0][0].key} --tree`);
    break;
  }

  /**
   * The heralds — the direction OUTWARD. The key is handed over when the
   * herald is created and cannot be read afterwards; what comes back says
   * "set".
   */
  case 'heralds': {
    const list = await call('/api/v1/heralds');
    if (!list.length) {
      console.log('No herald yet. Set one up:');
      console.log('  gradula herald --template werkstatt --chat -100123 --token <botfather>');
      const templates = await call('/api/v1/heralds/templates');
      for (const [id, v] of Object.entries(templates)) console.log(`  ${id.padEnd(14)} ${v.line}`);
      break;
    }
    for (const b of list) {
      const f = b.filter ?? {};
      const where = f.labels?.length ? ` @${f.labels.join(',')}` : '';
      console.log(`${b.active ? '●' : '○'} ${b.id}  ${b.kind}/${b.name}  → ${b.chat ?? '—'}  ${f.voice ?? 'plain'}/${f.visibility ?? 'internal'}${where}`);
      console.log(`  ${(f.verbs ?? ['everything']).join(' ')}${b.token ? '' : '   WARNING: no key'}`);
    }
    break;
  }

  case 'herald': {
    if (words[0] === 'probe' || words[0] === 'drop') {
      const id = String(words[1] ?? '');
      if (words[0] === 'drop') { await call(`/api/v1/heralds/${id}`, { method: 'DELETE' }); console.log('path.'); break; }
      const result = await call(`/api/v1/heralds/${id}/probe`, { method: 'POST' });
      console.log(result.sent ? `Delivered${result.bot ? ` (as @${result.bot})` : ''}.` : `Not delivered: ${result.reason}`);
      break;
    }
    const filter = {};
    if (typeof flags.verbs === 'string') filter.verbs = flags.verbs.split(',');
    if (typeof flags.labels === 'string') filter.labels = flags.labels.split(',');
    if (typeof flags.voice === 'string') filter.voice = flags.voice;
    if (typeof flags.visibility === 'string') filter.visibility = flags.visibility;
    const herald = await call('/api/v1/heralds', {
      method: 'PUT',
      body: {
        id: flags.id, kind: flags.kind ?? 'telegram', name: flags.name, chat: flags.chat,
        schedule: flags.every ? {
          cadence: flags.every, hour: Number(flags.hour ?? 8), weekday: Number(flags.weekday ?? 1),
        } : undefined,
        token: flags.token, template: flags.template,
        filter: Object.keys(filter).length ? filter : undefined,
        active: flags.off ? false : undefined,
      },
    });
    console.log(`${herald.id}  ${herald.name} → ${herald.chat ?? '—'}  (key: ${herald.token ?? 'MISSING'})`);
    console.log(`Probe:  gradula herald probe ${herald.id}`);
    break;
  }

  /**
   * Release. A command of its own, because it is a decision of its own: a
   * card does not become public by slipping through a filter.
   */
  case 'publish':
  case 'unpublish': {
    const key = String(words[0] ?? '').toUpperCase();
    const visibility = command === 'publish' ? 'public' : 'internal';
    const card = await call(`/api/v1/cards/${key}`, { method: 'PATCH', body: { visibility } });
    console.log(`${card.key} is now ${card.visibility}.`);
    break;
  }

  /**
   * The hook. Whoever wants to evidence a card should have to do nothing but
   * commit — `gradula sync` by hand is exactly the place where it stops after
   * three days.
   *
   * The hook NEVER holds the commit up: it starts detached, writes nothing to
   * the screen and ends quietly when the service does not answer. A hook that
   * delays a commit or turns it red is deleted the same day.
   */
  case 'hook': {
    const wurzel = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
    const file = join(wurzel, 'hooks', 'post-commit');
    const marke = '# gradula';
    if (flags.off || words[0] === 'off') {
      if (existsSync(file) && readFileSync(file, 'utf8').includes(marke)) {
        execFileSync('rm', ['-f', file]);
        console.log('Hook removed.');
      } else console.log('No gradula hook here.');
      break;
    }
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(marke)) {
      stop(`${file} exists and is not ours. Look at it first; I will not overwrite a hook I did not write.`);
    }
    const self = new URL(import.meta.url).pathname;
    writeFileSync(file, [
      '#!/bin/sh',
      marke + ' — evidence lands by itself. Remove with: gradula hook off',
      '# Detached and silent: a hook that delays or reddens a commit gets deleted the same day.',
      `(node ${JSON.stringify(self)} sync --since HEAD~1 >/dev/null 2>&1 &) || true`,
      '',
    ].join('\n'), { mode: 0o755 });
    console.log(`Hook installed: ${file}`);
    console.log('Every commit now sends its evidence. Nothing waits on it.');
    console.log('Remove with:  gradula hook off');
    break;
  }

  /**
   * The report. Without --send it only prints — a tool that writes into a
   * channel on the first attempt is one nobody tries.
   */
  case 'report': {
    const q = new URLSearchParams();
    if (typeof flags.since === 'string') q.set('since', flags.since);
    if (typeof flags.after === 'string') q.set('after', flags.after);
    q.set('voice', flags.plain ? 'plain' : 'human');
    if (typeof flags.period === 'string') q.set('period', flags.period);
    if (typeof flags.milestone === 'string') q.set('milestone', flags.milestone.toUpperCase());
    const report = await call(`/api/v1/report?${q}`);
    console.log(flags.plain ? report.plain : report.human);
    if (!flags.send) {
      console.log(`\n(${report.counts.done} done · ${report.counts.decided} decided · ${report.counts.incidents} incidents)`);
      console.log('Send it with --send');
      break;
    }
    const heralds = await call('/api/v1/heralds');
    const targets = heralds.filter((h) => h.active !== false && (!flags.to || h.id === flags.to || h.name === flags.to));
    if (!targets.length) { console.log('\nNo herald to send to.'); break; }
    for (const herald of targets) {
      const out = await call(`/api/v1/heralds/${herald.id}/say`, { method: 'POST', body: { html: report.html } })
        .catch((e) => ({ sent: false, reason: e.message }));
      console.log(`\n${herald.name}: ${out.sent ? 'delivered' : `not delivered — ${out.reason}`}`);
    }
    break;
  }

  case 'chats': {
    const heralds = await call('/api/v1/heralds');
    if (!heralds.length) { console.log('No herald yet.'); break; }
    for (const herald of heralds) {
      const out = await call(`/api/v1/heralds/${herald.id}/chats`).catch((e) => ({ ok: false, reason: e.message }));
      console.log(`${herald.name} (${herald.id})`);
      if (!out.ok) { console.log(`  ${out.reason}`); continue; }
      if (!out.chats.length) { console.log('  none yet — invite the bot into the group, or send it /start'); continue; }
      for (const c of out.chats) console.log(`  ${c.id.padEnd(16)} ${c.kind.padEnd(10)} ${c.name}`);
    }
    console.log('\nPoint a herald at one:  gradula herald --id <herald> --chat <chat>');
    break;
  }

  /**
   * Working — and saying so while you do.
   *
   * The heartbeat is a LEASE: as long as this command runs, it beats. When it
   * ends — cleanly, with Ctrl-C, or because the laptop closes — the beating
   * stops, and the board forgets the card by itself. Nobody has to reset
   * anything, and that is exactly why it is always right.
   *
   *   gradula work GRD-33                 only beat, until Ctrl-C
   *   gradula work GRD-33 -- npm test     beat while that runs
   */
  case 'work': {
    const key = String(words[0] ?? '').toUpperCase();
    if (!key) stop('gradula work <CARD> [-- <command>]');
    const cut = process.argv.indexOf('--');
    const inner = cut > -1 ? process.argv.slice(cut + 1) : [];

    const beat = async () => {
      try { await call(`/api/v1/cards/${key}/beat`, { method: 'POST' }); }
      catch { /* a mute beat is no reason to break off the work */ }
    };
    await beat();
    // Clearly more often than the lease runs out: a missed beat must not be
    // enough on its own for the card to vanish from the board.
    const clock = setInterval(beat, 25_000);
    clock.unref?.();

    console.log(`${key}: beating. The board shows it as running while this runs.`);
    if (!inner.length) {
      console.log('Ctrl-C to stop.');
      await new Promise(() => {});
      break;
    }

    console.log(`  $ ${inner.join(' ')}`);
    const child = spawn(inner[0], inner.slice(1), { stdio: 'inherit' });
    const code = await new Promise((done) => child.on('close', done));
    clearInterval(clock);
    console.log(code === 0 ? `\n${key}: done, and the beat has stopped.` : `\n${key}: exited ${code}.`);
    process.exit(code ?? 0);
  }

  /**
   * The standing — the third room. Not "is it done" (the gate proves that)
   * but "where has it arrived".
   */
  /**
   * The goals. Nearest date first, and what is still open by name — a number
   * without the cards behind it never answers the next question.
   */
  /**
   * The housekeeping. No number — findings, each with its cards.
   */
  /**
   * What hangs on a card in GitHub. One line of truth per check run and a
   * link to the real log — no second CI.
   */
  case 'github': {
    if (words[0]) {
      const key = String(words[0]).toUpperCase();
      const on = await call(`/api/v1/cards/${key}/github`);
      if (on.ok === false) { console.log(on.reason); break; }
      console.log(`${key} → ${on.repo}`);
      console.log(`  branch ${on.branch}${on.exists ? '' : ' (not pushed yet)'}  ${on.branchUrl}`);
      if (on.commit) console.log(`  head   ${on.commit.hash}  ${on.commit.title}\n         ${on.commit.url}`);
      if (on.pull) console.log(`  pr #${on.pull.number} ${on.pull.state}  ${on.pull.title}\n         ${on.pull.url}`);
      for (const c of on.checks ?? []) {
        const mark = { green: '✓', red: '✗', running: '▸', idle: '·' }[c.standing] ?? '·';
        console.log(`  ${mark} ${c.name}  ${c.url ?? ''}`);
      }
      if (on.evidence?.length) {
        console.log('  evidence:');
        for (const e of on.evidence) console.log(`    ${e.hash}  ${e.url}`);
      }
      break;
    }
    const set = await call('/api/v1/github', { method: 'PUT', body: { repo: flags.repo, token: flags.token } });
    console.log(`GitHub: ${set.repo} · key ${set.token ?? 'MISSING'}`);
    console.log('It only reads. A read token is enough — anything more would be a board with rights to the source.');
    break;
  }

  case 'health': {
    const now = await call(`/api/v1/health${flags.quiet ? `?quiet=${flags.quiet}` : ''}`);
    if (!now.findings.length) {
      console.log(`Nothing to sweep. ${now.cards} cards.`);
    } else {
      for (const f of now.findings) {
        console.log(`${String(f.count).padStart(3)}  ${f.line}`);
        console.log(`     ${f.cards.slice(0, 12).join(' ')}${f.cards.length > 12 ? ` … +${f.cards.length - 12}` : ''}`);
        console.log(`     ${f.why}`);
      }
    }
    if (now.people.length > 1) {
      console.log('\nWho is where:');
      for (const p of now.people) {
        console.log(`  ${p.machine ? '⚙' : '·'} ${p.actor.padEnd(26)} ${String(p.moves).padStart(4)} moves · ${p.cards.length} cards`);
      }
    }
    break;
  }

  case 'goals': {
    const goals = await call('/api/v1/goals');
    if (!goals.length) {
      console.log('No milestone and no venture yet.');
      console.log('  gradula new milestone "W2: the third room"');
      console.log('  gradula due GRD-41 2026-09-30');
      break;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const g of goals) {
      const bar = g.share === null ? '—'
        : `${'█'.repeat(Math.round(g.share * 10))}${'·'.repeat(10 - Math.round(g.share * 10))} ${Math.round(g.share * 100)}%`;
      const when = g.due ? (g.due < today ? `${g.due} OVERDUE` : g.due) : 'no date';
      console.log(`${g.key.padEnd(9)} ${bar.padEnd(16)} ${when.padEnd(18)} ${g.title}`);
      if (g.open?.length) console.log(`  open: ${g.open.join(' ')}`);
      // A dropped part is settled, not built. The bar reaches the end either
      // way; only this line says which of the two happened.
      if (g.dropped) console.log(`  ${g.done} done · ${g.dropped} dropped of ${g.total}`);
      if (g.share === null) console.log('  no parts yet — a milestone without parts is unanswered, not at zero');
    }
    break;
  }

  case 'due': {
    const key = String(words[0] ?? '').toUpperCase();
    const day = words[1] === 'none' ? null : String(words[1] ?? '');
    const card = await call(`/api/v1/cards/${key}`, { method: 'PATCH', body: { due: day } });
    console.log(`${card.key}: ${card.due ?? 'no date'}`);
    break;
  }

  case 'standing': {
    const now = await call('/api/v1/standing');
    const mark = { deploying: '▸', live: '✓', failed: '✗', idle: '·', unknown: '?' }[now.standing] ?? '?';
    console.log(`${mark} ${now.standing}${now.line ? ` — ${now.line}` : ''}`);
    for (const d of now.deployments ?? []) {
      console.log(`  ${d.standing.padEnd(10)} ${String(d.at ?? '').slice(0, 16).replace('T', ' ')}  ${d.title}`);
    }
    if (now.standing === 'unknown') console.log('\nConnect it:  gradula dokploy --base <api> --token <key> --compose <id>');
    break;
  }

  case 'dokploy': {
    const set = await call('/api/v1/dokploy', {
      method: 'PUT',
      body: {
        base: flags.base, token: flags.token, composeId: flags.compose,
        composes: { production: flags.compose, development: flags['compose-dev'] },
      },
    });
    const lanes = Object.entries(set.composes ?? {}).map(([env, id]) => `${env} ${id}`).join(' · ') || '—';
    console.log(`Dokploy: ${set.base} · composes ${lanes} · key ${set.token ?? 'MISSING'}`);
    console.log('It only reads. There is no deploy button, and that is deliberate.');
    break;
  }

  /**
   * The Sentry connection. Without a flag it shows what is there; with one
   * it sets — and the fields it does not name it carries over, so
   * `gradula sentry --environments prod,dev` is a whole sentence on its own.
   * The environments are the line that matters: a crash from a developer's
   * own dev build on his own phone was an incident card in Ready (MDLA-79)
   * until the connection could say which environments count.
   */
  case 'sentry': {
    const bases = { eu: 'https://de.sentry.io/api/0', us: 'https://sentry.io/api/0' };
    const show = (on) => {
      if (!on) { console.log('No Sentry connection.\nConnect it:  gradula sentry --org <org> --project <slug> --base eu --token <t> --hook-secret <s>'); return; }
      const watched = on.environments === 'all' ? 'all' : (on.environments ?? []).join(', ');
      console.log(`Sentry: ${on.org}/${on.project} · ${on.base} · token ${on.token ?? 'MISSING'} · hook ${on.hookSecret ?? 'MISSING'} · write back ${on.writeBack ? 'on' : 'off'}`);
      console.log(`  cards from: ${watched}${on.environments === 'all' ? '' : '  (an issue nobody can place counts as production)'}`);
      const lanes = Object.entries(on.lanes ?? {}).map(([lane, names]) => `${lane} ${[].concat(names).join('/')}`).join(' · ');
      if (lanes) console.log(`  lanes: ${lanes}`);
    };
    const setting = ['org', 'project', 'base', 'token', 'hook-secret', 'write-back', 'environments'].some((name) => flags[name] !== undefined);
    if (!setting) { show(await call('/api/v1/sentry')); break; }
    const before = await call('/api/v1/sentry');
    const org = flags.org ?? before?.org;
    const project = flags.project ?? before?.project;
    if (!org || !project) stop('Say which Sentry project: --org <org> --project <slug>.');
    const base = typeof flags.base === 'string' ? bases[flags.base.toLowerCase()] ?? flags.base : before?.base ?? bases.us;
    const writeBack = flags['write-back'] === true ? true : flags['write-back'] === 'off' ? false : before?.writeBack === true;
    const set = await call('/api/v1/sentry', {
      method: 'PUT',
      body: {
        org, project, base, writeBack,
        ...(typeof flags.token === 'string' ? { token: flags.token } : {}),
        ...(typeof flags['hook-secret'] === 'string' ? { hookSecret: flags['hook-secret'] } : {}),
        // `default` (or an empty word) goes back to production; not said keeps what was there.
        ...(typeof flags.environments === 'string' ? { environments: flags.environments === 'default' ? null : flags.environments } : {}),
      },
    });
    show(set);
    break;
  }

  case 'system': {
    const doc = await call('/api/v1/system');
    const when = (at) => String(at ?? '').slice(0, 16).replace('T', ' ');
    for (const env of doc.environments ?? []) {
      console.log(`${env.id.padEnd(12)} ${env.standing?.standing ?? 'unknown'}${env.standing?.line ? ` — ${env.standing.line}` : ''}`);
      for (const d of (env.deployments ?? []).slice(0, 3)) console.log(`  ${d.status.padEnd(10)} ${when(d.at)}  ${d.title}${d.carries?.length ? `  carries ${d.carries.join(' ')}` : ''}`);
      const lane = doc.deployed?.[env.id];
      if (lane) console.log(`  deployed   ${lane.sha ? lane.sha.slice(0, 12) : 'sha unknown'}${lane.cards?.length ? `  ${lane.cards.join(' ')}` : ''}`);
    }
    const rows = [
      ['builds', (doc.builds ?? []).slice(0, 3).map((b) => `${b.platform} ${b.profile ?? ''} ${b.status} ${when(b.at)} ${b.version ?? ''}`)],
      ['updates', (doc.updates ?? []).slice(0, 3).map((u) => `${u.channel} ${when(u.at)} ${u.message}`)],
      ['pipeline', (doc.pipeline ?? []).slice(0, 3).map((r) => `${r.status.padEnd(7)} ${r.branch ?? ''} ${when(r.at)} ${r.name}`)],
      ['releases', (doc.releases ?? []).slice(0, 3).map((r) => `${r.tag} ${when(r.at)}`)],
      ['errors', (doc.errors ?? []).slice(0, 5).map((e) => `${String(e.count24h).padStart(4)}/24h ${when(e.lastAt)} ${e.title}`)],
      ['people', (doc.people ?? []).slice(0, 8).map((p) => `${when(p.at)} ${p.actor} ${p.verb} ${p.card}`)],
      ['in hand', (doc.cards ?? []).map((c) => {
        const lanes = ['development', 'production'].filter((lane) => c.deployed?.[lane] === true).map((lane) => (lane === 'development' ? 'dev' : 'prod'));
        return `${c.key} ${c.state} ${c.title}${c.actor ? ` — ${c.actor}` : ''}${lanes.length ? `  [${lanes.join(' ')}]` : ''}`;
      })],
    ];
    for (const [name, lines] of rows) {
      if (!lines.length) continue;
      console.log(`\n${name}`);
      for (const one of lines) console.log(`  ${one}`);
    }
    const unseen = Object.entries(doc.sources ?? {}).filter(([, state]) => state !== 'ok');
    if (unseen.length) console.log(`\nnot seen: ${unseen.map(([name, state]) => `${name} (${state})`).join(', ')}`);
    break;
  }

  case 'history': {
    const mark = typeof flags.after === 'string' ? `?after=${encodeURIComponent(flags.after)}` : '';
    const rows = await call(`/api/v1/history${mark}`);
    if (!rows.length) { console.log('Nothing happened.'); break; }
    for (const z of rows.slice().reverse()) {
      const d = z.data ?? {};
      const detail = z.verb === 'said' ? d.line
        : z.verb === 'decided' ? `${d.result} — ${d.reason}`
        : z.verb === 'evidenced' ? `${d.ref}${d.note ? ` · ${d.note}` : ''}`
        : z.verb === 'deployed' ? `${d.environment}${d.sha ? ` · ${String(d.sha).slice(0, 12)}` : ''}`
        : z.verb === 'moved' ? `${d.from} → ${d.to}${d.reason ? ` (${d.reason})` : ''}`
        : '';
      console.log(`${String(z.at ?? '').slice(0, 16).replace('T', ' ')}  ${(z.card ?? '—').padEnd(9)} ${z.verb.padEnd(12)} ${z.actor}`);
      if (detail) console.log(`  ${String(detail).slice(0, 150)}`);
    }
    console.log(`\n${rows.length} entries. Continue from here:  gradula history --after ${rows[0].seq}`);
    break;
  }

  case 'vocabulary': {
    // The list and one of its entries must not share a name — the rename gave
    // both `module`, and reading the vocabulary died on its own loop.
    const modules = vocabularyOf();
    if (words[0] === 'push') {
      const sent = await call('/api/v1/vocabulary', { method: 'PUT', body: { module: modules } });
      console.log(`${sent.length} modules sent: ${sent.map((m) => m.id).join(' ')}`);
    } else {
      for (const one of modules) console.log(`${one.id.padEnd(16)} ${(one.area ?? '').padEnd(10)} ${one.paths.join(' ')}`);
      console.log(`\n${modules.length} modules — send them with \`gradula vocabulary push\`.`);
    }
    break;
  }

  /*
   * REGISTER THIS MACHINE. The board mints the key; the machine names itself
   * (its hostname) and writes its own `.gradula.env`. No key is typed and
   * none is copied — the friction that had Felix' key lying in a file on
   * David's disk.
   *
   * It runs WITHOUT a key: the CLI opens a request, a signed-in person
   * approves it on the board (matching the short code shown here), and the CLI
   * collects the key. The code is the guard — you approve the machine you can
   * see the code on.
   */
  case 'login': {
    const machine = typeof flags.as === 'string' ? flags.as : hostname();
    // The project: said outright, or read from a key already in .gradula.env.
    let project = typeof flags.project === 'string' ? flags.project.toUpperCase() : null;
    if (!project && env.GRADULA_TOKEN) {
      project = await fetch(`${base}/api/v1/project`, { headers: { Authorization: `Bearer ${env.GRADULA_TOKEN}` } })
        .then((r) => (r.ok ? r.json() : null)).then((p) => p?.key ?? null).catch(() => null);
    }
    if (!project) stop('Which project? gradula login --project MDLA');

    const raw = async (path, init = {}) => {
      const res = await fetch(`${base}${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
      const body = await res.json().catch(() => null);
      if (!res.ok) stop(body?.line ?? `${path}: ${res.status}`);
      return body;
    };

    const started = await raw(`/api/v1/device?project=${project}`, { method: 'POST', body: JSON.stringify({ machine }) });
    const at = `${base}/?project=${project}`;
    console.log(`This machine: ${machine}  →  ${project}`);
    console.log(`\nApprove it on the board:\n  ${at}\n  Settings → Your keys → this machine, code ${started.code}\n`);
    try { spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open', [at], { stdio: 'ignore', detached: true }).unref(); } catch { /* a terminal without a browser is fine */ }
    process.stdout.write('Waiting for approval');

    const until = Date.now() + 10 * 60_000;
    let keys = null;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await raw(`/api/v1/device/${started.id}`);
      if (poll.status === 'approved') { keys = poll; break; }
      if (poll.status === 'denied') { console.log('\nDenied on the board.'); break; }
      if (poll.status === 'expired') { console.log('\nThe request expired. Run it again.'); break; }
      process.stdout.write('.');
    }
    if (!keys?.token) { if (Date.now() >= until) console.log('\nTimed out. Run it again.'); break; }
    process.stdout.write('\n');

    // Write the machine's own file — the nearest .gradula.env, or one here.
    // Two keys: the person's, and the one the AI sessions on this machine
    // take (src/hand.mjs) — so the chronicle names the hand, not only the
    // errand. Other lines in the file (an actor, a comment) stay.
    let dir = process.cwd();
    let file = null;
    for (;;) { const candidate = join(dir, '.gradula.env'); if (existsSync(candidate)) { file = candidate; break; } const up = dirname(dir); if (up === dir) break; dir = up; }
    file ??= join(process.cwd(), '.gradula.env');
    const had = existsSync(file) ? readFileSync(file, 'utf8') : '';
    writeFileSync(file, mergeEnv(had, {
      GRADULA_URL: base, GRADULA_TOKEN: keys.token, ...(keys.agentToken ? { GRADULA_AGENT_TOKEN: keys.agentToken } : {}),
    }));
    const agent = keys.agentToken ? ` — and your sessions as ${agentKeyName(machine)}` : '';
    console.log(`Done. ${file} speaks as you${agent}. No actor line needed.`);
    break;
  }

  default:
    stop(`I do not know that: ${command}\n\n${HELP}`);
}
