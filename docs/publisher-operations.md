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

## Hosted refresh

Gradula's image build scans immutable Git objects at its source HEAD and bundles
one graph artifact. The running service imports that artifact into its own GRD
project, after verifying the repository and revision. It retries failed imports
every minute until successful and retains the last accepted graph on failure.
The runtime image contains no Git checkout or compiler dependency.

Mundus's existing docs deployment verifies its generated native graph against a
digest of the committed inputs and stamps the deployed revision at image build.
The docs service publishes through its existing project credential, retries
failures and exposes authenticated publication status. Updating a source input
requires regenerating the graph before pushing. A stale artifact fails the image
build instead of being labelled as current. Both pipelines run on deployments;
neither requires a login-started service on developer laptops.

The source-graph GitHub Actions workflow remains disabled because the account's
billing/spending restriction prevented jobs from starting. Its project secret is
configured, but hosted publication is the selected refresh path. Do not enable
a second competing publisher without a reason.

## Developer setup

Mundus's `node tools/setup.mjs` installs/updates Gradula and the developer login.
Use `node tools/dev.mjs context "topic"` or MCP `plan_context` for unfamiliar code.
Gradula developers use `node bin/gradula.mjs context "topic"`. Inspect freshness
and read the selected source. Use local search when a graph is missing or differs
from the checkout. No perpetual local publisher is installed by setup.

Manual recovery for Gradula remains `node tools/codegraph.mjs --ref origin/main
--fetch --publish`. For Mundus, run its generator and normal verification first;
the hosted artifact must pass the input digest check before receiving a revision.
Graph publication never approves cards or proves tests passed.

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

The Gradula project overview (`?project=GRD&view=overview`) combines board activity,
deployment observations and a bounded interactive source graph. `GET /system?wait=0`
returns the current board and cached provider data immediately, with an explicit
`observation.refreshing` and `observedAt`; provider checks continue in the background.
The original blocking system endpoint remains available for CLI callers.

Publishers may attach `documents` containing indexed Markdown paths and their bodies
(up to 1,000 documents, 128,000 characters each, 4 MB combined, within the existing
8 MB graph limit). Bodies contribute to the snapshot digest. The graph GET returns
only document metadata; the authenticated project-scoped `/documents?path=…&revision=…`
door returns one published document. Gradula never reads another project's checkout.
Upgrade Gradula before deploying document-aware publishers.
