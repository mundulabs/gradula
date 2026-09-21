import {useEffect,useMemo,useRef,useState} from 'preact/compat';
import type {CodeGraph} from './api';
import {graphGroup,projectGraph} from './graph-model';
import DocumentReader from './DocumentReader';
import {chosenLanguage,words} from './words';
const t=words(chosenLanguage());
export default function ProjectGraph({graph,project,open}:{graph:CodeGraph;project:string;open:(key:string)=>void}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[selected,setSelected]=useState<string|null>(null),[document,setDocument]=useState<string|null>(null);
  const [camera,setCamera]=useState({x:0,y:0,k:1});
  const svgRef=useRef<SVGSVGElement>(null);
  const [viewport,setViewport]=useState({width:990,height:610});
  useEffect(()=>{const svg=svgRef.current;if(!svg)return;const observer=new ResizeObserver(([entry])=>{const width=entry.contentRect.width;setViewport(width<600?{width:Math.max(280,width),height:420}:{width:990,height:610});});observer.observe(svg);return()=>observer.disconnect();},[]);
  const drag=useRef<{x:number;y:number;cx:number;cy:number;moved:boolean}|null>(null);
  const view=useMemo(()=>projectGraph(graph,query,kind,selected),[graph,query,kind,selected]);
  const byId=useMemo(()=>new Map(graph.nodes.map(n=>[n.id,n])),[graph]);
  const focus=selected?byId.get(selected):null;
  const groups=['structure','code','docs','work'];
  const positions=new Map<string,{x:number;y:number}>();
  for(const [column,group] of groups.entries()){
    const nodes=view.shown.filter(n=>graphGroup(n)===group);
    nodes.forEach((n,row)=>positions.set(n.id,{x:125+column*245,y:90+(row+0.5)*460/Math.max(1,nodes.length)}));
  }
  const resetCamera=(id:string|null=selected)=>{const p=id?positions.get(id):null;setCamera({x:viewport.width<600?viewport.width/2-(p?.x??125):0,y:viewport.width<600?viewport.height/2-(p?.y??305):0,k:1});};
  useEffect(()=>{resetCamera();},[viewport.width,selected]);
  const select=(id:string)=>{setSelected(id);resetCamera(id)};
  const source=(path:string)=>`https://github.com/${graph.repository}/blob/${graph.dirty===false&&graph.revision?graph.revision:'HEAD'}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const zoom=(amount:number)=>setCamera(c=>({...c,k:Math.max(.65,Math.min(2.5,c.k+amount))}));
  return <section className="project-knowledge" aria-label={t('workspace.knowledge')}>
    <header className="workspace-section-head"><div><span className="workspace-eyebrow">{t('workspace.knowledge')}</span><h2>{t('workspace.connected')}</h2></div><span className="workspace-meta">{graph.nodes.length.toLocaleString()} {t('workspace.nodes')} · {graph.edges.length.toLocaleString()} {t('workspace.relations')}</span></header>
    <div className="knowledge-controls"><input type="search" aria-label={t('workspace.find')} placeholder={t('workspace.find')} value={query} onChange={e=>{setQuery(e.currentTarget.value);setSelected(null)}}/>
      <div className="knowledge-tabs" role="group" aria-label={t('workspace.scope')}>{['all',...groups].map(group=><button key={group} aria-pressed={kind===group} onClick={()=>{setKind(group);setSelected(null)}}>{t(`workspace.${group}`)}</button>)}</div>
    </div>
    <div className="knowledge-layout"><div className="knowledge-canvas">
      <div className="knowledge-caption"><span>{focus?focus.name:t('workspace.overviewGraph')}</span>{selected?<button className="ghost" onClick={()=>{setSelected(null);resetCamera(null)}}>{t('workspace.resetFocus')}</button>:null}</div>
      <svg ref={svgRef} className="knowledge-svg" viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label={t('workspace.graphLabel')}
        onPointerDown={e=>{if((e.target as Element).closest('[data-node]'))return;drag.current={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId)}}
        onPointerMove={e=>{const d=drag.current;if(!d)return;const scale=viewport.width/e.currentTarget.getBoundingClientRect().width;d.moved=true;setCamera(c=>({...c,x:d.cx+(e.clientX-d.x)*scale,y:d.cy+(e.clientY-d.y)*scale}))}}
        onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
        <defs><pattern id={`grid-${project}`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" className="knowledge-grid-dot"/></pattern></defs>
        <rect width={viewport.width} height={viewport.height} fill={`url(#grid-${project})`}/>
        <g transform={`translate(${camera.x} ${camera.y}) translate(${viewport.width/2} ${viewport.height/2}) scale(${camera.k}) translate(${-viewport.width/2} ${-viewport.height/2})`}>
          {groups.map((group,i)=><g key={group}><text className="knowledge-column-name" x={35+i*245} y={40}>{t(`workspace.${group}`).toUpperCase()}</text><line className="knowledge-column-line" x1={35+i*245} y1={55} x2={210+i*245} y2={55}/></g>)}
          {view.edges.map((edge,i)=>{const a=positions.get(edge.from)!,b=positions.get(edge.to)!;const bend=(a.x+b.x)/2;return <path className="knowledge-edge" key={i} data-inferred={edge.confidence==='INFERRED'} d={`M ${a.x} ${a.y} C ${bend} ${a.y}, ${bend} ${b.y}, ${b.x} ${b.y}`}><title>{edge.kind}: {edge.reason}</title></path>})}
          {view.shown.map(node=>{const p=positions.get(node.id)!;return <g className="knowledge-node" data-node={node.id} data-selected={selected===node.id} key={node.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={`${node.name} · ${node.kind}`} aria-pressed={selected===node.id} onClick={()=>select(node.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node.id)}}}>
            <title>{node.name}{node.path?` · ${node.path}`:''}</title><rect x="-104" y="-20" width="208" height="40" rx="8"/><circle cx="-89" cy="0" r="3"/><text x="-78" y="4">{node.name.length>24?node.name.slice(0,22)+'…':node.name}</text>
          </g>})}
        </g>
      </svg>
      <footer className="knowledge-footer"><span>{view.shown.length} / {view.total.toLocaleString()} · {t('workspace.graphHint')}</span><div><button onClick={()=>zoom(-.2)} aria-label={t('workspace.zoomOut')}>−</button><button onClick={()=>resetCamera()}>{t('workspace.fit')}</button><button onClick={()=>zoom(.2)} aria-label={t('workspace.zoomIn')}>+</button></div></footer>
    </div><aside className="knowledge-inspector" aria-label={t('workspace.inspector')}>
      {focus?<><span className="workspace-eyebrow">{focus.kind}</span><h3>{focus.name}</h3><p>{focus.about||t('workspace.noDescription')}</p>{focus.path?<code className="knowledge-path">{focus.path}</code>:null}
        <div className="knowledge-actions">{focus.kind==='card'?<button onClick={()=>open(focus.name)}>{t('workspace.openCard')}</button>:null}{focus.path&&graph.documents?.some(d=>d.path===focus.path)?<button onClick={()=>setDocument(focus.path)}>{t('workspace.readDocument')}</button>:null}{focus.path?<a href={source(focus.path)} target="_blank" rel="noreferrer">{t('graph.source')}</a>:null}</div>
        <h4>{view.relations.length} {t('workspace.relations')}</h4><div className="knowledge-relations">{view.relations.slice(0,30).map((edge,i)=>{const other=byId.get(edge.from===focus.id?edge.to:edge.from);return <button key={i} onClick={()=>other&&select(other.id)}><strong>{other?.name??edge.kind}</strong><small>{edge.kind} · {t(edge.confidence==='INFERRED'?'graph.inferred':'graph.extracted')}</small><span>{edge.reason}</span></button>})}</div>
      </>:<><span className="workspace-eyebrow">{t('workspace.explore')}</span><h3>{t('workspace.selectNode')}</h3><p>{t('workspace.selectHelp')}</p></>}
      <details open={!focus}><summary>{t('workspace.results')} · {view.matches.length.toLocaleString()}</summary><div className="knowledge-results">{view.matches.slice(0,60).map(node=><button key={node.id} onClick={()=>select(node.id)}><strong>{node.name}</strong><small>{node.path??node.kind}</small></button>)}{!view.matches.length?<p>{t('workspace.noResults')}</p>:null}</div></details>
    </aside></div>
    <div className="knowledge-provenance"><span>{t('workspace.snapshot')} · {new Date(graph.importedAt).toLocaleString()} · {graph.revision?.slice(0,12)??graph.digest.slice(0,12)}</span><details><summary>{t('workspace.evidenceLegend')}</summary><p>{t('workspace.evidenceHelp')}</p></details></div>
    {document?<DocumentReader key={document} project={project} path={document} paths={(graph.documents??[]).map(d=>d.path)} revision={graph.dirty===false?graph.revision:null} close={()=>setDocument(null)}/>:null}
  </section>;
}
