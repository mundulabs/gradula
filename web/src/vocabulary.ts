/**
 * The vocabulary comes from the SERVICE, not from a copy.
 *
 * `src/spec.mjs` is the one place that knows what a state, a kind, a target and
 * a link kind are called in each language. The board imports it across the
 * package boundary on purpose: a second list of the same words in `web/` would
 * drift, and then a column would be called something the herald does not know.
 *
 * Only the words travel. Nothing of the service's machinery is pulled in — the
 * file is plain data and a few pure functions.
 */
export type Language = 'de' | 'en';

// @ts-expect-error — the service is plain JavaScript; these two exports are data.
import { WORDS as words, LANGUAGES as languages, KINDS as kinds, GATE_KINDS as gateKinds } from '../../src/spec.mjs';

export const WORDS = words as Record<Language, Record<string, string>>;
export const LANGUAGES = languages as Language[];

export const KINDS = kinds as string[];
export const GATE_KINDS = gateKinds as string[];
