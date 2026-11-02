// This endpoint accepts only media-specific operations. It never accepts SQL,
// an RPC name, an arbitrary fetch URL, or an arbitrary Storage object path.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const ASSET=/^(master\.m3u8|fallback\.mp4|r[0-3]\/(index\.m3u8|seg[0-9]{5}\.ts))$/;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const exact=(a,keys)=>plain(a)&&Object.keys(a).every(k=>keys.includes(k));
const path=v=>typeof v==='string'&&v.length<=1024&&!/[%\\\u0000-\u001f]/.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..');
const proof=a=>UUID.test(a.p_job_id)&&UUID.test(a.p_lease_id)&&integer(a.p_attempt,1,100);
const proofKeys=['p_job_id','p_lease_id','p_attempt'];
const ticket=a=>HASH.test(a.p_token)&&['post-media','story-media'].includes(a.p_bucket)&&path(a.p_path);
const ticketKeys=['p_token','p_bucket','p_path'];
const rendition=a=>ticket(a)&&typeof a.p_source_version==='string'&&a.p_source_version.length>0&&a.p_source_version.length<=128&&ASSET.test(a.p_name||'master.m3u8')&&(!a.p_lease_id||UUID.test(a.p_lease_id));
const renditionKeys=[...ticketKeys,'p_source_version','p_name','p_lease_id'];
const manifest=a=>Array.isArray(a)&&a.length>=4&&a.length<=2048&&a.every(x=>exact(x,['name','bytes','sha256','mime','playlist'])&&ASSET.test(x.name)&&integer(x.bytes,1,536870912)&&HASH.test(x.sha256)&&['video/mp4','video/mp2t','application/vnd.apple.mpegurl'].includes(x.mime)&&(!x.playlist||typeof x.playlist==='string'&&x.playlist.length<=65536));
const definitions={
 claim:{role:'worker',rpc:'claim_media_rendition_v2',keys:['p_worker_max_bytes'],valid:a=>integer(a.p_worker_max_bytes,1,536870912)},
 check:{role:'worker',rpc:'check_media_rendition_v2',keys:proofKeys,valid:proof},
 register:{role:'worker',rpc:'register_media_rendition_assets_v2',keys:[...proofKeys,'p_assets'],valid:a=>proof(a)&&manifest(a.p_assets)},
 finish:{role:'worker',rpc:'finish_media_rendition_v2',keys:[...proofKeys,'p_outcome','p_media','p_error_code','p_retry_after_seconds'],valid:a=>proof(a)&&['ready','retry','failed'].includes(a.p_outcome)&&(!a.p_error_code||/^[a-z0-9_]{1,80}$/.test(a.p_error_code))&&(a.p_retry_after_seconds==null||integer(a.p_retry_after_seconds,0,86400))&&(a.p_outcome!=='ready'||exact(a.p_media,['width','height','duration'])&&integer(a.p_media.width,2,1920)&&integer(a.p_media.height,2,1920)&&Number.isFinite(a.p_media.duration)&&a.p_media.duration>=.05&&a.p_media.duration<=600)},
 reconcile:{role:'worker',rpc:'reconcile_media_renditions_v2',keys:['p_limit'],valid:a=>integer(a.p_limit,1,100)},
 claim_cleanup:{role:'worker',rpc:'claim_media_rendition_cleanup_v2',keys:['p_limit'],valid:a=>integer(a.p_limit,1,2)},
 finish_cleanup:{role:'worker',rpc:'finish_media_rendition_cleanup_v2',keys:['p_lease_id','p_cleanup_lease'],valid:a=>UUID.test(a.p_lease_id)&&UUID.test(a.p_cleanup_lease)},
 prune:{role:'worker',rpc:'prune_media_renditions_v2',keys:['p_limit'],valid:a=>integer(a.p_limit,1,10)},
 status:{role:'worker',rpc:'media_rendition_health_v2',keys:[],valid:()=>true},
 ticket:{role:'gateway',rpc:'resolve_media_delivery',keys:ticketKeys,valid:ticket},
 rendition:{role:'gateway',rpc:'resolve_media_rendition_v2',keys:renditionKeys,valid:rendition},
 source:{role:'worker',keys:proofKeys,valid:proof},
 upload:{role:'worker',keys:[...proofKeys,'p_name'],valid:a=>proof(a)&&ASSET.test(a.p_name)},
 cleanup:{role:'worker',keys:['p_lease_id','p_cleanup_lease','p_names'],valid:a=>UUID.test(a.p_lease_id)&&UUID.test(a.p_cleanup_lease)&&Array.isArray(a.p_names)&&a.p_names.length>=1&&a.p_names.length<=100&&a.p_names.every(n=>ASSET.test(n))},
 sign:{role:'gateway',keys:renditionKeys,valid:rendition},
};
async function readJSON(request,signal){
 if(Number(request.headers.get('content-length')||0)>1048576)throw new Error('body_budget');
 const reader=request.body?.getReader();if(!reader)throw new Error('missing_body');
 const chunks=[];let size=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)throw new Error('request_deadline');const next=await reader.read();if(signal.aborted)throw new Error('request_deadline');if(next.done)break;size+=next.value.length;if(size>1048576)throw new Error('body_budget');chunks.push(next.value);}}
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function createMediaBroker({rpc,storage,base,now=Date.now}){
 const origin=new URL(base).origin;
 const signedURL=(value,kind,bucket,object)=>{const url=new URL(value);if(url.origin!==origin||url.pathname!==`/storage/v1/object/${kind}/${bucket}/${object.split('/').map(encodeURIComponent).join('/')}`||!url.searchParams.get('token'))throw new Error('invalid_storage_response');return url.href;};
 return async request=>{
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  const authorization=request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  const requestId=request.headers.get('X-Media-Request-ID'),issued=request.headers.get('X-Media-Issued-At');
  if(!authorization||!UUID.test(authorization[1])||!UUID.test(requestId)||!Number.isFinite(Date.parse(issued))||Math.abs(now()-Date.parse(issued))>60000)return reply(401,{error:'unauthorized'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  try{
   const body=await readJSON(request,controller.signal),operation=definitions[body?.action],args=body?.args;
   if(!operation)return reply(404,{error:'unknown_operation'});
   if(!exact(body,['action','args'])||!exact(args,operation.keys)||!operation.valid(args))return reply(400,{error:'invalid_arguments'});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(authorization[2]))),x=>x.toString(16).padStart(2,'0')).join('');
   const role=await rpc('authorize_media_broker_v2',{p_key_id:authorization[1],p_token_hash:hash,p_request_id:requestId,p_issued_at:issued},controller.signal);
   if(role==='rate_limited')return reply(429,{error:'rate_limited'});
   if(role!==operation.role)return reply(403,{error:'forbidden'});
   if(operation.rpc)return reply(200,{data:await rpc(operation.rpc,args,controller.signal)});
   if(body.action==='source'||body.action==='upload'){
    const descriptor=await rpc('media_rendition_transfer_v2',args,controller.signal);
    if(!descriptor)return reply(409,{error:'lease_unavailable'});
    if(body.action==='source'){
     const url=await storage.downloadURL(descriptor.bucket,descriptor.path,300,controller.signal);
     return reply(200,{data:{...descriptor,url:signedURL(url,'sign',descriptor.bucket,descriptor.path)}});
    }
    const url=await storage.uploadURL(descriptor.bucket,descriptor.path,controller.signal);
    return reply(200,{data:{...descriptor,url:signedURL(url,'upload/sign',descriptor.bucket,descriptor.path)}});
   }
   if(body.action==='cleanup'){
    const descriptor=await rpc('media_rendition_cleanup_transfer_v2',args,controller.signal);
    if(!descriptor)return reply(409,{error:'cleanup_lease_unavailable'});
    if(descriptor.bucket!=='adaptive-media'||!Array.isArray(descriptor.prefixes)||descriptor.prefixes.length>100)throw new Error('invalid_cleanup');
    await storage.remove(descriptor.bucket,descriptor.prefixes,controller.signal);return reply(200,{data:true});
   }
   const grant=await rpc('resolve_media_delivery',{p_token:args.p_token,p_bucket:args.p_bucket,p_path:args.p_path},controller.signal);
   if(!grant||grant.bucket!==args.p_bucket||grant.path!==args.p_path||grant.version!==args.p_source_version)return reply(403,{error:'forbidden'});
   const asset=await rpc('resolve_media_rendition_v2',args,controller.signal);
   if(!asset||asset.bucket!=='adaptive-media'||!path(asset.path)||asset.sourceVersion!==grant.version||!UUID.test(asset.leaseId))return reply(410,{error:'rendition_unavailable'});
   const url=signedURL(await storage.downloadURL(asset.bucket,asset.path,3600,controller.signal),'sign',asset.bucket,asset.path);
   const saved=await rpc('store_media_rendition_cache_v2',{p_lease_id:asset.leaseId,p_name:asset.name,p_version:asset.version,p_token:new URL(url).searchParams.get('token')},controller.signal);
   return reply(200,{data:saved});
  }catch{return reply(503,{error:'temporarily_unavailable'});}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);controller.abort();}
 };
}
