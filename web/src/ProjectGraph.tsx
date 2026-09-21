import {useEffect,useMemo,useRef,useState} from 'preact/compat';
import type {CodeGraph} from './api';
import {graphGroup,projectGraph,radialGraph} from './graph-model';
import DocumentReader from './DocumentReader';
import {chosenLanguage,words} from './words';
const t=words(chosenLanguage());
export default function ProjectGraph({graph,project,open,initialSelected=null}:{graph:CodeGraph;project:string;open:(key:string)=>void;initialSelected?:string|null}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[selected,setSelected]=useState<string|null>(initialSelected),[documentPath,setDocumentPath]=useState<string|null>(null);
  const [expanded,setExpanded]=useState(false),[inspector,setInspector]=useState(false),[hover,setHover]=useState<string|null>(null);
  const [camera,setCamera]=useState({x:0,y:0,k:1}),[viewport,setViewport]=useState({width:1100,height:650});
  const sectionRef=useRef<HTMLElement>(null),svgRef=useRef<SVGSVGElement>(null),expandRef=useRef<HTMLButtonElement>(null),inspectRef=useRef<HTMLButtonElement>(null);
  const drag=useRef<{x:number;y:number;cx:number;cy:number}|null>(null);
  useEffect(()=>{const svg=svgRef.current;if(!svg)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;setViewport({width:Math.max(280,width),height:Math.max(220,height)});});observer.observe(svg);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!expanded)return;const hidden:HTMLElement[]=[];let node:Element|null=sectionRef.current;while(node?.parentElement){for(const sibling of node.parentElement.children){if(sibling!==node&&sibling instanceof HTMLElement&&!sibling.inert){sibling.inert=true;hidden.push(sibling);}}node=node.parentElement;if(node===globalThis.document.body)break;}const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!globalThis.document.querySelector('dialog[open]')){setExpanded(false);expandRef.current?.focus();}};globalThis.addEventListener('keydown',escape);return()=>{globalThis.removeEventListener('keydown',escape);for(const sibling of hidden)sibling.inert=false;};},[expanded]);
  const view=useMemo(()=>projectGraph(graph,query,kind,selected,viewport.width<600?32:80),[graph,query,kind,selected,viewport.width]);
  const layout=useMemo(()=>radialGraph(view.shown,viewport.width,viewport.height,selected),[view.shown,viewport,selected]);
  const byId=useMemo(()=>new Map(graph.nodes.map(n=>[n.id,n])),[graph]);
  const focus=selected?byId.get(selected):null,groups=['structure','code','docs','work'];
  const resetCamera=()=>setCamera({x:0,y:0,k:1});
  useEffect(()=>{resetCamera();},[viewport.width,viewport.height,selected,query,kind]);
  const select=(id:string)=>{setSelected(id);setInspector(true);setHover(null)};
  const source=(path:string)=>`https://github.com/${graph.repository}/blob/${graph.dirty===false&&graph.revision?graph.revision:'HEAD'}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const zoom=(amount:number)=>setCamera(c=>({...c,k:Math.max(.4,Math.min(4,c.k+amount))}));
  const active=hover??selected;
  return <section ref={sectionRef} className="project-knowledge" data-expanded={expanded} aria-label={t('workspace.knowledge')}>
    <div className="knowledge-controls"><input type="search" aria-label={t('workspace.find')} placeholder={t('workspace.find')} value={query} onChange={e=>{setQuery(e.currentTarget.value);setSelected(null);setInspector(!!e.currentTarget.value)}}/>
      <div className="knowledge-tabs" role="group" aria-label={t('workspace.scope')}>{['all',...groups].map(group=><button key={group} data-group={group} aria-pressed={kind===group} onClick={()=>{setKind(group);setSelected(null)}}>{t(`workspace.${group}`)}</button>)}</div>
      <div className="knowledge-view-controls"><button ref={inspectRef} aria-expanded={inspector} aria-controls={`inspector-${project}`} onClick={()=>setInspector(v=>!v)}>{t('workspace.details')}</button><button ref={expandRef} aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{t(expanded?'workspace.exitFullscreen':'workspace.fullscreen')}</button></div>
    </div>
    <div className="knowledge-layout" data-inspector={inspector}><div className="knowledge-canvas">
      <div className="knowledge-caption"><span>{focus?focus.name:t('workspace.knowledge')} <small>{graph.nodes.length.toLocaleString()} {t('workspace.nodes')} · {graph.edges.length.toLocaleString()} {t('workspace.relations')} · {t('workspace.snapshot')} {graph.revision?.slice(0,7)??graph.digest.slice(0,7)}</small></span>{selected?<button className="ghost" onClick={()=>{setSelected(null);setInspector(false)}}>{t('workspace.resetFocus')}</button>:null}</div>
      <svg ref={svgRef} className="knowledge-svg" viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label={t('workspace.graphLabel')}
        onWheel={e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoom(e.deltaY<0?.1:-.1)}}}
        onPointerDown={e=>{if((e.target as Element).closest('[data-node]'))return;drag.current={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};e.currentTarget.setPointerCapture(e.pointerId)}}
        onPointerMove={e=>{const d=drag.current;if(!d)return;const scale=viewport.width/e.currentTarget.getBoundingClientRect().width;setCamera(c=>({...c,x:d.cx+(e.clientX-d.x)*scale,y:d.cy+(e.clientY-d.y)*scale}))}}
        onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
        <g transform={`translate(${camera.x} ${camera.y}) translate(${layout.center.x} ${layout.center.y}) scale(${camera.k}) translate(${-layout.center.x} ${-layout.center.y})`}>
          <circle className="knowledge-orbit" cx={layout.center.x} cy={layout.center.y} r={layout.radius+24}/>
          {layout.rings.map(ring=><path key={ring.group} className="knowledge-ring" data-group={ring.group} d={ring.path}/>)}
          {view.edges.map((edge,i)=>{const a=layout.positions.get(edge.from)!,b=layout.positions.get(edge.to)!,c=layout.center;return <path className="knowledge-edge" key={i} data-active={!!active&&(edge.from===active||edge.to===active)} data-dim={!!active&&edge.from!==active&&edge.to!==active} data-inferred={edge.confidence==='INFERRED'} d={`M ${a.x} ${a.y} C ${c.x} ${c.y}, ${c.x} ${c.y}, ${b.x} ${b.y}`}><title>{edge.kind}: {edge.reason}</title></path>})}
          {!focus?<g className="knowledge-center" transform={`translate(${layout.center.x} ${layout.center.y})`}><text y="-8">{project}</text><text y="18">{view.shown.length} / {view.total.toLocaleString()}</text></g>:null}
          {view.shown.map(node=>{const p=layout.positions.get(node.id)!,flip=Math.cos(p.angle)<0,angle=p.center?0:p.angle*180/Math.PI+(flip?180:0),labelLimit=viewport.width<600?12:22;return <g className="knowledge-node" data-node={node.id} data-group={graphGroup(node)} data-selected={selected===node.id} key={node.id} transform={`translate(${p.x} ${p.y}) rotate(${angle})`} role="button" tabIndex={0} aria-label={`${node.name} · ${node.kind}`} aria-pressed={selected===node.id} onClick={()=>select(node.id)} onMouseEnter={()=>setHover(node.id)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(node.id)} onBlur={()=>setHover(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node.id)}}}>
            <title>{node.name}{node.path?` · ${node.path}`:''}</title><circle className="knowledge-hit" r="11"/><circle className="knowledge-dot" r={p.center?7:3.5}/><text x={p.center?0:flip?-19:19} y={p.center?27:4} textAnchor={p.center?'middle':flip?'end':'start'}>{node.name.length>labelLimit?node.name.slice(0,labelLimit-1)+'…':node.name}</text>
          </g>})}
        </g>
      </svg>
      {!view.shown.length?<p className="knowledge-empty">{t('workspace.noResults')}</p>:null}
      <footer className="knowledge-footer"><span>{view.shown.length} / {view.total.toLocaleString()} · {t('workspace.graphHint')}</span><div><button onClick={()=>zoom(-.2)} aria-label={t('workspace.zoomOut')}>−</button><button onClick={resetCamera}>{t('workspace.fit')}</button><button onClick={()=>zoom(.2)} aria-label={t('workspace.zoomIn')}>+</button></div></footer>
    </div>{inspector?<aside id={`inspector-${project}`} className="knowledge-inspector" aria-label={t('workspace.inspector')}>
      <button className="knowledge-close" onClick={()=>{setInspector(false);inspectRef.current?.focus()}}>{t('card.close')}</button>
      {focus?<><span className="workspace-eyebrow">{focus.kind}</span><h3>{focus.name}</h3><p>{focus.about||t('workspace.noDescription')}</p>{focus.path?<code className="knowledge-path">{focus.path}</code>:null}
        <div className="knowledge-actions">{focus.kind==='card'?<button onClick={()=>open(focus.name)}>{t('workspace.openCard')}</button>:null}{focus.path&&graph.documents?.some(d=>d.path===focus.path)?<button onClick={()=>setDocumentPath(focus.path)}>{t('workspace.readDocument')}</button>:null}{focus.path?<a href={source(focus.path)} target="_blank" rel="noreferrer">{t('graph.source')}</a>:null}</div>
        <h4>{view.relations.length} {t('workspace.relations')}</h4><div className="knowledge-relations">{view.relations.slice(0,30).map((edge,i)=>{const other=byId.get(edge.from===focus.id?edge.to:edge.from);return <button key={i} onClick={()=>other&&select(other.id)}><strong>{other?.name??edge.kind}</strong><small>{edge.kind} · {t(edge.confidence==='INFERRED'?'graph.inferred':'graph.extracted')}</small><span>{edge.reason}</span></button>})}</div>
      </>:<><span className="workspace-eyebrow">{t('workspace.explore')}</span><h3>{t('workspace.selectNode')}</h3><p>{t('workspace.selectHelp')}</p></>}
      <details open={!focus}><summary>{t('workspace.results')} · {view.matches.length.toLocaleString()}</summary><div className="knowledge-results">{view.matches.slice(0,60).map(node=><button key={node.id} onClick={()=>select(node.id)}><strong>{node.name}</strong><small>{node.path??node.kind}</small></button>)}{!view.matches.length?<p>{t('workspace.noResults')}</p>:null}</div></details>
      <div className="knowledge-provenance"><span>{t('workspace.snapshot')} · {new Date(graph.importedAt).toLocaleString()} · {graph.revision?.slice(0,12)??graph.digest.slice(0,12)}</span><details><summary>{t('workspace.evidenceLegend')}</summary><p>{t('workspace.evidenceHelp')}</p></details></div>
    </aside>:null}</div>
    {documentPath?<DocumentReader key={documentPath} project={project} path={documentPath} paths={(graph.documents??[]).map(d=>d.path)} revision={graph.dirty===false?graph.revision:null} close={()=>setDocumentPath(null)}/>:null}
  </section>;
}
