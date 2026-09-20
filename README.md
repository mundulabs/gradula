# Gradula

A planning board for projects built by people and AI coders together.

Wishes become cards. A card carries labels that come from the project's own
repository (its modules and stack) and gates that prove it is done (a file, a
URL, a test, a command). Every move is written to a chronicle that names who
did it — a person, a machine acting for a person, or a rule.

One service holds several projects. People sign in through OIDC; machines come
in with a project key. Live board: <https://grad.mundula.app>.

## Run it locally

Requires Node 22 or newer.

```bash
npm install
npm run dev          # GRADULA_STORE=memory — no database, state is gone on exit
npm test             # node --test tests/*.test.mjs, no database needed
```

The service listens on `http://0.0.0.0:3200` (`PORT`, `HOST`). It serves the
API and, when `web/dist` exists, the board itself:

```bash
npm --prefix web ci && npm --prefix web run build
```

Environment variables read by `src/server.mjs`:

| Variable | Meaning |
| --- | --- |
| `GRADULA_STORE=memory` | Keep everything in memory. Also the fallback when `GRADULA_DB_URL` is unset (with a warning). |
| `GRADULA_DB_URL` | Postgres connection string. Tables are created and migrated on start. |
| `GRADULA_ADMIN_TOKEN` | Secret for the admin door (`/api/admin/…`). Without it the admin door answers 503. |
| `PUBLIC_ORIGIN` | The public URL of this instance, e.g. `https://grad.mundula.app`. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `GRADULA_SESSION_SECRET` | Sign-in for people. All four are optional; without them only machines can use the board. |
| `OIDC_ROLLEN_CLAIM`, `GRADULA_ROLE` | Where the roles sit in the token, and which role is required (default `dev`). |
| `GRADULA_WEB` | Path to the built board (default `web/dist`). |
| `SENTRY_DSN`, `GRADULA_ENV` | Crash reporting for the service itself. |

The Postgres part of the test suite runs only when `GRADULA_DB_URL` is set:

```bash
GRADULA_DB_URL=postgres://… npm test
```

The production deployment is `infra/gradula.compose.yml` (web + Postgres +
daily dumps, optional S3 mirror) built from `Dockerfile`. It needs
`GRADULA_DB_PASSWORD` and `GRADULA_ADMIN_TOKEN`.

## Attaching a project

A project brings three lines in `.gradula.env` (never committed; the CLI and
the MCP server look for the file from the current directory upwards):

```
GRADULA_URL=https://grad.mundula.app
GRADULA_TOKEN=grad_pat_…          your key
GRADULA_AGENT_TOKEN=grad_pat_…    the key your AI sessions take
```

You do not copy a key by hand:

```bash
node bin/gradula.mjs login --project KEY
```

opens a device request on the board, shows a short code, and waits. A signed-in
person approves the machine under *Settings → Your keys*; the board then mints
**two keys for that person** and the CLI writes all three lines into
`.gradula.env`, replacing older lines of the same names and keeping every other.

### Two keys, one person

Both keys ARE the person who approved the machine — same owner, same rights,
no actor header read. They differ in one thing: the hand the chronicle names.

| key | kind | name | the chronicle writes |
| --- | --- | --- | --- |
| `GRADULA_TOKEN` | `human` | the machine (`Davids-MacBook-Pro`) | `david (Davids-MacBook-Pro)` |
| `GRADULA_AGENT_TOKEN` | `agent` | `AI sessions · Davids-MacBook-Pro` | `david (Codex · Davids-MacBook-Pro)` when Codex acts |

The CLI and MCP send the detected coder in `X-Gradula-Coder`. Only agent keys
use this display metadata; the authenticated owner and registered machine stay
unchanged. Legacy `Claude Code · machine` keys also report the active coder.
Older clients without coder metadata retain the stored key name.

A session is recognised by the environment its tool runner sets (`CLAUDECODE`,
`CODEX_*`) and takes the agent key; the MCP server is a machine's door by
definition and always takes it. `GRADULA_HAND=agent|person` says which hand
this is when the environment does not. Without an agent key a session still
comes in — as the person, with the person's key.

*Your keys* on the board lists both, the agent one marked as the sessions'
key; revoking one leaves the other. A key can also be minted there by hand
(one key, named as you like) and shown once.

`GRADULA_ACTOR` is only read for a key that belongs to nobody (minted through
the admin door). It is a claim, not an identity: it appears in the chronicle as
`david (key name)`, and no right is derived from it.

The project itself is created through the admin door:

```bash
curl -X POST $GRADULA_URL/api/admin/projects \
  -H "Authorization: Bearer $GRADULA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"KEY","name":"Project name","repo":"owner/name"}'
```

`POST /api/admin/projects/KEY/keys` with `{"name":"…"}` mints a project key
directly; `GET …/keys` lists them; `DELETE /api/admin/keys/ID` revokes one.

## The CLI

`bin/gradula.mjs` speaks only through the API. Usage:

```
gradula cards [--state ready] [--kind task] [--module panels] [--area studio] [--q word]
gradula new [<kind>] "<title>" [--text "…"]   kinds: idea, task, venture, milestone, decision
                    [--gate test:tests/x.test.mjs] [--person david] [--file path]
gradula show <CARD>
gradula brief <CARD>             compact handoff for a chat: goal, state, gate, next move
gradula context [query] [--card CARD] [--files path,path] [--limit 8] [--max-bytes 8000]
                                 bounded code/document lookup with checkout revision comparison
gradula resume <CARD>            brief plus local workspace risk and recent evidence
gradula files <CARD> show|add|from-evidence [path…]   structured paths for map, wave and handoff
gradula approve <CARD>           the review says yes — done, with a reason
gradula reject <CARD> "reason"   back to making, and the sentence is the reason
gradula move <CARD> <ideas|ready|making|review|done|ice> [--reason "…"]
gradula confirm <CARD>…          take over the labels a rule proposed
gradula start <CARD>             creates an isolated branch/worktree by default
               --here "reason"   stay in this checkout when one developer intentionally combines related work
               [--anyway "why"]  start a card that waits on another
gradula link <CARD> <needs|blocks|part-of|resembles|touches> <CARD>
gradula sync [--since <ref>]     send commits carrying "Plan: CARD" as evidence
gradula gates [--commands]       run the gates; record verification for acceptance
gradula wave [<VENTURE>]         what can go side by side right now
gradula heralds                  who speaks outward, and about what
gradula herald --template <name> --chat <id> --token <t> [--every daily|weekly --hour 7]
gradula herald probe|drop <id>
gradula publish|unpublish <CARD> what may leave the house
gradula relabel                  run the label rules over old cards
gradula suggestions              what the cartographer sees (it changes nothing)
gradula work <CARD> [-- <cmd>]   say you are working; the board shows it live
gradula workspace                local worktrees beside the board: dirty, ahead, missing
gradula discard-worktree <CARD> --reason "…" [--discard-changes "…"] [--discard-commits "…"]
                                 remove a local task worktree; dirty work or local commits need their own reason
gradula github [<CARD>] [--repo owner/name --token <read token>]
gradula health [--quiet 14]      what is wrong with the board itself
gradula goals                    milestones, their coverage, the nearest date first
gradula pulse [--since ISO]      what happened, where to, in time, where the energy went
gradula due <CARD> <YYYY-MM-DD>  a date on a milestone or a venture ("none" clears)
gradula standing                 where things have arrived (reads Dokploy)
gradula app [--app @acc/slug --token <expo token>]   where the app has arrived (reads EAS)
gradula dokploy --base <api> --token <key> --compose <id> [--compose-dev <id>]
gradula sentry [--org <org> --project <slug>] [--base eu|us] [--token <t>] [--hook-secret <s>]
               [--write-back [off]] [--environments prod,dev|all|default]
                                 the Sentry connection — and which environments become cards
gradula system                   one picture of the whole system (see below)
gradula history [--after N]      what happened while you were away
gradula report [--plain] [--period "…"] [--milestone GRD-43] [--send]
gradula chats                    which channels the heralds can see
gradula vocabulary [push]        read this repo's modules (and send them)
gradula hook [off]               evidence lands on every commit, by itself
gradula login [--project MDUS]   register this machine — the board mints the key
gradula project [--alias "david=David Bläsing"] [--language de|en]
```

A commit whose message contains `Plan: KEY-42` becomes evidence on that card
through `gradula sync` (or automatically, once `gradula hook` is installed).

`gradula files KEY add path` records structured paths on old or new cards; `gradula files KEY from-evidence` backfills paths from commit evidence when available. Those paths feed map labels, waves, collision warnings and brief/resume.

`gradula brief KEY` is the prompt-sized handoff for modern IDE chats: current goal, state, labels, gate, reservation and next command. `gradula resume KEY` adds only the local risk that matters when a chat died or work is stale: matching worktree, dirty file count, commits not on `dev`, and the last few relevant chronicle lines. Use `show` when a person wants the full card; use `brief`/`resume` when an agent needs to continue without dragging the whole board into context. `gradula health` also flags open cards that grew beyond a compact handoff or whose chronicle became noisy; it names them for cleanup without blocking work.

### The life of a card, after the code

| Step | Who | What the board writes |
| --- | --- | --- |
| evidence | the push hook / `gradula sync` | `evidenced` — one note per commit that names the card (`Plan: KEY`) |
| deployed, per environment | Dokploy + GitHub, read by the system picture | `deployed` — once per lane, the first time the card is seen inside the deployed head (`{ environment, sha, at }`, hand `dokploy`) |
| done | manual acceptance, or eligible confirmed production delivery | `moved` to `done`; configured gates must pass, and manual acceptance policy may keep delivered work in Review |
| resolved in Sentry | the board, when the card is an incident and the connection allows writing back | `resolved in Sentry` |
| seen elsewhere | the Sentry hook, when an incident that already has a card happens again in an environment the connection does not watch (`dev`, `local`) | `seen` — one line per sighting (`{ environment, count }`); the card does not move and is never resurrected |

## Sentry — the incidents

One card per Sentry issue, recognised by `sentry:<id>`; the counter and the
last sighting come from Sentry. Two ways in: the hook (`POST
/api/v1/sentry/hook/KEY`, checked by its signature) and the pull (`POST
/api/v1/sentry/fetch`, or the schedule). The connection (`PUT`/`GET
/api/v1/sentry`, `gradula sentry`):

```
{ org, project, base,                  base: https://de.sentry.io/api/0 (EU) or https://sentry.io/api/0 (US)
  token: 'set' | null,                 an internal integration's token — the pull and the write-back
  hookSecret: 'set' | null,            the integration's client secret — the hook's signature
  writeBack: bool,                     may the board resolve an issue in Sentry when its card is done
  environments: ['production', 'prod'] | [...names] | 'all',   which Sentry environments become cards
  lanes: { production?: [...names], development?: [...names] } }   how Sentry names the board's lanes (system picture)
```

**Which environments become cards.** The apps tag every event with an
environment (`prod`, `dev`, `local`), and a crash from a developer's own dev
build on their own phone is real without being the board's business (MDUS-79
was one — a WatchdogTermination from `dev`, five times, in Ready). So an issue
becomes a card only when its environment is in the connection's
`environments` — `production` and `prod` unless the connection says otherwise:
`gradula sentry --environments prod,dev` (a comma list), `--environments all`
(every environment), `--environments default` (back to production). The
environment is read from the hook where it carries one (the alert's event, the
issue's tags); when the payload does not say, Sentry is asked once per issue
(the latest event) and the answer is held for the process; when it cannot be
asked (no token, Sentry down), the environment is unknown — and an unknown
environment counts as production, because a crash you cannot place is worse
than a card you have to close. An issue from an environment that is not
watched becomes no card and moves nothing; if a card for it already exists it
gets one `seen` line (see the table above), so the chronicle shows it keeps
happening. The pull asks Sentry for the watched environments only (all of them
with `all`). Cards that already exist are untouched by the setting: MDUS-79
stays until a hand decides.

`gradula show KEY` prints `deployed: dev 10:41 · production —` from those notes,
without the network; `gradula cards` marks a card production has carried with
a small `prod`. `GET /api/v1/cards/:key` answers the same next to the card:
`deployed: { development: bool, production: bool, at: { development, production } }`.

## The system picture

`GET /api/v1/system` (project key) answers ONE document gathered from every
connection the project has and from the board itself — the same shape whatever
is connected, every field optional:

```
{ at,
  environments: [{ id: production|development,
                   deployments: [{ status, title, head?, commit?, at, finishedAt?, carries: [cardKeys] }], standing }],
  deployed:  { production?: { sha, at, cards: [cardKeys] }, development?: { … } },   per lane with a live head
  builds:    [{ profile, channel, platform, status, at, url, version }],
  updates:   [{ channel, at, message, runtime }],
  pipeline:  [{ name, branch, status, at, url }],
  releases:  [{ tag, at, url }],
  errors:    [{ environment, count24h, lastAt, title, url }],   per lane, or the environment's own name (local); null where nobody claims it
  people:    [{ actor, card, verb, at, labels[] }],      the last 24 h of the chronicle
  cards:     [{ key, title, state, labels[], actor,      making, review, and done within a week
                deployed: { development: bool|null, production: bool|null },     null = nobody knows
                evidence: n }],                                                  commits behind the card
  sources:   { dokploy, eas, github, sentry, board } }   'ok' | 'not configured' | 'error: …'
```

**Where a card is.** A Dokploy deployment carries the full message of the
commit it built, so every deployment lists the cards that commit names in
`carries` — a deployment still running carries them too, and that is "what is
deploying right now". For the newest finished deployment of a lane the head's
sha is found by its title on the lane's branch (`main` for production, `dev`
for development; the GitHub connection may say otherwise in `branches`), and
each card in making, review or done within the week is asked whether its
evidence sits inside that head (`compare` — `identical` or `behind` means yes).
That is `deployed` per lane and `cards[].deployed` per card. A gathering
spends at most 40 GitHub calls (branch listings are held a minute, compares
forever): what does not fit stays `null`, and `sources.github` says
`ok (deployed: 3 cards past the budget …)` — or `ok (deployed unknown: no
token)` when the connection has none. The first time a card is seen deployed in
a lane, one `deployed` note lands on it (see the CLI's lifecycle table).
Card transitions follow the acceptance policy described below.

A connection that is not set up yields an empty list AND says so in `sources`,
so a page can say what it is not seeing instead of pretending. Dokploy watches
one compose per lane (`composes: { production, development }`; the old single
`composeId` means production). Sentry is asked once per lane under the names
it knows the lane by — `production`/`prod`, `development`/`dev`, or what the
connection says in `lanes: { production: 'live', development: ['dev'] }`
(`PUT /api/v1/sentry`) — and once per environment beside the lanes (`local`,
plus every name the connection watches for cards that no lane asks under), so
`errors` carries ALL environments: an error names its lane where a lane claims
it, the environment's own name (`local`) where none does, and the day count of
that place; an issue nobody claims keeps `environment: null`. The board decides
what becomes a card; the picture shows what is happening. The fetched parts are gathered at most once per
30 s per project, however many ask; the board's own half (`people`, `cards`) is
read anew on every ask, so a card that moved a second ago is in the next picture.

`GET /api/v1/live` (SSE, project key) announces `event: system` with
`{ at, changed: [...] }` whenever the gathered picture changed — no content, the
door above has it. The poll behind it runs only while at least one client is on
the line and stops with the last one. The same line carries `event: moved` with
`{ verb, card, actor, at }` for every chronicle verb — and `verb: 'wipe'` when
an admin empties the project, on which the board empties its columns at once.

## The MCP server

`mcp/server.mjs` exposes the same doors as tools over stdio (JSON-RPC) for
Codex, Claude Code and Claude Desktop. It reads the same `.gradula.env` and
takes `GRADULA_AGENT_TOKEN` when one is set (see "Two keys, one person"). Tools: `plan_list`, `plan_card`,
`plan_new`, `plan_move`, `plan_start`, `plan_approve`, `plan_reject`,
`plan_link`, `plan_suggest_labels`, `plan_project`, `plan_vocabulary`,
`plan_pulse`, `plan_wave`.

Example entry for a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "gradula": {
      "command": "node",
      "args": ["${GRADULA_HOME:-../gradula}/mcp/server.mjs"],
      "env": {}
    }
  }
}
```

`npm run mcp` starts it from this repository.

## Emptying a project

The admin door can clear a board for a clean start. The project itself (people,
keys, vocabulary) stays; only the cards, links and chronicle of that project go:

```bash
curl -X DELETE $GRADULA_URL/api/admin/projects/KEY/items \
  -H "Authorization: Bearer $GRADULA_ADMIN_TOKEN"
```

## Layout

```
src/spec.mjs         the words (kinds, states, targets, links, gates) — one place
src/gradula.mjs      the verbs — the rules live here, not in the router
src/api.mjs          the doors (node:http, no framework)
src/store.mjs        the store contract and the in-memory implementation
src/store-pg.mjs     the same contract on Postgres
bin/gradula.mjs      the CLI
mcp/server.mjs       the MCP server
web/                 the board (Vite + React), built into web/dist
tests/               node --test; store tests run over both implementations
infra/               the compose file for production
```

License: Apache-2.0. See [AGENTS.md](AGENTS.md) for the rules that apply when
working in this repository.

Progress shapes have fixed meanings: cards use five circles (●●◐○○),
workflow steps use squares (■▩□). Filled means succeeded, patterned means
running, empty means waiting or stopped; skipped steps use a dot. Failure and
cancellation are always named, never disguised as completion.

**Workshop → Live pipeline progress** watches the project's connected GitHub
workflows even when the board is closed. It checks about every minute and uses
actual jobs and steps, one message per run attempt. Changes edit that message;
unchanged snapshots are silent. Message IDs and fingerprints persist in
`herald_delivery` across restarts. Missing messages may be replaced; timeouts
and rate limits never cause an immediate repost. Later chat messages are left
alone, and no message is deleted. This is progress of GitHub workflows, not
proof that an external deployment or store review has finished.

Outside is never eligible for pipeline details. Existing Workshop heralds
can enable the checkbox; newly selected Workshop templates include it.
The initial poll skips old completed runs. The monitor currently checks the
30 most recent workflow runs and up to 500 jobs per attempt; the run link
remains the complete view. Deploy one Gradula scheduler instance to avoid
competing senders. A send acknowledged by Telegram but lost before its message
ID is stored can still produce a duplicate on retry.

### Card activity notifications

A Git push records evidence; it does not itself complete cards. Confirmed production deployment can move eligible cards to Done, subject to their gates; manual approval can also complete cards. Development deployment moves eligible cards to Review.

Creation, start, move, evidence, decision and subscribed edit notifications collect in a five-second window per project and herald. A single event keeps its detailed notification. A burst produces one bounded summary with the unique card total, latest state and linked card keys, showing up to twelve titles and the remaining count. A burst consisting entirely of Done transitions says completed; mixed activity says updated. New and recurring incidents remain immediate; release and pipeline notifications keep their separate behavior. Filters still apply before batching; full events remain in each card's chronicle. Scheduled reports remain separate. Delivery windows live in memory, like other immediate herald notifications; they are not a durable delivery queue. The service exposes `settle()` to wait for pending notifications.

### Parallel work and reservations

`gradula start KEY --files "src/audio,docs/audio.md"` reserves one card for the authenticated credential and a distinct session, then creates an isolated `codex/KEY` branch/worktree by default (from local `dev` when available). Update `dev` before starting. Enter the printed worktree and run `gradula work KEY` while working, or `gradula work KEY -- command …` for a bounded command. The explicit `--here "reason"` option keeps the current checkout and records why one developer intentionally combines related work there. Failed worktree setup releases the reservation and fails the command. Worktree creation does not copy uncommitted changes.

A reservation lasts 90 seconds and is renewed every 25 seconds by `work`. The board renews reservations started in its browser session while it remains open. MCP sessions use `plan_start`, `plan_beat` every 25 seconds and `plan_release_work`. CLI sessions use `GRADULA_SESSION` or the current Codex task ID when provided; otherwise their ID is stored privately in worktree Git metadata. Separate independent sessions in the same checkout must supply different `GRADULA_SESSION` values; using separate worktrees is the default. API clients send `X-Gradula-Session` on start, beat and release-work. Start responses expose the reservation, including its session. A client omitting the header receives a new session at start and must use it to renew. The owner is derived from authentication, never from the actor display header.

Concurrent starts use a database compare-and-swap: one wins, the other must refresh. An active reservation held by another session rejects a start unless `--takeover "reason"` is supplied. Its reason and previous actor are recorded. Only the owning session can renew or release; old sessions fail after a handover. `gradula release-work KEY` leaves the card state unchanged. Moving out of Making releases its reservation. Expiry means **activity unknown**, not Done or discarded changes; reserved cards are not automatically put back on Ready by the stalled-card sweep.

Planned scope uses repository-relative files or folders. Shared files/folders warn with the other card, actor and activity; shared modules give a lighter warning. No module or file is exclusively locked. Same-developer overlap is advisory: the worker can decide whether one checkout is clearer than several. Another active owner in the same files is a coordination warning, and taking over that card still requires a recorded reason. Start, card details and heartbeat responses include overlaps, so an earlier worker learns about a later start on its next heartbeat. These checks use declared scope and recorded evidence; Gradula does not inspect another developer's editor or prevent semantic/Git merge conflicts. Separate worktrees, small PRs, review and up-to-date integration checks remain necessary.

`gradula workspace` is the local sweep before resuming, cleaning or handing work to a new chat. It joins the board's Making cards with this repository's Git worktrees and reports missing local worktrees, dirty files, commits not on `dev`, and task worktrees whose cards are no longer Making. `gradula discard-worktree KEY --reason "…"` removes only the local worktree and tries to release this session's reservation; the branch is kept. Dirty files require `--discard-changes "…"`, and local commits require `--discard-commits "…"`, so destructive cleanup leaves a sentence instead of a silence.


Ordinary herald bursts are grouped by distinct card: repeated changes to one card retain its latest detailed message. A confirmed GitHub pre-start billing/budget failure is identified in the internal pipeline message as requiring local PR verification; it never turns failed or skipped checks green. The repository owns verification policy and execution, not Gradula. Device login exits unsuccessfully when not approved and stores the issued credentials with owner-only permissions.


## Acceptance, Git and deployment

Settings → **Manual acceptance required** defaults to off. When off, confirmed production delivery may complete a card whose gates pass; when on, delivery leaves unfinished work in Review for explicit acceptance. This project setting does not control GitHub merges or external deployments. It applies to new delivery observations; changing it does not reopen completed cards or retroactively accept earlier deliveries.

**Accept and finish** moves reviewed work to Done without pushing, merging or deploying. Missing or failed gate evidence disables the action with an explanation. `gradula gates` records verification and no longer automatically accepts work.

Card chips separate **Git dev/main** from **Deployment DEV/PROD**. Git counts show confirmed recorded commits on each branch; the lookup is bounded to the latest 100 commits per branch, so an unmatched older commit remains unconfirmed, not proven absent. Deployment chips preserve historical delivery observations and are not proof of a Git push.


The Workshop pipeline message also reads the `mundus/local-ci` commit status for
its exact full Git SHA. Local verification is labelled developer-reported and
never changes GitHub's workflow outcome or implies deployment. The same message
is refreshed when local evidence arrives after a hosted run completes or skips.

## Project code graph

The project may publish a generated `gradula.codegraph.v1` snapshot with
`gradula codegraph docs/gradula-codegraph.json`. The authenticated `PUT /api/v1/codegraph`
requires its repository to match the board. `GET /api/v1/codegraph` returns the latest
snapshot to authenticated project readers. Gradula does not fetch or scan the repository.

The card inspector matches structured file references to graph nodes and shows their
neighbours, source links and extracted/inferred edge explanations. Clean versioned
snapshots link to their exact source commit; legacy/dirty snapshots use GitHub HEAD
for navigation only. Graph imports never author card files, labels or completion.
Changing the project repository hides snapshots belonging to the previous repository.

Snapshots are bounded to 8 MB, 20,000 nodes and 80,000 edges. PostgreSQL stores the
current JSONB graph and up to eight recent clean revision snapshots; memory obeys
the same contract. A supplied checkout SHA selects its retained snapshot, falling
back to an explicitly mismatched current snapshot when unavailable. Import history
is retained. Re-publishing identical content is idempotent, including concurrent
requests. No graph database or hosted model is required.

### Code context for agents

Start with a small file lookup; expand only when relationships or evidence matter:

```bash
gradula context "authentication"
gradula context "normalizeGraph" --detail evidence
gradula context --mode explain --from src/codegraph.mjs
gradula context --mode impact --from src/auth.mjs --depth 3
gradula context --mode path --from src/api.mjs --to src/store.mjs --depth 4
gradula context --card GRD-69
```

MCP `plan_context` accepts the same fields through `GET /api/v1/context`. Search
uses field-weighted BM25, camel-case/plural normalization, a small explicit alias
vocabulary and file diversity. Exact symbol/path lookups avoid unrelated matches.
`detail=paths` is the default for search without a card: IDs, paths and lines.
`detail=evidence` expands source ranges, descriptions, explained relationships and
related work. Card-based requests default to evidence. Known files can still be read
directly; use local `rg` when the graph misses a concept.

`explain`, `impact` and `path` traverse source-backed extracted relationships by
default. `--include-inferred` explicitly allows inferred or unreferenced edges.
Impact follows incoming dependencies and contained declarations. Traversal is bounded
at 1,000 visited nodes and depth 1–6; responses distinguish found, unresolved,
not-found-within-the-inspected-component, and bounded results. Ambiguous symbol
names require exact IDs. `outputTruncated` reports a path or neighbourhood that
did not fit the response budget; an omitted edge is not proof of no dependency.

The response defaults to eight nodes and at most 8,000 serialized UTF-8 bytes,
including metadata and a newline. `--limit` accepts 1–20; `--max-bytes` accepts
4,096–24,000. Omission counts disclose reductions. Bytes are not tokenizer counts,
and the MCP protocol envelope is additional. The service keeps four compiled
retrieval indexes in a bounded cache, invalidated by graph digest.

Evidence context joins declared file scope to live cards, linked decisions, gates
and recorded commit/run/deployment events. Every event retains its ID, actor and
time. It scans at most 500 cards, inspects up to four related cards and the latest
12 relevant evidence events per card, then returns at most three events per card
within the shared byte budget. Coverage reports possible omissions. A configured
gate is not a passing test; an imported test is not a passing test; an event is a
recorded claim, not independent verification. Full history remains available via
`show`/`plan_card`. Retrieval never deletes or rewrites it.

Publishers may include a full `revision`, `dirty`, `generator`, node content hashes,
source line ranges, aliases and coverage. The local publisher reports unresolved
calls rather than pretending to have a complete runtime graph. The CLI sends HEAD
and detects local edits; MCP callers provide `revision` and `localDirty` when known.
Freshness is missing, unknown, dirty, local-dirty, unchecked, matching or different.
A clean matching revision still says nothing about tests or deployment. `health`
also reports graph availability/provenance separately from card hygiene.

### Rebuild, watch and publish

After `npm ci`, scan Gradula locally with no model calls:

```bash
npm run --silent codegraph:build > /tmp/gradula-codegraph.json
node tools/codegraph.mjs --publish
npm run codegraph:watch
node tools/codegraph.mjs --root /path/to/large-project --granularity files --ref origin/dev --fetch --publish
```

The publisher defaults to this checkout. `--root /path/to/project` explicitly scans
another local project and reads that project's configuration. The service never
fetches source repositories. Clean scans read immutable Git blobs; dirty scans use
tracked working-tree source (including staged additions) and cannot be published by
the watcher. Symlinks, credentials/configuration files, lockfiles, untracked code,
non-JS/TS languages, PDF and media are outside the scanner's scope. Markdown prose
and source comments are part of the published metadata.

For larger repositories, `--granularity files` keeps every supported source file
and representative compiler-resolved cross-file relationships. It omits symbol
nodes, intra-file edges and detailed call sites; the snapshot coverage says so.
File-mode descriptions are capped at 1,200 characters. It supports repository-wide
navigation within the same server limits without quietly dropping files. Use the
default `symbols` mode for detailed symbol traversal in smaller repositories.

`--ref origin/dev` scans immutable committed blobs even while a developer edits
the checkout. `--fetch` refreshes that origin branch first; it never switches,
resets or cleans the working tree. In watch mode unchanged commit IDs skip indexing
and publishing. A failed fetch or upload retains the last successfully published
snapshot and is retried on the next interval. `--config /private/publisher.env`
loads a dedicated publisher's environment file; keep it outside the source tree
with owner-only permissions. Run a supervised publisher with `--watch --interval
120000` when hosted CI is unavailable. It refreshes only while that machine runs;
snapshot revision mismatch remains visible to clients.

The TypeScript checker resolves declarations, aliases/re-exports, static calls,
constructors and heritage; literal imports link modules, test imports are tagged,
and Markdown sections/citations link documentation to source. Resolution uses
NodeNext over the supplied repository files, not external packages or custom
project tsconfig aliases. Unresolved calls remain unknown. Sources have content
hashes; the long-running watcher reuses unchanged syntax trees, rebuilds dependent
relationships and removes deleted files/edges. This is incremental parsing with a
full relationship relink, not an incremental database delta protocol. A fresh process
performs a cold scan. Failed scans/publishes retain the previous published snapshot.

`--watch --publish` polls every five seconds (`--interval` in milliseconds), runs
one scan/upload at a time and reports changed results/errors. It requires a clean
checkout and checks context-v2 server capabilities before uploading. SIGINT/SIGTERM
stop it. It does not install a daemon or change Git hooks implicitly.

The repository workflow `.github/workflows/codegraph.yml` publishes clean `main`
and `dev` pushes. Deploy the context-v2 server first, then configure repository
variable `GRADULA_URL` and secret `GRADULA_GRAPH_TOKEN` with a dedicated project key.
Absent configuration produces an explicit warning and no upload. Never put a token
in the graph or repository. The workflow and local watcher are alternatives.

### Retrieval evaluation

```bash
npm run --silent codegraph:eval > /tmp/retrieval-eval.json
npm run --silent codegraph:eval -- --check
```

The 30-question development set compares bounded graph lookup with a deterministic
`rg` baseline over the same tracked corpus. Audit reports and evaluation inputs are
excluded from retrieval. Results include expected files, misses, recall@8, actual
`cl100k_base` response-token counts, local retrieval timings and cold/warm indexing
statistics. `--check` requires recall >= 0.90 and mean response size <= 500 tokens.
This is a regression probe, not a held-out benchmark or a measure of end-to-end
coding success. See [retrieval validation](docs/retrieval-validation.md).

### Optional decision pilot

Connected projects can try [Jev shadow decisions](docs/decision-pilot.md) for ambiguous skill selection, routing, review triage and text intent. Opt in per project on the Gradula server; clients authenticate with existing Gradula credentials and supply their own optional TypeSafe key from a private project `.env`. Core graph/context features require no provider key. The fixed campaign limits paid attempts, records outcomes and compares complete-task usage only when measured. It never changes execution or approval.
