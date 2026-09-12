/** Check local documentation links and the Node entry points advertised by npm. */
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const documents = ['README.md', 'AGENTS.md', ...(await readdir(resolve(root, 'docs'))).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)];
const failures = [];
const exists = async (path, source) => {
  try { await access(path); } catch { failures.push(`${source}: missing ${path}`); }
};
for (const name of documents) {
  const file = resolve(root, name);
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^(?:[a-z]+:|\/)/i.test(link)) continue;
    await exists(resolve(dirname(file), decodeURIComponent(link)), name);
  }
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
  for (const match of command.matchAll(/\bnode\s+([^\s-][^\s]*\.mjs)\b/g)) await exists(resolve(root, match[1]), `npm run ${name}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${documents.length} documents and npm Node entry points.`);
