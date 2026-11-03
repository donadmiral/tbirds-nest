import {createMediaContentHandler} from '../media-content/handler.ts';
import {digest,isUuid,record} from '../live-integrations-core/security.ts';
type Grant={bucket:string;path:string;version:string;expiresAt:string;bytes:number};
type Dependencies={base:string;serviceKey:string;fetch:typeof fetch;resolve(id:string,tokenHash:string,consume:boolean,signal:AbortSignal):Promise<unknown>};
const maximumBytes=128*1024*1024;
const denied=(status:number)=>new Response(JSON.stringify({error:'MEDIA_UNAVAILABLE'}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
function grant(value:unknown):Grant|null{
 if(!record(value)||value.bucket!=='live-clips'||typeof value.path!=='string'||typeof value.version!=='string'||!value.version||typeof value.expiresAt!=='string'||Date.parse(value.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(value.expiresAt))||typeof value.bytes!=='number'||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>maximumBytes)return null;
 const parts=value.path.split('/');if(parts.length!==5||!parts.slice(0,4).every(isUuid)||parts[4]!=='vertical.mp4')return null;
 return value as Grant;
}
export function createSocialPullHandler(deps:Dependencies){return async(request:Request)=>{
 if(!['GET','HEAD'].includes(request.method))return denied(405);
 try{
  const input=new URL(request.url),match=input.pathname.match(/^\/(?:functions\/v1\/)?live-social-pull\/([a-f0-9-]{36})\/clip\.mp4$/),token=input.searchParams.get('token')||'';
  if(!match||!isUuid(match[1])||!/^[a-f0-9]{64}$/.test(token)||[...input.searchParams.keys()].some(key=>key!=='token')||input.searchParams.getAll('token').length!==1)return denied(403);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(110000)]),tokenHash=await digest(token),first=grant(await deps.resolve(match[1],tokenHash,true,AbortSignal.any([signal,AbortSignal.timeout(8000)])));
  if(!first)return denied(403);
  const url=new URL(`/functions/v1/media-content/live-clips/${first.path}`,deps.base);url.searchParams.set('token',token);
  let initial=true;
  const stream=createMediaContentHandler({base:deps.base,serviceKey:deps.serviceKey,startupTimeoutMs:12000,streamIdleTimeoutMs:15000,
   resolve:async(supplied,bucket,path,localSignal)=>{
    if(supplied!==token||bucket!==first.bucket||path!==first.path)return null;
    if(initial){initial=false;return first;}
    const current=grant(await deps.resolve(match[1],tokenHash,false,localSignal));return current&&current.path===first.path&&current.version===first.version?current:null;
   },
   fetch:async(url,options)=>{
    const response=await deps.fetch(url,options),length=response.headers.get('Content-Length');
    if(response.ok&&(!length||!/^\d{1,10}$/.test(length)||Number(length)>maximumBytes||response.headers.get('Content-Type')?.split(';')[0].trim()!=='video/mp4')){void response.body?.cancel().catch(()=>{});throw Error('INVALID_MEDIA');}
    return response;
   },
  });
  const headers=new Headers();for(const key of ['Range','If-Range']){const value=request.headers.get(key);if(value)headers.set(key,value);}
  const response=await stream(new Request(url,{method:request.method,headers,signal}));
  response.headers.set('Vercel-CDN-Cache-Control','no-store');response.headers.set('x-vercel-enable-rewrite-caching','0');return response;
 }catch{return denied(request.signal.aborted?499:503);}
};}
