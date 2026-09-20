import { readFile } from 'node:fs/promises';
/** One bundled revision per deployment; no repository access at runtime. */
export async function importHostedGraph(gradula, {path, project='GRD', log=console}={}) {
  if (!path) return {enabled:false};
  const graph = JSON.parse(await readFile(path,'utf8'));
  if (graph.repository !== 'mundulabs/gradula' || graph.dirty !== false || !/^[a-f0-9]{40}$/.test(graph.revision ?? '')) throw Error('Invalid hosted source provenance');
  const board = await gradula.getProject(project);
  if (board.repo !== graph.repository) throw Error('Hosted graph project/repository mismatch');
  const result = await gradula.putCodegraph(board.key, graph, 'Gradula hosted deployment');
  log.info(`[gradula] hosted source graph ${graph.revision}`);
  return result;
}
