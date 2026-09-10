/**
 * The runner. What is checked here is not "does a test pass" — it is the four
 * sentences at which a runner becomes dangerous or useless.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { check, allGates, gateLine } from '../src/gates.mjs';
import { GATE_KINDS } from '../src/spec.mjs';

test('a file is there or it is not — nothing more happens', async () => {
  assert.equal((await check({ kind: 'file', call: 'package.json' }, { root: process.cwd() })).green, true);
  const missing = await check({ kind: 'file', call: 'there-is-no-such-file.txt' }, { root: process.cwd() });
  assert.equal(missing.green, false);
  assert.match(missing.line, /missing/);
});

test('a URL is checked against the expectation, not against "something came back"', async () => {
  const fetchImpl = async () => ({ status: 404 });
  assert.equal((await check({ kind: 'url', call: 'https://x', expect: '404' }, { fetchImpl })).green, true);
  const daneben = await check({ kind: 'url', call: 'https://x' }, { fetchImpl });
  assert.equal(daneben.green, false);
  assert.match(daneben.line, /404 instead of 200/);
});

test('no answer is red, not a crash', async () => {
  const fetchImpl = async () => { throw new Error('no network'); };
  const result = await check({ kind: 'url', call: 'https://x' }, { fetchImpl });
  assert.equal(result.green, false);
  assert.match(result.line, /no answer/);
});

test('a gate that executes does NOT run without explicit permission', async () => {
  let angefasst = 0;
  const runImpl = async () => { angefasst += 1; return { stdout: '', stderr: '' }; };
  const without = await check({ kind: 'command', call: 'rm -rf /' }, { runImpl });
  assert.equal(without.ran, false, 'anyone with a key may create a card');
  assert.equal(angefasst, 0);
  assert.match(without.reason, /--commands/);
});

test('with permission it runs — and says beforehand what', async () => {
  const said = [];
  const runImpl = async (_shell, args) => ({ stdout: `lief: ${args[1]}\n`, stderr: '' });
  // A path that REALLY exists — since 09.09. a missing test is red, and this
  // test is not the one that should trigger that.
  const result = await check({ kind: 'test', call: 'tests/gates.test.mjs' },
    { commandsAllowed: true, testCommand: 'npm test --', runImpl, report: (b) => said.push(b) });
  assert.equal(result.green, true);
  assert.deepEqual(said, ['npm test -- tests/gates.test.mjs'], 'the exact command, before it runs');
});

test('a red run says what there was to see', async () => {
  const runImpl = async () => { const e = new Error('it fails'); e.stdout = 'one\ntwo\nthree broken'; throw e; };
  const result = await check({ kind: 'command', call: 'x' }, { commandsAllowed: true, runImpl });
  assert.equal(result.green, false);
  assert.equal(result.line, 'three broken');
});

test('finished cards and cards without a gate are not touched', async () => {
  const cards = [
    { key: 'X-1', state: 'done', gate: { kind: 'file', call: 'package.json' } },
    { key: 'X-2', state: 'ready', gate: null },
    { key: 'X-3', state: 'ready', gate: { kind: 'file', call: 'package.json' } },
  ];
  const ergebnisse = await allGates(cards, { root: process.cwd() });
  assert.deepEqual(ergebnisse.map((e) => e.card.key), ['X-3']);
});

test('a gate reads as one sentence', () => {
  assert.equal(gateLine({ kind: 'url', call: 'https://x/health', expect: '200' }), 'url https://x/health → 200');
  assert.equal(gateLine({ kind: 'file', call: 'a.ts', expect: null }), 'file a.ts');
});

test('a test that does not exist is NOT green', async () => {
  // The most expensive refusal in this file, measured on 09.09.: `npm test -- <path>`
  // appends the path to the test command. That runs over everything else,
  // goes green — and two cards moved themselves to done without the named
  // test ever having been written.
  const result = await check(
    { kind: 'test', call: 'tests/does-not-exist.test.mjs' },
    { commandsAllowed: true, runImpl: async () => ({ stdout: 'all good', stderr: '' }) },
  );
  assert.equal(result.green, false);
  assert.match(result.line, /no test at/);
});

test('a test that does exist runs quite normally', async () => {
  const result = await check(
    { kind: 'test', call: 'tests/gates.test.mjs' },
    { commandsAllowed: true, runImpl: async () => ({ stdout: 'pass 3', stderr: '' }) },
  );
  assert.equal(result.green, true);
});

test('a test name without a path is not looked for as a file', async () => {
  // `--test-name-pattern` and the like are not paths. Whoever checks too
  // strictly here forbids half the use.
  const result = await check(
    { kind: 'test', call: '--test-name-pattern "the wave"' },
    { commandsAllowed: true, runImpl: async () => ({ stdout: 'pass 1', stderr: '' }) },
  );
  assert.equal(result.green, true);
});

test('the runner knows exactly the gate kinds the vocabulary declares', async () => {
  // On 09.09. the runner still asked for `adresse` and `befehl` while the
  // vocabulary had long said `url` and `command`. A card with a url gate came
  // back as "I do not know gate kind" — the gate was fine, the runner was deaf.
  for (const kind of GATE_KINDS) {
    const result = await check({ kind, call: 'tests/gates.test.mjs' }, { commandsAllowed: true, runImpl: async () => ({ stdout: 'ok', stderr: '' }), fetchImpl: async () => ({ status: 200 }) });
    assert.doesNotMatch(String(result.reason ?? result.line ?? ""), /do not know gate kind/, `the runner does not know "${kind}"`);
  }
});
