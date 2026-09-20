/** Project-owned provider credentials are read only for an explicit trial request. */
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {parseEnv} from 'node:util';
export const PROVIDER_HEADER='X-Gradula-Typesafe-Key';
export function validProviderKey(value) {
  if(typeof value!=='string'||value.length<1||value.length>512||/[^\x21-\x7e]/.test(value))throw Error('Invalid TypeSafe key format.');
  return value;
}
export function projectProviderKey({cwd=process.cwd(),env=process.env}={}) {
  if(Object.hasOwn(env,'TYPESAFE_API_KEY'))return env.TYPESAFE_API_KEY?validProviderKey(env.TYPESAFE_API_KEY):null;
  let root=resolve(cwd),main=root;
  try {
    const git=(...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    root=git('rev-parse','--show-toplevel');main=dirname(git('rev-parse','--path-format=absolute','--git-common-dir'));
  } catch { /* Outside Git, read only this directory, never a parent project's .env. */ }
  for(const base of [...new Set([root,main])]){
    const file=join(base,'.env');if(!existsSync(file))continue;
    const values=parseEnv(readFileSync(file,'utf8'));
    if(Object.hasOwn(values,'TYPESAFE_API_KEY'))return values.TYPESAFE_API_KEY?validProviderKey(values.TYPESAFE_API_KEY):null;
  }
  return null;
}
export function providerHeaders(base,path,method,options) {
  if(path!=='/api/v1/decision-trials'||method!=='POST')return {};
  const key=projectProviderKey(options);if(!key)return {};
  const url=new URL(base);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Project provider keys require HTTPS, except loopback development.');
  return {[PROVIDER_HEADER]:key};
}
