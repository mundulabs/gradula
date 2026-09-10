/**
 * WHICH HAND IS AT THE DOOR.
 *
 * `.gradula.env` holds one key, and everybody on that machine came in through
 * it: David at his own terminal, and every AI session that ran the CLI or the
 * MCP server from the same directory. The chronicle said `david (via key
 * "Davids Rechner")` for all of them — true about the errand, silent about the
 * hand. Asked "did I move this, or did a session?", the board had no answer.
 *
 * So a second, optional key: `GRADULA_AGENT_TOKEN`. An AI session takes it,
 * a person keeps the first — and the WHO stays the person in whose errand the
 * machine acts (`GRADULA_ACTOR`). Only the hand in brackets changes:
 * `david (AI sessions in ~/sound)`. A right is never derived from it; a mirror is.
 *
 * A session is recognised by the environment its tool runner sets
 * (`CLAUDECODE`, `CODEX_*`), or declares itself with `GRADULA_HAND=agent`;
 * the MCP server is a machine's door by definition and says so itself.
 *
 * ONE reader for the CLI and the MCP server. They had two copies of the same
 * loop, and two copies drift — the MCP server read no file at all for a day.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The configuration: the environment first, then `.gradula.env` from here upwards. */
export function config(from = process.cwd(), processEnv = process.env) {
  const out = { ...processEnv };
  let dir = resolve(from);
  for (;;) {
    const file = join(dir, '.gradula.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match && !processEnv[match[1]]) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

/** Is this process a machine's hand? Pure: the environment in, a yes or no out. */
export function isAgent(env, { machine = false } = {}) {
  if (machine) return true;
  const said = String(env.GRADULA_HAND ?? '').toLowerCase();
  if (said === 'agent') return true;
  if (said === 'person') return false;
  return Boolean(env.CLAUDECODE) || Object.keys(env).some((name) => name.startsWith('CODEX_'));
}

/**
 * The key and the name this process speaks with. `hand` says which was
 * chosen — for a line in `--help` and for a test, never for a right.
 */
export function handOf(env, { machine = false } = {}) {
  const agent = isAgent(env, { machine });
  const token = (agent && env.GRADULA_AGENT_TOKEN) ? env.GRADULA_AGENT_TOKEN : (env.GRADULA_TOKEN ?? null);
  return {
    token,
    actor: env.GRADULA_ACTOR ?? null,
    hand: agent && env.GRADULA_AGENT_TOKEN ? 'agent' : 'person',
  };
}
