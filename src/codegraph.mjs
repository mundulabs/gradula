/** Project-published snapshots; never crawl a repository or trust embedded URLs. */
import {createHash} from 'node:crypto';
export const GRAPH_LIMITS = Object.freeze({bytes:8_000_000,nodes:20000,edges:80000});
export function normalizeGraph(input, repo) {
  const fail = message => { throw new Error(message); };
  const word = (value, max = 500) => typeof value === 'string' && value.length <= max ? value : fail('Invalid graph text');
  const path = value => {
    const p = word(value);
    if (!p || p.startsWith('/') || p.includes('\\') || p.includes(':') || p.split('/').some(x => x === '..' || x === '.' || !x) || /[\x00-\x1f]/.test(p)) fail('Expected a repository-relative path');
    return p;
  };
  if (input?.schema !== 'gradula.codegraph.v1' || !repo || input.repository !== repo) fail('Graph repository must match this project');
  if (Buffer.byteLength(JSON.stringify(input)) > GRAPH_LIMITS.bytes) fail('Graph exceeds 8 MB');
  if (!Array.isArray(input.nodes) || input.nodes.length > GRAPH_LIMITS.nodes || !Array.isArray(input.edges) || input.edges.length > GRAPH_LIMITS.edges) fail('Graph exceeds node or edge limits');
  const ids = new Set();
  const nodes = input.nodes.map(n => {
    const id = word(n.id, 600); if (!id || ids.has(id)) fail('Duplicate or empty node ID'); ids.add(id);
    if (n.line != null && (!n.path || !Number.isSafeInteger(n.line) || n.line < 1)) fail('Invalid node source line');
    if (n.endLine != null && (!n.line || !Number.isSafeInteger(n.endLine) || n.endLine < n.line)) fail('Invalid source range');
    if (n.contentHash != null && !/^[a-f0-9]{64}$/.test(n.contentHash)) fail('Invalid content hash');
    if (n.aliases != null && (!Array.isArray(n.aliases) || n.aliases.length > 30)) fail('Invalid aliases');
    return {id, name:word(n.name), kind:word(n.kind, 60), area:word(n.area ?? '', 60), path:n.path ? path(n.path) : null, line:n.line ?? null, endLine:n.endLine ?? null, contentHash:n.contentHash ?? null, aliases:(n.aliases ?? []).map(a=>word(a,100)), about:word(n.about ?? '', 10000)};
  });
  const edges = input.edges.map(e => {
    if (!ids.has(e.from) || !ids.has(e.to)) fail('Edge points to a missing node');
    if (!['EXTRACTED','INFERRED'].includes(e.confidence)) fail('Edge confidence is required');
    const source = e.source?.path ? {path:path(e.source.path)} : null;
    if (source && e.source.line != null) {if (!Number.isSafeInteger(e.source.line) || e.source.line < 1) fail('Invalid source line');source.line=e.source.line;}
    return {from:e.from,to:e.to,kind:word(e.kind,100),confidence:e.confidence,reason:word(e.reason,2000),source};
  });
  // A legacy snapshot is allowed, but must never acquire a made-up revision.
  const revision = input.revision ?? null;
  if (revision !== null && (typeof revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))) fail('Expected a full source commit SHA');
  if (input.dirty != null && typeof input.dirty !== 'boolean') fail('Expected a boolean dirty flag');
  const generator = input.generator == null ? null : word(input.generator,100);
  let coverage=null;
  if(input.coverage!=null){
    for(const field of ['files','unresolvedCalls'])if(!Number.isSafeInteger(input.coverage[field])||input.coverage[field]<0)fail('Invalid graph coverage');
    coverage={files:input.coverage.files,unresolvedCalls:input.coverage.unresolvedCalls,scope:word(input.coverage.scope,100)};
  }
  const graph = {schema:input.schema,repository:repo,revision,dirty:input.dirty ?? null,generator,coverage,nodes,edges};
  return {...graph,digest:createHash('sha256').update(JSON.stringify(graph)).digest('hex')};
}
