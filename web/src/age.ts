/**
 * How long a card has been lying there — and when that is worth saying.
 *
 * A KANBAN COLUMN HIDES TIME. Twelve cards in `ready` look the same whether
 * they arrived this morning or in July, and the ones from July are the whole
 * problem. The board knew this already — `findings` reports it — but only on
 * a page nobody has open while they work.
 *
 * `touched`, not `created`: a card written three weeks ago that somebody said
 * something about yesterday is not three weeks old. The chronicle knows the
 * difference, so the board should not invent a worse answer from `created`.
 *
 * NOT A COLOUR. Age is not a state, and this house has exactly one warm
 * colour, which means "you are needed". Age gets a word and a weight — and
 * only past the threshold, because a number on every card is a number nobody
 * reads.
 */
export const QUIET_DAYS = 14;

const DAY = 86_400_000;

export type Age = {
  days: number;
  /** Open and untouched for longer than the board's patience. */
  idle: boolean;
  /** A date that has passed, on something still open. */
  overdue: boolean;
};

const OPEN = (state: string) => !['done', 'ice'].includes(state);

export function ageOf(
  card: { state: string; touched?: string | null; created?: string; due?: string | null },
  now = Date.now(),
): Age {
  const last = card.touched ?? card.created ?? null;
  const days = last ? Math.floor((now - new Date(last).getTime()) / DAY) : 0;
  const open = OPEN(card.state);
  return {
    days,
    idle: open && days >= QUIET_DAYS,
    // Compared as a day, not as a moment: `due` is a date, and a card is not
    // late at one minute past midnight of the day it is due.
    overdue: open && Boolean(card.due) && String(card.due) < new Date(now).toISOString().slice(0, 10),
  };
}

/** `3d`, `2w`, `4mo` — short, because it stands on a card, not in a report. */
export function shortAge(days: number): string {
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}
