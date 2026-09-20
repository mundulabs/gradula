/** Build-time only: publish the exact Git revision packaged in this image. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { scanRepository } from './codegraph.mjs';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const {graph} = scanRepository(process.cwd(), undefined, {revision});
if (graph.repository !== 'mundulabs/gradula') throw Error('Unexpected source repository');
writeFileSync(process.argv[2] ?? '/tmp/gradula-source-graph.json', JSON.stringify(graph));
console.log(`Bundled graph ${revision}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
