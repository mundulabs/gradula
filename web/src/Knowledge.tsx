import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'preact/compat';
import {codegraph,type CodeGraph} from './api';
import {graphGroup,knowledgeSearch} from './graph-model';
import {chosenLanguage,words} from './words';
import DocumentReader from './DocumentReader';
const ProjectGraph=lazy(()=>import('./ProjectGraph'));
const t=words(chosenLanguage()),PAGE_SIZE=60;
export default function Knowledge({project,open}:{project:string;open:(key:string)=>void}){
  const [graph,setGraph]=useState<CodeGraph|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState(''),[group,setGroup]=useState('all'),[page,setPage]=useState(0),[selected,setSelected]=useState<string|null>(null),[diagram,setDiagram]=useState(false),[documentPath,setDocumentPath]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError(false);setGraph(null);setSelected(null);setDiagram(false);setPage(0);
    codegraph(project,controller.signal).then(value=>{if(!controller.signal.aborted)setGraph(value)}).catch(()=>{if(!controller.signal.aborted)setError(true)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();},[project,attempt]);
  const results=useMemo(()=>graph?knowledgeSearch(graph,query,group):[],[graph,query,group]);
  const counts=useMemo(()=>{const counts:Record<string,number>={all:graph?.nodes.length??0};for(const node of graph?.nodes??[]){const key=graphGroup(node);counts[key]=(counts[key]??0)+1;}return counts;},[graph]);
  const byId=useMemo(()=>new Map(graph?.nodes.map(n=>[n.id,n])??[]),[graph]);
  const focus=selected?byId.get(selected):null;
  const relations=useMemo(()=>graph&&selected?graph.edges.filter(e=>e.from===selected||e.to===selected):[],[graph,selected]);
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(listRef.current)listRef.current.scrollTop=0;},[page,query,group]);
  const shown=results.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const source=(path:string)=>`https://github.com/${graph?.repository}/blob/${graph?.dirty===false&&graph?.revision?graph.revision:'HEAD'}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return <main className="knowledge-browser" aria-busy={loading}>
    <header className="knowledge-browser-head"><div><h1>{t('nav.knowledge')}</h1><p>{t('knowledge.intro')}</p></div>{graph?<span className="workspace-meta">{t('workspace.snapshot')} · {graph.revision?.slice(0,7)??graph.digest.slice(0,7)}</span>:null}</header>
    {loading?<p className="knowledge-loading" role="status">{t('workspace.loadingGraph')}</p>:error||!graph?<div className="knowledge-loading"><p role="status">{t(error?'graph.error':'graph.empty')}</p><button onClick={()=>setAttempt(n=>n+1)}>{t('ui.retry')}</button></div>:diagram?<>
      <div className="knowledge-browser-back"><button onClick={()=>setDiagram(false)}>{t('knowledge.backToResults')}</button><span>{focus?.name}</span></div>
      <Suspense fallback={<p className="knowledge-loading" role="status">{t('ui.loading')}</p>}><ProjectGraph graph={graph} project={project} open={open} initialSelected={selected}/></Suspense>
    </>:<>
      <div className="knowledge-controls"><input type="search" aria-label={t('workspace.find')} placeholder={t('workspace.find')} value={query} onChange={e=>{setQuery(e.currentTarget.value);setPage(0)}}/>
        <div className="knowledge-tabs" role="group" aria-label={t('workspace.scope')}>{['all','structure','code','docs','work'].map(kind=><button key={kind} data-group={kind} aria-pressed={group===kind} onClick={()=>{setGroup(kind);setPage(0)}}>{t(`workspace.${kind}`)} <span>{counts[kind]??0}</span></button>)}</div>
      </div>
      <div className="knowledge-browser-layout" data-inspector={!!focus}>
        <section className="knowledge-browser-results" aria-label={t('workspace.results')}>
          <div className="knowledge-list-head"><span>{t('knowledge.name')}</span><span>{t('knowledge.type')}</span><span>{t('knowledge.path')}</span></div>
          <div ref={listRef} className="knowledge-list">{shown.map(node=><button key={node.id} aria-pressed={selected===node.id} onClick={()=>setSelected(node.id)}><strong>{node.name}</strong><span>{node.kind}</span><small>{node.path??'—'}</small></button>)}{!shown.length?<p className="knowledge-loading" role="status">{t('workspace.noResults')}</p>:null}</div>
          <footer className="knowledge-pagination"><span role="status">{results.length?`${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,results.length)} / ${results.length.toLocaleString()}`:'0'}</span><div><button disabled={page===0} onClick={()=>setPage(n=>n-1)}>{t('knowledge.previous')}</button><button disabled={(page+1)*PAGE_SIZE>=results.length} onClick={()=>setPage(n=>n+1)}>{t('knowledge.next')}</button></div></footer>
        </section>
        {focus?<aside className="knowledge-inspector" aria-label={t('workspace.inspector')}><button className="knowledge-close" onClick={()=>setSelected(null)}>{t('card.close')}</button><span className="workspace-eyebrow">{focus.kind}</span><h2>{focus.name}</h2><p>{focus.about||t('workspace.noDescription')}</p>{focus.path?<code className="knowledge-path">{focus.path}</code>:null}
          <div className="knowledge-actions">{focus.kind==='card'?<button onClick={()=>open(focus.name)}>{t('workspace.openCard')}</button>:null}{focus.path&&graph.documents?.some(d=>d.path===focus.path)?<button onClick={()=>setDocumentPath(focus.path)}>{t('workspace.readDocument')}</button>:null}{focus.path?<a href={source(focus.path)} target="_blank" rel="noreferrer">{t('graph.source')}</a>:null}<button onClick={()=>setDiagram(true)}>{t('knowledge.showRelationships')}</button></div>
          <h3>{relations.length} {t('workspace.relations')}</h3><div className="knowledge-relations">{relations.slice(0,40).map((edge,i)=>{const other=byId.get(edge.from===focus.id?edge.to:edge.from);return <button key={i} onClick={()=>other&&setSelected(other.id)}><strong>{other?.name??edge.kind}</strong><small>{edge.kind} · {t(edge.confidence==='INFERRED'?'graph.inferred':'graph.extracted')}</small><span>{edge.reason}</span></button>})}</div>{relations.length>40?<p>40 / {relations.length}</p>:null}
        </aside>:null}
      </div>
    </>}
    {documentPath&&graph?<DocumentReader key={documentPath} project={project} path={documentPath} paths={(graph.documents??[]).map(d=>d.path)} revision={graph.dirty===false?graph.revision:null} close={()=>setDocumentPath(null)}/>:null}
  </main>;
}
