# Gradula — rules for agents

Gradula is a planning board for projects built by people and AI coders
together. Wishes become cards, cards carry labels from the repository and gates
that prove them, and a chronicle records who moved what. [README.md](README.md)
says how to run it and how a project attaches.

This file is a pointer, not content: every model reads it in every session.
Whatever is normative lives in the code and its tests; add a rule there first,
then one line here.

## The build

```
src/spec.mjs         the words (kinds, states, targets, links, gates) — ONE place
src/ids.mjs          inner id (ULID-shaped) and card key (MDLA-142)
src/labels.mjs       labels from rules: module (from the vocabulary) and stack
src/links.mjs        links, cycle check, blocked computation, collisions — pure
src/wave.mjs         what can go side by side, and what is ripe — pure
src/cartographer.mjs proposals: same file, similar title, a bundle — pure
src/heralds.mjs      the filter and the sentence that leaves the house — pure
src/telegram.mjs     the first herald: introduce itself, say something
src/gates.mjs        the runner: file, url, test, command
src/store.mjs        the CONTRACT of the store + the in-memory implementation
src/store-pg.mjs     the same implementation on Postgres (same contract)
src/sentry.mjs       incidents: signature, mapping, fetching, writing back
src/gradula.mjs      the verbs — the rules live here, not in the router
src/api.mjs          the doors (node:http, no framework)
src/hand.mjs         the ONE reader of .gradula.env for the CLI and the MCP server
bin/gradula.mjs      the CLI (speaks only through the API)
mcp/server.mjs       the same tools over MCP, for Codex and Claude
web/                 the board (Vite + React); web/src/vocabulary.ts imports src/spec.mjs
```

## The laws in one sentence each

1. **No change without a chronicle entry**, and every entry names an actor.
2. **A suggestion changes nothing** until a hand confirms it.
3. **Blocked is computed**, not a state. Cycles are refused.
4. **One incident per cause** — the fingerprint comes from Sentry, not from us.
5. **Gradula reads no foreign repository.** The project sends its vocabulary.
6. **The store is a contract**; the tests run over both implementations.
7. **What is ripe harvests itself** — a venture whose parts are done closes,
   and the chronicle names the rule as the actor.
8. **The CLI and the MCP server hold no truth of their own.** Every tool calls
   an API door that exists; `tests/doors.test.mjs` refuses one that does not.
9. **The data speak English; the display speaks en and de.** Identifiers in
   `src/spec.mjs` never change with the language (`tests/words.test.mjs`), and
   no German word is an identifier in code (`tests/german.test.mjs`).
10. **`GRADULA_ACTOR` is a claim, not an identity.** It stands in the chronicle
    as `david (via key …)`; no right is ever derived from it.
11. **A class named in the markup has a rule in `web/src/styles.css`**
    (`tests/surface.test.mjs`). `web/` must not copy `src/spec.mjs`.
12. **Nothing above the migration block in `src/store-pg.mjs` may name a
    column that only a migration creates** (`tests/migration.test.mjs`).

## Checking

```bash
npm test                                # memory
GRADULA_DB_URL=postgres://… npm test    # additionally against Postgres
```

Without `GRADULA_DB_URL` the Postgres part is skipped and says so out loud.
A test that only imitates the database does not test the database.

## Deployment

`infra/gradula.compose.yml` is the production deployment. Read its comments
before touching it: the volume keys `dream-db` and `dream-sicherungen` and the
Postgres role and database name `dream` keep their old names on purpose —
renaming them detaches the data.
