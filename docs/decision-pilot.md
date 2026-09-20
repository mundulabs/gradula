# Jev decision pilot

Gradula hosts an opt-in, project-scoped **shadow experiment**. It recommends one item from a supplied catalog; it does not select tools automatically, change context retrieval, approve reviews, execute commands, or change task state. The caller continues its normal decision. TypeSafe receives only the submitted summary and candidate descriptions, never an automatically collected repository or skill body.

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

`kind` is `skill`, `route`, `review` or `intent`. `fallback` is always offered by the service. A probability-derived confidence of at least 0.9 is an experimental threshold, not a calibrated correctness guarantee. Low confidence, invalid responses, timeouts and provider failures preserve the normal route. A high-confidence suggestion is still shadow-only.

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

Keep `TYPESAFE_API_KEY` in **Gradula's deployment secrets**. Set `GRADULA_DECISION_PROJECTS=GRD,MDUS` to opt those projects in. A newly connected project needs its own explicit allowlist entry; it uses its existing Gradula credentials and never receives the provider key. An empty allowlist or missing key disables paid calls. The private local Gradula `.env` remains useful for manual trials, and is not copied into an image.

The fixed `jev-shadow-v1` campaign pins `jev-1.13.0`, allows 20 attempted calls per project and 100 across the installation, has a 2.5-second request timeout, no automatic retries, at most 12,000 request bytes, and at most 64,000 response bytes. PostgreSQL atomically reserves an attempt before contacting TypeSafe. Concurrent duplicate request ids do not issue another paid call. Failed and interrupted requests consume an attempt; a crash may leave a pending record rather than silently retrying. Limits survive restarts. These are request limits, not a guaranteed dollar invoice cap. Do not reset the campaign to evade its budget.

Stored records contain actor, time, model, catalog/input hashes, candidate ids, recommendations, usage and feedback. Raw briefs/descriptions and provider error bodies are not stored. Do not put sensitive text in candidate or request ids. Project isolation follows the authenticated Gradula project. Turning the allowlist off leaves reports available and restores the ordinary path immediately.
