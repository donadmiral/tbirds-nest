import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ASSET,UUID,safePath,objectPath} from './config.mjs';
import {validatePlaylist} from './transcode.mjs';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range, If-Range, If-None-Match','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges, ETag','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const digest=v=>createHash('sha256').update(v).digest('hex');
function validAsset(a,lease){return a&&a.bucket==='adaptive-media'&&UUID.test(a.leaseId)&&(!lease||a.leaseId===lease)&&ASSET.test(a.name)&&safePath(a.path)&&a.path.endsWith(`/${a.leaseId}/${a.name}`)&&typeof a.version==='string'&&a.version.length<=128&&typeof a.etag==='string'&&/^[\x21\x23-\x7e]{1,256}$/.test(a.etag)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=536870912;}
function equal(a,b){if(typeof a!=='string'||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function abortable(work,signal){return new Promise((resolve,reject)=>{const stop=()=>reject(new Error('request_deadline'));if(signal.aborted){stop();return;}signal.addEventListener('abort',stop,{once:true});Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});}
function rangeBounds(value,total){if(!/^bytes=(?:\d+-\d*|-\d+)$/.test(value))return null;const [a,b]=value.slice(6).split('-');let start,end;if(a===''){const suffix=Number(b);if(!Number.isSafeInteger(suffix)||suffix<1)return null;start=Math.max(0,total-suffix);end=total-1;}else{start=Number(a);end=b?Math.min(Number(b),total-1):total-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=total)return null;}return{start,end};}
export function createGateway(api,{cache,secret,publicOrigin,now=Date.now,authorizationMs=30000,maxAuthorizations=32}={}){
 const origin=new URL(publicOrigin);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash||secret?.length<32)throw new Error('Invalid gateway configuration');
 const windowMs=Math.min(30000,Math.max(1000,authorizationMs));const flights=new Map();
 const mac=(token,bucket,path,lease,name,expires)=>createHmac('sha256',secret).update(JSON.stringify(['pc-hls-v2',digest(token),bucket,path,lease,name,expires])).digest('hex');
 async function cached(key,valid,ttl,load){
  if(flights.has(key))return flights.get(key);
  if(flights.size>=maxAuthorizations)throw new Error('authorization_busy');
  const work=(async()=>{const existing=await cache.get(key);if(valid(existing))return existing;const result=await load();if(result){try{await cache.set(key,result,ttl);}catch{/* A cache outage must fall back to current authorization, never stale rights. */}}return result;})();flights.set(key,work);
  void work.finally(()=>flights.delete(key)).catch(()=>{});return work;
 }
 async function authorize(token,bucket,path,signal){
  const key=`auth:${digest(token)}:${bucket}/${path}`;
  return cached(key,x=>x&&x.deadline>now()&&x.expiresAt>now()&&UUID.test(x.leaseId)&&typeof x.version==='string',30,async()=>{
   const started=now();const grant=await api.rpc('resolve_media_delivery',{p_token:token,p_bucket:bucket,p_path:path},signal);
   if(!grant||grant.bucket!==bucket||grant.path!==path||typeof grant.version!=='string')return null;
   const expiresAt=typeof grant.expiresAt==='number'?grant.expiresAt:Date.parse(grant.expiresAt);
   if(!Number.isFinite(expiresAt)||expiresAt<=now())return null;
   const root=await api.rpc('resolve_media_rendition_v2',{p_token:token,p_bucket:bucket,p_path:path,p_source_version:grant.version,p_name:'master.m3u8'},signal);
   if(!validAsset(root)||root.name!=='master.m3u8'||root.sourceVersion!==grant.version)return null;
   const value={version:grant.version,leaseId:root.leaseId,expiresAt,deadline:Math.min(started+windowMs,expiresAt)};
   if(value.deadline<=now())return null;
   try{await cache.set(`asset:${root.leaseId}:master.m3u8`,{...root,cacheUntil:now()+900000},900);}catch{}
   return value;
  });
 }
 return async request=>{
  const error=status=>new Response(null,{status,headers});if(request.method==='OPTIONS')return error(204);if(!['GET','HEAD'].includes(request.method))return error(405);
  const controller=new AbortController();const abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();let timer=setTimeout(abort,12000),streaming=false;
  try{
   const url=new URL(request.url),match=url.pathname.match(/^\/playback\/(post-media|story-media)\/(.+)$/);
   let source;try{source=match&&decodeURIComponent(match[2].replace(/\/master\.m3u8$/,''));}catch{return error(400);}
   const token=url.searchParams.get('token')||'',name=url.searchParams.get('asset')||'master.m3u8',lease=url.searchParams.get('rendition');
   if(!match||!safePath(source)||!/^[0-9a-f]{64}$/.test(token)||!ASSET.test(name)||(lease&&!UUID.test(lease)))return error(400);
   const bucket=match[1];
   if(name!=='master.m3u8'){
    const expires=Number(url.searchParams.get('expires'));if(!lease||!Number.isSafeInteger(expires)||expires<=now()||!equal(url.searchParams.get('sig'),mac(token,bucket,source,lease,name,expires)))return error(403);
   }
   const auth=await abortable(authorize(token,bucket,source,controller.signal),controller.signal);
   if(!auth||auth.deadline<=now()||auth.expiresAt<=now()||lease&&lease!==auth.leaseId)return error(403);
   const assetKey=`asset:${auth.leaseId}:${name}`;
   const asset=await abortable(cached(assetKey,a=>validAsset(a,auth.leaseId)&&a.cacheUntil>now()&&a.sourceVersion===auth.version,900,async()=>{
    const a=await api.rpc('resolve_media_rendition_v2',{p_token:token,p_bucket:bucket,p_path:source,p_source_version:auth.version,p_name:name,p_lease_id:auth.leaseId},controller.signal);
    return validAsset(a,auth.leaseId)&&a.sourceVersion===auth.version?{...a,cacheUntil:now()+900000}:null;
   }),controller.signal);
   if(!asset)return error(410);
   if(url.searchParams.get('format')==='json'&&name==='master.m3u8'){
    const playback=new URL(`/playback/${objectPath(bucket,source)}/master.m3u8`,origin);playback.searchParams.set('token',token);
    const body=JSON.stringify({ready:true,hlsUrl:playback.href,sourceVersion:auth.version,expiresAt:auth.expiresAt,revocationWindowSeconds:windowMs/1000});
    return new Response(request.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))}});
   }
   const representation=`"pc-hls-v2-${digest(asset.version+':'+asset.etag)}"`;
   if(request.headers.get('If-None-Match')===representation)return new Response(null,{status:304,headers:{...headers,ETag:representation}});
   if(name.endsWith('.m3u8')){
    validatePlaylist(asset.playlist,name);
    const content=asset.playlist.split('\n').map(line=>{
     if(!line||line.startsWith('#'))return line;const child=name==='master.m3u8'?line:`${name.split('/')[0]}/${line}`;
     const next=new URL(`/playback/${objectPath(bucket,source)}/master.m3u8`,origin);next.searchParams.set('token',token);next.searchParams.set('asset',child);next.searchParams.set('rendition',auth.leaseId);next.searchParams.set('expires',String(auth.expiresAt));next.searchParams.set('sig',mac(token,bucket,source,auth.leaseId,child,auth.expiresAt));return next.href;
    }).join('\n');
    return new Response(request.method==='HEAD'?null:content,{headers:{...headers,'Content-Type':'application/vnd.apple.mpegurl','Content-Length':String(Buffer.byteLength(content)),ETag:representation}});
   }
   let cacheToken=asset.cacheToken;
   if(!cacheToken||Date.parse(asset.cacheTokenExpiresAt)<=now()+30000||!Number.isFinite(Date.parse(asset.cacheTokenExpiresAt))){
    const saved=await api.cachedSigning(asset,{token,bucket,path:source,version:auth.version},controller.signal);
    if(typeof saved?.token!=='string'||!Number.isFinite(Date.parse(saved.expiresAt)))return error(410);cacheToken=saved.token;
    try{await cache.set(assetKey,{...asset,cacheToken,cacheTokenExpiresAt:saved.expiresAt,cacheUntil:now()+900000},900);}catch{}
   }
   const upstreamUrl=new URL(`${api.base}/storage/v1/object/sign/${objectPath('adaptive-media',asset.path)}`);upstreamUrl.searchParams.set('token',cacheToken);
   const range=request.headers.get('Range');const requested=range?rangeBounds(range,asset.bytes):null;if(range&&!requested)return error(416);
   const sendRange=range&&(!request.headers.get('If-Range')||request.headers.get('If-Range')===representation)?range:null;
   const response=await api.fetch(upstreamUrl,{method:request.method,headers:{'Accept-Encoding':'identity',...(sendRange?{Range:sendRange}:{})},signal:controller.signal,redirect:'error'});
   if(![200,206].includes(response.status)||response.headers.get('etag')?.replace(/^"|"$/g,'')!==asset.etag||!['identity',null].includes(response.headers.get('content-encoding'))){await response.body?.cancel();return error(response.status===416?416:503);}
   let size=asset.bytes;const contentRange=response.headers.get('Content-Range');
   if(response.status===206){const m=contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);if(!sendRange||!m||Number(m[3])!==asset.bytes||Number(m[1])!==requested.start||Number(m[2])!==requested.end){await response.body?.cancel();return error(503);}size=Number(m[2])-Number(m[1])+1;}
   const stated=response.headers.get('Content-Length');if(stated!==null&&Number(stated)!==size){await response.body?.cancel();return error(503);}
   const out={...headers,'Content-Type':asset.mime,ETag:representation,'Content-Length':String(size),'Accept-Ranges':'bytes',...(contentRange?{'Content-Range':contentRange}:{})};
   if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{status:response.status,headers:out});}
   if(!response.body)return error(503);const reader=response.body.getReader();let bytes=0,done=false;
   clearTimeout(timer);streaming=true;
   const close=()=>{if(done)return;done=true;clearTimeout(timer);controller.abort();void reader.cancel().catch(()=>{});request.signal?.removeEventListener('abort',abort);};
   const body=new ReadableStream({async pull(stream){
    // No deadline runs while the player deliberately exerts backpressure.
    timer=setTimeout(abort,15000);
    try{const next=await reader.read();clearTimeout(timer);if(next.done){if(bytes!==size)throw new Error('truncated_asset');stream.close();close();return;}bytes+=next.value.byteLength;if(bytes>size)throw new Error('excess_asset');stream.enqueue(next.value);if(bytes===size){stream.close();close();}}
    catch(error){stream.error(error);close();}
   },cancel(){close();}});
   return new Response(body,{status:response.status,headers:out});
  }catch{return error(request.signal?.aborted?499:503);}finally{if(!streaming){clearTimeout(timer);controller.abort();request.signal?.removeEventListener('abort',abort);}}
 };
}
