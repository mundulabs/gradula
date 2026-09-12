/**
 * WHICH HAND IS AT THE DOOR.
 *
 * `.gradula.env` holds one key, and everybody on that machine came in through
 * it: David at his own terminal, and every AI session that ran the CLI or the
 * MCP server from the same directory. The chronicle said `david (via key
 * "Davids Rechner")` for all of them — true about the errand, silent about the
 * hand. Asked "did I move this, or did a session?", the board had no answer.
 *
 * So a second key: `GRADULA_AGENT_TOKEN`. An AI session takes it, a person
 * keeps the first — and the WHO stays the person both keys belong to. Only
 * the hand in brackets changes: `david (Claude Code · Davids-MacBook-Pro)`
 * beside `david (Davids-MacBook-Pro)`. A right is never derived from it; a
 * mirror is. `gradula login` mints both (src/gradula.mjs approveDevice); the
 * name is the program and the machine, never a path — a key named after a
 * directory read `Claude in ~/sound` for months after the repository moved.
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

/**
 * The file `gradula login` writes, as text. The lines it brings REPLACE the
 * lines of the same name and every other line stays where it was — a
 * `GRADULA_ACTOR` or a comment somebody put there is not the CLI's to lose.
 * Its own lines come first, in the order given. Pure: text in, text out, so
 * a test can read it without a disk.
 */
export function mergeEnv(text, values) {
  const names = Object.keys(values);
  const kept = String(text ?? '').split('\n')
    .filter((line) => line.trim() && !names.some((name) => new RegExp(`^\\s*${name}\\s*=`).test(line)));
  return [...names.map((name) => `${name}=${values[name]}`), ...kept].join('\n') + '\n';
}

/** Is this process a machine's hand? Pure: the environment in, a yes or no out. */
export function isAgent(env, { machine = false } = {}) {
  if (machine) return true;
  const said = String(env.GRADULA_HAND ?? '').toLowerCase();
  if (said === 'agent') return true;
  if (said === 'person') return false;
  return AGENT_SIGNS.some((sign) => (sign.endsWith('_') ? Object.keys(env).some((name) => name.startsWith(sign)) : Boolean(env[sign])));
}

/**
 * How the agents announce themselves in their shells. Claude Code sets
 * CLAUDECODE, the Codex CLI a family of CODEX_ variables, Gemini CLI
 * GEMINI_CLI, Cursor's agent CURSOR_AGENT. One that sets nothing (a new IDE)
 * says it in the project: GRADULA_HAND=agent in its environment — the
 * sentence above, not a guess from a process name.
 */
export const AGENT_SIGNS = ['CLAUDECODE', 'CODEX_', 'GEMINI_CLI', 'CURSOR_AGENT', 'ANTIGRAVITY', 'COPILOT_AGENT'];

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

/** Session metadata describes the coder, never the authenticated person or rights.
 * CODEX_HOME alone is installation configuration, not a running Codex session.
 */
export function coderOf(env) {
  if (env.GRADULA_HAND === 'person') return null;
  if (env.CODEX_THREAD_ID || env.CODEX_CI || env.CODEX_SANDBOX || env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) return 'Codex';
  if (env.CLAUDECODE) return 'Claude Code';
  if (env.GEMINI_CLI) return 'Gemini CLI';
  if (env.CURSOR_AGENT) return 'Cursor';
  if (env.ANTIGRAVITY) return 'Antigravity';
  if (env.COPILOT_AGENT) return 'Copilot';
  return null;
}
