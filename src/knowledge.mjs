/** Live board evidence joined to retrieved source, without rewriting the chronicle. */
const clip=(text,max=160)=>String(text ?? '').replace(/\s+/g,' ').slice(0,max);
export const pathsOverlap=(a,b)=>a && b && (a===b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`));
export function attachKnowledge(result,cards,histories,{maxBytes,scanned,capped,links=[]}) {
  result.work={nodes:[],edges:[],coverage:{cardsScanned:scanned,cardScanCapped:capped,eventsPerCard:12,omittedCards:cards.length,evidenceMayBeOmitted:true}};
  result.budget.maxBytes=maxBytes;
  const fits=()=>{result.budget.bytes=maxBytes;return Buffer.byteLength(JSON.stringify(result))+1<=maxBytes;};
  for(const card of cards) {
    const id=`work:card:${card.key}`;
    const node={id,kind:card.kind==='decision'?'decision':'card',key:card.key,title:clip(card.title),state:card.state,gate:card.gate?{kind:card.gate.kind,call:clip(card.gate.call)}:null};
    const paths=new Set();
    const edges=result.nodes.filter(n=>{if(paths.has(n.path))return false;paths.add(n.path);return(card.files ?? []).some(path=>pathsOverlap(path,n.path));}).slice(0,2).map(n=>({from:id,to:n.id,kind:'touches',source:{card:card.key},claim:'Declared scope'}));
    result.work.nodes.push(node);result.work.edges.push(...edges);
    if (!fits()) {result.work.nodes.pop();result.work.edges.splice(result.work.edges.length-edges.length,edges.length);continue;}
    result.work.coverage.omittedCards--;
    const seen=new Set();let count=0;
    for(const event of [...(histories.get(card.key) ?? [])].reverse()) {
      if (!['evidenced','decided','deployed'].includes(event.verb)) continue;
      const signature=JSON.stringify([event.verb,event.data]);if(seen.has(signature))continue;seen.add(signature);
      if(count++>=3)break;
      const data=event.data ?? {}, eid=`work:event:${event.id}`;
      const evidence={id:eid,kind:event.verb,eventId:event.id,actor:clip(event.actor,80),at:event.at,
        ref:clip(data.ref ?? data.sha ?? data.result,160),claim:clip(data.comment ?? data.reason ?? data.environment,200),evidenceKind:data.kind ?? null};
      result.work.nodes.push(evidence);result.work.edges.push({from:id,to:eid,kind:event.verb,source:{card:card.key,event:event.id}});
      if (!fits()) {result.work.nodes.pop();result.work.edges.pop();break;}
    }
  }
  const byId=new Map(cards.map(c=>[c.id,`work:card:${c.key}`])), included=new Set(result.work.nodes.map(n=>n.id));
  for(const link of links) {
    const from=byId.get(link.from),to=byId.get(link.to);
    if(!included.has(from)||!included.has(to))continue;
    result.work.edges.push({from,to,kind:link.kind,source:{link:link.id},claim:clip(link.reason)});
    if(!fits())result.work.edges.pop();
  }
  for(let i=0;i<3;i++)result.budget.bytes=Buffer.byteLength(JSON.stringify(result))+1;
  return result;
}
