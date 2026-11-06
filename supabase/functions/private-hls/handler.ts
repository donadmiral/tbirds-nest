type Client = { auth: { getUser(): PromiseLike<{data:{user:unknown},error:unknown}> }; rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:any,error:unknown}> };
type Dependencies={env(name:string):string|undefined;client(base:string,key:string,authorization:string):Client;fetch:typeof fetch;now?:()=>number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION=/^[a-zA-Z0-9_-]{1,128}$/;
const ASSET=/^(master\.m3u8|r[0-3]\/(index\.m3u8|seg[0-9]{5}\.ts))$/;
const common={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,POST,OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Vary':'Authorization','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function validAsset(a:any,input:any,now:number){return a&&a.bucket==='adaptive-media'&&typeof a.leaseId==='string'&&UUID.test(a.leaseId)&&typeof a.sourceVersion==='string'&&VERSION.test(a.sourceVersion)&&typeof a.version==='string'&&VERSION.test(a.version)&&typeof a.name==='string'&&ASSET.test(a.name)
 &&(!input.leaseId||a.leaseId===input.leaseId)&&(!input.sourceVersion||a.sourceVersion===input.sourceVersion)&&(!input.asset||a.name===input.asset)
 &&typeof a.path==='string'&&new RegExp(`^[0-9a-f-]{36}/_renditions_v2/[0-9a-f-]{36}/${a.leaseId}/${a.name.replace(/[.]/g,'\\.')}$`,'i').test(a.path)
 &&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=16777216&&typeof a.etag==='string'&&/^[\x21\x23-\x7e]{1,256}$/.test(a.etag)
 &&typeof a.sha256==='string'&&/^[0-9a-f]{64}$/.test(a.sha256)&&Number.isFinite(Date.parse(a.expiresAt))&&Date.parse(a.expiresAt)>now;}
function rewritePlaylist(text:string,name:string,urlFor:(name:string)=>string){
 if(typeof text!=='string'||!text.startsWith('#EXTM3U\n')||text.length>65536||/[\u0000\r]/.test(text))throw new Error('invalid_playlist');
 let refs=0;
 const result=text.split('\n').map(line=>{if(!line)return line;if(line.startsWith('#')){
  if(!/^#(?:EXTM3U$|EXT-X-(?:VERSION:\d+|INDEPENDENT-SEGMENTS|STREAM-INF:BANDWIDTH=\d+,RESOLUTION=\d+x\d+,FRAME-RATE=[0-9.]+|TARGETDURATION:\d+|MEDIA-SEQUENCE:\d+|PLAYLIST-TYPE:VOD|ENDLIST)$|EXTINF:[0-9.]+,$)/.test(line))throw new Error('unsupported_playlist_tag');return line;}
  const child=name==='master.m3u8'?line:`${name.split('/')[0]}/${line}`;
  if(!(name==='master.m3u8'?/^r[0-3]\/index\.m3u8$/:/^r[0-3]\/seg[0-9]{5}\.ts$/).test(child))throw new Error('invalid_playlist_path');
  refs++;return urlFor(child);
 }).join('\n');
 if(!refs||(name!=='master.m3u8'&&!text.includes('#EXT-X-ENDLIST')))throw new Error('incomplete_playlist');return result;
}
function bounded<T>(work:PromiseLike<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const cancel=()=>reject(new Error('request_deadline'));if(signal.aborted){cancel();return;}signal.addEventListener('abort',cancel,{once:true});
 Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
});}
async function inputBody(req:Request,signal:AbortSignal){
 const reader=req.body?.getReader();if(!reader)throw new Error('missing_body');const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const next=await bounded(reader.read(),signal);if(next.done)break;length+=next.value.length;if(length>2048)throw new Error('body_budget');chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(length);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return JSON.parse(new TextDecoder().decode(result));
}
export function createPrivateHLS(deps:Dependencies){return async(req:Request)=>{
 const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...common,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:common});
 if(!['GET','HEAD','POST'].includes(req.method))return json(405,{error:'method_not_allowed'});
 const controller=new AbortController(),abort=()=>controller.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort();
 const timer=setTimeout(abort,15000);let upstream:Response|undefined;
 const now=deps.now??Date.now;
 try{
  const base=deps.env('SUPABASE_URL'),anon=deps.env('SUPABASE_ANON_KEY'),service=deps.env('SUPABASE_SERVICE_ROLE_KEY'),authorization=req.headers.get('Authorization')||'';
  if(!base||!anon||!service)return json(503,{error:'unavailable'});
  if(!/^Bearer \S+$/.test(authorization))return json(401,{error:'sign_in_required'});
  const endpoint=new URL('/functions/v1/private-hls',base);
  const client=deps.client(base,anon,authorization),auth=await bounded(client.auth.getUser(),controller.signal);if(auth.error||!auth.data?.user)return json(401,{error:'sign_in_required'});
  let input:any;
  if(req.method==='POST'){
   if(Number(req.headers.get('Content-Length')||0)>2048)return json(400,{error:'invalid_request'});
   input=await inputBody(req,controller.signal);
  }else{const params=new URL(req.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length!==1))return json(400,{error:'invalid_request'});input=Object.fromEntries(params);}
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!(req.method==='POST'?['messageId','requestId','action']:['messageId','requestId','sourceVersion','leaseId','asset']).includes(k))||typeof input.messageId!=='string'||!UUID.test(input.messageId)||typeof input.requestId!=='string'||!UUID.test(input.requestId)||(req.method==='POST'&&typeof input.action!=='string'))return json(400,{error:'invalid_request'});
  const args={p_message_id:input.messageId,p_request_id:input.requestId};
  if(req.method==='POST'&&input.action==='close'){
   const r=await bounded(client.rpc('close_chat_hls_v1',args),controller.signal);return r.error?json(503,{error:'unavailable'}):json(200,{closed:r.data===true});
  }
  if(req.method==='POST'&&input.action!=='open')return json(400,{error:'invalid_action'});
  if(req.method!=='POST'&&(!UUID.test(input.leaseId)||!VERSION.test(input.sourceVersion)||!ASSET.test(input.asset)||req.headers.has('Range')))return json(400,{error:'invalid_request'});
  const readArgs={...args,p_source_version:input.sourceVersion,p_lease_id:input.leaseId,p_name:input.asset};
  const r=await bounded(client.rpc(req.method==='POST'?'open_chat_hls_v1':'read_chat_hls_v1',req.method==='POST'?args:readArgs),controller.signal);
  if(r.error)return json(503,{error:'unavailable'});
  if(!r.data)return req.method==='POST'?json(200,{ready:false}):json(410,{error:'viewing_ended'});
  const a=r.data;if(!validAsset(a,input,now())||controller.signal.aborted)return json(410,{error:'viewing_ended'});
  const urlFor=(name:string)=>{const u=new URL(endpoint);for(const [k,v] of Object.entries({messageId:input.messageId,requestId:input.requestId,sourceVersion:a.sourceVersion,leaseId:a.leaseId,asset:name}))u.searchParams.set(k,v as string);return u.href;};
  if(req.method==='POST')return json(200,{ready:true,requestId:input.requestId,hlsUrl:urlFor('master.m3u8'),sourceVersion:a.sourceVersion,expiresAt:a.expiresAt});
  const recheck=async()=>{const check=await bounded(client.rpc('read_chat_hls_v1',readArgs),controller.signal);return !check.error&&validAsset(check.data,input,now())&&check.data.version===a.version&&check.data.path===a.path&&check.data.etag===a.etag&&check.data.sha256===a.sha256&&!controller.signal.aborted;};
  if(a.name.endsWith('.m3u8')){
   if(a.mime!=='application/vnd.apple.mpegurl')return json(415,{error:'unsupported_media'});
   const content=rewritePlaylist(a.playlist,a.name,urlFor);if(!await recheck())return json(410,{error:'viewing_ended'});
   return new Response(req.method==='HEAD'?null:content,{headers:{...common,'Content-Type':a.mime,'Content-Length':String(new TextEncoder().encode(content).length)}});
  }
  if(a.mime!=='video/mp2t')return json(415,{error:'unsupported_media'});
  const url=new URL(`/storage/v1/object/authenticated/adaptive-media/${a.path.split('/').map(encodeURIComponent).join('/')}`,base);
  url.searchParams.set('cacheNonce',`${a.version}-${crypto.randomUUID()}`);
  upstream=await deps.fetch(url,{method:req.method,headers:{Authorization:`Bearer ${service}`,apikey:service,'Cache-Control':'no-store','Accept-Encoding':'identity'},cache:'no-store',redirect:'error',signal:controller.signal});
  if(upstream.status!==200||upstream.headers.get('etag')?.replace(/^"|"$/g,'')!==a.etag||!['identity',null].includes(upstream.headers.get('content-encoding'))||(upstream.headers.get('Content-Length')!==null&&Number(upstream.headers.get('Content-Length'))!==a.bytes))return json(503,{error:'attachment_unavailable'});
  if(req.method==='HEAD'){if(!await recheck())return json(410,{error:'viewing_ended'});return new Response(null,{headers:{...common,'Content-Type':a.mime,'Content-Length':String(a.bytes)}});}
  if(!upstream.body)return json(503,{error:'attachment_unavailable'});
  const reader=upstream.body.getReader(),chunks:Uint8Array[]=[];let count=0;
  try{while(true){const next=await bounded(reader.read(),controller.signal);if(next.done)break;count+=next.value.length;if(count>a.bytes||controller.signal.aborted)throw new Error('invalid_segment');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
  if(count!==a.bytes)return json(503,{error:'attachment_unavailable'});
  const bytes=new Uint8Array(count);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==a.sha256)return json(503,{error:'attachment_unavailable'});
  // Recheck after the complete bounded segment was fetched and verified. A
  // close during Storage IO releases no bytes. Authorization is never cached.
  if(!await recheck())return json(410,{error:'viewing_ended'});
  return new Response(bytes,{headers:{...common,'Content-Type':a.mime,'Content-Length':String(count)}});
 }catch{return json(controller.signal.aborted?499:503,{error:'unavailable'});}
 finally{clearTimeout(timer);req.signal.removeEventListener('abort',abort);controller.abort();try{await upstream?.body?.cancel();}catch{}}
};}
