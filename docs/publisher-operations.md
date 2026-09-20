# Operating source graph publishers

The context-v2 service was deployed on 2026-09-20 via PR #1, dev, then the
identical dev head on main. PR #2 added optional compact file graphs and immutable
ref scans. The production API accepted a clean GRD snapshot and returned matching
revision context. Existing card history was preserved.

## The active projects

Gradula is `GRD`, repository `mundulabs/gradula`. The native product **Mundus** is
`MDUS`, repository `mundulabs/mundus`. `MOLD` / `mundulabs/mundula` is the legacy
JavaScript/Expo project, not Mundus. An initial rollout probe mistakenly targeted
that legacy checkout and published one snapshot there; it did not alter source
or history. No ongoing publisher should target it as a substitute for Mundus.

Mundus already has its own Rust/documentation generator, `tools/docs_graph.py`,
the generated `docs/gradula-codegraph.json`, local query tool `tools/codegraph.py`
and a hosted documentation service. Reuse that native graph. Gradula's TypeScript
scanner does not provide Rust compiler coverage.

## Current refresh status

The first GitHub Actions publication could not start: GitHub reported failed
account payments or a spending limit. The source-graph workflow was disabled to
avoid repeated failed jobs. Its dedicated GRD project secret and URL variable are
configured. After billing is resolved it can be enabled with
`gh workflow enable codegraph.yml --repo mundulabs/gradula` and dispatched on main.

The proposed local LaunchAgents were **not installed**: automatic approval review
required explicit authorization for persistent cross-project publishing. There
are no new login-started publishers and no background publisher added to developer
setup. Prepared installation instructions are not evidence of a running service.
Until an automatic path is enabled, snapshots are refreshed explicitly.

For Gradula, run `node tools/codegraph.mjs --ref origin/main --fetch --publish`.
For Mundus, verify its generated native graph with `python3 tools/docs_graph.py
--check` and publish through `node tools/dev.mjs codegraph path/to/snapshot.json`.
Revision metadata may identify a clean commit only after verifying the graph
against that commit; the legacy generated format alone has no source SHA.

## Developer setup and the intended shared workflow

Mundus's `node tools/setup.mjs` installs/updates Gradula and the developer login;
it does not install a perpetual publisher. Developers can retrieve compact
context through `node tools/dev.mjs context "topic"` or MCP `plan_context`.
Inspect freshness and read the selected source. Use local search when a graph is
missing or differs from the checkout.

For a team, publication belongs in a project-owned CI or deployment pipeline:
one source snapshot per committed revision, queried by every developer. The
existing hosted Mundus docs deployment is a possible integration point, but it
currently reads board observations; automatic graph publication has not been
added to it. No hosted publication should be claimed until it is implemented
and verified. A local watcher remains an explicit opt-in fallback, not a new
developer prerequisite.

## Optional local watcher behavior

`--ref origin/branch --fetch --watch --interval 120000` reads committed Git blobs
without switching, resetting or cleaning the developer's checkout. Unchanged refs
skip indexing and publishing. Fetch/validation/upload failures retain the last
successful snapshot. `--config /private/publisher.env` supports a dedicated
project credential in an owner-only file. It works only while its machine runs.

`--granularity files` retains every supported JS/TS/Markdown file with representative
cross-file relationships. Symbol nodes, intra-file edges and full call-site detail
are omitted and labelled in coverage. It is a size option for those languages,
not a replacement for Mundus's Rust-aware generator. Static relationships are not
runtime proof, and publication never approves cards or proves tests passed.
