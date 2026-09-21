import {useEffect,useMemo,useState} from 'preact/compat';
import {codegraph,decisionReport,type Card,type CodeGraph,type DecisionReport,type Project,type System} from './api';
import ProjectGraph from './ProjectGraph';
import Dialog from './Dialog';
import {chosenLanguage,words} from './words';
const t=words(chosenLanguage());
export default function ProjectOverview({project,cards,system,systemError,loading,open,board,retry}:{project:Project;cards:Card[];system:System|null;systemError:boolean;loading:boolean;open:(key:string)=>void;board:()=>void;retry:()=>void}){
  const [activity,setActivity]=useState(false);
  const [graph,setGraph]=useState<CodeGraph|null>(null),[graphLoading,setGraphLoading]=useState(true),[graphError,setGraphError]=useState(false),[report,setReport]=useState<DecisionReport|null>(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let alive=true;setGraph(null);setGraphLoading(true);setGraphError(false);setReport(null);
    codegraph(project.key).then(g=>{if(alive)setGraph(g)}).catch(()=>{if(alive)setGraphError(true)}).finally(()=>{if(alive)setGraphLoading(false)});
    decisionReport(project.key).then(r=>{if(alive)setReport(r)}).catch(()=>{});return()=>{alive=false};},[project.key,attempt]);
  const active=cards.filter(c=>c.state==='making'),review=cards.filter(c=>c.state==='review');
  const ahead=useMemo(()=>{const prod=new Set(system?.deployed?.production?.cards??[]);return (system?.deployed?.development?.cards??[]).filter(key=>!prod.has(key));},[system]);
  const status=systemError?'workspace.interrupted':!system||system.observation?.refreshing?'workspace.refreshing':'workspace.observed';
  const observation=system?.observation?.observedAt??(system?.observation?null:system?.at);
  return <main className="project-workspace" aria-busy={loading}>
    <header className="project-hero"><section className="project-metrics" aria-label={t('workspace.work')}>
      <button onClick={board}><span>{t('workspace.inFlight')}</span><strong>{active.length}</strong><small>{t('workspace.activeTasks')}</small></button>
      <button onClick={board}><span>{t('workspace.review')}</span><strong>{review.length}</strong><small>{t('workspace.awaitingReview')}</small></button>
      <button onClick={board}><span>{t('workspace.ahead')}</span><strong>{system?.deployed?.development?.sha&&system?.deployed?.production?.sha?ahead.length:'—'}</strong><small>{t('workspace.aheadHelp')}</small></button>
      <div><span>{t('workspace.indexed')}</span><strong>{graph?graph.nodes.length.toLocaleString():graphLoading?'…':'—'}</strong><small>{graph?`${graph.documents?.length??0} ${t('workspace.documents')}`:t('workspace.sourceEvidence')}</small></div>
    </section><div className="project-connection"><span className="connection-badge" data-state={systemError?'error':system?.observation?.refreshing||!system?'pending':'ready'}>{t(status)}</span><small>{observation?new Date(observation).toLocaleTimeString():t('workspace.firstObservation')}</small><button onClick={()=>setActivity(true)}>{t('workspace.activityDelivery')}</button><button className="ghost" onClick={()=>{retry();setAttempt(n=>n+1)}}>{t('workspace.refresh')}</button></div></header>
    {graph?<ProjectGraph project={project.key} graph={graph} open={open}/>:<section className="project-panel graph-placeholder" aria-busy={graphLoading}><span className="workspace-eyebrow">{t('workspace.knowledge')}</span><h2>{graphLoading?t('workspace.loadingGraph'):t(graphError?'graph.error':'graph.empty')}</h2>{!graphLoading?<button onClick={()=>setAttempt(n=>n+1)}>{t('ui.retry')}</button>:null}</section>}
    {activity?<Dialog title={t('workspace.activityDelivery')} close={()=>setActivity(false)} wide>
    <div className="project-status-grid"><section className="project-panel"><header className="workspace-section-head"><h2>{t('workspace.delivery')}</h2><span className="workspace-meta">{observation?new Date(observation).toLocaleDateString():'—'}</span></header>
      <div className="delivery-lanes">{['development','production'].map(lane=>{const environment=system?.environments?.find(e=>e.id===lane),sha=system?.deployed?.[lane]?.sha;return <div className="delivery-lane" key={lane}><span className="workspace-eyebrow">{t(lane==='development'?'lane.dev':'lane.prod')}</span><strong>{sha?sha.slice(0,9):'—'}</strong><span>{environment?.standing?.line??t('workspace.notObserved')}</span></div>})}</div>
      <details className="workspace-sources"><summary>{t('workspace.connections')}</summary>{Object.entries(system?.sources??{}).map(([source,state])=><div key={source}><span>{source}</span><span>{state}</span></div>)}</details>
    </section><section className="project-panel"><header className="workspace-section-head"><h2>{t('workspace.now')}</h2><button className="ghost" onClick={board}>{t('workspace.openBoard')}</button></header><div className="project-activity">
      {[...active,...review].slice(0,4).map(card=><button key={card.key} onClick={()=>open(card.key)}><span className="activity-marker" data-running={card.running}/><span><strong>{card.title}</strong><small>{card.key} · {card.reservation?.actor??t(card.state)}</small></span></button>)}
      {!active.length&&!review.length?<p>{loading?t('ui.loading'):t('workspace.quiet')}</p>:null}
    </div></section></div>
    <section className="project-bottom-grid"><div className="project-panel"><header className="workspace-section-head"><h2>{t('workspace.activity')}</h2></header><div className="project-activity">{system?.people?.slice(0,5).map((event,i)=><button key={i} onClick={()=>open(event.card)}><span className="workspace-meta">{new Date(event.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span><span><strong>{event.card} · {event.verb}</strong><small>{event.actor}</small></span></button>)}{!system?.people?.length?<p>{t('workspace.notObserved')}</p>:null}</div></div>
      <div className="project-panel"><header className="workspace-section-head"><h2>{t('workspace.efficiency')}</h2><span className="workspace-meta">TypeSafe / Jev</span></header><p className="efficiency-verdict">{t('workspace.notProven')}</p>{report?<><div className="efficiency-values"><span><strong>{Object.values(report.tasks?.arms??{}).reduce((n,a)=>n+a.started,0)}</strong>{t('workspace.enrolled')}</span><span><strong>{report.tasks?.collectionGaps??0}</strong>{t('workspace.gaps')}</span><span><strong>{report.remainingProjectAttempts}</strong>{t('workspace.remaining')}</span></div><small>{t('workspace.efficiencyHelp')}</small></>:<p>{t('workspace.notObserved')}</p>}</div>
    </section>
    </Dialog>:null}
  </main>;
}
