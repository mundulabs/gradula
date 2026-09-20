/** Reproducible navigation probe. This is not a claim about completed coding tasks. */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {getEncoding} from 'js-tiktoken';
import {createIndexer} from './codegraph-index.mjs';
import {retrieveContext,contextOptions} from '../src/context.mjs';
import {tokens} from '../src/retrieval.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const paths=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0')
  .filter(path=>/\.(?:mjs|[jt]sx?|md)$/.test(path) && !/^(?:docs\/audit|docs\/retrieval|tools\/codegraph-eval|tests\/context|tests\/retrieval)/.test(path));
const files=new Map(paths.map(path=>[path,readFileSync(new URL(`../${path}`,import.meta.url),'utf8')]));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const metadata={repository:'mundulabs/gradula',revision,dirty:true};
const started=performance.now(), indexer=createIndexer(), cold=indexer.build(files,metadata), coldMs=performance.now()-started;
const warmed=performance.now(), warm=indexer.build(files,metadata), warmMs=performance.now()-warmed;
const graph=cold.graph, encoding=getEncoding('cl100k_base');
const count=text=>encoding.encode(text,[],[]).length;
const dataset=JSON.parse(readFileSync(new URL('../tests/fixtures/retrieval-eval.json',import.meta.url),'utf8'));
const baseline=query=>{
  const terms=[...new Set(tokens(query))], matches=new Map();
  for(const term of terms) {
    let output='';
    try{output=execFileSync('rg',['-l','-i','-F','--',term,...paths],{cwd:root,encoding:'utf8',maxBuffer:8_000_000});}
    catch(error){if(error.status!==1)throw error;}
    for(const path of output.trim().split('\n').filter(Boolean))matches.set(path,(matches.get(path) ?? 0)+1);
  }
  const selected=[...matches].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,8).map(([path])=>path);
  const chunks=selected.map(path=>`${path}\n${files.get(path).split('\n').map((text,line)=>({text,line})).filter(({text})=>terms.some(term=>text.toLowerCase().includes(term))).slice(0,2).map(({text,line})=>`${line+1}:${text}`).join('\n')}`);
  let text='',included=[];
  for(let i=0;i<chunks.length;i++){if(Buffer.byteLength(text+chunks[i]+'\n')>8000)break;text+=chunks[i]+'\n';included.push(selected[i]);}
  return {paths:included,text};
};
const rows=dataset.cases.map(({id,query,expected})=>{
  const before=performance.now(), result=retrieveContext(graph,null,contextOptions({q:query,maxBytes:8000,limit:8})), ms=performance.now()-before;
  const baselineStart=performance.now(), rg=baseline(query), rgMs=performance.now()-baselineStart;
  const paths=[...new Set(result.nodes.map(n=>n.path))];
  return {id,query,expected,graph:{recall:expected.filter(p=>paths.includes(p)).length/expected.length,paths,tokens:count(JSON.stringify(result)),bytes:result.budget.bytes,ms:+ms.toFixed(2)},rg:{recall:expected.filter(p=>rg.paths.includes(p)).length/expected.length,paths:rg.paths,tokens:count(rg.text),bytes:Buffer.byteLength(rg.text),ms:+rgMs.toFixed(2)}};
});
const mean=(name,key)=>+(rows.reduce((sum,row)=>sum+row[name][key],0)/rows.length).toFixed(3);
const report={schema:'gradula.retrieval-eval.v1',revision,workingTree:true,graphDigest:graph.digest,tokenizer:'cl100k_base',dataset:dataset.description,
  method:'Same tracked corpus; benchmark/audit leakage excluded. Both return at most 8 nodes/files and 8000 UTF-8 bytes. rg uses query-token file matches ranked by distinct terms, with two matching lines per file. Different payload contents: graph includes relationships/provenance. No LLM answer or end-to-end coding accuracy measured.',
  index:{nodes:graph.nodes.length,edges:graph.edges.length,coldMs:+coldMs.toFixed(2),warmMs:+warmMs.toFixed(2),warmParsed:warm.stats.parsed,warmReused:warm.stats.reused,fullGraphTokens:count(JSON.stringify(graph))},
  summary:{queries:rows.length,graph:{recallAt8:mean('graph','recall'),meanTokens:mean('graph','tokens'),meanMs:mean('graph','ms')},rg:{recallAt8:mean('rg','recall'),meanTokens:mean('rg','tokens'),meanMs:mean('rg','ms')}},cases:rows};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--check') && (report.summary.graph.recallAt8<0.9 || report.summary.graph.meanTokens>500))process.exitCode=1;
