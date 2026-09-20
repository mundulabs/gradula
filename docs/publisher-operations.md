# Operating source graph publishers

The context-v2 service was deployed on 2026-09-20 via PR #1, dev, then the
identical dev head on main. The production API accepted a clean GRD snapshot and
returned matching-revision context. Existing card history was preserved.

The first GitHub Actions publication could not start: GitHub reported failed
account payments or a spending limit. The source-graph workflow was disabled to
avoid repeated failed jobs. Its dedicated project secret and URL variable are
configured. After billing is resolved it can be enabled with
`gh workflow enable codegraph.yml --repo mundulabs/gradula` and dispatched on main.
Stop the corresponding local publisher when switching to hosted publishing.

## Local supervision

A macOS user LaunchAgent can run each publisher with these arguments:

```
node /path/to/gradula/tools/codegraph.mjs --watch --publish --interval 120000 \
  --root /path/to/project --ref origin/main --fetch \
  --granularity symbols --config /private/project-publisher.env
```

Use `origin/dev` and `--granularity files` for the larger Mundula repository.
Only remote-tracking refs are fetched; local branches, dirty source and untracked
work are not changed. Keep the publisher's config outside the repository with
mode 0600. It contains only `GRADULA_URL`, the dedicated `GRADULA_AGENT_TOKEN`
and the publishing actor. Neither a GitHub token nor an infrastructure admin
credential belongs in this config.

The rollout uses LaunchAgent labels `app.gradula.codegraph.grd` and
`app.gradula.codegraph.mold`. Configuration and logs live under
`~/Library/Application Support/Gradula/publishers/`; the plists live under
`~/Library/LaunchAgents/`. They start on login and restart on failure. Check with
`launchctl print gui/$(id -u)/app.gradula.codegraph.grd` (or `.mold`), and stop with
`launchctl bootout gui/$(id -u)/app.gradula.codegraph.grd`. These publishers depend
on this Mac being awake, logged in and online. No source refresh is promised while
it is offline; compare the response's revision to your checkout.

Logs report revisions, counts and publication failures, never tokens. Network or
validation failures retain the previous successful snapshot. Unchanged refs skip
indexing and publishing; a new commit triggers a fresh graph with syntax reuse.
No hosted model or embeddings are involved. Restart after updating the local
publisher code to load the new generator.

## Coverage

The initial full Mundula graph exceeded the 8 MB limit (about 31,000 nodes and
35 MB). Explicit file mode retained all 1,638 supported committed files and
5,057 representative cross-file relationships within the existing limit. This
is a file navigation and dependency graph. Symbol nodes, intra-file edges and
individual call-site completeness are omitted and labelled in snapshot coverage.
Unresolved calls remain counted. Gradula itself uses the detailed symbol mode.

Verify with `gradula context "topic"`, `gradula context --mode impact --from
path/to/file`, and `gradula context --card KEY`. Missing or different revisions
require local source search. A passing publisher does not approve cards or prove
tests passed; card acceptance remains separate.
