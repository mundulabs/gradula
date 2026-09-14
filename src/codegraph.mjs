/** Project-published snapshots; never crawl a repository or trust embedded URLs. */
import {createHash} from 'node:crypto';
export function normalizeGraph(input, repo) {
  const fail = message => { throw new Error(message); };
  const word = (value, max = 500) => typeof value === 'string' && value.length <= max ? value : fail('Invalid graph text');
  const path = value => {
    const p = word(value);
    if (!p || p.startsWith('/') || p.includes('\\') || p.includes(':') || p.split('/').some(x => x === '..' || x === '.' || !x) || /[\x00-\x1f]/.test(p)) fail('Expected a repository-relative path');
    return p;
  };
  if (input?.schema !== 'gradula.codegraph.v1' || !repo || input.repository !== repo) fail('Graph repository must match this project');
  if (Buffer.byteLength(JSON.stringify(input)) > 2_000_000) fail('Graph exceeds 2 MB');
  if (!Array.isArray(input.nodes) || input.nodes.length > 5000 || !Array.isArray(input.edges) || input.edges.length > 20000) fail('Graph exceeds node or edge limits');
  const ids = new Set();
  const nodes = input.nodes.map(n => {
    const id = word(n.id, 600); if (!id || ids.has(id)) fail('Duplicate or empty node ID'); ids.add(id);
    return {id, name:word(n.name), kind:word(n.kind, 60), area:word(n.area ?? '', 60), path:n.path ? path(n.path) : null, about:word(n.about ?? '', 10000)};
  });
  const edges = input.edges.map(e => {
    if (!ids.has(e.from) || !ids.has(e.to)) fail('Edge points to a missing node');
    if (!['EXTRACTED','INFERRED'].includes(e.confidence)) fail('Edge confidence is required');
    const source = e.source?.path ? {path:path(e.source.path)} : null;
    if (source && e.source.line != null) {if (!Number.isSafeInteger(e.source.line) || e.source.line < 1) fail('Invalid source line');source.line=e.source.line;}
    return {from:e.from,to:e.to,kind:word(e.kind,100),confidence:e.confidence,reason:word(e.reason,2000),source};
  });
  const graph = {schema:input.schema,repository:repo,nodes,edges};
  return {...graph,digest:createHash('sha256').update(JSON.stringify(graph)).digest('hex')};
}
