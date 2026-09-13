/**
 * GitHub — the connection that makes a piece of evidence clickable.
 *
 * Until today evidence was a hash: `abc1234`, and nobody got anywhere from
 * there. Evidence you cannot open is a claim with a checksum attached.
 *
 * It keeps the contract from docs/connections.md:
 *
 *   verify()   credentials? Reads, changes nothing.
 *   fetch…()   collect facts: commit, branch, check runs.
 *   writeBack  EMPTY. Gradula writes into nobody else's repository.
 *
 * WHAT IT DOES NOT DO: fetch logs. A check run has one line of truth (green,
 * red, running) and a link to the real log — whoever rebuilds the log
 * maintains a worse copy of it forever (manifest, "no second CI").
 *
 * And it needs NO write access. A read token is enough; anything more would
 * be a planning board with rights over the source.
 */

const API = 'https://api.github.com';

const line = (text) => String(text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 120);

/** A check run has three states, and a board needs no more than that. */
const CHECK = { success: 'green', failure: 'red', cancelled: 'red', timed_out: 'red', action_required: 'red' };
const standingOfRun = (run) => (run.status !== 'completed' ? 'running' : CHECK[run.conclusion] ?? 'idle');

async function ask(path, token, fetchImpl) {
  const response = await fetchImpl(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Do the credentials hold, and do they see the repository? */
export async function verify({ repo, token }, { fetchImpl = fetch } = {}) {
  if (!repo) return { ok: false, reason: 'no repository' };
  try {
    const { status, body } = await ask(`/repos/${repo}`, token, fetchImpl);
    if (status === 404) return { ok: false, reason: 'the repository is not visible with this key' };
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (!body?.full_name) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return { ok: true, repo: body.full_name, private: Boolean(body.private) };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The address of a commit. NO network — a link is a string, and making a
 * request for one would be waste with a waiting time attached.
 */
export const commitUrl = (repo, hash) => (repo && hash ? `https://github.com/${repo}/commit/${hash}` : null);
export const branchUrl = (repo, branch) => (repo && branch ? `https://github.com/${repo}/tree/${branch}` : null);

/**
 * What hangs on a branch: the open PR and the standing of its check runs.
 *
 * `gradula start --tree` creates `plan/GRD-33` — so the branch knows the
 * card, and the card can find its branch again here.
 */
export async function branchStanding({ repo, token, branch }, { fetchImpl = fetch } = {}) {
  if (!repo || !branch) return { ok: false, reason: 'not set up' };
  try {
    const owner = repo.split('/')[0];
    const { body: pulls } = await ask(`/repos/${repo}/pulls?head=${owner}:${branch}&state=all&per_page=1`, token, fetchImpl);
    const pull = Array.isArray(pulls) ? pulls[0] : null;

    const { status, body: head } = await ask(`/repos/${repo}/commits/${encodeURIComponent(branch)}`, token, fetchImpl);
    if (status === 404) return { ok: true, branch, exists: false, pull: null, checks: [] };
    const sha = head?.sha ?? null;

    const { body: runs } = sha
      ? await ask(`/repos/${repo}/commits/${sha}/check-runs?per_page=10`, token, fetchImpl)
      : { body: null };

    const checks = (runs?.check_runs ?? []).map((run) => ({
      name: line(run.name),
      standing: standingOfRun(run),
      url: run.html_url ?? null,
    }));

    return {
      ok: true,
      branch,
      exists: true,
      commit: sha ? { hash: sha.slice(0, 12), title: line(head?.commit?.message), url: commitUrl(repo, sha) } : null,
      pull: pull ? { number: pull.number, state: pull.merged_at ? 'merged' : pull.state, title: line(pull.title), url: pull.html_url } : null,
      checks,
      // ONE line of truth, as in the manifest. Red beats running beats green:
      // whoever sees only "green" because one of ten checks was green is wrong.
      standing: checks.some((c) => c.standing === 'red') ? 'red'
        : checks.some((c) => c.standing === 'running') ? 'running'
        : checks.length && checks.every(c => c.standing === 'green') ? 'green' : 'idle',
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The pipeline: the last workflow runs of the repository, one line each.
 *
 * The same three states as a check run — a workflow run is a check run
 * with a name and a branch — and the same refusal to fetch logs: the link
 * points at the real one.
 */
export async function fetchPipeline({ repo, token }, { fetchImpl = fetch, limit = 10 } = {}) {
  if (!repo) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(`/repos/${repo}/actions/runs?per_page=${limit}`, token, fetchImpl);
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (status === 404) return { ok: false, reason: 'the repository is not visible with this key' };
    if (!Array.isArray(body?.workflow_runs)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return {
      ok: true,
      runs: body.workflow_runs.slice(0, limit).map((run) => ({
        name: line(run.name ?? run.display_title),
        branch: run.head_branch ?? null,
        status: standingOfRun(run),
        at: run.updated_at ?? run.created_at ?? null,
        url: run.html_url ?? null,
        commit: run.head_sha ? String(run.head_sha).slice(0, 12) : null,
        title: line(run.display_title),
      })),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/** Only GitHub's explicit pre-start billing annotation permits local fallback.
 * A failure in a test, or missing access to diagnostics, never implies billing.
 */
export async function billingBlocked({repo, token}, checkId, {fetchImpl = fetch} = {}) {
  if (!/^\d+$/.test(String(checkId))) return false;
  try {
    const {status, body} = await ask(`/repos/${repo}/check-runs/${checkId}/annotations`, token, fetchImpl);
    return status === 200 && Array.isArray(body) && body.some(a =>
      /job was not started because/i.test(a.message ?? '') &&
      /payments have failed|spending limit/i.test(a.message ?? ''));
  } catch { return false; }
}

/** The releases: a tag, a date, a link — what the store and TestFlight hang on. */
export async function fetchReleases({ repo, token }, { fetchImpl = fetch, limit = 5 } = {}) {
  if (!repo) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(`/repos/${repo}/releases?per_page=${limit}`, token, fetchImpl);
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (status === 404) return { ok: false, reason: 'the repository is not visible with this key' };
    if (!Array.isArray(body)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return {
      ok: true,
      releases: body.slice(0, limit).map((release) => ({
        tag: release.tag_name ?? null,
        name: line(release.name),
        at: release.published_at ?? release.created_at ?? null,
        url: release.html_url ?? null,
        prerelease: Boolean(release.prerelease),
      })),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * The commits on a branch, newest first — sha, title, when. This is how a
 * deployment's title finds its sha again (deployed.mjs): Dokploy keeps the
 * commit message, GitHub keeps the commit, and the first line is the seam.
 */
export async function fetchBranchCommits({ repo, token, branch }, { fetchImpl = fetch, limit = 100 } = {}) {
  if (!repo || !branch) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`, token, fetchImpl);
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (status === 404) return { ok: false, reason: `${branch} is not visible with this key` };
    if (!Array.isArray(body)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return {
      ok: true,
      commits: body.map((c) => ({
        sha: String(c.sha ?? ''),
        title: line(c.commit?.message),
        at: c.commit?.committer?.date ?? c.commit?.author?.date ?? null,
      })).filter((c) => c.sha),
    };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * One commit by its sha — title, the whole message, when. A webhook
 * deployment names only its sha; the `Plan:` lines that say which cards it
 * carries are in the message, and the message is here. Immutable: whoever
 * asks twice has asked once too often (deployed.mjs keeps the answer).
 */
export async function fetchCommit({ repo, token, sha }, { fetchImpl = fetch } = {}) {
  if (!repo || !sha) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(`/repos/${repo}/commits/${encodeURIComponent(sha)}`, token, fetchImpl);
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (status === 404) return { ok: false, reason: `${String(sha).slice(0, 12)} is not visible with this key` };
    if (!body?.sha) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    return { ok: true, sha: String(body.sha), title: line(body.commit?.message), message: String(body.commit?.message ?? ''), at: body.commit?.committer?.date ?? body.commit?.author?.date ?? null };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/**
 * How two commits stand to each other: `identical`, `behind` (head is an
 * ancestor of base), `ahead`, `diverged`. Between two fixed commits that
 * never changes — whoever asks twice has asked once too often.
 */
export async function compareCommits({ repo, token, base, head }, { fetchImpl = fetch } = {}) {
  if (!repo || !base || !head) return { ok: false, reason: 'not set up' };
  try {
    const { status, body } = await ask(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, token, fetchImpl);
    if (status === 401) return { ok: false, reason: 'the key is not valid' };
    if (status === 404) return { ok: false, reason: 'one of the two commits is not visible with this key' };
    if (!['identical', 'behind', 'ahead', 'diverged'].includes(body?.status)) return { ok: false, reason: `unexpected answer (HTTP ${status})` };
    // the commits between base and head, with their messages — how a release knows which cards it carries (releases.mjs)
    const commits = Array.isArray(body.commits) ? body.commits.map((c) => ({ sha: String(c.sha ?? ''), message: String(c.commit?.message ?? '') })).filter((c) => c.sha) : [];
    return { ok: true, status: body.status, commits };
  } catch (error) {
    return { ok: false, reason: line(error.message) };
  }
}

/** A connection never shows its key outward. */
export const publicConnection = (connection) => (connection
  ? { repo: connection.repo, token: connection.token ? 'set' : null, setAt: connection.setAt ?? null }
  : null);

/** Workflow progress keeps GitHub's actual status, run id and retry attempt.
 * Only metadata, never logs or credentials, enters a herald message. */
export async function fetchWorkflowRuns({ repo, token }, { fetchImpl = fetch } = {}) {
  const { status, body } = await ask(`/repos/${repo}/actions/runs?per_page=30`, token, fetchImpl);
  if (status !== 200 || !Array.isArray(body?.workflow_runs)) throw new Error(`GitHub workflow runs: HTTP ${status}`);
  return body.workflow_runs.map((run) => ({
    id: run.id, attempt: run.run_attempt ?? 1, name: line(run.name),
    branch: line(run.head_branch), commit: String(run.head_sha ?? '').slice(0, 7),
    status: run.status, conclusion: run.conclusion, at: run.updated_at ?? run.created_at,
    url: `https://github.com/${repo}/actions/runs/${run.id}`,
  }));
}

export async function fetchWorkflowJobs({ repo, token }, run, { fetchImpl = fetch } = {}) {
  const jobs = [];
  for (let page = 1; page <= 5; page++) {
    const { status, body } = await ask(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100&page=${page}`, token, fetchImpl);
    if (status !== 200 || !Array.isArray(body?.jobs)) throw new Error(`GitHub workflow jobs: HTTP ${status}`);
    jobs.push(...await Promise.all(body.jobs.map(async (job) => ({ name: line(job.name), status: job.status, conclusion: job.conclusion,
      ...(job.conclusion === 'failure' && !(job.steps ?? []).length && await billingBlocked({repo,token}, job.check_run_url?.split('/').at(-1), {fetchImpl}) ? {localFallback: 'billing'} : {}),
      steps: (job.steps ?? []).map((step) => ({ name: line(step.name), status: step.status, conclusion: step.conclusion })) }))));
    if (jobs.length >= body.total_count || body.jobs.length < 100) return jobs;
  }
  throw new Error('GitHub workflow has more than 500 jobs; see the run for progress.');
}
