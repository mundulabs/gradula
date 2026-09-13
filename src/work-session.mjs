import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** A session is separate from the authenticated person. Persist human CLI
 * sessions in Git metadata, not in tracked files or a shared home directory. */
export function workSession(env = process.env, cwd = process.cwd()) {
  if (env.GRADULA_SESSION || env.CODEX_THREAD_ID) return String(env.GRADULA_SESSION || env.CODEX_THREAD_ID);
  let path;
  try { path = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'gradula-session'], { cwd, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim(); }
  catch { return randomUUID(); }
  try { return readFileSync(path,'utf8').trim(); } catch { /* first use */ }
  const id=randomUUID();
  try { writeFileSync(path,id,{flag:'wx',mode:0o600}); return id; }
  catch { return readFileSync(path,'utf8').trim(); }
}
