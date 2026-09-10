/** The pure sentences: identifiers, labels, links. No store, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mintId, isId, parseItemKey, mentionedKeys, itemKey, cardOfBranch } from '../src/ids.mjs';
import { labelsFor, normalizeVocabulary, pathsIn, mergeLabels, proseOf, STACK_WORDS } from '../src/labels.mjs';
import { cycleWith, blockedBy, collisions } from '../src/links.mjs';
import { normalizeGate, bornIn, STACKS } from '../src/spec.mjs';

test('an identifier sorts itself by its time', () => {
  const early = mintId(1_000_000_000_000);
  const late = mintId(1_000_000_001_000);
  assert.ok(isId(early) && isId(late));
  assert.ok(early < late, 'the earlier identifier must be the smaller one');
});

test('a card key is read, a wrong one is not', () => {
  assert.deepEqual(parseItemKey('MDLA-142'), { project: 'MDLA', number: 142 });
  assert.deepEqual(parseItemKey('mdla-142'), { project: 'MDLA', number: 142 });
  assert.equal(parseItemKey('MDLA-0'), null, 'there is no card zero');
  assert.equal(parseItemKey('M-1'), null, 'one letter is not a project');
  assert.equal(itemKey('MDLA', 7), 'MDLA-7');
});

test('named cards are found — and only the ones meant', () => {
  assert.deepEqual(mentionedKeys('needs MDLA-158 and STR-9'), ['MDLA-158', 'STR-9']);
  assert.deepEqual(mentionedKeys('FOO-MDLA-1'), [], 'no find in the middle of a word');
  assert.deepEqual(mentionedKeys('MDLA-12-3'), [], 'no number with something appended');
});

test('labels come from paths, from module names and from stack words', () => {
  const vocabulary = normalizeVocabulary([
    { id: 'panels', paths: ['packages/panels'], words: ['bühne'] }, // a German word: a card may be written in either language
    { id: 'mundula-web', paths: ['apps/mundula-web'] },
  ]);
  const fromPath = labelsFor({ title: 'head', text: 'see packages/panels/src/StageView.tsx', vocabulary });
  assert.deepEqual(fromPath.module, ['panels']);

  const fromWord = labelsFor({ title: 'Die Bühne ruckelt', text: '', vocabulary });
  assert.deepEqual(fromWord.module, ['panels'], 'a word of its own counts like a path');

  const stack = labelsFor({ title: 'Traefik deploy for iOS', text: 'in the browser', vocabulary }).stack;
  assert.ok(stack.includes('infra') && stack.includes('ios') && stack.includes('web'));

  const nothing = labelsFor({ title: 'A thought', text: 'without anything', vocabulary });
  assert.deepEqual(nothing, { module: [], stack: [] }, 'without a hold, no label');
});

test('paths are recognised, in brackets and quotation marks too', () => {
  assert.deepEqual(pathsIn('(apps/mundula-web/server/app.mjs)'), ['apps/mundula-web/server/app.mjs']);
  assert.deepEqual(pathsIn('nothing here'), []);
});

test('a vocabulary without duplicates, or a refusal', () => {
  assert.throws(() => normalizeVocabulary([{ id: 'a' }, { id: 'a' }]), /twice/);
  assert.throws(() => normalizeVocabulary([{ id: 'a module' }]), /not a module id/);
});

test('handwork survives the merge', () => {
  assert.deepEqual(mergeLabels(['panels'], ['panels', 'core']), ['panels', 'core']);
});

test('a link that would close a cycle is named as a chain', () => {
  const links = [
    { from: 'A', to: 'B', kind: 'needs' },
    { from: 'B', to: 'C', kind: 'needs' },
  ];
  assert.equal(cycleWith(links, { from: 'A', to: 'C', kind: 'needs' }), null, 'a shortcut is not a cycle');
  assert.deepEqual(cycleWith(links, { from: 'C', to: 'A', kind: 'needs' }), ['C', 'A', 'B', 'C']);
});

test('blocked by and resembles are not the same', () => {
  const items = [{ id: 'A', state: 'ready' }, { id: 'B', state: 'ready' }];
  const turned = blockedBy([{ from: 'B', to: 'A', kind: 'blocks' }], items);
  assert.deepEqual(turned.get('A'), ['B'], 'B blocked by A means: A waits on B');
  assert.equal(blockedBy([{ from: 'A', to: 'B', kind: 'resembles' }], items).size, 0);
});

test('what is done holds nobody up any more', () => {
  const links = [{ from: 'A', to: 'B', kind: 'needs' }];
  assert.deepEqual(blockedBy(links, [{ id: 'A', state: 'ready' }, { id: 'B', state: 'ready' }]).get('A'), ['B']);
  assert.equal(blockedBy(links, [{ id: 'A', state: 'ready' }, { id: 'B', state: 'done' }]).size, 0);
});

test('two running cards on the same file collide', () => {
  const meine = { id: 'A', key: 'X-1', files: ['packages/panels/src/StageView.tsx'] };
  const andere = [{ id: 'B', key: 'X-2', files: ['packages/panels/src/StageView.tsx', 'x.ts'] }];
  assert.deepEqual(collisions(meine, andere), [{ card: 'X-2', files: ['packages/panels/src/StageView.tsx'] }]);
  assert.deepEqual(collisions({ id: 'A', key: 'X-1', files: [] }, andere), []);
});

test('a gate needs a kind and a call', () => {
  assert.deepEqual(normalizeGate({ kind: 'test', call: 'tests/x.test.mjs' }), { kind: 'test', call: 'tests/x.test.mjs', expect: null });
  assert.equal(normalizeGate(null), null);
  assert.throws(() => normalizeGate({ kind: 'raten', call: 'x' }), /gate.kind/);
  assert.throws(() => normalizeGate({ kind: 'test', call: '  ' }), /empty/);
});

test('an idea begins in the ideas, everything else in ready', () => {
  assert.equal(bornIn('idea'), 'ideas');
  assert.equal(bornIn('task'), 'ready');
});

test('paths and addresses do NOT feed the craft axis', () => {
  const vocabulary = normalizeVocabulary([
    { id: 'mundula', paths: ['apps/mundula'] },
    { id: 'mundula-web', paths: ['apps/mundula-web'] },
    { id: 'engine', paths: ['packages/engine'] },
  ]);
  // Measured on 08.09.: "~/sound-live.sh" gave `engine` (the word "sound"),
  // "dev-api.mundula.app" gave `backend` (the word "api").
  const found = labelsFor({
    title: 'create the dev environment',
    text: 'Today ~/sound-live.sh copies apps/mundula-web/.env. Traefik, DNS through Cloudflare, dev-api.mundula.app.',
    vocabulary,
  });
  assert.ok(!found.stack.includes('engine'), 'a file name is not a craft');
  assert.ok(!found.stack.includes('backend'), 'nor is a domain');
  assert.deepEqual(found.stack, ['infra']);
  assert.deepEqual(found.module, ['mundula-web'], 'the path beats the word');
});

test('prose stays prose', () => {
  assert.match(proseOf('see packages/panels/src/x.ts and https://a.b/c — the sound of it'), /the sound of it/);
  assert.doesNotMatch(proseOf('packages/panels/src/x.ts'), /panels/);
});

test('Sentry is infrastructure', () => {
  // MDLA-4 arrived in production without a label: "Sentry" stood in no
  // vocabulary, although a card about a token and a hook is plainly infra.
  assert.deepEqual(labelsFor({ title: 'store the Sentry token and hook', text: '' }).stack, ['infra']);
});

test('an underscore separates no words', () => {
  const vocabulary = normalizeVocabulary([{ id: 'ai', paths: ['packages/ai'] }]);
  // Measured on 2026-09-09 against MDLA-6: "AI_APP_TOKEN" fetched the module `ai`.
  assert.deepEqual(labelsFor({ title: 'an AI_APP_TOKEN of our own for dev', text: '', vocabulary }).module, []);
  assert.deepEqual(labelsFor({ title: 'let the model behind ai answer', text: '', vocabulary }).module, ['ai']);
});

test("a card's files say where it belongs", () => {
  const vocabulary = normalizeVocabulary([{ id: 'mundula', paths: ['apps/mundula'] }]);
  // Measured against MDLA-7: the path stood only in the `files` field, and
  // the card arrived without a module — although a file is the clearest hint there is.
  assert.deepEqual(labelsFor({ title: 'build in the reporting door', vocabulary }).module, []);
  assert.deepEqual(labelsFor({ title: 'build in the reporting door', files: ['apps/mundula/sentry.ts'], vocabulary }).module, ['mundula']);
});

test('a branch names its card — but only the exact shape', () => {
  // `gradula start MDLA-3 --tree` creates `plan/MDLA-3`, so the branch already
  // knows the card. Guessing from arbitrary names is how evidence lands on the
  // wrong card, and that is worse than no evidence at all.
  assert.equal(cardOfBranch('plan/MDLA-3'), 'MDLA-3');
  assert.equal(cardOfBranch('plan/mdla-3'), 'MDLA-3', 'case does not matter');
  assert.equal(cardOfBranch('feature/fix-MDLA-3'), null, 'a mention is not a claim');
  assert.equal(cardOfBranch('plan/MDLA-3-again'), null);
  assert.equal(cardOfBranch('main'), null);
  assert.equal(cardOfBranch(''), null);
  assert.equal(cardOfBranch(undefined), null);
});

/**
 * ONE LIST OF CRAFTS, NOT TWO.
 *
 * `STACKS` names them and `STACK_WORDS` gives each its words. They are two
 * places, and the loop that labels a card reads only the first — so a craft
 * added to the words alone is a craft that never happens. That is exactly what
 * `gpu` did for one afternoon: the words were there, the axis stayed silent.
 */
test('every craft has words, and every set of words has a craft', () => {
  assert.deepEqual(STACKS.filter((s) => !STACK_WORDS[s]), [], 'named, but with no words — it can never be found');
  assert.deepEqual(Object.keys(STACK_WORDS).filter((s) => !STACKS.includes(s)), [], 'words, but not in the list — the loop never reads them');
});

test('the picture has its own craft', () => {
  // A shader is not `native` because the word `metal` happens to be nearby.
  assert.deepEqual(labelsFor({ title: 'Das Netz im Shader: TensorOps', text: '' }).stack, ['gpu']);
  assert.deepEqual(labelsFor({ title: 'volles WGSL in Nutzer-Operatoren', text: '' }).stack, ['gpu']);
});

/**
 * THE RULES MUST RUN OVER WHAT IS ALREADY THERE.
 *
 * Labels are given once, at creation. Everything written before a module
 * existed, before a craft was named, or before the vocabulary was refreshed
 * keeps whatever it got then — measured on the live board: 22 of 35 cards with
 * no craft at all, 19 with no module. A board that cannot say where its work
 * sits cannot group it, cannot warn about a collision and cannot fill a
 * milestone. That is why a hand-made milestone felt like it brought nothing.
 *
 * The crafts below are measured, not invented: 56 mentions of speech and voice
 * on this board, 33 of models. `desktop` and `midi` have none, and are absent.
 */
test('the crafts the board actually talks about are findable', () => {
  const stackOf = (title) => labelsFor({ title, text: '' }).stack;
  assert.deepEqual(stackOf('Die Stimme als Modulationsquelle'), ['speech']);
  assert.deepEqual(stackOf('Welche Locale hoert zu'), ['speech']);
  assert.deepEqual(stackOf('ein Modell auf dem Geraet'), ['model']);
  assert.deepEqual(stackOf('ein Embedding auf dem Geraet rechnen'), ['model']);
  // A word inside another word is not that word — the same law that keeps
  // `AI_APP_TOKEN` from meaning the module `ai`. So a MODEL'S NAME is not
  // found: `NLContextualEmbedding` carries `embedding` and gets nothing.
  // Names belong in a vocabulary entry's `words`, not in a rule.
  assert.deepEqual(stackOf('NLContextualEmbedding oder MobileCLIP'), []);
  // A wrong craft is worse than none: on this board a token is an access token.
  assert.deepEqual(stackOf('Sentry-Token und Haken hinterlegen'), ['infra']);
});

/**
 * THE AREA IS DERIVED, NEVER TYPED. An app is its own area, everything else is
 * the first segment of its path — and a project that has a word for it wins.
 */
test('a module has an area: the app it is, or the first segment of its path — unless the project says otherwise', () => {
  const [core, studio, tools, said] = normalizeVocabulary([
    { id: 'core', paths: ['packages/core'] },
    { id: 'mundula', paths: ['apps/mundula'] },
    { id: 'tools', paths: ['tools'] },
    { id: 'hand', paths: ['packages/native/hand'], area: 'Kit' },
  ]);
  assert.equal(core.area, 'packages');
  assert.equal(studio.area, 'mundula');
  assert.equal(tools.area, 'tools');
  assert.equal(said.area, 'kit', 'declared wins, lower-cased');
  assert.throws(() => normalizeVocabulary([{ id: 'x', paths: ['packages/x'], area: 'not an area!' }]), /is not an area/);
});

/**
 * WHICH HAND IS AT THE DOOR. A session takes the agent key, a person keeps
 * the first; the actor — the person in whose errand — stays the same.
 */
test('a session speaks with the agent key, a person with their own, and the actor never changes', async () => {
  const { handOf, isAgent } = await import('../src/hand.mjs');
  const env = { GRADULA_TOKEN: 'person-key', GRADULA_AGENT_TOKEN: 'agent-key', GRADULA_ACTOR: 'david' };
  assert.deepEqual(handOf(env), { token: 'person-key', actor: 'david', hand: 'person' });
  assert.deepEqual(handOf({ ...env, CLAUDECODE: '1' }), { token: 'agent-key', actor: 'david', hand: 'agent' });
  assert.deepEqual(handOf({ ...env, CODEX_THREAD_ID: 'x' }).hand, 'agent');
  assert.deepEqual(handOf({ ...env, GRADULA_HAND: 'agent' }).hand, 'agent', 'a hand may say what it is');
  assert.deepEqual(handOf({ ...env, CLAUDECODE: '1', GRADULA_HAND: 'person' }).hand, 'person', 'and what it says wins');
  assert.deepEqual(handOf(env, { machine: true }).token, 'agent-key', 'the MCP server is a machine by definition');
  assert.equal(handOf({ GRADULA_TOKEN: 'person-key', CLAUDECODE: '1' }).token, 'person-key', 'without an agent key the session still comes in');
  assert.equal(isAgent({}), false);
});

test('the ladder: five marks say where a card stands', async () => {
  const { ladderOf } = await import('../src/spec.mjs');
  assert.equal(ladderOf('ready'), '■▩□□□');
  assert.equal(ladderOf('done'), '■■■■■');
  assert.equal(ladderOf('ice'), '·····');
  assert.equal(ladderOf('nonsense'), '□□□□□');
});
