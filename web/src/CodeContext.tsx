import {useEffect, useMemo, useState} from 'react';
import {codegraph, type CodeGraph} from './api';
import {chosenLanguage, words} from './words';
const t=words(chosenLanguage());
export default function CodeContext({project, files}:{project:string;files:string[]}) {
  const [graph,setGraph]=useState<CodeGraph|null>(null), [error,setError]=useState(false), [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<string|null>(null), [query,setQuery]=useState('');
  useEffect(()=>{let alive=true;setGraph(null);setError(false);setLoading(true);setSelected(null);
    codegraph(project).then(g=>{if(alive)setGraph(g)}).catch(()=>{if(alive)setError(true)}).finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};},[project]);
  const seeds=useMemo(()=>new Set(graph?.nodes.filter(n=>n.path&&files.some(f=>n.path===f||n.path?.startsWith(f+'/'))).map(n=>n.id)),[graph,files]);
  const focus=selected ? new Set([selected]) : seeds;
  const edges=graph?.edges.filter(e=>focus.has(e.from)||focus.has(e.to)) ?? [];
  const ids=new Set([...focus,...edges.flatMap(e=>[e.from,e.to])]);
  const nodes=graph?.nodes.filter(n=>ids.has(n.id)) ?? [];
  const matches=query.trim()?graph?.nodes.filter(n=>(n.name+' '+n.path).toLowerCase().includes(query.trim().toLowerCase())).slice(0,20):[];
  const href=(path:string,line?:number)=>`https://github.com/${graph?.repository}/blob/${graph?.revision && graph.dirty===false ? graph.revision : 'HEAD'}/${path.split('/').map(encodeURIComponent).join('/')}${line?'#L'+line:''}`;
  const shown=nodes.slice(0,36), centre=shown.find(n=>focus.has(n.id));
  const surrounding=shown.filter(n=>n.id!==centre?.id);
  const positions=new Map(surrounding.map((n,i)=>[n.id,{x:160+112*Math.cos(i/surrounding.length*Math.PI*2),y:160+112*Math.sin(i/surrounding.length*Math.PI*2)}]));
  if(centre)positions.set(centre.id,{x:160,y:160});
  return <section className="code-context" aria-label={t('graph.title')}>
    <h3>{t('graph.title')}</h3>
    {loading?<p>{t('ui.loading')}</p>:error?<p role="status">{t('graph.error')}</p>:!graph?<p>{t('graph.empty')}</p>:<>
      <p>{t('graph.snapshot')} {new Date(graph.importedAt).toLocaleString()} · {graph.digest.slice(0,8)}{graph.revision && graph.dirty===false ? ` · ${graph.revision.slice(0,12)}` : ''}</p>
      <label>{t('graph.find')}<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {!!matches?.length&&<div className="code-context-results">{matches.map(n=><button key={n.id} onClick={()=>{setSelected(n.id);setQuery('')}}>{n.name}</button>)}</div>}
      {selected&&<button onClick={()=>setSelected(null)}>{t('graph.ticket')}</button>}
      {!nodes.length?<p>{t('graph.unmatched')}</p>:<>
        <svg viewBox="0 0 320 320" role="group" aria-label={t('graph.neighbours')}>
          {edges.map((e,i)=>{const a=positions.get(e.from),b=positions.get(e.to);return a&&b?<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray={e.confidence==='INFERRED'?'3 4':undefined}/>:null})}
          {shown.map(n=>{const p=positions.get(n.id)!;return <g key={n.id} role="button" tabIndex={0} aria-label={n.name} onClick={()=>setSelected(n.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(n.id)}}}><title>{n.name}</title><rect x={p.x-30} y={p.y-12} width={60} height={36} fill="transparent"/><circle cx={p.x} cy={p.y} r={focus.has(n.id)?7:4}/><text x={p.x} y={p.y+17} textAnchor="middle">{n.name.length>23?n.name.slice(0,21)+'…':n.name}</text></g>})}
        </svg>
        {nodes.length>shown.length&&<p>{t('graph.limit')} {shown.length} / {nodes.length}</p>}
        <div className="code-context-results">{nodes.map(n=><div key={n.id}><button onClick={()=>setSelected(n.id)}>{n.name}</button>{n.path&&<a href={n.kind==='card'?'/'+encodeURIComponent(n.name):href(n.path)} target="_blank" rel="noreferrer">{t('graph.source')}</a>}</div>)}</div>
        <details><summary>{t('graph.explain')} ({edges.length})</summary>{edges.map((e,i)=><p key={i}><strong>{t(e.confidence==='INFERRED'?'graph.inferred':'graph.extracted')}</strong> · {e.kind}<br/>{graph.nodes.find(n=>n.id===e.from)?.name} → {graph.nodes.find(n=>n.id===e.to)?.name}<br/>{e.reason}{e.source&&<> · <a href={href(e.source.path,e.source.line)} target="_blank" rel="noreferrer">{e.source.path}{e.source.line?':'+e.source.line:''}</a></>}</p>)}</details>
      </>}
    </>}
  </section>;
}
