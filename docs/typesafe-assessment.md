# TypeSafe / Jev assessment for Gradula

Reviewed 20 September 2026. Recommendation: an optional measured pilot, not a core dependency. A user-authorized synthetic API trial was run. An opt-in shadow pilot is now implemented; it does not change production task decisions. See [pilot operation and limits](decision-pilot.md).

## What the claims mean

Jev returns choices and scores instead of generating prose or code. The vendor's “zero hallucinations” comparison is explicitly a schema guarantee, not an empirical demonstration that decisions are always correct. A valid option can still be the wrong option. The published workflow comparison uses other models' consensus as its reference, and the vendor acknowledges selection and comparison limitations. It does not establish accuracy on Gradula repositories. [Vendor introduction and qualifications](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

The documented model is `jev-1.13.0`. Input costs $0.042 per million tokens; output is free. At 1,000 total billed input tokens per request, 10,000 requests cost $0.42 before fallback calls and other infrastructure. This is an illustrative calculation, not a measured Gradula bill. Pin a version for an evaluation; moving aliases can change behavior. The vendor says customer requests are not used for training; enterprise zero retention is a separate consideration. [Model reference](https://docs.typesafe.ai/models).

Confidence is derived from the output probability distribution. It is useful for abstention, but a value of 0.9 does not prove 90% correctness on our workload. Thresholds require local calibration. [Confidence documentation](https://docs.typesafe.ai/confidence). Inputs are text or JSON and questions share state while being evaluated independently. [State contract](https://docs.typesafe.ai/concepts/state).

## Where it could help

| Gradula workload | Recommendation |
| --- | --- |
| Exact paths, symbols, source edges, gates, permissions and reservations | Keep deterministic code. These currently need no model tokens. |
| Intent routing from an ambiguous request | Candidate pilot: choose context lookup, board lookup, or reasoning. Include abstain. |
| Relevance of a bounded set of retrieved files | Candidate pilot after existing retrieval. Measure file recall before cutting context. |
| Duplicate cards and suggested labels | Advisory suggestions with explicit provenance and human confirmation. |
| Approval, merging, deployment and evidence truth | Model confidence must never grant authority or substitute for actual checks. |
| Project automation | A decision node can select an allowed next step; the workflow engine owns permissions, retries, idempotency and audit records. |

The supplied Jev → direct decision / reasoning fallback diagram is a reasonable cascade for narrow tasks. In Gradula, put deterministic lookup before that cascade. Send a compact state and allowlisted candidates, then validate the returned choice. An uncertain answer, timeout, invalid response or unavailable provider returns to the existing route. Retain source IDs and record model/version, criteria version, probability, chosen route, billed usage and outcome.

Token reduction is conditional. Replacing our current graph search with Jev adds model usage. Savings arise only when Jev avoids a more expensive reasoning call, improves retrieval enough to reduce context, or prevents a retry without losing task quality. Compare the complete workflow: router input + fallback input/output + repeated calls + downstream coding tokens. A lower price per token alone is not fewer tokens.

## Evidence required before enabling it

Build a held-out set from real, consented Gradula tasks with human-reviewed labels. Split by project and time to avoid near-duplicate leakage. Include German and English, ambiguous requests, nonexistent files, stale snapshots, misleading instructions inside source text and unavailable-provider cases. English is currently the vendor's strongest language. [Language limitations](https://docs.typesafe.ai/models).

Compare deterministic retrieval/rules, the present reasoning route, and the cascade. Report task completion, file recall, false confident decisions, abstention coverage, calibration, p50/p95 latency and total billed cost. Choose thresholds on a development split, freeze them and report held-out results separately. Start in shadow mode: suggestions cannot change state. Enable only a reversible, low-impact routing action after the measured gain justifies another provider dependency.

We have a small synthetic routing trial, not representative production evidence. “State of the art”, guaranteed correctness and a particular token-saving percentage are therefore unsupported claims.

## Authorized live trial

The reproducible command is `node --env-file=/Users/davidblaesing/gradula/.env tools/typesafe-eval.mjs` on this workstation; other developers supply their own ignored credential file. It makes at most 24 requests, each capped at 3,000 bytes, with no retries, a 15-second timeout and an input-usage stop. It reads no repository or board data. Never commit the provider token.

Results are in [typesafe-trial.json](typesafe-trial.json): 24/24 synthetic intent-routing cases matched the authored labels, compared with 23/24 for a simple keyword baseline. Eighteen answers met the preselected confidence threshold of 0.9; all eighteen were correct. The other six would fall back. The set includes English, German, ambiguous requests and five examples with distracting instructions inside an untrusted document field. Median end-to-end latency was 308 ms and p95 was 387 ms. The API reported 10,392 input tokens, corresponding to approximately $0.000436 at the published input price, excluding other infrastructure. This is calculated usage cost, not a reconciled invoice.

The sample is tiny, authored for this trial and easy for the baseline. It establishes working authentication, valid outputs and inexpensive routing on these examples. It cannot establish calibration, robustness, production accuracy, a coding-token reduction or an advantage over the existing complete coding workflow. Do not switch core behavior on these results alone. The next useful experiment is shadow routing over a consented, human-labelled set of actual ambiguous requests.

## Next evaluation

The [cross-project decision pilot](decision-pilot.md) records skill selection, routing, review triage and text-intent recommendations, with persistent limits and attributed feedback. Initial synthetic results above remain separate from upcoming task results. No end-to-end savings have been established.

Provider ownership: [the pilot now supports project-owned keys](decision-pilot.md), supplied transiently from each client project environment. An operator-funded instance key is optional; open-source use does not include our account or require TypeSafe for core retrieval.
