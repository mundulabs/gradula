/**
 * The runner — the one promise that separates Gradula from a card index.
 *
 * Until today a gate has been a text field: written, displayed, read aloud in
 * the briefing, never executed. Here it is executed.
 *
 * FOUR KINDS, THREE OF THEM HARMLESS:
 *   file    — does the file exist? Reads nothing, runs nothing.
 *   url     — does it answer with the expected status? A GET, nothing else.
 *   test    — the project's test command plus the card's call.
 *   command — exactly what the card says.
 *
 * THE LAST TWO EXECUTE SOMEBODY ELSE'S TEXT. Anyone with a project key can
 * create a card — so "run the gate" is the same sentence as "execute what is
 * written on a note". Therefore:
 *   · they run ONLY with `--commands`, a deliberate decision per run,
 *   · the exact command is printed BEFORE it runs,
 *   · and the runner runs where the repository lies — never in the service.
 * Whoever finds that too strict has never watched a planning tool become a
 * remote control.
 *
 * WHAT IT MAY DO: green → move the card to `done`, with the run as evidence.
 * That is not a guess, it is exactly what the gate claimed.
 * WHAT IT MAY NOT DO: conclude anything from a red run. Red means "not yet",
 * never "broken" — the reason may be a missing tool.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const lauf = promisify(execFile);

/** What a gate says, in one sentence — for the log and the evidence. */
export const gateLine = (gate) => `${gate.kind} ${gate.call}${gate.expect ? ` → ${gate.expect}` : ''}`;

/**
 * Check a gate. Pure enough for a test: everything that reaches outward
 * arrives as an injection.
 */
export async function check(gate, {
  root = process.cwd(),
  testCommand = 'npm test --',
  commandsAllowed = false,
  fetchImpl = fetch,
  runImpl = lauf,
  report = () => {},
} = {}) {
  if (!gate?.kind) return { ran: false, reason: 'no gate' };

  if (gate.kind === 'file') {
    const da = existsSync(`${root}/${gate.call}`.replace(/\/+/g, '/'));
    return { ran: true, green: da, line: da ? 'the file is there' : 'the file is missing' };
  }

  if (gate.kind === 'url') {
    const expected = Number(gate.expect ?? 200);
    try {
      const response = await fetchImpl(gate.call, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      return {
        ran: true,
        green: response.status === expected,
        line: `${response.status}${response.status === expected ? '' : ` instead of ${expected}`}`,
      };
    } catch (error) {
      return { ran: true, green: false, line: `no answer (${error.message})` };
    }
  }

  if (gate.kind === 'test' || gate.kind === 'command') {
    // A TOUCHSTONE THAT DOES NOT EXIST IS NOT GREEN.
    //
    // Measured on 09.09.: two cards named `tests/sources.test.mjs` and
    // `tests/runner.test.mjs`, both unwritten. `npm test -- <path>`
    // appends the path to the project's test command — which runs over
    // EVERYTHING else anyway, goes green, and the cards moved themselves to
    // done. A gate that measures something other than what it claims is worse
    // than no gate: it sounds like a proof.
    if (gate.kind === 'test' && /[/\\]/.test(gate.call)) {
      const path = `${root}/${gate.call}`.replace(/\/+/g, '/');
      if (!existsSync(path)) {
        return { ran: true, green: false, line: `there is no test at ${gate.call}` };
      }
    }
    if (!commandsAllowed) {
      return { ran: false, reason: 'needs --commands: this gate executes what the card says' };
    }
    const command = gate.kind === 'test' ? `${testCommand} ${gate.call}` : gate.call;
    report(command);
    try {
      const { stdout, stderr } = await runImpl('/bin/sh', ["-c", command], { cwd: root, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
      const ende = `${stdout}${stderr}`.trim().split('\n').filter(Boolean).at(-1) ?? '';
      return { ran: true, green: true, line: ende.slice(0, 160) || 'no output, but no error either' };
    } catch (error) {
      const ende = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? error.message;
      return { ran: true, green: false, line: ende.slice(0, 160) };
    }
  }

  return { ran: false, reason: `I do not know gate kind "${gate.kind}"` };
}

/**
 * Walk every open card that has a gate. Returns a list instead of printing
 * itself — what appears on screen is the caller's decision.
 */
export async function allGates(cards, options = {}) {
  const ergebnisse = [];
  for (const card of cards) {
    if (!card.gate) continue;
    if (['done', 'ice'].includes(card.state)) continue;
    const result = await check(card.gate, options);
    ergebnisse.push({ card, ...result });
  }
  return ergebnisse;
}
