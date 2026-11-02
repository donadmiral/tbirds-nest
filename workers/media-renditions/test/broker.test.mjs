import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import{mkdtemp,writeFile,readFile,rm}from'node:fs/promises';
import os from'node:os';
import path from'node:path';
import{createMediaBroker}from'../../../supabase/functions/media-broker/handler.mjs';
import{backend}from'../backend.mjs';
const keyId='40000000-0000-4000-8000-000000000001',jobId='40000000-0000-4000-8000-000000000002',leaseId='40000000-0000-4000-8000-000000000003';
const secret='b'.repeat(64),credential=keyId+'.'+secret,base='https://fixture.supabase.co',source=keyId+'/video.mp4',prefix=`${keyId}/_renditions_v2/${jobId}/${leaseId}/`;
const proof={p_job_id:jobId,p_lease_id:leaseId,p_attempt:1};
function harness(role='worker'){
 const calls=[],nonces=new Set(),transfers=[];let access=true;
 const rpc=async(name,args)=>{calls.push({name,args});if(name==='authorize_media_broker_v2'){assert.equal(args.p_token_hash,createHash('sha256').update(secret).digest('hex'));if(nonces.has(args.p_request_id))return null;nonces.add(args.p_request_id);return role;}
  if(name==='claim_media_rendition_v2')return{lease_id:leaseId};
  if(name==='media_rendition_transfer_v2')return args.p_name?{bucket:'adaptive-media',path:prefix+args.p_name,bytes:4,mime:'video/mp4',metadata:{processing_lease_id:leaseId,sha256:'a'.repeat(64)}}:{bucket:'story-media',path:source,bytes:4,etag:'source-etag',version:'v1'};
  if(name==='resolve_media_delivery')return access?{bucket:'story-media',path:source,version:'v1'}:null;
  if(name==='resolve_media_rendition_v2')return{bucket:'adaptive-media',path:prefix+'r0/seg00000.ts',sourceVersion:'v1',version:'output-v1',name:'r0/seg00000.ts',leaseId};
  if(name==='store_media_rendition_cache_v2')return{token:args.p_token,expiresAt:new Date(Date.now()+3300000).toISOString()};
  throw new Error('unexpected_rpc');};
 const storage={async downloadURL(bucket,p){transfers.push({bucket,path:p});return`${base}/storage/v1/object/sign/${bucket}/${p}?token=internal.signed.value`;},async uploadURL(bucket,p){transfers.push({bucket,path:p});return`${base}/storage/v1/object/upload/sign/${bucket}/${p}?token=upload.signed.value`;},async remove(){throw new Error('unexpected_remove');}};
 const handler=createMediaBroker({base,rpc,storage});
 const request=(action,args,headers={})=>new Request(base+'/functions/v1/media-broker',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json','X-Media-Request-ID':randomUUID(),'X-Media-Issued-At':new Date().toISOString(),...headers},body:JSON.stringify({action,args})});
 return{handler,request,calls,transfers,storage,deny(){access=false;}};
}
test('media broker rejects arbitrary operations, missing credentials, stale requests and cross-role actions',async()=>{
 const h=harness();assert.equal((await h.handler(h.request('sql',{query:'select 1'}))).status,404);assert.equal(h.calls.length,0);
 assert.equal((await h.handler(h.request('claim',{p_worker_max_bytes:128},{Authorization:''}))).status,401);
 assert.equal((await h.handler(h.request('claim',{p_worker_max_bytes:128},{'X-Media-Issued-At':'2001-01-01'}))).status,401);
 assert.equal((await h.handler(h.request('ticket',{p_token:secret,p_bucket:'story-media',p_path:source}))).status,403);
 const g=harness('gateway');assert.equal((await g.handler(g.request('claim',{p_worker_max_bytes:128}))).status,403);assert.ok(!g.calls.some(c=>c.name==='claim_media_rendition_v2'));
});
test('broker request IDs are one use and transfer sources come from canonical lease descriptors',async()=>{
 const h=harness(),req=h.request('source',proof),copy=req.clone();const response=await h.handler(req);assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.path,source);assert.equal((await h.handler(copy)).status,403);
 assert.equal((await h.handler(h.request('source',{...proof,path:'other/private-file'}))).status,400);
 assert.equal((await h.handler(h.request('upload',{...proof,p_name:'../../original.mp4'}))).status,400);
});
test('gateway signing rechecks viewer rights and refuses foreign Storage origins',async()=>{
 const h=harness('gateway'),args={p_token:secret,p_bucket:'story-media',p_path:source,p_source_version:'v1',p_name:'r0/seg00000.ts',p_lease_id:leaseId};
 assert.equal((await h.handler(h.request('sign',args))).status,200);assert.equal(h.transfers.length,1);h.deny();assert.equal((await h.handler(h.request('sign',args))).status,403);assert.equal(h.transfers.length,1);
 const w=harness();w.storage.downloadURL=async()=>`https://foreign.invalid/object?token=foo`;assert.equal((await w.handler(w.request('source',proof))).status,503);
});
test('scoped backend streams signed source/upload bytes without forwarding its broker credential to Storage',async()=>{
 const h=harness(),seen=[],fetchImpl=async(url,init)=>{
  const u=new URL(url);if(u.pathname==='/functions/v1/media-broker')return h.handler(new Request(u,init));
  seen.push({url:u,init});assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.apikey,undefined);
  if(init.method==='PUT'){assert.equal(await new Response(init.body).text(),'data');assert.equal(JSON.parse(Buffer.from(init.headers['x-metadata'],'base64')).processing_lease_id,leaseId);return new Response('{}');}
  return new Response('data',{headers:{ETag:'"source-etag"','Content-Length':'4'}});
 },api=backend({base,brokerUrl:base+'/functions/v1/media-broker',brokerKey:credential,fetchImpl}),dir=await mkdtemp(path.join(os.tmpdir(),'pc-broker-test-'));
 try{const j={job_id:jobId,lease_id:leaseId,attempt:1,source_bucket:'story-media',source_path:source,source_version:'v1',source_etag:'source-etag',source_bytes:4,output_prefix:prefix};
  const file=path.join(dir,'source');await api.download(j,file);assert.equal(await readFile(file,'utf8'),'data');
  await api.upload(j,{name:'fallback.mp4',bytes:4,mime:'video/mp4',sha256:'a'.repeat(64)},file);assert.equal(seen.length,2);await assert.rejects(api.rpc('admin_delete_user'),/unsupported_media_operation/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
