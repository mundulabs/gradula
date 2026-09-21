import type {CodeGraph} from './api';
export type GraphNode=CodeGraph['nodes'][number];
export const graphGroup=(node:GraphNode)=>node.kind==='card'?'work':/doc|guide/.test(node.kind)||node.path?.endsWith('.md')?'docs':/package|module|area|projection/.test(node.kind)?'structure':'code';
/** Bounded, stable graph projections. Search sees every node, not only drawn nodes. */
export function projectGraph(graph:CodeGraph,query:string,group:string,selected:string|null,limit=36){
  const degree=new Map<string,number>();const neighbours=new Set(selected?[selected]:[]);
  for(const e of graph.edges){degree.set(e.from,(degree.get(e.from)??0)+1);degree.set(e.to,(degree.get(e.to)??0)+1);if(e.from===selected)neighbours.add(e.to);if(e.to===selected)neighbours.add(e.from);}
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches=graph.nodes.filter(n=>(group==='all'||graphGroup(n)===group)&&terms.every(term=>`${n.name} ${n.path??''} ${n.about}`.toLowerCase().includes(term)));
  const candidates=(selected?graph.nodes.filter(n=>neighbours.has(n.id)):matches).slice().sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||(degree.get(b.id)??0)-(degree.get(a.id)??0)||a.id.localeCompare(b.id));
  // Round robin through categories keeps documents and cards visible beside hubs.
  const queues=['structure','code','docs','work'].map(kind=>candidates.filter(n=>graphGroup(n)===kind));
  const shown:GraphNode[]=[];
  if(selected){const focus=candidates.find(n=>n.id===selected);if(focus){shown.push(focus);for(const q of queues){const i=q.findIndex(n=>n.id===selected);if(i>=0)q.splice(i,1);}}}
  while(shown.length<limit&&queues.some(q=>q.length))for(const q of queues){if(q.length&&shown.length<limit)shown.push(q.shift()!);}
  const ids=new Set(shown.map(n=>n.id));
  return {matches,shown,total:candidates.length,edges:graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).slice(0,100),relations:selected?graph.edges.filter(e=>e.from===selected||e.to===selected):[]};
}

/** Static radial layout: no simulation, timers or layout dependency. */
export function radialGraph(nodes:GraphNode[],width:number,height:number,selected:string|null){
  const center={x:width/2,y:height/2};
  const reach=Math.min(145,width*.26);
  const radius=Math.max(30,Math.min(width,height)/2-reach-24);
  const ordered=['structure','code','docs','work'].flatMap(group=>nodes.filter(n=>graphGroup(n)===group&&n.id!==selected));
  const positions=new Map<string,{x:number;y:number;angle:number;center:boolean}>();
  ordered.forEach((node,index)=>{const angle=-Math.PI/2+2*Math.PI*(index+.5)/Math.max(1,ordered.length);positions.set(node.id,{x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle),angle,center:false});});
  if(selected&&nodes.some(n=>n.id===selected))positions.set(selected,{...center,angle:0,center:true});
  const rings=['structure','code','docs','work'].flatMap(group=>{
    const ids=ordered.filter(n=>graphGroup(n)===group);if(!ids.length)return [];
    const first=positions.get(ids[0].id)!,last=positions.get(ids.at(-1)!.id)!;
    const gap=Math.min(.08,Math.PI/Math.max(1,ordered.length)*.6),start=first.angle-Math.PI/Math.max(1,ordered.length)+gap,end=last.angle+Math.PI/Math.max(1,ordered.length)-gap,r=radius+12;
    return [{group,path:`M ${center.x+r*Math.cos(start)} ${center.y+r*Math.sin(start)} A ${r} ${r} 0 ${end-start>Math.PI?1:0} 1 ${center.x+r*Math.cos(end)} ${center.y+r*Math.sin(end)}`}];
  });
  return {center,radius,positions,rings};
}
