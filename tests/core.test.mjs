/** The pure sentences: identifiers, labels, links. No store, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mintId, isId, parseItemKey, mentionedKeys, itemKey, cardOfBranch } from '../src/ids.mjs';
import { labelsFor, normalizeVocabulary, pathsIn, mergeLabels, proseOf, STACK_WORDS } from '../src/labels.mjs';
import { cycleWith, blockedBy, collisions } from '../src/links.mjs';
import { normalizeGate, bornIn, STACKS } from '../src/spec.mjs';
import { createGradula } from '../src/gradula.mjs';
import { createMemoryStore } from '../src/store.mjs';

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
  assert.equal(cardOfBranch('codex/MDLA-3'), 'MDLA-3');
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

/**
 * THE FILE `gradula login` WRITES. Three lines of its own — the URL, the
 * person's key, the sessions' key — replacing lines of the same name; what
 * else stands in the file (an actor line from before, a comment) stays.
 * Pure, so it is tested without a disk; the CLI only writes what comes out.
 */
test('gradula login writes three lines and keeps every other', async () => {
  const { mergeEnv } = await import('../src/hand.mjs');
  const before = 'GRADULA_URL=http://old\n# mine\nGRADULA_ACTOR=david\n  GRADULA_TOKEN = stale \nGRADULA_AGENT_TOKEN=stale-too\n';
  const after = mergeEnv(before, { GRADULA_URL: 'https://grad.mundula.app', GRADULA_TOKEN: 'grad_pat_p', GRADULA_AGENT_TOKEN: 'grad_pat_a' });
  assert.equal(after, 'GRADULA_URL=https://grad.mundula.app\nGRADULA_TOKEN=grad_pat_p\nGRADULA_AGENT_TOKEN=grad_pat_a\n# mine\nGRADULA_ACTOR=david\n');
  assert.equal(mergeEnv('', { GRADULA_URL: 'u', GRADULA_TOKEN: 't' }), 'GRADULA_URL=u\nGRADULA_TOKEN=t\n', 'a file that was not there');
  assert.equal(mergeEnv('GRADULA_TOKEN_OLD=x\n', { GRADULA_TOKEN: 't' }), 'GRADULA_TOKEN=t\nGRADULA_TOKEN_OLD=x\n', 'a name is matched whole, not as a prefix');
  // And the reader gets back what the writer wrote.
  const { config } = await import('../src/hand.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gradula-env-'));
  writeFileSync(join(dir, '.gradula.env'), after);
  const read = config(dir, {});
  assert.deepEqual([read.GRADULA_URL, read.GRADULA_TOKEN, read.GRADULA_AGENT_TOKEN, read.GRADULA_ACTOR], ['https://grad.mundula.app', 'grad_pat_p', 'grad_pat_a', 'david']);
});

test('the ladder: five marks say where a card stands', async () => {
  const { ladderOf } = await import('../src/spec.mjs');
  assert.equal(ladderOf('ready'), '■▩□□□');
  assert.equal(ladderOf('done'), '■■■■■');
  assert.equal(ladderOf('ice'), '·····');
  assert.equal(ladderOf('nonsense'), '□□□□□');
});

test('a card that is only words may be removed; one with a chronicle goes on ice instead', async () => {
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  const idea = await gradula.addItem('PRB', { title: 'Just a test', kind: 'idea' }, 'david');
  assert.deepEqual(await gradula.removeItem(idea.key, 'david'), { key: idea.key, removed: true });
  await assert.rejects(gradula.getItem(idea.key), /There is no/);
  const task = await gradula.addItem('PRB', { title: 'Real work', kind: 'task' }, 'david');
  await assert.rejects(gradula.removeItem(task.key, 'david'), (e) => e.code === 'has-history' && /ice/.test(e.message), 'ready is past words');
  const released = await gradula.addItem('PRB', { title: 'An idea that was released', kind: 'idea' }, 'david');
  await gradula.moveItem(released.key, 'ready', 'david');
  await gradula.moveItem(released.key, 'ideas', 'david');
  await assert.rejects(gradula.removeItem(released.key, 'david'), (e) => e.code === 'has-history', 'back in ideas, but it has a chronicle');
});

test('the publishing rule: with "done" a card that reaches done becomes public by itself, incidents excepted; by hand nothing does', async () => {
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  const quiet = await gradula.addItem('PRB', { title: 'By hand', kind: 'task' }, 'david');
  await gradula.moveItem(quiet.key, 'done', 'david');
  assert.equal((await gradula.getItem(quiet.key)).visibility, 'internal', 'the default: nothing leaves the house');
  const project = await gradula.patchProject('PRB', { publish: 'done' }, 'david');
  assert.equal(project.publish, 'done');
  const shipped = await gradula.addItem('PRB', { title: 'Shipped', kind: 'task' }, 'david');
  await gradula.moveItem(shipped.key, 'done', 'dokploy', 'seen on production (abc)');
  assert.equal((await gradula.getItem(shipped.key)).visibility, 'public', 'reached production: public by the rule');
  const crash = await gradula.addItem('PRB', { title: 'TypeError', kind: 'task' }, 'sentry');
  await store.items.patch(crash.key, { source: 'sentry' });
  await gradula.moveItem(crash.key, 'done', 'dokploy', 'seen on production (abc)');
  assert.equal((await gradula.getItem(crash.key)).visibility, 'internal', 'a crash is never news for the outside');
  await assert.rejects(gradula.patchProject('PRB', { publish: 'always' }, 'david'), (e) => e.code === 'publish');
});

test('the commit\'s files label the card: evidence with paths adds the modules the vocabulary maps them to', async () => {
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  await gradula.putVocabulary('PRB', [{ id: 'docs', paths: ['docs'], area: 'docs' }, { id: 'tools', paths: ['tools'] }, { id: 'core', paths: ['packages/core'], area: 'kit' }]);
  const card = await gradula.addItem('PRB', { title: 'The board moves by itself', kind: 'task' }, 'david');
  assert.deepEqual(card.module, [], 'a subject without a path names no module');
  await gradula.addEvidence(card.key, { kind: 'commit', ref: 'abc1234', files: ['docs/release-pipeline.md', 'tools/release/ci.mjs'] }, 'hook');
  const after = await gradula.getItem(card.key);
  assert.deepEqual(after.module, ['docs', 'tools'], 'the files said where the work was');
});

test('the root itself is a place: a vocabulary path "/" labels the files beside package.json', async () => {
  const { labelsFor, normalizeVocabulary } = await import('../src/labels.mjs');
  const vocabulary = normalizeVocabulary([{ id: 'repo', paths: ['/'] }, { id: 'githooks', paths: ['.githooks'] }]);
  assert.deepEqual(labelsFor({ files: ['package.json', 'AGENTS.md'], vocabulary }).module, ['repo']);
  assert.deepEqual(labelsFor({ files: ['.githooks/pre-push'], vocabulary }).module, ['githooks'], 'a dot-folder is a module without its dot');
  assert.deepEqual(labelsFor({ files: ['docs/x.md'], vocabulary }).module, [], 'a folder the vocabulary does not know is not the root');
});

test('the files say the craft too: a commit in the hooks is tooling, one in the server is backend — without a word of prose', async () => {
  const { labelsFor } = await import('../src/labels.mjs');
  assert.deepEqual(labelsFor({ title: 'Every editor', files: ['.githooks/pre-push', 'tools/sdk/plan-line.mjs'] }).stack, ['tooling']);
  assert.deepEqual(labelsFor({ title: 'The door', files: ['apps/mundula-web/server/gate.mjs'] }).stack, ['backend']);
  assert.deepEqual(labelsFor({ title: 'A ring', files: ['apps/mundula-web/server/docs-page/page.js', 'docs/skills.json'] }).stack, ['backend', 'web', 'docs'], 'the docs page is served by the server and is a web page');
  assert.deepEqual(labelsFor({ title: 'The store notes', files: ['tools/release/Fastfile', 'apps/mundula/eas.json'] }).stack, ['ios', 'tooling']);
});

test('three ladder styles, one meaning: behind, now, ahead — and ice no rung', async () => {
  const { laddersOf, ladderOf, LADDER_STYLE_NAMES } = await import('../src/spec.mjs');
  assert.deepEqual(LADDER_STYLE_NAMES, ['squares', 'circles', 'diamonds', 'moon']);
  assert.deepEqual(laddersOf('moon'), { ideas: '○', ready: '◔', making: '◐', review: '◕', done: '●', ice: '·' }, 'one glyph: the phase is the standing');
  assert.deepEqual(laddersOf('squares'), { ideas: '▩□□□□', ready: '■▩□□□', making: '■■▩□□', review: '■■■▩□', done: '■■■■■', ice: '·····' }, 'the old marks, unchanged');
  assert.deepEqual(laddersOf('circles'), { ideas: '◐○○○○', ready: '●◐○○○', making: '●●◐○○', review: '●●●◐○', done: '●●●●●', ice: '·····' });
  assert.deepEqual(laddersOf('diamonds'), { ideas: '◈◇◇◇◇', ready: '◆◈◇◇◇', making: '◆◆◈◇◇', review: '◆◆◆◈◇', done: '◆◆◆◆◆', ice: '·····' });
  assert.equal(ladderOf('making', 'circles'), '●●◐○○');
  assert.equal(ladderOf('making'), '■■▩□□', 'without a style, squares');
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'PRB', name: 'Probe' });
  assert.equal((await gradula.patchProject('PRB', { ladder: 'circles' }, 'david')).ladder, 'circles');
  await assert.rejects(gradula.patchProject('PRB', { ladder: 'stars' }, 'david'), (e) => e.code === 'ladder');
});


test('the active coder is session metadata, not a permanently named shared key', async () => {
  const { coderOf } = await import('../src/hand.mjs');
  const { sessionKeyName, agentKeyName } = await import('../src/spec.mjs');
  assert.equal(coderOf({ CODEX_THREAD_ID: 'thread' }), 'Codex');
  assert.equal(coderOf({ CLAUDECODE: '1', CODEX_HOME: '/installed' }), 'Claude Code');
  assert.equal(coderOf({ CODEX_THREAD_ID: 'thread', CLAUDECODE: '1' }), 'Codex');
  assert.equal(coderOf({ CODEX_HOME: '/installed' }), null);
  assert.equal(coderOf({ CODEX_THREAD_ID: 'thread', GRADULA_HAND: 'person' }), null);
  assert.equal(agentKeyName('mac'), 'AI sessions · mac');
  const old = { kind: 'agent', name: 'Claude Code · mac' };
  assert.equal(sessionKeyName(old, 'Codex'), 'Codex · mac');
  assert.equal(sessionKeyName(old, 'Claude Code'), old.name);
  assert.equal(sessionKeyName(old, 'invented'), old.name);
  assert.equal(sessionKeyName(old, undefined), old.name);
  assert.equal(sessionKeyName({ kind: 'human', name: 'mac' }, 'Codex'), 'mac');
  assert.equal(sessionKeyName({ kind: 'system', name: 'deploy' }, 'Codex'), 'deploy');
});

test('editing checks the original field atomically and records no rejected change', async () => {
  const gradula = createGradula(createMemoryStore());
  await gradula.createProject({ key: 'EDT', name: 'Editing' });
  const card = await gradula.addItem('EDT', { kind: 'task', title: 'Original' }, 'first');
  await gradula.patchItem(card.key, { title: 'New title' }, 'other');
  const before = await gradula.getItem(card.key);
  await assert.rejects(gradula.patchItem(card.key, { title: 'Overwrite', expected: { title: 'Original' } }, 'first'), { code: 'edit-conflict' });
  assert.deepEqual(await gradula.getItem(card.key), before);
  assert.equal((await gradula.patchItem(card.key, { text: 'Independent edit', expected: { text: '' } }, 'first')).title, 'New title');
});

test('starting work cannot silently reopen review or completed cards', async () => {
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'STA', name: 'Start' });
  const card = await gradula.addItem('STA', { kind: 'task', title: 'Review me' }, 'first');
  for (const state of ['review', 'done']) {
    await store.items.patch(card.key, { state });
    await assert.rejects(gradula.startItem(card.key, {}, 'first'), { code: 'not-ready' });
    assert.equal((await gradula.getItem(card.key)).state, state);
  }
});

test('agent configuration folders belong to tooling, including old stored areas', async () => {
  for (const folder of ['.claude', '.codex', '.agents']) {
    const [module] = normalizeVocabulary([{ id: 'agent-docs', paths: [`${folder}/skills`] }]);
    assert.equal(module.area, 'tooling');
    assert.ok(labelsFor({ files: [`${folder}/skills/task/SKILL.md`] }).stack.includes('tooling'));
  }
  const store = createMemoryStore();
  const gradula = createGradula(store);
  await gradula.createProject({ key: 'AREA', name: 'Areas' });
  await store.vocab.set('AREA', [{ id: 'agent-docs', paths: ['.claude/skills'], area: '.claude' }]);
  assert.equal((await gradula.getVocabulary('AREA'))[0].area, 'tooling');
  assert.equal(normalizeVocabulary([{ id: 'ci', paths: ['.github/workflows'] }])[0].area, 'infra');
});


test('CI pipelines do not imply GPU work, while explicit graphics evidence still does', () => {
  for (const title of ['Publish local pre-push verification for pipeline progress', 'Show local CI evidence alongside GitHub workflow progress', 'Release pipeline']) {
    assert.ok(!labelsFor({title}).stack.includes('gpu'));
  }
  assert.ok(labelsFor({title:'GPU render pipeline'}).stack.includes('gpu'));
  assert.ok(labelsFor({title:'Improve shader pipeline'}).stack.includes('gpu'));
  assert.ok(labelsFor({title:'Update pipeline',files:['shaders/render.wgsl']}).stack.includes('gpu'));
});
