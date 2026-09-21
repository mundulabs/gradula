/** Gradula motion policy: every cue represents board state or observed activity. */

import type { Card } from './api';

export type Signal = 'working' | 'attention' | 'changed';


export type BeamSetting = {
  size: 'sm' | 'md' | 'line' | 'pulse-outside' | 'pulse-inner';
  duration: number;

  color: 'mono' | 'sunset';
};


export const IMPULSE_MS = 2400;


export const isRunning = (card: Card) => card.running === true;


export function signalOf(card: Card, justChanged = false): Signal | null {
  if (justChanged) return 'changed';
  // Being worked on: someone pressed start and it has not come back.
  if (card.state === 'making') return 'working';
  // Needing a hand: a review somebody ASKED for, labels nobody confirmed — or
  // an open crash that Sentry called fatal. The last one is why this stayed
  // ONE signal instead of growing a second warm colour: "you are needed" is
  // the same sentence whoever is saying it, and a board with two alarms has
  // none. A settled card is quiet however bad the crash was.
  //
  // A card the PIPELINE put in review — seen on dev, on its way to production,
  // where it goes to done by itself — needs nobody. It may be looked at on dev
  // and sent back if it is wrong; it must not be approved. Orange on every
  // deployed card for the hour between dev and main would be the alarm that
  // means nothing. So: review is warm only when the card is not on dev yet,
  // which is the one way a person, not a deployment, put it there.
  const unconfirmed = (card.suggestions?.module?.length ?? 0) + (card.suggestions?.stack?.length ?? 0);
  const loud = (card.level === 'fatal' || card.level === 'error') && !['done', 'ice'].includes(card.state);
  const asked = card.state === 'review' && !card.deployed?.development;
  if (asked || unconfirmed > 0 || loud) return 'attention';
  return null;
}


export function beamFor(signal: Signal | null): BeamSetting | null {
  switch (signal) {
    case 'working': return { size: 'md', duration: 1 / 0.9 * 6, color: 'mono' };
    case 'attention': return { size: 'pulse-inner', duration: 1 / 0.8 * 6, color: 'sunset' };
    case 'changed': return { size: 'pulse-inner', duration: 1 / 1.6 * 6, color: 'mono' };
    default: return null;
  }
}





export function changedBetween(before: Card[], after: Card[]): Set<string> {
  const was = new Map(before.map((c) => [c.key, `${c.state}|${c.title}|${c.gate?.call ?? ''}`]));
  const moved = new Set<string>();
  for (const card of after) {
    const then = was.get(card.key);
    if (then !== undefined && then !== `${card.state}|${card.title}|${card.gate?.call ?? ''}`) moved.add(card.key);
  }
  return moved;
}


export const LEVEL_CLASS: Record<string, string> = {
  fatal: 'level level-fatal',
  error: 'level level-error',
  warning: 'level level-warning',
  info: 'level level-info',
  debug: 'level level-debug',
};
