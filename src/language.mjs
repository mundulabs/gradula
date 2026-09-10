/**
 * Which language a card is written in — guessed, and never more than guessed.
 *
 * A board with developers in three countries drifts: half the cards in German,
 * half in English, and then nobody can search it and neither reader can put it
 * right alone. `project.language` says which one this board writes in. This
 * says which one a card actually IS.
 *
 * IT NEVER REFUSES. A title of four words is not enough evidence to turn
 * somebody away at the door, and a board that rejects "GPU flackert bei
 * resize" teaches people to write nothing rather than to write English. So the
 * answer is a FINDING — the same shelf as "open tasks without a gate": named,
 * countable, and with the cards listed beside it.
 *
 * The evidence is deliberately crude and deliberately one-sided:
 *
 *   - German has letters English does not (ä ö ü ß). One of them is proof.
 *   - Both have common short words that almost never appear in the other.
 *     Those vote, they do not decide.
 *
 * `null` means "not enough to say", and that is the answer for most short
 * titles. A guess with no evidence is worse than no guess: it fills a finding
 * with cards nobody needs to look at, and then the finding gets ignored.
 */

/** Words that are common in one language and rare in the other. */
const MARKERS = {
  de: ['der', 'die', 'das', 'den', 'dem', 'und', 'oder', 'nicht', 'kein', 'keine', 'ist', 'sind',
    'wird', 'werden', 'ein', 'eine', 'einen', 'für', 'fuer', 'mit', 'ohne', 'auf', 'aus', 'bei',
    'von', 'nach', 'noch', 'schon', 'wenn', 'weil', 'aber', 'auch', 'beim', 'zum', 'zur', 'soll',
    'muss', 'kann', 'wie', 'was', 'wer', 'wo', 'sich', 'man', 'nur', 'sehr', 'immer', 'jetzt'],
  en: ['the', 'and', 'or', 'not', 'is', 'are', 'was', 'were', 'a', 'an', 'of', 'for', 'with',
    'without', 'on', 'from', 'at', 'by', 'after', 'still', 'already', 'if', 'because', 'but',
    'also', 'should', 'must', 'can', 'how', 'what', 'who', 'where', 'only', 'very', 'always',
    'now', 'this', 'that', 'these', 'those', 'when', 'while', 'into'],
};

const GERMAN_LETTERS = /[äöüßÄÖÜ]/;

/**
 * @returns 'de' | 'en' | null — null whenever the evidence is thin, which is
 * most short titles and every list of file paths.
 */
export function looksLike(text) {
  const written = String(text ?? '');
  if (GERMAN_LETTERS.test(written)) return 'de';

  const words = written.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (words.length < 4) return null;

  let de = 0;
  let en = 0;
  for (const word of words) {
    if (MARKERS.de.includes(word)) de += 1;
    if (MARKERS.en.includes(word)) en += 1;
  }
  // A clear majority, and at least two votes. One `the` in a German sentence
  // full of English identifiers is not evidence of anything.
  if (de >= 2 && de > en) return 'de';
  if (en >= 2 && en > de) return 'en';
  return null;
}

/**
 * The cards that are not written in the board's language — title and text
 * together, because a title may be a bare identifier while the text is prose.
 */
export function strangers(cards, language) {
  if (!language) return [];
  return cards
    .filter((card) => {
      const found = looksLike(`${card.title ?? ''}\n${card.text ?? ''}`);
      return found !== null && found !== language;
    })
    .map((card) => card.key)
    .sort();
}
