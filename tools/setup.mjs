#!/usr/bin/env node
/** Explicit setup actions. Never print or commit credentials. */
import {randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseArgs,parseEnv} from 'node:util';
import {config,handOf} from '../src/hand.mjs';
const home=dirname(dirname(fileURLToPath(import.meta.url)));
export function projectKey(name) {
 const parts=String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/[A-Z]+/g) ?? [];
 const letters=parts.length>1?parts.map(p=>p[0]).join(''):parts.join('');
 return (letters+'PR').slice(0,Math.max(2,Math.min(8,letters.length)));
}
export function serviceOrigin(value) {
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol))throw Error('Use a bare http(s) origin without credentials, query or path.');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use HTTPS outside localhost.');
 return url.origin;
}
export function initializeInstance({file,origin}) {
 const publicOrigin=serviceOrigin(origin);
 const text=`# Private instance configuration; do not commit.\nPUBLIC_ORIGIN=${publicOrigin}\nGRADULA_HOST=${new URL(publicOrigin).host}\nGRADULA_DB_PASSWORD=${randomBytes(24).toString('hex')}\nGRADULA_ADMIN_TOKEN=${randomBytes(32).toString('hex')}\nGRADULA_SESSION_SECRET=${randomBytes(32).toString('hex')}\n# Register an OIDC client and grant users the gradula role.\nOIDC_ISSUER=\nOIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\nOIDC_SCOPE=openid profile email\nOIDC_ROLLEN_CLAIM=roles\nGRADULA_ROLE=gradula\n# Optional; no TypeSafe calls unless explicitly enabled per project.\nGRADULA_DECISION_PROJECTS=\n`;
 writeFileSync(file,text,{flag:'wx',mode:0o600});return {file,origin:publicOrigin};
}
export async function setup(args=process.argv.slice(2)) {
 const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,options:{url:{type:'string'},origin:{type:'string'},env:{type:'string'},file:{type:'string'},name:{type:'string'},key:{type:'string'},repo:{type:'string'},root:{type:'string'},role:{type:'string'},publish:{type:'boolean'},restore:{type:'boolean'},help:{type:'boolean'}}});
 if(v.help||!p.length){console.log(`Gradula setup (Node 22+)
  instance --origin https://board.example.org [--file .env.instance]
  project --url URL --name NAME --repo owner/repository [--key APP] [--role gradula:APP] --env .env.instance
  attach --url URL --key APP [--root /path/to/repository]
  scan [--root /path/to/repository] [--publish]
  github [--root /path/to/repository] --env /private/github.env
  archive --url URL --key OLD --env .env.instance [--restore]

Admin credentials are read from --env or GRADULA_ADMIN_TOKEN, never command arguments.
The github env file contains GITHUB_TOKEN. Tokens are never printed.
Scan previews first; --publish sends committed source metadata and Markdown to your own instance.
See docs/setup.md for identity-provider roles, domains and hosted refresh.`);return;}
 const command=p[0],root=resolve(v.root??process.cwd());
 if(command==='instance'){console.log(JSON.stringify(initializeInstance({file:resolve(v.file??'.env.instance'),origin:v.origin??'http://localhost:3200'})));return;}
 if(command==='attach'){
  const url=serviceOrigin(v.url??'');if(!/^[A-Z]{2,8}$/.test(v.key??''))throw Error('--key must contain 2–8 uppercase letters');
  // Login owns .gradula.env merging and its private permissions.
  execFileSync(process.execPath,[join(home,'bin/gradula.mjs'),'login','--project',v.key],{cwd:root,env:{...process.env,GRADULA_URL:url},stdio:'inherit'});return;
 }
 if(command==='scan'){
  const {scanRepository,publishGraph}=await import('./codegraph.mjs');
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const {graph,stats}=scanRepository(root,undefined,{revision});
  if(v.publish)await publishGraph(graph,{env:config(root)});
  console.log(JSON.stringify({repository:graph.repository,revision,nodes:graph.nodes.length,edges:graph.edges.length,documents:graph.documents?.length??0,coverage:graph.coverage,stats,published:!!v.publish}));return;
 }
 const supplied=v.env?parseEnv(readFileSync(resolve(v.env),'utf8')):{};
 const env={...config(root),...supplied};
 const url=serviceOrigin(v.url??env.GRADULA_URL??env.PUBLIC_ORIGIN??'');
 const request=async(path,{method='GET',body,token=env.GRADULA_ADMIN_TOKEN}={})=>{
  if(!token)throw Error('Required credential is missing; read docs/setup.md');
  const response=await fetch(url+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Setup request failed (${response.status}); no credentials were printed.`);
  return response.json();
 };
 if(command==='project'){
  if(!v.name||!v.repo||!/^[-\w.]+\/[-\w.]+$/.test(v.repo))throw Error('--name and --repo owner/repository are required');
  const key=v.key??projectKey(v.name);if(!/^[A-Z]{2,8}$/.test(key))throw Error('Use a project key of 2–8 uppercase letters');
  const projects=await request('/api/admin/projects');
  const existing=projects.find(p=>p.key===key);
  if(existing){if(existing.repo!==v.repo||existing.name!==v.name)throw Error(`${key} is already in use; choose --key explicitly`);console.log(`${key} already exists; no configuration changed.`);return;}
  if(projects.some(p=>p.aliases?.includes(key)))throw Error(`${key} is a historical key; choose another --key`);
  const project=await request('/api/admin/projects',{method:'POST',body:{key,name:v.name,repo:v.repo,accessRole:v.role??`gradula:${key}`}});
  console.log(JSON.stringify({key:project.key,name:project.name,accessRole:project.accessRole,next:`Grant both the instance role and ${project.accessRole} to project members in your identity provider, then run attach.`}));return;
 }
 if(command==='archive'){
  if(!/^[A-Z]{2,8}$/.test(v.key??''))throw Error('--key required');
  const project=await request(`/api/admin/projects/${v.key}`,{method:'PATCH',body:{archived:!v.restore}});
  console.log(JSON.stringify({key:project.key,archived:project.archived}));return;
 }
 if(command==='github'){
  const token=handOf(env).token,project=await request('/api/v1/project',{token});
  if(!env.GITHUB_TOKEN)throw Error('Set GITHUB_TOKEN in the private --env file');
  const result=await request('/api/v1/github',{method:'PUT',token,body:{repo:project.repo,token:env.GITHUB_TOKEN}});
  console.log(JSON.stringify({project:project.key,repo:project.repo,connected:!!result}));return;
 }
 throw Error('Unknown setup action; use --help');
}
if(process.argv[1]===fileURLToPath(import.meta.url))setup().catch(error=>{console.error(error.message);process.exitCode=1;});
