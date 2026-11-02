import {pathToFileURL} from 'node:url';
import {workerConfig} from './config.mjs';
import {backend} from './backend.mjs';
import {createWorker} from './worker.mjs';

/** One externally scheduled task, using the same fenced worker as /drain. */
export async function runJob(worker,{signal,report=()=>{}}={}) {
 const result=await worker.drain(signal);
 // Job identity, source paths and capabilities never enter scheduler logs.
 report({event:'media_rendition_job',state:result.state,...(Number.isSafeInteger(result.assets)?{assets:result.assets}:{}),...(Number.isSafeInteger(result.bytes)?{bytes:result.bytes}:{})});
 // Durable retries belong to the database. Mark infrastructure/transient
 // failures for monitoring; set the host's automatic task retries to zero.
 return ['ready','idle','failed','busy'].includes(result.state)?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{
  const config=workerConfig();
  process.exitCode=await runJob(createWorker(backend(config),config),{signal:controller.signal,report:value=>console.log(JSON.stringify(value))});
 }catch{console.error(JSON.stringify({event:'media_rendition_job',state:'unavailable'}));process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
