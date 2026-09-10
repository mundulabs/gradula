/**
 * When something moves, and what it means.
 *
 * Mundula's design law says: the orange means state, never decoration. This is
 * the same law for motion. **Every effect on this board shows a fact from the
 * board — or it does not go in.** A card that shimmers because shimmering
 * looks good teaches the eye to ignore shimmering, and then the one card that
 * really is being worked on says nothing.
 *
 * The three signals and their shapes come from the kit
 * (`packages/ui/src/effect-policy.ts`, `signalBeam`), because a house that
 * moves differently in two products has no language, only effects:
 *
 *   generating travels        — rotate
 *   needing a hand breathes   — pulse
 *   a landed change           — one short pulse that ends by itself
 *
 * THE ORB NOW HAS ITS FACT. It used to be missing on purpose: an orb means "a
 * runner is working on this right now", and the board could not know that.
 * Since the heartbeat it can — `gradula work` holds a lease, and the lease goes
 * stale by itself when the laptop closes. So the orb spins exactly while a
 * machine is really at work, and stops without anybody clearing a flag.
 *
 * Note the difference to the beam: `making` is a STATE someone put the card in
 * and may leave it in for days. `running` is a MACHINE, right now. Two facts,
 * two shapes — showing them as one would lose the interesting half.
 */
import type { Card } from './api';

export type Signal = 'working' | 'attention' | 'changed';

/**
 * The kit names it speed, border-beam names it duration — the same idea from
 * the other end. One place translates, so that nobody translates twice.
 */
export type BeamSetting = {
  size: 'sm' | 'md' | 'line' | 'pulse-outside' | 'pulse-inner';
  duration: number;
  /**
   * Colour DOUBLES the shape, it does not open a second language. Mundula's
   * design law says the orange means state, never decoration — so exactly one
   * signal is warm, and it is the one that means *you* are needed. Everything
   * else stays mono: progress is not an alarm.
   *
   * Doubling is deliberate. Shape alone fails nobody, colour alone fails the
   * colour-blind; both together fail neither, as long as they say the same
   * thing.
   */
  color: 'mono' | 'sunset';
};

/** How long a landed change keeps pulsing. Short: it is a notice, not a state. */
export const IMPULSE_MS = 2400;

/** Is a machine at work on this card at this moment? */
export const isRunning = (card: Card) => card.running === true;

/** What a card is saying right now — or nothing, which is the common case. */
export function signalOf(card: Card, justChanged = false): Signal | null {
  if (justChanged) return 'changed';
  // Being worked on: someone pressed start and it has not come back.
  if (card.state === 'making') return 'working';
  // Needing a hand: waiting for review, carrying labels nobody confirmed — or
  // an open crash that Sentry called fatal. The last one is why this stayed
  // ONE signal instead of growing a second warm colour: "you are needed" is
  // the same sentence whoever is saying it, and a board with two alarms has
  // none. A settled card is quiet however bad the crash was.
  const unconfirmed = (card.suggestions?.module?.length ?? 0) + (card.suggestions?.stack?.length ?? 0);
  const loud = (card.level === 'fatal' || card.level === 'error') && !['done', 'ice'].includes(card.state);
  if (card.state === 'review' || unconfirmed > 0 || loud) return 'attention';
  return null;
}

/**
 * The kit's law, one to one. `colorVariant` stays `mono` everywhere: the kit
 * says Mundula Studio stays on mono, and a house that is grey in one product
 * and rainbow in the next has no language, only effects.
 */
export function beamFor(signal: Signal | null): BeamSetting | null {
  switch (signal) {
    case 'working': return { size: 'md', duration: 1 / 0.9 * 6, color: 'mono' };
    case 'attention': return { size: 'pulse-inner', duration: 1 / 0.8 * 6, color: 'sunset' };
    case 'changed': return { size: 'pulse-inner', duration: 1 / 1.6 * 6, color: 'mono' };
    default: return null;
  }
}

/**
 * THE HUE MUST NOT WANDER.
 *
 * border-beam shifts the hue by ±30° while it animates, and it is on by
 * default. So `sunset` — the one warm signal, the one that means "you are
 * needed" — drifted into magenta, and on the legend the same beam read as
 * teal. A colour that means a state and then quietly becomes another colour
 * is worse than no colour: it teaches the eye that the colour means nothing.
 *
 * The library offers four fixed palettes (`colorful | mono | ocean | sunset`)
 * and no way to hand it ours. Holding them still is what we can do from
 * outside; giving the beam this house's own tokens means vendoring it, the
 * way the kit next door already does.
 */
export const BEAM_STATIC = true;

/**
 * Which cards changed between two readings. The board polls; this turns two
 * lists into the one fact a person cares about — what moved while I looked
 * away.
 */
export function changedBetween(before: Card[], after: Card[]): Set<string> {
  const was = new Map(before.map((c) => [c.key, `${c.state}|${c.title}|${c.gate?.call ?? ''}`]));
  const moved = new Set<string>();
  for (const card of after) {
    const then = was.get(card.key);
    if (then !== undefined && then !== `${card.state}|${card.title}|${card.gate?.call ?? ''}`) moved.add(card.key);
  }
  return moved;
}

/**
 * How bad Sentry thought it was, as a class. Written out, not composed: a
 * class name built from a value is one no test can find and no stylesheet can
 * be checked against — the surface test caught `level-${card.level}` the
 * moment it was written, which is exactly what it is for.
 *
 * It lives HERE, next to the beam, because it is the same kind of law: what
 * the surface is allowed to say with colour. And it is the one place where a
 * second warm colour is allowed, because a level is not a state — moving the
 * card does not change what the crash weighed.
 */
export const LEVEL_CLASS: Record<string, string> = {
  fatal: 'level level-fatal',
  error: 'level level-error',
  warning: 'level level-warning',
  info: 'level level-info',
  debug: 'level level-debug',
};
