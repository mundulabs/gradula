/** Local publisher; source scanning never runs inside the Gradula service. */
import {readFileSync, lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseEnv} from 'node:util';
import {config, handOf} from '../src/hand.mjs';
import {createIndexer, buildGraph} from './codegraph-index.mjs';
export {buildGraph};

export function scanRepository(root, indexer = createIndexer(), {revision: requestedRevision=null}={}) {
  const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32_000_000}).trim();
  if(requestedRevision!==null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(requestedRevision))throw new Error('Expected a full source commit SHA');
  const revision = requestedRevision ?? git('rev-parse','HEAD');
  const dirty = requestedRevision===null && !!git('status','--porcelain');
  const files = new Map();
  if(!dirty) {
    // Read immutable Git objects in one batch, never a mixture of working-tree edits.
    const entries=git('ls-tree','-rz','--full-tree',revision).split('\0').filter(Boolean)
      .map(row=>{const tab=row.indexOf('\t');const [mode,,sha]=row.slice(0,tab).split(' ');return {mode,sha,path:row.slice(tab+1)};})
      .filter(e=>e.mode.startsWith('100') && /\.(?:mjs|cjs|[jt]sx?|md)$/.test(e.path));
    const output=execFileSync('git',['cat-file','--batch'],{cwd:root,input:entries.map(e=>e.sha).join('\n')+'\n',maxBuffer:128_000_000});
    let offset=0;
    for(const entry of entries){const end=output.indexOf(10,offset),header=output.subarray(offset,end).toString().split(' '),size=Number(header[2]);if(header[1]!=='blob'||!Number.isSafeInteger(size))throw new Error('Invalid Git blob');offset=end+1;files.set(entry.path,output.subarray(offset,offset+size).toString('utf8'));offset+=size+1;}
  } else {
    const tracked = git('ls-files','-z').split('\0').filter(path=>/\.(?:mjs|cjs|[jt]sx?|md)$/.test(path));
    for (const path of tracked) {
      const file = join(root,path), stat = lstatSync(file);
      if (stat.isFile()) files.set(path,readFileSync(file,'utf8'));
    }
  }
  const remote = git('remote','get-url','origin');
  const repository = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (!repository) throw new Error('Expected a GitHub origin in owner/repository form');
  const result = indexer.build(files,{repository,revision,dirty});
  if (requestedRevision===null && git('rev-parse','HEAD') !== revision) throw new Error('HEAD changed during indexing; retry the scan');
  // Detect edits made while reading. Never label a mixed scan as a clean revision.
  if (requestedRevision===null && !dirty && git('status','--porcelain')) throw new Error('Checkout changed during indexing; retry the scan');
  return result;
}

export async function publishGraph(graph, {env=config(), fetchImpl=fetch}={}) {
  if (graph.dirty) throw new Error('Only a clean committed checkout may be published');
  const {token}=handOf(env,{machine:true});
  if (!token || !env.GRADULA_URL) throw new Error('GRADULA_URL and a project token are required');
  const base=env.GRADULA_URL.replace(/\/+$/,'');
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const probe=await fetchImpl(`${base}/api/v1/context?q=publisher-capabilities`,{headers,signal:AbortSignal.timeout(10000)});
  const capabilities=await probe.json();
  if (!probe.ok || capabilities.capabilities?.version!==2) throw new Error('Upgrade the server to context version 2 before publishing');
  const response=await fetchImpl(`${base}/api/v1/codegraph`,{method:'PUT',headers,body:JSON.stringify(graph),signal:AbortSignal.timeout(30000)});
  const saved=await response.json();
  if (!response.ok) throw new Error(`Graph publish failed: ${saved.error ?? response.status}`);
  if (saved.revision!==graph.revision || saved.digest!==graph.digest) throw new Error('Server did not preserve the graph revision/digest; upgrade the server before publishing');
  return saved;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), watch=args.includes('--watch'), publish=args.includes('--publish');
  const value=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
  const root=resolve(value('--root') ?? fileURLToPath(new URL('../',import.meta.url)));
  const ref=value('--ref'),fetchRemote=args.includes('--fetch');
  if(fetchRemote && (!ref || !/^origin\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(ref)))throw new Error('--fetch requires an origin/branch ref');
  const interval=Number(value('--interval') ?? 5000);
  if (!Number.isSafeInteger(interval) || interval<1000 || interval>300000) throw new Error('Interval must be 1000–300000 ms');
  const indexer=createIndexer({granularity:value('--granularity') ?? 'symbols'}),controller=new AbortController(); let lastDigest=null, lastRevision=null, stopped=false, lastError=null;
  const stop=()=>{stopped=true;controller.abort();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  do {
    try {
      if(fetchRemote)execFileSync('git',['fetch','--quiet','origin',`${ref.slice(7)}:refs/remotes/${ref}`],{cwd:root,timeout:30000,stdio:['ignore','pipe','pipe']});
      const revision=ref ? execFileSync('git',['rev-parse','--verify','--end-of-options',`${ref}^{commit}`],{cwd:root,encoding:'utf8'}).trim() : null;
      if(revision===null || revision!==lastRevision) {
        const {graph,stats}=scanRepository(root,indexer,{revision});
        if (graph.digest!==lastDigest) {
          if (publish) await publishGraph(graph,{env:value('--config') ? {...config(root),...parseEnv(readFileSync(value('--config'),'utf8'))} : config(root)});
          else if (!watch) process.stdout.write(`${JSON.stringify(graph)}\n`);
          process.stderr.write(`${JSON.stringify({revision:graph.revision,dirty:graph.dirty,nodes:graph.nodes.length,edges:graph.edges.length,...stats,published:publish})}\n`);
          lastDigest=graph.digest;
        }
        lastRevision=revision;
      }
      lastError=null;
    } catch(error) {
      if (error.message!==lastError) process.stderr.write(`${error.message}\n`);
      lastError=error.message;
      if (!watch) process.exitCode=1;
    }
    if (watch && !stopped) await delay(interval,null,{signal:controller.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
  } while (watch && !stopped);
}
