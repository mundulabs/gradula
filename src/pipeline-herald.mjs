/** One durable Telegram message per workflow attempt, updated from real jobs.
 * This monitor does not depend on an open browser. Outside never receives it.
 */
import { fetchWorkflowRuns, fetchWorkflowJobs } from './github.mjs';
import { hashToken } from './store.mjs';

const label = (part) => part.status === 'completed' ? (part.conclusion ?? 'unknown') : (part.status ?? 'unknown');
export const stepMark = (step) => {
  if (step.status === 'completed') return step.conclusion === 'success' ? '■' : step.conclusion === 'skipped' ? '·' : '□';
  return step.status === 'in_progress' ? '▩' : '□';
};

export function pipelineText(project, run, jobs) {
  const lines = [`${project} · ${run.name} · ${run.branch} · ${run.commit}`, `Attempt ${run.attempt} · ${label(run)}`];
  for (const job of jobs) {
    const steps = job.steps.length ? job.steps : [job];
    const bar = steps.slice(0, 40).map(stepMark).join('') + (steps.length > 40 ? '…' : '');
    const current = job.steps.find((step) => step.status === 'in_progress')
      ?? job.steps.find((step) => step.status === 'completed' && !['success', 'skipped'].includes(step.conclusion));
    const line = `${bar} ${job.name} · ${label(job)}${current ? ` — ${current.name}` : ''}`;
    if ([...lines, line, run.url].join('\n').length > 3700) { lines.push('More jobs in the workflow run.'); break; }
    lines.push(line);
  }
  if (jobs.some(job => job.localFallback === 'billing')) lines.push('GitHub billing blocked the job before tests started. Local PR verification is required; no test failure is waived.');
  if (!jobs.length) lines.push('□ Waiting for job details');
  lines.push('■ succeeded · ▩ running · □ waiting / stopped · · skipped', run.url);
  return lines.join('\n');
}

export function createPipelineHerald({ store, heraldKinds, keyOf, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const busy = new Map();
  const poll = async (project) => {
    const heralds = (await store.heralds.list(project, { raw: true }))
      .filter((h) => h.active !== false && h.filter?.pipeline === true && h.filter?.visibility !== 'public' && h.chat && keyOf(h));
    if (!heralds.length) return [];
    const connection = await store.github.get(project);
    if (!connection?.repo) return [];
    const runs = await fetchWorkflowRuns(connection, { fetchImpl });
    const jobs = new Map();
    const results = [];
    for (const herald of heralds) {
      const kind = heraldKinds[herald.kind];
      if (!kind?.send || !kind?.edit) continue;
      const destination = `${connection.repo}:${herald.chat}:${hashToken(keyOf(herald))}`;
      const watchKey = `${destination}:watch`;
      let watch = await store.heraldDeliveries.get(herald.id, watchKey);
      if (!watch) {
        watch = { since: now() };
        await store.heraldDeliveries.set(herald.id, watchKey, watch);
      }
      for (const run of [...runs].reverse()) {
        const key = `${destination}:${run.id}:${run.attempt}`;
        const previous = await store.heraldDeliveries.get(herald.id, key);
        // Do not replay completed history when a subscription is first enabled.
        if (!previous && run.status === 'completed' && (!run.at || run.at < watch.since)) continue;
        if (previous?.completed && previous.updatedAt === run.at) continue;
        const jobKey = `${run.id}:${run.attempt}`;
        if (!jobs.has(jobKey)) jobs.set(jobKey, await fetchWorkflowJobs(connection, run, { fetchImpl }));
        const text = pipelineText(project, run, jobs.get(jobKey));
        const fingerprint = hashToken(text);
        if (fingerprint === previous?.fingerprint) {
          if (previous.updatedAt !== run.at) await store.heraldDeliveries.set(herald.id, key, { ...previous, updatedAt: run.at, completed: run.status === 'completed' });
          continue;
        }
        const address = { token: keyOf(herald), chat: herald.chat };
        let result = previous?.messageId
          ? await kind.edit(address, previous.messageId, text, { fetchImpl, preview: false })
          : await kind.send(address, text, { fetchImpl, preview: false });
        // A user may have removed this bot message. Only an explicit not-found
        // permits a replacement; timeouts and rate limits never trigger a send.
        if (result.missing) result = await kind.send(address, text, { fetchImpl, preview: false });
        if (result.sent && result.messageId) {
          await store.heraldDeliveries.set(herald.id, key, { messageId: result.messageId, fingerprint,
            completed: run.status === 'completed', updatedAt: run.at });
        }
        results.push({ herald: herald.id, run: run.id, ...result });
      }
    }
    return results;
  };
  return {
    poll(project) {
      if (busy.has(project)) return busy.get(project);
      const pending = poll(project).finally(() => busy.delete(project));
      busy.set(project, pending);
      return pending;
    },
  };
}
