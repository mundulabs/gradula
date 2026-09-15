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

import { readFileSync, writeFileSync, existsSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { hostname } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { allGates, gateLine } from '../src/gates.mjs';
import { KINDS, ladderOf, agentKeyName, CARD_STYLE, laddersOf } from '../src/spec.mjs';
import { config, handOf, mergeEnv, coderOf } from '../src/hand.mjs';
import { workSession } from '../src/work-session.mjs';
import { cardOfBranch } from '../src/ids.mjs';

const HELP = `gradula — wish, board, standing

  gradula cards [--state ready] [--kind task] [--module panels] [--area studio] [--q word]
  gradula new [<kind>] "<title>" [--text "…"]   kinds: idea, task, venture, milestone, decision
                      [--gate test:tests/x.test.mjs] [--person david] [--file path]
  gradula show <CARD>
  gradula brief <CARD>             compact handoff for a chat: goal, state, gate, next move
  gradula resume <CARD>            brief plus local workspace risk and recent evidence
  gradula files <CARD> show|add|from-evidence [path…]   structured paths for map, wave and handoff
  gradula approve <CARD>           the review says yes — done, with a reason
  gradula reject <CARD> "what is missing" back to making, and the sentence is the reason
  gradula move <CARD> <ideas|ready|making|review|done|ice> [--reason "…"]
  gradula remove <CARD>            an idea that was only words — anything with a chronicle goes on ice
  gradula confirm <CARD>…          take over the labels a rule proposed (a hand's call)
  gradula start <CARD>             creates an isolated branch/worktree by default
                 --here "reason"  stay in this checkout when one developer intentionally combines related work
                 [--files "src/audio.rs,src/ui"] [--takeover "reason"]
  gradula release-work <CARD>      release your session reservation without marking Done
                 [--anyway "why"]  start a card that waits on another — the sentence is the reason
  gradula link <CARD> <needs|blocks|part-of|resembles|touches> <CARD>
  gradula sync [--since <ref>] [--adopt]   send commits carrying "Plan: CARD" as evidence; --adopt gives a card to one that carries none
  gradula gates [--commands]       run the gates; record evidence for acceptance
  gradula wave [<VENTURE>]         what can go side by side right now
  gradula heralds                  who speaks outward, and about what
  gradula herald --template <name> --chat <id> --token <t>
                 [--every daily|weekly --hour 7]   a report that comes by itself (UTC)
  gradula herald probe|drop <id>
  gradula publish|unpublish <CARD> what may leave the house
  gradula publishing hand|done     the rule: by hand, or everything that reaches production (incidents excepted)
  gradula style                  show the fixed card progress marks
  gradula releases                 what left the house, per lane: web, ios, android, ota — with the cards each carried
  gradula next [--lane ios] [--all] the note for the release about to go: what reached production since the last one on that lane
  gradula notes --lane ios --version 1.2.0 [--stage beta] --file notes.md   file the reviewed notes — the store's text; Release · public hears production, Beta · testers hears beta
  gradula relabel                  run the label rules over old cards:
                                 an empty axis is filled, a touched one is asked
  gradula suggestions              what the cartographer sees (it changes nothing)
  gradula work <CARD> [-- <cmd>]   say you are working; the board shows it live
  gradula workspace                local worktrees beside the board: dirty, ahead, missing
  gradula discard-worktree <CARD> --reason "…" [--discard-changes "…"] [--discard-commits "…"]
                                 remove a local task worktree; dirty work or local commits need their own reason
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
  gradula env --compose <id> --from <.env> KEY…  the server's variables from a file, then redeploy (DOKPLOY_URL/_API_TOKEN)
  gradula dokploy --base <api> --token <key> --compose <id> [--compose-dev <id>]
                 --from MOLD --compose <id> [--compose-dev <id>]   the same Dokploy as another project; the key is copied on the server
  gradula sentry [--org <org> --project <slug>] [--base eu|us] [--token <t>]
                 [--hook-secret <s>] [--write-back [off]]
                 [--environments prod,dev|all|default]   which Sentry environments become cards
  gradula system                   ONE picture: deployments, builds, updates,
                                 pipeline, releases, errors, people — and what is not seen
  gradula history [--after N]      what happened while you were away
  gradula report [--plain] [--period "…"] [--milestone GRD-43] [--send]
  gradula chats                    which channels the heralds can see
  gradula codegraph <file.json>    publish a project-generated code graph snapshot
  gradula vocabulary [push]        read this repo's modules (and send them)
  gradula hook [off]               evidence lands on every commit, by itself
  gradula login [--project MDLA]   register THIS machine — the board mints two keys (yours, and
                                 one for the AI sessions here), no copy-paste
  gradula project [--alias "david=David Bläsing"] [--language de|en] [--integration direct|pr]
  gradula key <name>               mint a named service key with your own key (shown once; the owner is you)
                                 which names mean the same person ("none" clears)
                                 and which language the CARDS are written in

Environment: GRADULA_URL, GRADULA_TOKEN, GRADULA_ACTOR (or .gradula.env — gradula login writes it)
             GRADULA_AGENT_TOKEN  the key AI sessions take — same person, its own hand in the
                                  chronicle ("<coder> · <machine>"); gradula login writes it too
             GRADULA_HAND=agent|person  say which hand this is, if the environment does not`;

const env = config();
const base = (env.GRADULA_URL ?? 'http://127.0.0.1:3200').replace(/\/+$/, '');
// Which hand: a person at the terminal, or a session that runs the CLI for
// one. Same actor, its own key — the chronicle says "via" which.
const hand = handOf(env);
let session = workSession(env);

async function call(path, { method = 'GET', body, soft = false } = {}) {
  if (!hand.token) stop('No GRADULA_TOKEN — nothing happens here without a project key.');
  const res = await fetch(`${base}${path}`, {
    method,
    ...(soft ? { signal: AbortSignal.timeout(15000) } : {}),
    headers: {
      Authorization: `Bearer ${hand.token}`,
      'X-Gradula-Session': session,
      ...(hand.actor ? { 'X-Gradula-Actor': hand.actor } : {}),
      ...(coderOf(env) ? { 'X-Gradula-Coder': coderOf(env) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((cause) => { const message = `${base} does not answer (${cause.message}).`; if (soft) throw new Error(message); stop(message); });
  const payload = await res.json().catch(() => null);
  if (!res.ok) { const message = `${payload?.error ?? res.status}: ${payload?.line ?? 'unknown'}`; if (soft) throw new Error(message); stop(message); }
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

/* the board's ladder style, read once per run — every ladder printed here is the project's own */
const ladderStyle = CARD_STYLE;
const dot = (item) => {
  // The ladder instead of one mark: five rungs say where a card stands, and
  // a session can copy them beside a link — "[MDLA-71](…) ■■▩□□".
  const mark = ladderOf(item.state, ladderStyle);
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
/** A card's title from a commit subject: whole when it fits the door's 140, else cut at a word with an ellipsis — never mid-word. */
function titleOf(subject) {
  const clean = String(subject ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 140) return clean;
  const cut = clean.slice(0, 139);
  const space = cut.lastIndexOf(' ');
  return `${space > 80 ? cut.slice(0, space) : cut}…`;
}

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
  /*
   * EVERY PLACE A COMMIT CAN TOUCH IS A MODULE. A hand-typed list (tools,
   * infra, docs, tests) left every other folder — templates, patches, the
   * hooks — and every root file outside the vocabulary, and a card touching
   * only those stood unlabelled on the map. So: every top-level directory
   * git tracks is a module (a dot-folder without its dot: .githooks →
   * githooks), and the root files together are the module `repo`.
   */
  let tracked = [];
  try { tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no git: the workspaces alone */ }
  const covered = (relative) => [...module.values()].some((m) => m.paths.some((p) => relative === p || relative.startsWith(`${p}/`) || p.startsWith(`${relative}/`)));
  let rootFiles = false;
  for (const first of new Set(tracked.map((f) => f.split('/')[0]))) {
    if (!tracked.some((f) => f.startsWith(`${first}/`))) { rootFiles = true; continue; }   /* a file at the root */
    if (first === 'node_modules' || covered(first)) continue;
    const id = first.replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) continue;
    // the same name twice (packages/tools and tools/): one module, both paths
    if (module.has(id)) { module.get(id).paths.push(first); continue; }
    module.set(id, { id, paths: [first], words: [] });
  }
  if (rootFiles) module.set('repo', { id: 'repo', paths: ['/'], words: [] });
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

function git(args, { cwd = process.cwd(), soft = false } = {}) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { if (soft) return null; throw error; }
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']);
}

function worktrees() {
  const out = git(['worktree', 'list', '--porcelain'], { soft: true });
  if (!out) return [];
  const rows = [];
  let row = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (row) rows.push(row);
      row = { path: line.slice(9), branch: null, head: null };
    } else if (row && line.startsWith('branch ')) row.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (row && line.startsWith('HEAD ')) row.head = line.slice(5);
  }
  if (row) rows.push(row);
  return rows;
}

function worktreeCard(row) {
  return cardOfBranch(row.branch) ?? (/\/([A-Z]{2,8}-[1-9][0-9]{0,6})$/.exec(row.path)?.[1] ?? null);
}

function localStanding(row, root = repoRoot()) {
  const status = git(['-C', row.path, 'status', '--porcelain'], { soft: true });
  const dirty = status === null ? null : status.split('\n').filter(Boolean).length;
  let ahead = null;
  if (row.branch && row.branch !== 'dev') {
    const base = git(['-C', row.path, 'rev-parse', '--verify', 'dev'], { soft: true });
    if (base) {
      const count = git(['-C', row.path, 'rev-list', '--count', 'dev..HEAD'], { soft: true });
      ahead = count === null ? null : Number(count);
    }
  }
  const inside = row.path === root || row.path.startsWith(`${root}/`);
  return { ...row, card: worktreeCard(row), dirty, ahead, inside };
}



function clipLine(value, limit = 360) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > limit * 0.65 ? space : cut.length)}…`;
}

function shortHistory(entry) {
  const data = entry.data ?? {};
  if (entry.verb === 'evidenced') return `${entry.verb} ${data.kind ?? ''} ${data.ref ? String(data.ref).slice(0, 12) : ''}${data.comment ? ` · ${String(data.comment).slice(0, 90)}` : ''}`.trim();
  if (entry.verb === 'moved') return `${entry.verb} ${data.from ?? ''} → ${data.to ?? ''}${data.reason ? ` · ${String(data.reason).slice(0, 100)}` : ''}`;
  if (entry.verb === 'started') return `${entry.verb}${data.workspaceReason ? ` · ${String(data.workspaceReason).slice(0, 100)}` : ''}`;
  if (entry.verb === 'said') return `${entry.verb} · ${String(data.line ?? '').replace(/\s+/g, ' ').slice(0, 120)}`;
  if (entry.verb === 'deployed') return `${entry.verb} ${data.environment ?? ''}${data.sha ? ` ${String(data.sha).slice(0, 7)}` : ''}`.trim();
  return entry.verb;
}

function printBrief(card, { resume = false, local = null } = {}) {
  const labels = [card.module.length ? `[${card.module.join(' ')}]` : '', card.stack.filter((x) => !card.module.includes(x)).join(' ')].filter(Boolean).join(' ');
  console.log(`${card.key} · ${card.state} · ${card.title}`);
  if (labels) console.log(`Labels: ${labels}`);
  console.log(`Goal: ${clipLine(card.text || card.title)}`);
  console.log(`Gate: ${card.gate ? `${card.gate.kind} ${card.gate.call}${card.gate.expect ? ` -> ${card.gate.expect}` : ''}` : 'none'}`);
  const cardFiles = card.files ?? [];
  if (cardFiles.length) console.log(`Files: ${cardFiles.slice(0, resume ? 12 : 6).join(', ')}${cardFiles.length > (resume ? 12 : 6) ? ` … +${cardFiles.length - (resume ? 12 : 6)}` : ''}`);
  if (card.blockedBy?.length) console.log(`Blocked by: ${card.blockedBy.join(', ')}`);
  if (card.reservation) {
    const active = Date.parse(card.reservation.until) > Date.now() ? 'active' : 'activity unknown';
    const files = (card.reservation.files ?? []).slice(0, 6).join(', ');
    console.log(`Reservation: ${card.reservation.actor} · ${active}${files ? ` · ${files}` : ''}`);
  } else console.log('Reservation: none');
  if (resume && local) {
    const row = local.find((one) => one.card === card.key);
    if (row) {
      const bits = [
        row.dirty === null ? 'status unknown' : row.dirty ? `${row.dirty} dirty` : 'clean',
        row.ahead === null ? null : row.ahead ? `${row.ahead} local commits not on dev` : 'no local commits',
        row.inside ? null : 'outside repo folder',
      ].filter(Boolean);
      console.log(`Workspace: ${bits.join(' · ')} · ${row.path}`);
    } else console.log('Workspace: no local task worktree found');
  }
  const evidence = (card.history ?? []).filter((e) => ['evidenced', 'deployed', 'moved', 'started', 'said'].includes(e.verb)).slice(-6);
  if (resume && evidence.length) {
    console.log('Recent:');
    for (const entry of evidence) console.log(`- ${String(entry.at ?? '').slice(0, 16).replace('T', ' ')} ${clipLine(shortHistory(entry), 140)}`);
  } else {
    const last = [...(card.history ?? [])].reverse().find((e) => ['evidenced', 'deployed', 'moved', 'started', 'said'].includes(e.verb));
    if (last) console.log(`Last: ${clipLine(shortHistory(last), 140)}`);
  }
  const next = card.state === 'ready' ? `gradula start ${card.key}`
    : card.state === 'making' ? `gradula work ${card.key} -- <command>  ·  or gradula move ${card.key} review --reason "..."`
      : card.state === 'review' ? `gradula approve ${card.key}  ·  or gradula reject ${card.key} "what is missing"`
        : card.state === 'ideas' ? `gradula move ${card.key} ready --reason "yes"` : 'none';
  console.log(`Next: ${next}`);
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

  case 'key': {
    const name = words[0];
    if (!name) stop('Which name? gradula key mundus-docs');
    const made = await call('/api/v1/keys', { method: 'POST', body: { name } });
    // Shown once, on purpose: the board never returns it again.
    console.log(made.token);
    console.error(`Key ${name} minted for ${made.entry?.ownerName ?? 'you'}; shown once, store it where the service reads it.`);
    break;
  }

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
    if (typeof flags.integration === 'string') {
      const after = await call('/api/v1/project', { method: 'PATCH', body: { integration: flags.integration } });
      console.log(`Landing a card: ${after.integration === 'direct' ? 'directly onto the main line' : 'through a pull request'}`);
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
    console.log(`Landing a card: ${project.integration === 'direct' ? 'directly onto the main line' : 'through a pull request'}`);
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


  case 'brief':
  case 'resume': {
    const key = String(words[0] ?? '').toUpperCase();
    if (!/^[A-Z]{2,8}-[0-9]{1,7}$/.test(key)) stop(`gradula ${command} <CARD>`);
    const card = await call(`/api/v1/cards/${key}`);
    let local = null;
    if (command === 'resume') {
      try { const root = repoRoot(); local = worktrees().map((row) => localStanding(row, root)); }
      catch (error) { console.error(`Workspace unavailable: ${error.message}`); local = []; }
    }
    printBrief(card, { resume: command === 'resume', local });
    break;
  }


  case 'files': {
    const key = String(words[0] ?? '').toUpperCase();
    const action = String(words[1] ?? 'show');
    if (!/^[A-Z]{2,8}-[0-9]{1,7}$/.test(key)) stop('gradula files <CARD> show|add|from-evidence [path…]');
    const card = await call(`/api/v1/cards/${key}`);
    const current = card.files ?? [];
    if (action === 'show') {
      if (!current.length) console.log(`${key}: no structured files yet`);
      else for (const file of current) console.log(file);
      break;
    }
    let next = current;
    if (action === 'add') {
      const given = words.slice(2).flatMap((one) => String(one).split(',')).map((one) => one.trim()).filter(Boolean);
      if (!given.length) stop('gradula files <CARD> add path [path…]');
      next = [...new Set([...current, ...given.map((f) => f.replace(/^\/+/, ''))])].slice(0, 60);
    } else if (action === 'from-evidence') {
      const fromHistory = [];
      for (const entry of card.history ?? []) {
        const files = Array.isArray(entry.data?.files) ? entry.data.files : [];
        for (const file of files) fromHistory.push(String(file).replace(/^\/+/, ''));
      }
      if (!fromHistory.length) stop(`${key}: no evidence files found in this card's chronicle.`);
      next = [...new Set([...current, ...fromHistory])].slice(0, 60);
    } else stop('gradula files <CARD> show|add|from-evidence [path…]');
    const updated = await call(`/api/v1/cards/${key}`, { method: 'PATCH', body: { files: next } });
    console.log(`${updated.key}: ${updated.files.length} structured file${updated.files.length === 1 ? '' : 's'}`);
    for (const file of updated.files) console.log(`  ${file}`);
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
    console.log(`  chat handoff: gradula brief ${card.key}  ·  stale/local resume: gradula resume ${card.key}`);
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

  case 'remove': {
    // Only a card that is nothing but words yet — an idea, or on ice, with no chronicle. Everything else: ice.
    const gone = await call(`/api/v1/cards/${String(words[0] ?? '').toUpperCase()}`, { method: 'DELETE' });
    console.log(`${gone.key} removed`);
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
    if (!/^[A-Z]{2,8}-[0-9]{1,7}$/.test(key)) stop('start needs a valid card key');
    if (flags.here && (typeof flags.here !== 'string' || !flags.here.trim())) stop('--here needs a reason');
    // A blocked card opens only with a reason, and the reason is a sentence
    // — `--anyway` alone is a shrug, and the door refuses a shrug.
    const anyway = typeof flags.anyway === 'string' ? flags.anyway : null;
    const card = await call(`/api/v1/cards/${key}/start`, { method: 'POST', body: { anyway, workspaceReason: typeof flags.here === 'string' ? flags.here : null, takeover: typeof flags.takeover === 'string' ? flags.takeover : null, ...(typeof flags.files === 'string' ? { files: flags.files.split(',').map(s => s.trim()) } : {}) } });

    // The warnings first: whoever reads them under the brief has already begun.
    if (card.blockedBy.length) console.log(`CAREFUL: ${key} waits on ${card.blockedBy.join(', ')}`);
    // Which language this board writes its cards in. It stands HERE because
    // this is the last thing anybody reads before they write — a setting
    // nobody sees at the moment of writing is a setting nobody follows.
    const speaks = await call('/api/v1/project').then((p) => p.language).catch(() => null);
    if (speaks) console.log(`Write on this board in: ${speaks}`);
    for (const warning of card.warnings ?? []) console.log(`CAREFUL: ${warning.card} · ${warning.actor ?? 'unassigned'} · ${warning.activity} · ${warning.level}: ${(warning.files.length ? warning.files : warning.modules).join(', ')}`);

    /**
     * A tree of its own is the default because Git is clearer that way. It is
     * not law, though: one developer may deliberately keep related tracks in a
     * single checkout with --here, and that reason stands in the chronicle.
     */
    if (flags.here && (typeof flags.here !== 'string' || !flags.here.trim())) stop('--here needs a reason; otherwise start creates an isolated worktree.');
    if (!flags.here) {
      const branch = `codex/${key}`;
      let place = join('.worktrees', 'plan', key);
      try {
        const currentBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
        if (currentBranch === branch) place = '.';
        const exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
        const excluded = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
        if (!excluded.split('\n').includes('/.worktrees/')) writeFileSync(exclude, `${excluded}\n/.worktrees/\n`);
        if (!existsSync(place)) {
          const zweige = execFileSync('git', ['branch', '--list', branch], { encoding: 'utf8' }).trim();
          // Current dev means the shared one: a local dev with unpushed merges
          // from another session must not leak into a fresh task branch.
          let baseRef = 'HEAD';
          try { execFileSync('git', ['fetch', '--quiet', 'origin', 'dev'], { stdio: 'pipe' }); } catch { /* offline: the last known remote dev is still better than a diverged local one */ }
          for (const ref of ['refs/remotes/origin/dev', 'refs/heads/dev']) {
            try { execFileSync('git', ['show-ref', '--verify', '--quiet', ref]); baseRef = ref; break; } catch { /* repositories without a dev branch use their current base */ }
          }
          execFileSync('git', zweige ? ['worktree', 'add', place, branch] : ['worktree', 'add', place, '-b', branch, baseRef], { stdio: 'pipe' });
        }
        const actualBranch = execFileSync('git', ['-C', place, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
        if (actualBranch !== branch) throw new Error(`Expected ${branch}, found ${actualBranch}; existing files were not changed.`);
        const treeSession = workSession(env, place);
        if (treeSession !== session) {
          await call(`/api/v1/cards/${key}/release-work`, { method: 'POST' });
          session = treeSession;
          await call(`/api/v1/cards/${key}/start`, { method: 'POST', body: { anyway, files: card.reservation.files } });
        }
        console.log(`Worktree: ${place} (branch ${branch})`);
      } catch (error) {
        await call(`/api/v1/cards/${key}/release-work`, { method: 'POST' });
        stop(`No worktree: ${String(error.stderr ?? error.message).trim().split('\n').pop()}`);
      }
    }

    console.log(`Reservation: ${session}. Keep it alive with: gradula work ${key}${flags.here ? '' : ' (from the worktree)'}.`);
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
    const orphans = [];
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
      else if (flags.adopt && !/^(Merge |fixup!|squash!)/.test(String(title ?? ''))) orphans.push({ hash, title: (title ?? '').trim(), body: (body ?? '').trim(), author, email, files });
    }

    /*
     * ADOPTION. A commit without a Plan line happens: the board was mid-deploy
     * when the commit hook asked, and the hook — by its law — let the commit
     * through. The push hook passes --adopt, and such a commit gets its card
     * here: a task from its subject, started, evidenced — the same card the
     * commit hook would have made a minute earlier. Merges and fixups are
     * nobody's work of their own and are left alone.
     */
    for (const orphan of orphans) {
      try {
        // adopted already — by an earlier push, another machine, a hand? then it is that card's evidence
        const known = await call(`/api/v1/evidence/${orphan.hash.trim().slice(0, 12)}`).catch(() => ({ cards: [] }));
        if (known.cards?.length) { for (const key of known.cards) add(key, orphan.hash, orphan.title, orphan.author, orphan.email, orphan.files); continue; }
        const made = await call('/api/v1/cards', { method: 'POST', body: { kind: 'task', title: titleOf(orphan.title), text: `Born from a commit that found no board when it was made (${orphan.hash.trim().slice(0, 12)}).${orphan.body ? `\n\n${orphan.body.slice(0, 2000)}` : ''}` } });
        await call(`/api/v1/cards/${made.key}/start`, { method: 'POST', body: {} }).catch(() => {});
        add(made.key, orphan.hash, orphan.title, orphan.author, orphan.email, orphan.files);
        console.log(`${made.key} adopted  ${orphan.title.slice(0, 52)}`);
      } catch (error) { console.log(`no card for ${orphan.hash.trim().slice(0, 12)} — ${error.message}`); }
    }

    if (!found.size) {
      console.log('No commit names a card. The line reads:  Plan: MDLA-142');
      console.log('Or work on a branch that gradula start --tree created (codex/MDLA-142).');
      break;
    }
    if (onBranch) console.log(`On the task branch for ${onBranch} — commits without a Plan line count for ${onBranch}.\n`);

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
   * Run the gates and record verification; acceptance remains explicit.
   * Red means "not yet", never "broken": the reason may be
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
        console.log('  → verification recorded; review and approve to finish');
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
  case 'notes': {
    // gradula notes --lane ios --version 1.2.0 --file notes.md   the reviewed release notes, filed and spoken (Outside hears only these)
    const lane = String(flags.lane ?? 'web');
    const version = flags.version;
    const text = typeof flags.file === 'string' ? readFileSync(flags.file, 'utf8') : words.join(' ');
    if (!version || !text.trim()) stop('gradula notes --lane web|ios|android|ota --version <v> (--file notes.md | "the notes")');
    const stage = String(flags.stage ?? 'production');
    const filed = await call('/api/v1/releases/notes', { method: 'POST', body: { lane, stage, version: String(version), text } });
    console.log(filed.filed ? `${lane} ${filed.version}: notes filed and spoken to ${filed.sent.length} ${filed.sent.length === 1 ? 'channel' : 'channels'}.` : `${lane} ${filed.version}: notes were filed before — nothing changed.`);
    break;
  }

  case 'next': {
    // gradula next [--lane ios|android|ota|web] [--all]   the note for the release about to go: public cards since the last one
    const lane = String(flags.lane ?? 'ios');
    const out = await call(`/api/v1/releases/next?lane=${encodeURIComponent(lane)}&visibility=${flags.all ? 'internal' : 'public'}`);
    if (!out.cards.length) { console.log(`${lane}: nothing ${flags.all ? '' : 'public '}since ${out.previous ? `${out.previous.version ?? out.previous.id} (${String(out.previous.at).slice(0, 10)})` : 'the last month'}.`); break; }
    console.log(out.text);
    break;
  }

  case 'releases': {
    const list = await call('/api/v1/releases');
    if (!list.length) { console.log('No release seen yet.'); break; }
    for (const r of list.slice(0, 20)) console.log(`${String(r.at).slice(0, 16).replace('T', ' ')}  ${r.lane.padEnd(7)} ${(r.version ?? (r.commit ?? '').slice(0, 7)).padEnd(14)} ${r.cards.length} cards${r.title ? `  ${r.title.slice(0, 60)}` : ''}`);
    break;
  }

  case 'style': {
    if (words[0] && words[0] !== CARD_STYLE) stop('Cards use circles; pipeline steps use squares. Their shapes are fixed.');
    const l = laddersOf(CARD_STYLE);
    console.log(`Cards: ${l.ideas} ideas · ${l.ready} ready · ${l.making} making · ${l.review} review · ${l.done} done · ${l.ice} ice`);

    break;
  }

  case 'publishing': {
    // gradula publishing hand|done — the board's rule for what becomes public
    const rule = String(words[0] ?? '');
    if (!['hand', 'done'].includes(rule)) stop('gradula publishing hand|done   (hand: someone publishes a card; done: whatever reaches production, incidents excepted)');
    const project = await call('/api/v1/project', { method: 'PATCH', body: { publish: rule } });
    console.log(`${project.key}: a card becomes public ${project.publish === 'done' ? 'when it reaches production (incidents excepted)' : 'only when someone publishes it'}.`);
    break;
  }

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
        rmSync(file, { force: true });
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
  case 'release-work': {
    const card = await call(`/api/v1/cards/${String(words[0] ?? '').toUpperCase()}/release-work`, { method: 'POST' });
    console.log(`${card.key}: reservation released; card state unchanged.`);
    break;
  }

  case 'work': {
    const key = String(words[0] ?? '').toUpperCase();
    if (!key) stop('gradula work <CARD> [-- <command>]');
    const cut = process.argv.indexOf('--');
    const inner = cut > -1 ? process.argv.slice(cut + 1) : [];

    let child;
    let lastWarnings = '';
    const beat = async () => {
      const out = await call(`/api/v1/cards/${key}/beat`, { method: 'POST', soft: true });
      const warnings = JSON.stringify(out.warnings ?? []);
      if (warnings !== lastWarnings && out.warnings?.length) console.error(`Work overlaps: ${warnings}`);
      lastWarnings = warnings;
    };
    await beat();
    // Clearly more often than the lease runs out: a missed beat must not be
    // enough on its own for the card to vanish from the board.
    const clock = setInterval(() => beat().catch(error => { console.error(error.message); clearInterval(clock); if (child) child.kill('SIGTERM'); else process.exit(1); }), 25_000);

    console.log(`${key}: beating. The board shows it as running while this runs.`);
    if (!inner.length) {
      console.log('Ctrl-C to stop.');
      await new Promise(() => {});
      break;
    }

    console.log(`  $ ${inner.join(' ')}`);
    child = spawn(inner[0], inner.slice(1), { stdio: 'inherit' });
    const code = await new Promise((done) => { child.on('close', done); child.on('error', error => { console.error(error.message); done(1); }); });
    clearInterval(clock);
    await call(`/api/v1/cards/${key}/release-work`, { method: 'POST', soft: true }).catch(error => console.error(error.message));
    console.log(code === 0 ? `\n${key}: command finished; the heartbeat has stopped.` : `\n${key}: exited ${code}.`);
    process.exit(code ?? 0);
  }

  case 'workspace': {
    const cards = await call('/api/v1/cards?state=making');
    const byKey = new Map(cards.map((card) => [card.key, card]));
    const root = repoRoot();
    const local = worktrees().map((row) => localStanding(row, root));
    const byCard = new Map(local.filter((row) => row.card).map((row) => [row.card, row]));
    console.log(`Repository: ${root}`);
    console.log(`Making: ${cards.length} card${cards.length === 1 ? '' : 's'}`);
    for (const card of cards) {
      const row = byCard.get(card.key);
      const lease = card.reservation && Date.parse(card.reservation.until) > Date.now() ? 'active' : card.reservation ? 'unknown' : 'none';
      if (!row) {
        console.log(`  ${card.key.padEnd(10)} no local worktree · reservation ${lease}`);
        continue;
      }
      const bits = [
        row.dirty === null ? 'status unknown' : row.dirty ? `${row.dirty} dirty` : 'clean',
        row.ahead === null ? null : row.ahead ? `${row.ahead} local commits not on dev` : 'no local commits',
        row.inside ? null : 'outside repo folder',
        `reservation ${lease}`,
      ].filter(Boolean);
      console.log(`  ${card.key.padEnd(10)} ${bits.join(' · ')}`);
      console.log(`             ${row.path}`);
    }
    const extras = local.filter((row) => row.card && !byKey.has(row.card));
    if (extras.length) {
      console.log('\nLocal task worktrees without a making card:');
      for (const row of extras) {
        const bits = [
          row.dirty === null ? 'status unknown' : row.dirty ? `${row.dirty} dirty` : 'clean',
          row.ahead === null ? null : row.ahead ? `${row.ahead} local commits not on dev` : 'no local commits',
        ].filter(Boolean);
        console.log(`  ${row.card.padEnd(10)} ${bits.join(' · ')}`);
        console.log(`             ${row.path}`);
      }
    }
    break;
  }

  case 'discard-worktree': {
    const key = String(words[0] ?? '').toUpperCase();
    if (!/^[A-Z]{2,8}-[0-9]{1,7}$/.test(key)) stop('gradula discard-worktree <CARD> --reason "…"');
    const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
    if (!reason) stop('--reason is required; discarding local work must leave a sentence behind.');
    const root = repoRoot();
    const row = worktrees().map((one) => localStanding(one, root)).find((one) => one.card === key && one.path !== root);
    if (!row) stop(`${key}: no local task worktree found.`);
    if (row.dirty === null) stop(`${key}: cannot read worktree status; inspect ${row.path} by hand.`);
    if (row.dirty > 0 && !(typeof flags['discard-changes'] === 'string' && flags['discard-changes'].trim())) {
      stop(`${key}: ${row.dirty} dirty file${row.dirty === 1 ? '' : 's'} in ${row.path}. Add --discard-changes "why those local edits can go".`);
    }
    if ((row.ahead ?? 0) > 0 && !(typeof flags['discard-commits'] === 'string' && flags['discard-commits'].trim())) {
      stop(`${key}: ${row.ahead} commit${row.ahead === 1 ? '' : 's'} not on dev. Add --discard-commits "why those commits can stay only on the branch or be ignored".`);
    }
    const args = ['worktree', 'remove'];
    if (row.dirty > 0) args.push('--force');
    args.push(row.path);
    git(args);
    const discardLine = [
      `Local worktree removed: ${reason}`,
      row.dirty > 0 ? `Discarded local changes: ${flags['discard-changes'].trim()}` : null,
      (row.ahead ?? 0) > 0 ? `Local commits kept on ${row.branch}: ${flags['discard-commits'].trim()}` : null,
    ].filter(Boolean).join('\n');
    await call(`/api/v1/cards/${key}/say`, { method: 'POST', body: { text: discardLine }, soft: true }).catch((error) => console.error(`Could not write discard note: ${error.message}`));
    await call(`/api/v1/cards/${key}/release-work`, { method: 'POST', soft: true }).catch(() => null);
    console.log(`${key}: removed local worktree`);
    console.log(`Reason: ${reason}`);
    if ((row.ahead ?? 0) > 0) console.log(`Branch kept: ${row.branch}. Delete it separately only after the commits are pushed, synced, or deliberately abandoned.`);
    console.log(`Next: move ${key} to ready or ice with a reason if the work should not continue.`);
    break;
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

  case 'env': {
    /*
     * THE SERVER'S OWN VARIABLES, FROM A FILE THAT NEVER LEAVES THE MACHINE.
     *   gradula env --compose <id> --from <.env file> KEY [KEY…]     (DOKPLOY_URL, DOKPLOY_API_TOKEN in the environment)
     * Reads the named keys out of the file, merges them into the compose's variables in Dokploy,
     * and redeploys. Nothing is typed, nothing is printed — the values go from the file to the
     * server and nowhere else. This is how the house bot's key (TELEGRAM_BOT_TOKEN) reaches the board.
     */
    const base = String(process.env.DOKPLOY_URL ?? '').replace(/\/+$/, '');
    const apiKey = process.env.DOKPLOY_API_TOKEN;
    const composeId = flags.compose;
    const from = flags.from;
    if (!base || !apiKey) stop('DOKPLOY_URL and DOKPLOY_API_TOKEN must be in the environment.');
    if (!composeId || !from || !words.length) stop('gradula env --compose <id> --from <.env file> KEY [KEY…]');
    const file = Object.fromEntries(readFileSync(String(from), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trimStart().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
    const missing = words.filter((k) => !file[k]);
    if (missing.length) stop(`${from} has no value for ${missing.join(', ')}.`);
    const dok = async (path, body) => {
      const res = await fetch(`${base}/${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.json();
    };
    const compose = await dok(`compose.one?composeId=${encodeURIComponent(String(composeId))}`);
    const merged = new Map();
    for (const line of String(compose.env ?? '').split(/\r?\n/)) { const at = line.indexOf('='); if (at > 0 && !line.trimStart().startsWith('#')) merged.set(line.slice(0, at).trim(), line.slice(at + 1)); }
    for (const k of words) merged.set(k, file[k]);
    await dok('compose.saveEnvironment', { composeId: String(composeId), env: [...merged].map(([k, v]) => `${k}=${v}`).join('\n'), createEnvFile: true });
    await dok('compose.deploy', { composeId: String(composeId) });
    console.log(`${compose.appName ?? composeId}: ${words.join(', ')} set — redeploying.`);
    break;
  }

  case 'dokploy': {
    const set = await call('/api/v1/dokploy', {
      method: 'PUT',
      body: {
        from: flags.from, base: flags.base, token: flags.token, composeId: flags.compose,
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

  case 'codegraph': {
    if (!words[0]) stop('Provide the project-generated graph JSON file.');
    const graph = JSON.parse(readFileSync(resolve(words[0]), 'utf8'));
    const saved = await call('/api/v1/codegraph', {method:'PUT', body:graph});
    console.log(`${saved.nodes.length} nodes · ${saved.edges.length} edges · ${saved.digest.slice(0,12)}`);
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
    // `start` is a cmd.exe builtin, not a program; and a missing opener fails
    // asynchronously, so the 'error' event needs a listener or node exits.
    const opener = process.platform === 'darwin' ? ['open', [at]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', at]] : ['xdg-open', [at]];
    try { spawn(...opener, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* a terminal without a browser is fine */ }
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
    if (!keys?.token) { if (Date.now() >= until) console.log('\nTimed out. Run it again.'); process.exitCode = 1; break; }
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
    chmodSync(file, 0o600);
    const agent = keys.agentToken ? ` — and your sessions as ${agentKeyName(machine)}` : '';
    console.log(`Done. ${file} speaks as you${agent}. No actor line needed.`);
    break;
  }

  default:
    stop(`I do not know that: ${command}\n\n${HELP}`);
}
