# Jev decision pilot

> **Superseded on 21 September 2026 (GRAD-81).** The classifier, its doors, CLI verbs, MCP tools and provider keys were removed: across every labelled case it matched a keyword baseline and saved no task tokens. Task usage measurement stayed (`gradula measure on|off|report|collect`, [setup](setup.md)). This page is the record of the pilot as it ran.

Gradula hosts an opt-in, project-scoped decision experiment. Manual `decision-trial` calls remain shadow classifications. Repositories that explicitly enable task measurement also enroll upcoming board tasks in a normal-workflow or TypeSafe-advice arm. Advice can change an optional next step; it never overrides required skills, context retrieval, tests or review, and never executes commands. TypeSafe receives a bounded title and the approach catalog, never an automatically collected repository or skill body.

## Automatic task collection

Run `gradula decision-setup on` once in each consenting repository, using the updated Gradula CLI. The setting is local Git configuration, shared with that repository's worktrees; no daemon, background publisher or key is installed. A newly connected project must explicitly opt in and supply its own private provider key. Use `decision-setup off` to stop automatic enrollment and collection.

`gradula start` and MCP `plan_start` now enroll tasks automatically when a matching local Codex usage trace is available. A stable hash assigns each run to the baseline or TypeSafe arm before seeing a recommendation. Roughly half receive no classifier call. The other half receive at most one title-based route decision under the **existing** 20-attempt project campaign cap. The initial catalog chooses an optional starting approach: reproduce a regression, establish a behavior contract, follow an existing implementation, or verify documentation facts. This does not duplicate the deterministic file index. It is not automatic selection from a developer's installed skill library; supplied-catalog skill trials remain available separately.

The start response names the assigned arm, recommendation and collection status. If advice is offered, record whether you used it with `gradula decision-adopt CARD yes|no`, or MCP `plan_decision_adopt`. Unacknowledged advice stays **adoption unknown**; an offered recommendation is not evidence that it changed behavior. Missing traces, unsupported coders, disabled projects and exhausted limits preserve normal task work. Repeating start does not make another paid call. Updating a running MCP server requires restarting it; the CLI loads the updated integration on its next invocation.

`gradula move`, `decision-collect`, and `decision-report` collect enrolled usage. The existing report monitor can therefore collect later completion tokens without running another model trial. Moving to review is not the end of the model turn: collection waits for the corresponding completion event and includes its final response, then freezes that usage window. Board acceptance is reported separately from awaiting review. Reopening a task or overlapping cards in a thread is flagged as a collection gap rather than presented as a clean experiment.

Local private cursors live in the repository's common Git metadata, under `gradula-measure/`. They contain a trace path, session/turn identity, task/revision hashes and collection status, not task prose or keys. The adapter parses only usage, model and lifecycle metadata from the enrolled Codex JSONL trace. It discovers matching trace filenames, not other conversations' text. No transcript content is uploaded. This trace format is a locally verified adapter, not a promised stable public API; unknown/missing counters fail visibly. Remote workers and other coding tools need their own observed-usage adapter.

The reported **task-session window** starts at the beginning of the turn containing task start and ends after the completion turn. It includes observed coding-model inputs/outputs and retries across that window, plus separately reported classifier tokens. Cached input is already part of input, and reasoning output is already part of output: neither is added twice. Codex subscription billing is not inferred from token counts; coding-model dollar cost remains unknown. Delegated agents, overlapping tasks, missing traces, counter resets and unfinished turns are flagged. External model/tool usage remains explicitly unverified; a primary-session trace is not a guarantee that every other service was metered.

These are whole-task observations, **not automatically matched replays**. Different tasks in the two arms do not establish savings, even if one aggregate is lower. The report keeps `provenTokenSavings: null`; a claim requires comparable frozen-task runs, complete accounting of additional models/tools, and accepted outcomes as described below. No coding task is silently rerun and no paid trial is created by the monitor merely to fill a report.

## Where to try it

- **Skill selection:** identify the relevant optional skill from concise catalog descriptions. First obey explicit user choices and mandatory skill rules. Multiple necessary skills must fall back to normal selection. Load the actual skill before using it.
- **Task routing:** classify a brief as source lookup, board lookup, deeper reasoning or clarification. Exact paths and symbols should use deterministic lookup directly.
- **Review triage:** recommend the next specialist check, such as concurrency, authentication, data migration or UI behavior. This is not a review verdict. Keep required tests and human approval.
- **Mundus intent:** classify transcribed text into a small command or clarification catalog. This hosted network experiment is not realtime, not offline, and must never run on the audio callback or bypass native capability checks. No Mundus application integration is enabled by this pilot.

Jev accepts text/JSON, not audio or images. It is not fine-tuned on customer feedback; learning here means reviewing our evaluation data and deliberately improving catalogs and routing policies. See [model capabilities](https://docs.typesafe.ai/models) and [the initial assessment](typesafe-assessment.md).

## Upcoming tasks

For the next eligible ambiguous tasks, record the normal choice **before** seeing Jev, use one stable request id per decision, and supply a short sanitized brief plus 2–16 candidate descriptions. Skip trivial exact-match decisions. Never send credentials, customer data or entire source files. This is an optional pilot; it must not block the task.

From any connected repository, use its usual Gradula CLI and credentials:

```sh
node "$GRADULA_HOME/bin/gradula.mjs" decision-trial /path/to/decision.json
node "$GRADULA_HOME/bin/gradula.mjs" decision-feedback TRIAL_ID /path/to/feedback.json
node "$GRADULA_HOME/bin/gradula.mjs" decision-report
```

The equivalent MCP tools are `plan_decision_trial`, `plan_decision_feedback`, and `plan_decision_report`. An already-running MCP server must restart to discover added tools. The HTTP doors are `POST /api/v1/decision-trials`, `POST /api/v1/decision-trials/:id/feedback` and `GET /api/v1/decision-trials`, scoped by the existing project credential.

Example decision file (illustrative candidates, not an installed skill registry):

```json
{
  "requestId": "example-slide-task-1",
  "kind": "skill",
  "summary": "Turn the supplied quarterly outline into a presentation deck.",
  "baseline": "presentations",
  "candidates": [
    {"id": "presentations", "description": "Create and edit presentation decks."},
    {"id": "documents", "description": "Create and edit Word documents."},
    {"id": "spreadsheets", "description": "Analyze tabular data and create workbooks."}
  ]
}
```

`kind` is `skill`, `route`, `review` or `intent`. `fallback` is always offered by the service. A probability-derived confidence of at least 0.9 is an experimental threshold, not a calibrated correctness guarantee. Low confidence, invalid responses, timeouts and provider failures preserve the normal route. Manual high-confidence suggestions stay shadow-only; the separately opted-in task workflow offers them as optional advice.

After the task, a reviewer can submit `{"expected":"presentations"}`. Labels are attributed as agent or human according to authentication; neither implies independent ground truth. At most ten feedback entries are retained per trial, with the latest used in reports. Original feedback remains in the audit record. No thresholds, prompts or model weights update themselves.

## Measure actual savings

Shadow mode adds a classifier call; by itself it saves no task tokens. A later controlled replay may compare the existing workflow against a workflow using the suggestion on the **same frozen task**. Separate task wording/projects/time between tuning and held-out evaluation. Do not derive savings from Jev agreeing with the baseline or from its low price.

Optional feedback for two observed runs:

```json
{
  "expected": "presentations",
  "comparison": {
    "sameTask": true,
    "baselineRunId": "observed-baseline-run",
    "pilotRunId": "observed-pilot-run",
    "baseline": {"success": true, "inputTokens": 10000, "outputTokens": 1000, "costUsd": 0.05},
    "pilot": {"success": true, "inputTokens": 6000, "outputTokens": 1000, "costUsd": 0.035}
  }
}
```

Those numbers are illustrative, **not results**. Count all model inputs, outputs, retries, fallbacks and added tool-catalog/instruction overhead in each arm. Report actual billed costs so cache discounts are represented. Pilot values exclude the classifier call; Gradula adds that call's reported input tokens and estimated cost. Only use this schema for a comparison with one classifier decision; multi-decision task accounting needs trace-level aggregation before comparison. Duplicate run ids are excluded from aggregate comparisons. Without paired measurements the report returns `comparison: null`, not a guessed saving. Failed calls can have unknown billed usage and are counted as unmetered attempts. Reports separate decision accuracy from completed-task success.

Promote a use case only after a held-out evaluation shows lower complete-task cost with acceptable task success, file recall and false-confident error rate. Preserve a fallback and a switch to disable it. Review triage must not suppress mandatory checks.

## Central setup and limits

Projects bring their own optional TypeSafe credential. Put `TYPESAFE_API_KEY=...` in the **calling project's private, Git-ignored `.env`**, or inject it as a process secret. The CLI and MCP read only that variable, only for a trial POST. The environment takes precedence (an explicitly empty value disables file lookup); a worktree's `.env` takes precedence over the main checkout's `.env`. Another repository's or parent directory's key is never inherited. No key belongs in a committed manifest, candidate catalog, MCP argument or decision JSON file.

The client passes the key in `X-Gradula-Typesafe-Key` over HTTPS to the trusted Gradula instance named by `GRADULA_URL` (HTTP is allowed only on loopback for development). Credential-bearing requests refuse redirects. Gradula uses the key for that request to TypeSafe, never saves it in its database, never returns it in the result, and removes request headers from crash reports. Operators must also keep this header out of any custom reverse-proxy access logging. This model requires trusting the Gradula operator with the transient key; use a self-hosted instance if that trust is inappropriate.

Set `GRADULA_DECISION_PROJECTS=GRD,MDUS` on the server to opt projects in. A newly connected project supplies its own key and needs an allowlist entry for this capped pilot. Existing Gradula authentication still identifies the project and controls access. Ordinary graph/context/board features need **no TypeSafe key**. The open-source project includes no provider credential, subscription or paid dependency for core behavior.

An operator may optionally fund its own projects using a server-side `TYPESAFE_API_KEY` as an instance fallback. A supplied project key always wins; an invalid project key never retries against the operator's key. With no usable key, a trial returns `key-required` and consumes no attempt. Reports distinguish server opt-in from key availability. Clients do not send provider keys on report, feedback or ordinary board requests. Hosted workers that invoke trials should obtain their project's key from their own secret manager/process environment.

For this workstation, Gradula and Mundus use distinct user-supplied keys in their respective private `.env` files. A key can be replaced there without a code or server credential change; the client reads it for each trial request.

The fixed `jev-shadow-v1` campaign pins `jev-1.13.0`, allows 20 attempted calls per project and 100 across the installation, has a 2.5-second request timeout, no automatic retries, at most 12,000 request bytes, and at most 64,000 response bytes. PostgreSQL atomically reserves an attempt before contacting TypeSafe. Concurrent duplicate request ids do not issue another paid call. Failed and interrupted requests consume an attempt; a crash may leave a pending record rather than silently retrying. Limits survive restarts. These are request limits, not a guaranteed dollar invoice cap. Do not reset the campaign to evade its budget.

Stored records contain actor, time, model, catalog/input hashes, candidate ids, recommendations, usage and feedback. Raw briefs/descriptions and provider error bodies are not stored. Do not put sensitive text in candidate or request ids. Project isolation follows the authenticated Gradula project. Turning the allowlist off leaves reports available and restores the ordinary path immediately.
