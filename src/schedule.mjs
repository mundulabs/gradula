/**
 * The schedule — a report that comes by itself.
 *
 * A report you have to trigger is, by the second week, a report nobody
 * triggers. So it falls at the agreed hour.
 *
 * IT BELONGS TO THE HERALD, NOT TO THE PROJECT. A channel for the workshop
 * wants it daily, one for the clients weekly, and both hang on the same
 * board. One schedule per project would give everyone exactly one choice.
 *
 * IT STORES NO TIMESTAMPS OF THE FUTURE, only an hour and the last run.
 * Whoever stores the next appointment has to redraw it after every restart,
 * every clock change and every edit — and one day does not.
 *
 * In: schedule and clock. Out: due or not.
 */

export const CADENCES = ['daily', 'weekly', 'off'];

const DAY = 86_400_000;

/** The day in UTC, as a string — the unit a report thinks in. */
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

/**
 * Is this herald due now?
 *
 * `hour` is UTC. Deliberate: a service that knows time zones knows them
 * wrongly the moment somebody moves. Whoever wants 9 o'clock in Berlin enters
 * 7 — once, visibly.
 */
export function due(schedule, { now = Date.now() } = {}) {
  const cadence = schedule?.cadence ?? 'off';
  if (!CADENCES.includes(cadence) || cadence === 'off') return false;

  const at = new Date(now);
  const hour = Number.isFinite(schedule?.hour) ? schedule.hour : 8;
  if (at.getUTCHours() < hour) return false;

  const last = schedule?.lastRun ? new Date(schedule.lastRun).getTime() : 0;

  // Daily: once per calendar day, not "every 24 hours". Otherwise the hour
  // wanders a little later on every run, and after two weeks the morning
  // report arrives in the evening.
  if (cadence === 'daily') return !last || dayOf(last) !== dayOf(now);

  // Weekly: on the agreed weekday, and only once on it. The weekday is
  // checked BEFORE "never ran" — otherwise the first weekly report falls on
  // the day you set it up.
  const weekday = Number.isFinite(schedule?.weekday) ? schedule.weekday : 1;
  if (at.getUTCDay() !== weekday) return false;
  return !last || now - last > 6 * DAY;
}

/** Which heralds are due now — and over which period they report. */
export function dueHeralds(heralds, { now = Date.now() } = {}) {
  const out = [];
  for (const herald of heralds ?? []) {
    if (herald.active === false) continue;
    const schedule = herald.schedule;
    if (!due(schedule, { now })) continue;
    const cadence = schedule.cadence;
    out.push({
      herald,
      // Since the last run, and on the very first one since yesterday or
      // since a week ago: a first report covering the whole history would be
      // a wall nobody reads.
      since: schedule.lastRun ?? new Date(now - (cadence === 'daily' ? DAY : 7 * DAY)).toISOString(),
      period: cadence === 'daily' ? 'today' : 'this week',
    });
  }
  return out;
}
