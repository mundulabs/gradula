/**
 * Two kinds of identifier, and they do different jobs.
 *
 * The INNER one (`mintId`) is what everything hangs from: ten characters of
 * time, sixteen of chance, in Crockford's alphabet (no I, L, O, U — nothing
 * you mishear when reading it aloud). It sorts itself by creation time, so a
 * list without a second key is already in the right order. It is built the
 * same way as in Mundula's library; whoever reads both reads the same thing.
 *
 * The OUTER one is the card key — `MDLA-142`. That one is for speaking aloud
 * ("start MDLA-142"), so it may be short and countable. It is NOT the truth:
 * it belongs to a project, and a project can be renamed. That is why every
 * link points at the inner identifier, and the key is only the way to find it.
 * only the way to find it.
 */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An inner identifier, 26 characters, sortable in time. */
export function mintId(at = Date.now()) {
  let time = '';
  let ms = at;
  for (let i = 0; i < 10; i += 1) {
    time = B32[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += B32[b % 32];
  return time + rand;
}

export const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const isId = (value) => typeof value === 'string' && ID.test(value);

/**
 * A project key: two to eight capital letters. No digits, because a card key
 * separates project and number with a hyphen, and `A1-2` would be ambiguous
 * to an eye and to a regular expression alike.
 */
export const PROJECT_KEY = /^[A-Z]{2,8}$/;
export const isProjectKey = (value) => typeof value === 'string' && PROJECT_KEY.test(value);

export const ITEM_KEY = /^([A-Z]{2,8})-([1-9][0-9]{0,6})$/;

/** `MDLA` + 142 → `MDLA-142`. */
export const itemKey = (projectKey, number) => `${projectKey}-${number}`;

/** `MDLA-142` → `{ project: 'MDLA', number: 142 }`, or `null`. */
export function parseItemKey(value) {
  const match = ITEM_KEY.exec(String(value ?? '').trim().toUpperCase());
  return match ? { project: match[1], number: Number(match[2]) } : null;
}

/**
 * Every card number standing in a text — for the links that follow by
 * themselves: whoever writes `MDLA-158` means MDLA-158. A text can contain
 * anything, so the border is deliberately narrow: capitals, a hyphen, digits,
 * and no word character to the left (otherwise `FOO-MDLA-1` would hold a card
 * nobody meant).
 */
export function mentionedKeys(text) {
  const found = new Set();
  for (const match of String(text ?? '').matchAll(/(^|[^A-Z0-9-])([A-Z]{2,8}-[1-9][0-9]{0,6})(?![0-9-])/g)) {
    found.add(match[2]);
  }
  return [...found];
}

/**
 * The card a branch belongs to. `gradula start MDLA-3 --tree` creates the
 * branch `plan/MDLA-3`, so the branch already knows the card — and then nobody
 * should have to type it again.
 *
 * Only this exact shape counts. A branch called `feature/fix-MDLA-3-again` is
 * NOT a claim about a card: guessing from arbitrary names is how evidence ends
 * up on the wrong card, and evidence on the wrong card is worse than none.
 */
export function cardOfBranch(branch) {
  const match = /^plan\/([A-Z]{2,8}-[1-9][0-9]{0,6})$/.exec(String(branch ?? '').trim().toUpperCase().replace(/^PLAN\//, 'plan/'));
  return match ? match[1] : null;
}
