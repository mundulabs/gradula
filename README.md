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
GRADULA_TOKEN=grad_pat_…
GRADULA_ACTOR=david
```

`GRADULA_ACTOR` is a claim, not an identity. It appears in the chronicle as
`david (via key …)`; no right is derived from it.

You do not have to copy a key by hand:

```bash
node bin/gradula.mjs login --project KEY
```

opens a device request on the board, shows a short code, and waits. A signed-in
person approves the machine under *Settings → Your keys*; the CLI then receives
a key minted by the board and writes `GRADULA_URL` and `GRADULA_TOKEN` into
`.gradula.env`.

Optional: `GRADULA_AGENT_TOKEN` is a second key for AI sessions (same actor,
its own "via" in the chronicle); `GRADULA_HAND=agent|person` says which hand
this is when the environment does not.

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
gradula approve <CARD>           the review says yes — done, with a reason
gradula reject <CARD> "reason"   back to making, and the sentence is the reason
gradula move <CARD> <ideas|ready|making|review|done|ice> [--reason "…"]
gradula confirm <CARD>…          take over the labels a rule proposed
gradula start <CARD> [--tree]    --tree creates a branch and a worktree
               [--anyway "why"]  start a card that waits on another
gradula link <CARD> <needs|blocks|part-of|resembles|touches> <CARD>
gradula sync [--since <ref>]     send commits carrying "Plan: CARD" as evidence
gradula gates [--commands]       run the gates; green moves the card to done
gradula wave [<VENTURE>]         what can go side by side right now
gradula heralds                  who speaks outward, and about what
gradula herald --template <name> --chat <id> --token <t> [--every daily|weekly --hour 7]
gradula herald probe|drop <id>
gradula publish|unpublish <CARD> what may leave the house
gradula relabel                  run the label rules over old cards
gradula suggestions              what the cartographer sees (it changes nothing)
gradula work <CARD> [-- <cmd>]   say you are working; the board shows it live
gradula github [<CARD>] [--repo owner/name --token <read token>]
gradula health [--quiet 14]      what is wrong with the board itself
gradula goals                    milestones, their coverage, the nearest date first
gradula pulse [--since ISO]      what happened, where to, in time, where the energy went
gradula due <CARD> <YYYY-MM-DD>  a date on a milestone or a venture ("none" clears)
gradula standing                 where things have arrived (reads Dokploy)
gradula app [--app @acc/slug --token <expo token>]   where the app has arrived (reads EAS)
gradula dokploy --base <api> --token <key> --compose <id> [--compose-dev <id>]
gradula system                   one picture of the whole system (see below)
gradula history [--after N]      what happened while you were away
gradula report [--plain] [--period "…"] [--milestone GRD-43] [--send]
gradula chats                    which channels the heralds can see
gradula vocabulary [push]        read this repo's modules (and send them)
gradula hook [off]               evidence lands on every commit, by itself
gradula login [--project MDLA]   register this machine — the board mints the key
gradula project [--alias "david=David Bläsing"] [--language de|en]
```

A commit whose message contains `Plan: KEY-42` becomes evidence on that card
through `gradula sync` (or automatically, once `gradula hook` is installed).

### The life of a card, after the code

| Step | Who | What the board writes |
| --- | --- | --- |
| evidence | the push hook / `gradula sync` | `evidenced` — one note per commit that names the card (`Plan: KEY`) |
| deployed, per environment | Dokploy + GitHub, read by the system picture | `deployed` — once per lane, the first time the card is seen inside the deployed head (`{ environment, sha, at }`, hand `dokploy`) |
| done | a hand — `gradula approve`, or the gate | `moved` to `done`; the gate proves, the deployment only reports |
| resolved in Sentry | the board, when the card is an incident and the connection allows writing back | `resolved in Sentry` |

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
  errors:    [{ environment, count24h, lastAt, title, url }],   per lane; null where no lane claims it
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
a lane, one `deployed` note lands on it (see the CLI's lifecycle table); no
state moves.

A connection that is not set up yields an empty list AND says so in `sources`,
so a page can say what it is not seeing instead of pretending. Dokploy watches
one compose per lane (`composes: { production, development }`; the old single
`composeId` means production). Sentry is asked once per lane under the names
it knows the lane by — `production`/`prod`, `development`/`dev`, or what the
connection says in `environments: { production: 'live', development: ['dev'] }`
(`PUT /api/v1/sentry`) — so an error carries its lane and the day count of
that lane; an issue no lane claims keeps `environment: null`. The fetched parts are gathered at most once per
30 s per project, however many ask; the board's own half (`people`, `cards`) is
read anew on every ask, so a card that moved a second ago is in the next picture.

`GET /api/v1/live` (SSE, project key) announces `event: system` with
`{ at, changed: [...] }` whenever the gathered picture changed — no content, the
door above has it. The poll behind it runs only while at least one client is on
the line and stops with the last one.

## The MCP server

`mcp/server.mjs` exposes the same doors as tools over stdio (JSON-RPC) for
Codex, Claude Code and Claude Desktop. It reads the same `.gradula.env` and
takes `GRADULA_AGENT_TOKEN` when one is set. Tools: `plan_list`, `plan_card`,
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
