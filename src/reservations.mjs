import { filesOf } from './links.mjs';
/** Paths are relative to the repository, never a developer's workstation. */
export function plannedPaths(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('files: at most 100 repository-relative paths');
  return [...new Set(value.map(raw => {
    const path = String(raw).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(p => p === '..' || !p) || /[\x00-\x1f]/.test(path) || path.length > 500) throw new TypeError('files: use repository-relative paths without ..');
    return path;
  }))];
}
export const activeReservation = (value, now = Date.now()) => Boolean(value && Date.parse(value.until) > now);
export function workWarnings(item, others) {
  const mine = item.reservation?.files ?? filesOf(item);
  const out = [];
  for (const other of others) {
    if (other.key === item.key || other.state !== 'making') continue;
    const theirs = other.reservation?.files ?? filesOf(other);
    const files = [...new Set(mine.filter(a => theirs.some(b => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`))))];
    const modules = (item.module ?? []).filter(m => !['repo','docs','tests','tools','tooling'].includes(m) && other.module?.includes(m));
    if (files.length || modules.length) out.push({ card: other.key, actor: other.reservation?.actor ?? other.person ?? null, activity: activeReservation(other.reservation) ? 'active' : 'unknown', files, modules, level: files.length ? 'files' : 'module' });
  }
  return out;
}
