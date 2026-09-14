/**
 * Where a card has arrived — the law of the two small chips.
 *
 * Two sources say something about it, and neither says everything:
 *
 *   the card itself     `deployed` on /api/v1/cards — the chronicle's notes,
 *                       written once per lane the first time the picture saw
 *                       the card there. Memory: true stays true, and a lane
 *                       that was never noted is simply not noted.
 *   the picture         `cards[].deployed` on /api/v1/system — measured against
 *                       what the lane runs RIGHT NOW: true, false, or null when
 *                       nobody could tell (no token, budget, not yet measured).
 *                       And `evidence`, how many commits stand behind the card.
 *
 * The chips say only what is known. A card without a single commit has
 * nothing that could have arrived — no chips, rather than two hollow ones on
 * every card in making. A lane that was measured and holds nothing of the
 * card is outlined: "not there yet" is a fact. A lane nobody could measure
 * shows nothing: unknown is an answer, a hollow chip would be a guess.
 */
import type { Card, SystemCard } from './api';

export type Lane = 'development' | 'production';
export const LANES: Lane[] = ['development', 'production'];
export type Chip = 'filled' | 'outlined';

export function laneChips(card: Pick<Card, 'deployed'>, picture?: Pick<SystemCard, 'deployed' | 'evidence'> | null): Record<Lane, Chip | null> {
  const seen = card.deployed;
  const measured = picture?.deployed;
  const out: Record<Lane, Chip | null> = { development: null, production: null };
  const somewhere = LANES.some((lane) => seen?.[lane] === true || measured?.[lane] === true);
  if (!somewhere && !((picture?.evidence ?? 0) > 0)) return out;
  for (const lane of LANES) {
    if (seen?.[lane] === true || measured?.[lane] === true) out[lane] = 'filled';
    else if (measured?.[lane] === false) out[lane] = 'outlined';
  }
  return out;
}

/**
 * The address of a commit — the same string github.mjs builds for the
 * evidence links of the card's GitHub door (`commitUrl`), written here so a
 * link costs no request: the project's repository is already on the page.
 */
export const commitHref = (repo: string | null | undefined, sha: string | null | undefined): string | null =>
  (repo && sha ? `https://github.com/${repo}/commit/${sha}` : null);

/** A repository-relative path as a GitHub source link. */
export const fileHref = (repo: string | null | undefined, path: string | null | undefined): string | null =>
  (repo && path ? `https://github.com/${repo}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}` : null);
