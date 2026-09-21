# Contributing to Gradula

Use Node.js 22+ and read [AGENTS.md](AGENTS.md). The project is independent of
Mundus/Mundula: no sibling checkout, account, private package or hosted connection
is required to build and test it.

```sh
npm ci
npm --prefix web ci
npm test
npm run docs:check
npm --prefix web run build
./web/node_modules/.bin/tsc --noEmit -p web/tsconfig.json
```

For database changes run the same suite with `GRADULA_DB_URL` pointing to a
**disposable** PostgreSQL database. The suite checks the same store contract in
memory and Postgres. Migrations must be repeatable and preserve existing data.

The interface uses **Preact + TypeScript + Vite**. Preact's compatibility exports
keep familiar component/hook APIs, but React and ReactDOM are not installed or
shipped. The graph is SVG, state cues are CSS and typography uses system fonts.
Keep keyboard access, reduced motion, mobile layout and clear empty/error states.
No external font, UI kit or animation service is needed.

The service uses Node's HTTP server and PostgreSQL; source analysis runs in the
project's publisher, never in the hosted API. Compiler-aware JavaScript/TypeScript
indexing uses TypeScript. Other languages are file inventory unless a project's
custom publisher supplies richer semantics. See [setup](docs/setup.md).

For frontend development, run the configured service and `npm --prefix web run dev`.
Vite proxies `/api` and `/auth` to localhost:3200 (`GRADULA_DEV_TARGET` overrides it).
To test sign-in through Vite, configure `PUBLIC_ORIGIN` and the provider callback
for that Vite origin. There is no hard-coded development user or authentication bypass.

Describe the behavior change and verification in a pull request. Do not commit
keys, `.env*` files, real user transcripts, database exports or private graph data.
TypeSafe integration is optional; tests use synthetic provider responses, not paid calls.
