import {mkdtemp,rm,statfs} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UUID,ASSET,validateJob} from './config.mjs';
import {transcode} from './transcode.mjs';
const proof=j=>({p_job_id:j.job_id,p_lease_id:j.lease_id,p_attempt:j.attempt});
export function createWorker(api,{deadlineMs=240000,threads=2,encode=transcode,tempRoot=os.tmpdir(),diskBudgetBytes=1610612736,maxInputBytes=536870912}={}){
 let active=false;
 async function cleanup(signal){
  await api.rpc('reconcile_media_renditions_v2',{p_limit:100},signal);
  const leases=await api.rpc('claim_media_rendition_cleanup_v2',{p_limit:2},signal);
  if(!Array.isArray(leases)||leases.length>2)throw new Error('invalid_cleanup_claim');
  for(const a of leases){if(!UUID.test(a.lease_id)||!UUID.test(a.cleanup_lease)||a.bucket!=='adaptive-media'||!new RegExp(`^[0-9a-f-]{36}/_renditions_v2/[0-9a-f-]{36}/${a.lease_id}/$`,'i').test(a.prefix)||!Array.isArray(a.names)||a.names.length>2048||a.names.some(n=>!ASSET.test(n)))throw new Error('invalid_cleanup_claim');
   await api.remove(a.prefix,a.names,signal,a);if(!await api.rpc('finish_media_rendition_cleanup_v2',{p_lease_id:a.lease_id,p_cleanup_lease:a.cleanup_lease},signal))throw new Error('cleanup_incomplete');
  }
  await api.rpc('prune_media_renditions_v2',{p_limit:10},signal);
 }
 return {
  get active(){return active;},
  async drain(parentSignal){
   if(active)return{state:'busy'};active=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),deadlineMs);const cancel=()=>controller.abort();parentSignal?.addEventListener('abort',cancel,{once:true});if(parentSignal?.aborted)cancel();
   let job,dir;
   try{
    await cleanup(controller.signal);
    const disk=await statfs(tempRoot),usable=Math.min(diskBudgetBytes,Number(disk.bavail)*Number(disk.bsize))-16777216;
    if(usable<67108864)throw new Error('scratch_space_unavailable');
    const claim=await api.rpc('claim_media_rendition_v2',{p_worker_max_bytes:Math.min(maxInputBytes,Math.floor(usable/3))},controller.signal);if(!claim)return{state:'idle'};job=validateJob(claim);
    job={...job,output_max_bytes:Math.min(job.output_max_bytes,usable-job.source_bytes)};
    dir=await mkdtemp(path.join(tempRoot,'pc-rendition-'));const input=path.join(dir,'source'),output=path.join(dir,'output');
    await api.download(job,input,controller.signal);
    const result=await encode(input,output,job,{signal:controller.signal,threads});
    if(!await api.rpc('register_media_rendition_assets_v2',{...proof(job),p_assets:result.assets},controller.signal))throw new Error('source_changed');
    // Deliberately sequential uploads bound sockets, bytes in flight and Storage pressure.
    for(let i=0;i<result.assets.length;i++){
     if(i%20===0&&!await api.rpc('check_media_rendition_v2',proof(job),controller.signal))throw new Error('source_changed');
     const a=result.assets[i];await api.upload(job,a,path.join(output,a.name),controller.signal);
    }
    if(!await api.rpc('finish_media_rendition_v2',{...proof(job),p_outcome:'ready',p_media:result.media},controller.signal))throw new Error('publish_rejected');
    return{state:'ready',assets:result.assets.length,bytes:result.assets.reduce((n,a)=>n+a.bytes,0)};
   }catch(error){
    if(job){const settle=new AbortController();const t=setTimeout(()=>settle.abort(),5000);try{await api.rpc('finish_media_rendition_v2',{...proof(job),p_outcome:error.permanent?'failed':'retry',p_error_code:controller.signal.aborted?'worker_deadline':/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'worker_error',p_retry_after_seconds:error.retryAfter||null},settle.signal);}catch{}finally{clearTimeout(t);}}
    return{state:job?(error.permanent?'failed':'retry'):'unavailable',code:controller.signal.aborted?'worker_deadline':error.message==='upstream_throttled'?'upstream_throttled':'worker_error'};
   }finally{clearTimeout(timer);parentSignal?.removeEventListener('abort',cancel);if(dir)await rm(dir,{recursive:true,force:true});active=false;}
  },cleanup,
 };
}
