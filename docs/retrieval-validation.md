# Source and knowledge retrieval validation

This upgrade turns the original graph viewer into a usable retrieval system for
Gradula's JavaScript/TypeScript and documentation. It does not claim universal
language support, a complete runtime call graph, or superiority to Graphify.

## What now works

- Compiler-resolved declarations, imported aliases, re-exports, calls, constructors
  and heritage, with source ranges and content hashes. Test imports and document
  citations are typed separately. Unresolved calls are counted explicitly.
- Incremental syntax reuse in the local watcher, full relationship relinking,
  deletion handling, immutable Git-blob scans for clean checkouts and guarded
  publication. No hosted model or embedding calls are required.
- BM25 file discovery, compact exact-symbol lookup, file diversity and explicit
  terminology aliases. Progressive disclosure keeps descriptions and relationships
  out of the default path lookup.
- Bounded explain, impact and path queries. Ambiguity and search bounds are visible;
  inferred edges require explicit opt-in. Static references never assert runtime
  reachability or complete impact coverage.
- Revision-aware retrieval across eight retained clean snapshots, idempotent
  concurrent imports and source links pinned to clean indexed commits.
- Live links to relevant cards, decisions, declared scope and original evidence
  events. Source graphs and card history remain separate authorities. History is
  neither reset nor rewritten to reduce context.

## Evaluation method

Run `npm run --silent codegraph:eval -- --check` after `npm ci` with `rg` installed.
The dataset is [30 repository navigation questions](../tests/fixtures/retrieval-eval.json).
It mixes ordinary descriptions and exact symbols. Expected files were identified
from the repository's modules; these are development examples, not held-out
historical coding tasks. The initial failures influenced retrieval development.

Both systems inspect the same tracked working-tree corpus and return at most
eight results and 8,000 bytes. Audit reports, benchmark code, and query fixtures
are excluded to avoid retrieving the answer key. The baseline uses literal,
case-insensitive `rg` searches for normalized query terms, ranks files by the
number of distinct matching terms, and returns two matching lines per file.
It is a defined first-search baseline, not an expert's iterative search process.

Response tokens are counted locally using pinned `js-tiktoken` and `cl100k_base`.
They exclude tool schemas, protocol wrappers, later source reads, model reasoning
and output. They are not a bill estimate for any particular coding model.
Graph response includes provenance metadata; `rg` response contains code lines.
The tasks therefore measure file discovery, not identical answer contents.

Local query timing excludes API/network latency. Cold/warm indexing time is
reported separately; neither invokes an LLM. The warm process reuses syntax but
still relinks the graph. A new process starts cold.

## Measured development result

The final implementation probe found the expected file for **28/30 questions
(93.3%)**, versus **25/30 (83.3%)** for the baseline. Mean responses were about
**378 tokens versus 406**, approximately **7% fewer** after including coverage
metadata. Earlier richer graph responses cost substantially more; this is why
path lookup is now the default and evidence requires expansion.

The measured corpus contained 1,267 nodes and 4,528 relationships. Cold indexing
took about 574 ms and a warm rebuild about 266 ms on this machine; the warm run
parsed zero changed files and reused all 102 inputs. These timings vary with
machine load and do not include transport to a running Gradula service.

Two questions still missed: “Read the project environment credentials” and
“Find stale cards without a heartbeat.” Use local search or a more precise symbol
for these. No graph can safely turn an unsuccessful search into evidence that
the code or dependency is absent.

The regression gate requires recall@8 >= 0.90 and mean response tokens <= 500.
The [machine-readable run](retrieval-eval.json) includes all cases and misses.
Its revision is the base HEAD; `workingTree: true` identifies evaluation of the
pending implementation rather than an immutable checkout at that base revision.

## Validation and rollout

All 368 tests passed with PostgreSQL enabled, with zero skipped tests. Tests cover
alias/shadowing resolution, incremental changes and deletion, invalid
syntax, secret/symlink exclusion, publication preflight, authentication, CLI/MCP
parity, graph walks, byte bounds, revision retention, concurrent import idempotency,
project isolation, bounded evidence reads and history preservation. Memory and
real PostgreSQL run the same snapshot/evidence contract. TypeScript checking and
the production frontend build validate the source-link change.

The code includes a local `codegraph:watch` publisher and a GitHub workflow for
clean `main`/`dev` pushes. At audit time the repository had neither publishing
variable `GRADULA_URL` nor secret `GRADULA_GRAPH_TOKEN`; no credential was copied
to GitHub and no production deployment was performed. Deploy the context-v2
service first, provision a dedicated project publishing key, then enable either
the watcher or workflow and verify `gradula context` against the deployed snapshot.
The workflow warns explicitly when configuration is missing. A scan/publish error
retains the last successful snapshot and is reported; it does not mark cards Done.

## Remaining boundaries

Custom tsconfig aliases, external-package declarations, non-JS/TS languages,
semantic extraction from arbitrary prose/media and dynamic runtime dispatch are
not resolved by this indexer. The generic graph API can accept another local
publisher's source-backed graph. Source comments and Markdown are published
metadata, so project publishers must choose their intended repository content.

Snapshot retention is bounded to eight clean revisions and a current snapshot.
Older checkouts fall back to an explicit mismatch. Retrieval caches four graph
indexes; a graph is capped at 8 MB, 20,000 nodes and 80,000 edges. Larger projects
need partitioned publishing, not silently truncated graphs. The server does not
have a revision-sharded graph database, vector search, or a claim of complete
cross-repository dependency analysis.

Before claiming “better than Graphify,” compare both on a held-out set of complete
coding tasks, including required source reads, indexing maintenance, network time,
total input/output tokens, stale-source rate and correctness. This change supplies
the working retrieval layer and reproducible measurements needed for that comparison.

## Technical references

[TypeScript's compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
provides the parser and symbol checker used here. [SCIP's symbol and occurrence
model](https://github.com/scip-code/scip/blob/main/scip.proto) is a useful future
interchange boundary for additional language indexers. [Graphify's implementation](https://github.com/Graphify-Labs/graphify)
is the comparison reference for broader local graph extraction and query workflows;
it was not executed in this benchmark.
