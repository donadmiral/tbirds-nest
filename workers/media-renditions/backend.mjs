import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {objectPath} from './config.mjs';
import {randomUUID} from 'node:crypto';
export class ProviderError extends Error {
  constructor(code,status,retryAfter=0){super(code);this.status=status;this.retryAfter=retryAfter;this.permanent=status===400 || status===415;}
}
export function retrySeconds(value){const n=Number(value);return Math.min(86400,Math.max(0,Number.isFinite(n)?n:Math.ceil((Date.parse(value)-Date.now())/1000)||0));}
export function backend({base,key,brokerUrl,brokerKey,fetchImpl=fetch}) {
 if(brokerUrl||brokerKey)return scopedBackend({base,brokerUrl,brokerKey,fetchImpl});
 const headers={apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`})};
 const checked=async response=>{if(!response.ok){await response.body?.cancel();throw new ProviderError(response.status===429||response.status===503?'upstream_throttled':'provider_error',response.status,retrySeconds(response.headers.get('Retry-After')));}return response;};
 return {
  async rpc(name,args={},signal){const r=await checked(await fetchImpl(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(args),signal,redirect:'error'}));return r.json();},
  async download(job,destination,signal){
   const url=new URL(`${base}/storage/v1/object/authenticated/${objectPath(job.source_bucket,job.source_path)}`);url.searchParams.set('cacheNonce',job.source_version+'-'+job.lease_id);
   const r=await checked(await fetchImpl(url,{headers:{...headers,'Accept-Encoding':'identity','Cache-Control':'no-store'},signal,redirect:'error',cache:'no-store'}));
   const etag=r.headers.get('etag')?.replace(/^"|"$/g,'');const size=r.headers.get('content-length');
   if(etag!==job.source_etag || (size!==null&&Number(size)!==job.source_bytes) || !['identity',null].includes(r.headers.get('content-encoding')) || !r.body){await r.body?.cancel();throw new ProviderError('source_changed',409);}
   let bytes=0;const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>job.source_bytes)done(new Error('source_excess'));else done(null,chunk);}});
   await pipeline(Readable.fromWeb(r.body),limit,createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
   if(bytes!==job.source_bytes)throw new Error('source_truncated');
  },
  async upload(job,asset,file,signal){
   const metadata=Buffer.from(JSON.stringify({processing_job_id:job.job_id,processing_lease_id:job.lease_id,source_id:job.source_id,source_version:job.source_version,sha256:asset.sha256})).toString('base64');
   const r=await checked(await fetchImpl(`${base}/storage/v1/object/${objectPath('adaptive-media',job.output_prefix+asset.name)}`,{method:'POST',headers:{...headers,'Content-Type':asset.mime,'Content-Length':String(asset.bytes),'cache-control':'max-age=31536000','x-upsert':'false','x-metadata':metadata},body:Readable.toWeb(createReadStream(file)),duplex:'half',signal,redirect:'error'}));await r.body?.cancel();
  },
  async remove(prefix,names,signal){
   for(let i=0;i<names.length;i+=100){const r=await checked(await fetchImpl(`${base}/storage/v1/object/adaptive-media`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:names.slice(i,i+100).map(n=>prefix+n)}),signal,redirect:'error'}));await r.body?.cancel();}
  },
  async sign(path,signal){const r=await checked(await fetchImpl(`${base}/storage/v1/object/sign/${objectPath('adaptive-media',path)}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600}),signal,redirect:'error'}));const body=await r.json();const u=new URL(body.signedURL||body.signedUrl,base+'/storage/v1');const token=u.searchParams.get('token');if(!token)throw new Error('invalid_storage_capability');return token;},
  async cachedSigning(asset,context,signal){const token=await this.sign(asset.path,signal);return this.rpc('store_media_rendition_cache_v2',{p_lease_id:asset.leaseId,p_name:asset.name,p_version:asset.version,p_token:token},signal);},
  fetch:fetchImpl,base,
 };
}

const operation={claim_media_rendition_v2:'claim',check_media_rendition_v2:'check',register_media_rendition_assets_v2:'register',finish_media_rendition_v2:'finish',reconcile_media_renditions_v2:'reconcile',claim_media_rendition_cleanup_v2:'claim_cleanup',finish_media_rendition_cleanup_v2:'finish_cleanup',prune_media_renditions_v2:'prune',media_rendition_health_v2:'status',resolve_media_delivery:'ticket',resolve_media_rendition_v2:'rendition',reserve_media_sandbox_v1:'sandbox_reserve',attach_media_sandbox_v1:'sandbox_attach',pending_media_sandboxes_v1:'sandbox_pending',finish_media_sandbox_v1:'sandbox_finish',media_sandbox_status_v1:'sandbox_status'};
const jobProof=j=>({p_job_id:j.job_id,p_lease_id:j.lease_id,p_attempt:j.attempt});
function scopedBackend({base,brokerUrl,brokerKey,fetchImpl}){
 const origin=new URL(base).origin,endpoint=new URL(brokerUrl);
 if(endpoint.origin!==origin||endpoint.pathname!=='/functions/v1/media-broker'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||!/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i.test(brokerKey||''))throw new Error('invalid_broker_configuration');
 const checked=async r=>{if(!r.ok){await r.body?.cancel();throw new ProviderError(r.status===429||r.status===503?'upstream_throttled':'provider_error',r.status,retrySeconds(r.headers.get('Retry-After')));}return r;};
 async function call(action,args,signal){
  const r=await checked(await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${brokerKey}`,'Content-Type':'application/json','X-Media-Request-ID':randomUUID(),'X-Media-Issued-At':new Date().toISOString()},body:JSON.stringify({action,args}),signal,redirect:'error'}));
  if(Number(r.headers.get('content-length')||0)>1048576){await r.body?.cancel();throw new Error('broker_response_budget');}
  const reader=r.body?.getReader();if(!reader)throw new Error('broker_response_missing');const chunks=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1048576)throw new Error('broker_response_budget');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks,size).toString()).data;
 }
 const storageURL=(value,kind,bucket,path)=>{const u=new URL(value);if(u.origin!==origin||u.pathname!==`/storage/v1/object/${kind}/${objectPath(bucket,path)}`||!u.searchParams.get('token'))throw new Error('invalid_transfer_url');return u;};
 return {
  base:origin,fetch:fetchImpl,
  claimPoster:signal=>call('poster_claim',{},signal),
  finishPoster:(args,signal)=>call('poster_finish',args,signal),
  async rpc(name,args={},signal){if(!operation[name])throw new Error('unsupported_media_operation');return call(operation[name],args,signal);},
  async download(job,destination,signal){
   const d=await call('source',jobProof(job),signal);
   if(!d||d.bucket!==job.source_bucket||d.path!==job.source_path||d.version!==job.source_version||d.etag!==job.source_etag||d.bytes!==job.source_bytes)throw new Error('source_changed');
   const u=storageURL(d.url,'sign',d.bucket,d.path);u.searchParams.set('cacheNonce',job.source_version+'-'+job.lease_id);
   const r=await checked(await fetchImpl(u,{headers:{'Accept-Encoding':'identity','Cache-Control':'no-store'},signal,redirect:'error',cache:'no-store'}));
   if(r.headers.get('etag')?.replace(/^"|"$/g,'')!==job.source_etag||(r.headers.get('content-length')!==null&&Number(r.headers.get('content-length'))!==job.source_bytes)||!['identity',null].includes(r.headers.get('content-encoding'))||!r.body){await r.body?.cancel();throw new Error('source_changed');}
   let bytes=0;const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>job.source_bytes)done(new Error('source_excess'));else done(null,chunk);}});
   await pipeline(Readable.fromWeb(r.body),limit,createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});if(bytes!==job.source_bytes)throw new Error('source_truncated');
  },
  async upload(job,asset,file,signal){
   const d=await call('upload',{...jobProof(job),p_name:asset.name},signal);
   if(!d||d.bucket!=='adaptive-media'||d.path!==job.output_prefix+asset.name||d.bytes!==asset.bytes||d.mime!==asset.mime||d.metadata?.processing_lease_id!==job.lease_id||d.metadata?.sha256!==asset.sha256)throw new Error('upload_proof_mismatch');
   const url=storageURL(d.url,'upload/sign',d.bucket,d.path),metadata=Buffer.from(JSON.stringify(d.metadata)).toString('base64');
   const r=await checked(await fetchImpl(url,{method:'PUT',headers:{'Content-Type':asset.mime,'Content-Length':String(asset.bytes),'cache-control':'max-age=31536000','x-upsert':'false','x-metadata':metadata},body:Readable.toWeb(createReadStream(file)),duplex:'half',signal,redirect:'error'}));await r.body?.cancel();
  },
  async remove(prefix,names,signal,lease){
   if(!lease||lease.prefix!==prefix)throw new Error('missing_cleanup_lease');
   for(let i=0;i<names.length;i+=100)await call('cleanup',{p_lease_id:lease.lease_id,p_cleanup_lease:lease.cleanup_lease,p_names:names.slice(i,i+100)},signal);
  },
  async cachedSigning(asset,context,signal){return call('sign',{p_token:context.token,p_bucket:context.bucket,p_path:context.path,p_source_version:context.version,p_name:asset.name,p_lease_id:asset.leaseId},signal);},
 };
}
