/** A bounded window combines completion bursts per project and recipient.
 * This changes delivery only; the chronicle still records every transition.
 */
export function createCompletionBatch({ delay = 5000 } = {}) {
  const pending = new Map();
  return {
    enqueue(key, entry, deliver) {
      return new Promise((resolve) => {
        let batch = pending.get(key);
        if (!batch) {
          batch = { entries: [], waiters: [] };
          pending.set(key, batch);
          setTimeout(async () => {
            pending.delete(key);
            let result;
            try { result = await deliver(batch.entries); }
            catch { result = { sent: false, reason: 'completion summary delivery failed' }; }
            batch.waiters.forEach(done => done(result));
          }, delay);
        }
        batch.entries.push(entry);
        batch.waiters.push(resolve);
      });
    },
  };
}

export function completionSummary(entries, project, { language = 'en', limit = 12 } = {}) {
  const cards = [...new Map(entries.map(entry => [entry.card.key, entry.card])).values()];
  const de = language === 'de';
  const lines = cards.slice(0, limit).map(card => `• ${card.key} · ${String(card.title ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
  if (cards.length > limit) lines.push(de ? `… und ${cards.length - limit} weitere` : `… and ${cards.length - limit} more`);
  return `${String(project).slice(0, 80)} · ${cards.length} ${de ? 'Karten abgeschlossen' : 'cards completed'}\n\n${lines.join('\n')}`;
}
