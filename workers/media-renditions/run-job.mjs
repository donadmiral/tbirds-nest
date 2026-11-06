import {pathToFileURL} from 'node:url';
import {workerConfig} from './config.mjs';
import {backend} from './backend.mjs';
import {createWorker} from './worker.mjs';

/** Sequential work shares one VM reservation and one absolute deadline. */
export async function runJob(worker,{signal,report=()=>{},maxJobs=8,deadlineMs=720000,now=()=>performance.now()}={}) {
 if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>8||!Number.isFinite(deadlineMs)||deadlineMs<1||deadlineMs>720000)throw new Error('invalid_batch_limits');
 const controller=new AbortController(),stop=()=>controller.abort(),started=now();
 const timer=setTimeout(stop,deadlineMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
 let state='idle',reason='max_jobs',attempted=0,ready=0,failed=0,assets=0,bytes=0;
 try{
  while(attempted<maxJobs){
   if(controller.signal.aborted){state='retry';reason='cancelled';break;}
   // Do not claim a fresh lease with less than 30 seconds remaining. The
   // same abort signal also cuts off an in-flight encode at the shared bound.
   if(attempted&&deadlineMs-(now()-started)<30000){reason='deadline_guard';break;}
   const result=await worker.drain(controller.signal);attempted++;state=result.state;
   if(state==='ready'){
    ready++;if(Number.isSafeInteger(result.assets)&&result.assets>=0)assets+=result.assets;
    if(Number.isSafeInteger(result.bytes)&&result.bytes>=0)bytes+=result.bytes;
   }else if(state==='failed')failed++;
   else{reason=state==='idle'?'queue_empty':state;break;}
  }
  if(state==='idle'&&ready)state='ready';
  else if(state==='idle'&&failed)state='failed';
  // Counts only. Job identity, paths, capabilities and raw errors stay private.
  report({event:'media_rendition_job',state,reason,attempted,ready,failed,assets,bytes});
  // Durable retries remain in the database. Never retry a transient failure
  // inside this reservation, or start concurrent encoders.
  return ['ready','idle','failed','busy'].includes(state)?0:1;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{
  const config=workerConfig();
  process.exitCode=await runJob(createWorker(backend(config),config),{signal:controller.signal,deadlineMs:config.deadlineMs,report:value=>console.log(JSON.stringify(value))});
 }catch{console.error(JSON.stringify({event:'media_rendition_job',state:'unavailable'}));process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
