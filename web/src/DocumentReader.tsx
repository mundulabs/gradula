import {useEffect,useState,type ReactNode} from 'react';
import {publishedDocument} from './api';
import Dialog from './Dialog';
import {chosenLanguage,words} from './words';
const t=words(chosenLanguage());
/** React text rendering: documents cannot inject HTML, scripts or remote images. */
export default function DocumentReader({project,path:initialPath,paths,revision,close}:{project:string;path:string;paths:string[];revision?:string|null;close:()=>void}){
  const [path,setPath]=useState(initialPath);
  const [doc,setDoc]=useState<Awaited<ReturnType<typeof publishedDocument>>|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{let alive=true;setDoc(null);setError(null);publishedDocument(project,path,revision).then(d=>{if(alive)setDoc(d)}).catch(()=>{if(alive)setError(t('workspace.documentMissing'))});return()=>{alive=false};},[project,path,revision]);
  const inline=(text:string):ReactNode[]=>text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part,i)=>{
    if(part.startsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>;
    if(part.startsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
    const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if(link&&doc){try{
      const base=`https://github.com/${doc.repository}/blob/${doc.revision??'HEAD'}/`;
      const url=new URL(link[2],base+path);
      const relative=url.href.startsWith(base)?decodeURIComponent(url.pathname.slice(new URL(base).pathname.length)):null;
      if(relative&&!url.hash&&paths.includes(relative))return <a key={i} href={url.href} onClick={e=>{if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();setPath(relative);}}}>{link[1]}</a>;
      if(['http:','https:'].includes(url.protocol))return <a key={i} href={url.href} target="_blank" rel="noreferrer">{link[1]}</a>;
    }catch{/* Invalid links remain text. */}}
    return part;
  });
  const lines=(doc?.markdown??'').replace(/<!--[\s\S]*?-->/g,'').split('\n');
  const blocks:ReactNode[]=[];
  const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  for(let i=0;i<lines.length;i++){
    const line=lines[i],key=i;if(!line.trim())continue;
    if(/^```/.test(line)){const code=[];while(++i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i]);blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);continue;}
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){blocks.push(heading[1].length===1?<h2 key={key}>{inline(heading[2])}</h2>:<h3 key={key}>{inline(heading[2])}</h3>);continue;}
    if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]??'')){
      const head=cells(line),rows=[];i++;while(i+1<lines.length&&lines[i+1].includes('|'))rows.push(cells(lines[++i]));
      blocks.push(<div className="document-table" key={key}><table><thead><tr>{head.map((c,j)=><th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((row,j)=><tr key={j}>{row.map((c,k)=><td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const list=line.match(/^\s*(?:[-*+] |\d+\. )(.+)$/);
    if(list){const ordered=/^\s*\d+\./.test(line),items=[list[1]];while(i+1<lines.length){const next=lines[i+1].match(ordered?/^\s*\d+\. (.+)$/:/^\s*[-*+] (.+)$/);if(!next)break;i++;items.push(next[1]);}const content=items.map((item,j)=><li key={j}>{inline(item)}</li>);blocks.push(ordered?<ol key={key}>{content}</ol>:<ul key={key}>{content}</ul>);continue;}
    if(/^>\s?/.test(line)){blocks.push(<blockquote key={key}>{inline(line.replace(/^>\s?/,''))}</blockquote>);continue;}
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){blocks.push(<hr key={key}/>);continue;}
    blocks.push(<p key={key}>{inline(line)}</p>);
  }
  return <Dialog title={path} close={close} wide><article className="document-reader" aria-busy={!doc&&!error}>
    <div className="workspace-meta">{doc?.revision?doc.revision.slice(0,12):t('workspace.snapshot')}</div>
    {error?<p role="alert">{error}</p>:doc?blocks:<p role="status">{t('ui.loading')}</p>}
  </article></Dialog>;
}
