/**
 * The report — many moves become one message.
 *
 * A herald says one sentence per move. That is right for a workshop channel
 * and wrong for everyone else: whoever gets forty lines reads none of them.
 * A report answers a different question — **what happened, in total** — and it
 * answers it in one message.
 *
 * IT IS COMPOSED FROM THE CHRONICLE, not from a second store. Whoever keeps a
 * second list of "what shipped" maintains a worse copy of the history from the
 * second week onwards. Everything here reads what already stands.
 *
 * TWO SHAPES OF THE SAME FACTS. The plain one carries keys, labels and gates,
 * because a developer wants to click. The human one carries titles and
 * reasons, because a reader wants to understand — and it names no key, no
 * actor and no module, since none of that means anything outside the house.
 *
 * Pure: history and cards in, text out. No store, no clock, no network.
 */

const BY_LENGTH = (a, b) => b.length - a.length;

/**
 * A share, as ten blocks.
 *
 * IT IS ONLY HONEST WHERE THERE IS A WHOLE. A milestone has parts, so "6 of 8
 * settled" has a bar; "31 cards finished this week" has none, because there
 * is no denominator and a bar would invent one. That is the whole rule, and
 * it is why this is not offered for anything else.
 *
 * Ten blocks, not twenty: in a chat the line has to survive a phone. The
 * characters are FULL and LIGHT SHADE — both are one cell wide in every
 * monospace face, which is why the bars line up under each other. Telegram
 * puts them in <code>, or a proportional font makes a ladder of them.
 */
export function bar(share, cells = 10) {
  if (share === null || share === undefined || Number.isNaN(share)) return '';
  const full = Math.round(Math.max(0, Math.min(1, share)) * cells);
  return '█'.repeat(full) + '░'.repeat(cells - full);
}

/** Telegram's HTML mode needs exactly three characters escaped. That is the whole reason we use it. */
export const escapeHtml = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const trim = (text, n) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

/**
 * What the period contains. `entries` is the project history (newest first is
 * fine, order does not matter here), `cards` every card of the project.
 */
export function gather(entries, cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = { done: [], decided: [], ingested: [], started: [] };
  const actors = new Set();
  const touched = new Set();

  for (const entry of entries) {
    const card = byId.get(entry.item);
    if (!card) continue;
    touched.add(card.key);
    if (entry.actor) actors.add(entry.actor);
    if (entry.verb === 'moved' && entry.data?.to === 'done') seen.done.push({ card, entry });
    else if (entry.verb === 'decided') seen.decided.push({ card, entry });
    else if (entry.verb === 'ingested') seen.ingested.push({ card, entry });
    else if (entry.verb === 'started') seen.started.push({ card, entry });
  }

  // The same card can be moved to done twice (reopened, closed again). The
  // report shows it once — a list that counts one thing twice is a list nobody
  // checks against reality.
  const once = (list) => {
    const byKey = new Map();
    for (const row of list) byKey.set(row.card.key, row);
    return [...byKey.values()].sort((a, b) => String(a.card.key).localeCompare(String(b.card.key), 'en', { numeric: true }));
  };

  return {
    done: once(seen.done),
    decided: once(seen.decided),
    incidents: once(seen.ingested),
    started: once(seen.started),
    actors: [...actors].sort(),
    touched: touched.size,
    // Released is the subset that actually left the house.
    released: once(seen.done).filter((r) => r.card.target === 'release'),
  };
}

const labelsOf = (card) => [...new Set([...(card.module ?? []), ...(card.stack ?? [])])];

/**
 * The plain shape: keys, labels, gates. For the people who will click.
 */
export function plainReport(found, { project, period = null } = {}) {
  const lines = [`${project} · report${period ? ` · ${period}` : ''}`];
  const block = (title, rows, render) => {
    if (!rows.length) return;
    lines.push('', `${title} (${rows.length})`);
    for (const row of rows) lines.push(`  ${render(row)}`);
  };

  block('done', found.done, ({ card }) => {
    const labels = labelsOf(card);
    const gate = card.gate ? ` · gate ${card.gate.kind}` : ' · NO GATE';
    return `${card.key.padEnd(9)} ${trim(card.title, 60)}${labels.length ? `  [${labels.join(' ')}]` : ''}${gate}`;
  });
  block('decided', found.decided, ({ card, entry }) =>
    `${card.key.padEnd(9)} ${trim(card.title, 60)}${entry.data?.reason ? ` — ${trim(entry.data.reason, 70)}` : ''}`);
  block('incidents', found.incidents, ({ card }) =>
    `${card.key.padEnd(9)} ${trim(card.title, 60)}${card.count ? ` ×${card.count}` : ''}`);
  block('started', found.started, ({ card }) => `${card.key.padEnd(9)} ${trim(card.title, 60)}`);

  lines.push('', `${found.touched} cards touched · ${found.actors.length} actors`);
  return lines.join('\n');
}

/**
 * The human shape. No key, no actor, no module — outside the house none of
 * those mean anything, and a reader who has to decode is a reader who stops.
 */
export function humanReport(found, { period = null } = {}) {
  const parts = [];
  const head = period ? `What happened ${period}` : 'What happened';
  parts.push(head);

  if (found.released.length) {
    parts.push('', 'Shipped:');
    for (const { card } of found.released) parts.push(`• ${trim(card.title, 90)}`);
  }
  const rest = found.done.filter((r) => r.card.target !== 'release');
  if (rest.length) {
    parts.push('', 'Finished:');
    for (const { card } of rest) parts.push(`• ${trim(card.title, 90)}`);
  }
  if (found.decided.length) {
    parts.push('', 'Decided:');
    for (const { card, entry } of found.decided) {
      parts.push(`• ${trim(card.title, 90)}`);
      if (entry.data?.reason) parts.push(`  ${trim(entry.data.reason, 140)}`);
    }
  }
  if (found.incidents.length) {
    parts.push('', 'Crashes that came in:');
    for (const { card } of found.incidents) parts.push(`• ${trim(card.title, 90)}`);
  }
  // Where there IS a whole: a bundle's parts, and how many of them are settled.
  if (found.goals?.length) {
    parts.push('', 'Where we are going:');
    for (const goal of found.goals) {
      parts.push(`${bar(goal.share)}  ${goal.done + goal.dropped}/${goal.total}  ${trim(goal.title, 60)}`);
    }
  }
  if (parts.length === 1) parts.push('', 'Nothing moved.');
  return parts.join('\n');
}

/**
 * The same report for Telegram. `<pre>` for the plain one, because a table
 * that reflows is not a table; light emphasis for the human one.
 */
export function htmlReport(found, { project, period = null, voice = 'human' } = {}) {
  if (voice === 'plain') {
    return `<b>${escapeHtml(project)}</b>\n<pre>${escapeHtml(plainReport(found, { project, period }))}</pre>`;
  }
  const text = humanReport(found, { period });
  const [head, ...rest] = text.split('\n');
  return [`<b>${escapeHtml(head)}</b>`, ...rest.map((line) => {
    if (/^[A-Z][a-z].*:$/.test(line)) return `<b>${escapeHtml(line)}</b>`;
    // A bar only lines up in a monospace face — proportionally the blocks
    // make a ladder. <code> is the one thing Telegram gives us for that.
    const bars = line.match(/^([█░]+)(\s+.*)$/);
    return bars ? `<code>${escapeHtml(bars[1])}</code>${escapeHtml(bars[2])}` : escapeHtml(line);
  })].join('\n');
}
