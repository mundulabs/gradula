/** Deterministic, field-weighted BM25 plus bounded graph walks. No remote model. */
const stop = new Set('a an and are as at be by can do does for from how i in is it of on or the this to what when where which who why with'.split(' '));
const stem = term => term.length>4 && term.endsWith('ies') ? `${term.slice(0,-3)}y` : term.length>4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0,-1) : term;
export const tokens = text => (String(text ?? '').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t=>!stop.has(t)).map(stem);
const aliases = [
  ['authentication','auth','signin','login','oidc'], ['authorization','permission','role','access'],
  ['reservation','lease','heartbeat'], ['notification','herald','telegram'],
  ['deployment','deploy','delivery','dokploy'], ['verification','gate','test'],
  ['history','chronicle','event'], ['documentation','document','doc'],
  ['coder','coding','assistant','agent','codex','claude'],
];
const cached = new Map();
const overlap = (a,b) => a && b && (a===b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`));

export function compileGraph(graph) {
  const key=graph.digest && `${graph.digest}:${graph.nodes.length}:${graph.edges.length}`;
  if (key && cached.has(key)) {const value=cached.get(key);cached.delete(key);cached.set(key,value);return value;}
  const byId=new Map(graph.nodes.map(n=>[n.id,n])), adjacency=new Map(), frequency=new Map();
  const documents=graph.nodes.map(node=>{
    const counts=new Map();
    for (const [text,weight] of [[node.name,5],[node.path,2],[node.about,1],[(node.aliases ?? []).join(' '),3]]) {
      for (const token of tokens(text)) counts.set(token,(counts.get(token) ?? 0)+weight);
    }
    for (const term of counts.keys()) frequency.set(term,(frequency.get(term) ?? 0)+1);
    return {node,counts,length:[...counts.values()].reduce((a,b)=>a+b,0)};
  });
  for (const edge of graph.edges) for (const id of [edge.from,edge.to]) {const list=adjacency.get(id) ?? [];list.push(edge);adjacency.set(id,list);}
  const index={byId,adjacency,documents,frequency,average:documents.reduce((n,d)=>n+d.length,0)/Math.max(1,documents.length)};
  if (key) {cached.set(key,index);while(cached.size>4)cached.delete(cached.keys().next().value);}
  return index;
}

export function rankNodes(graph,{q='',files=[]}) {
  const index=compileGraph(graph), original=[...new Set(tokens(q))], expanded=new Map(original.map(t=>[t,1]));
  for (const group of aliases) if (group.some(t=>original.includes(stem(t)))) for (const term of group) if (!expanded.has(stem(term))) expanded.set(stem(term),0.25);
  return index.documents.map(({node,counts,length})=>{
    const exact=files.includes(node.path), scoped=files.some(path=>overlap(node.path,path));
    let score=exact?10000:scoped?5000:0, hits=0;
    for (const [term,weight] of expanded) {
      const tf=counts.get(term) ?? 0;
      if (!tf) continue;
      if (weight===1) hits++;
      const df=index.frequency.get(term) ?? 0, idf=Math.log(1+(index.documents.length-df+0.5)/(df+0.5));
      score+=weight*idf*(tf*2.2)/(tf+1.2*(0.25+0.75*length/Math.max(1,index.average)));
    }
    if (original.length) score*=1+hits/original.length;
    if (q && [node.id,node.path,node.name].some(value=>value?.toLowerCase()===q.toLowerCase())) score+=20000;
    if (scoped && ['file','document'].includes(node.kind)) score+=100;
    return {node,score,match:exact?'declared-file':scoped?'declared-folder':'query'};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score || a.node.id.localeCompare(b.node.id));
}

export function graphWalk(graph,{mode,q,from,to,depth=2,includeInferred=false,files=[]}) {
  const index=compileGraph(graph);
  const resolve = value => {
    if(index.byId.has(value))return value;
    const path=graph.nodes.find(n=>n.path===value && ['file','document'].includes(n.kind));
    if(path)return path.id;
    const names=graph.nodes.filter(n=>n.name===value);
    return names.length===1?names[0].id:null;
  };
  const start=resolve(from || q || files[0]), goal=mode==='path'?resolve(to):null;
  if (!start || mode==='path' && !goal) return {nodes:[],edges:[],traversal:{status:'unresolved',visited:0,depth}};
  const seen=new Map([[start,null]]), queue=[{id:start,level:0}], walked=[];
  let capped=false,depthLimited=false;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const {id,level}=queue[cursor];
    if (mode==='path' && id===goal) break;
    for(const edge of index.adjacency.get(id) ?? []) {
      if (!includeInferred && (edge.confidence!=='EXTRACTED' || !edge.source)) continue;
      // Impact follows incoming usage; declarations link a changed file to its symbols.
      const downstream=['imports','calls','constructs','extends','tests','references'].includes(edge.kind) && edge.to===id;
      const contained=['declares','contains'].includes(edge.kind) && edge.from===id;
      if (mode==='impact' && !downstream && !contained) continue;
      const next=edge.from===id?edge.to:edge.from;
      if (seen.has(next)) continue;
      if (level>=depth) {depthLimited=true;continue;}
      if (seen.size>=1000) {capped=true;continue;}
      seen.set(next,{previous:id,edge});walked.push(edge);queue.push({id:next,level:level+1});
    }
  }
  if (mode==='path') {
    const path=[],edges=[];
    if (seen.has(goal)) {let id=goal;while(id){path.unshift(index.byId.get(id));const step=seen.get(id);if(step)edges.unshift(step.edge);id=step?.previous;}}
    return {nodes:path,edges,traversal:{status:path.length?'found':capped||depthLimited?'bounded':'not-found',visited:seen.size,depth}};
  }
  return {nodes:queue.map(({id})=>index.byId.get(id)),edges:walked,traversal:{status:capped||depthLimited?'bounded':'complete',visited:seen.size,depth}};
}
